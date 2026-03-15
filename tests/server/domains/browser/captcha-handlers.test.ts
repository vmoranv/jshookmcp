import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerState } = vi.hoisted(() => ({
  loggerState: {
    info: vi.fn(),
  },
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { CaptchaHandlers } from '@server/domains/browser/handlers/captcha-handlers';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('CaptchaHandlers', () => {
  const page = { id: 'page-1' } as any;
  const pageController = {
    getPage: vi.fn(),
  } as any;
  const captchaDetector = {
    detect: vi.fn(),
    waitForCompletion: vi.fn(),
  } as any;

  let deps: any;
  let handlers: CaptchaHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController.getPage.mockResolvedValue(page);

    deps = {
      pageController,
      captchaDetector,
      autoDetectCaptcha: true,
      autoSwitchHeadless: false,
      captchaTimeout: 30000,
      setAutoDetectCaptcha: vi.fn((value: boolean) => {
        deps.autoDetectCaptcha = value;
      }),
      setAutoSwitchHeadless: vi.fn((value: boolean) => {
        deps.autoSwitchHeadless = value;
      }),
      setCaptchaTimeout: vi.fn((value: number) => {
        deps.captchaTimeout = value;
      }),
    };

    handlers = new CaptchaHandlers(deps);
  });

  it('returns detection results from the captcha detector', async () => {
    captchaDetector.detect.mockResolvedValue({
      detected: true,
      type: 'turnstile',
      confidence: 0.91,
    });

    const body = parseJson(await handlers.handleCaptchaDetect({}));

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(captchaDetector.detect).toHaveBeenCalledWith(page);
    expect(body).toEqual({
      success: true,
      captcha_detected: true,
      captcha_info: {
        detected: true,
        type: 'turnstile',
        confidence: 0.91,
      },
    });
  });

  it('waits with the configured default timeout and reports success', async () => {
    captchaDetector.waitForCompletion.mockResolvedValue(true);

    const body = parseJson(await handlers.handleCaptchaWait({}));

    expect(loggerState.info).toHaveBeenCalledWith('Waiting for CAPTCHA to be solved...');
    expect(captchaDetector.waitForCompletion).toHaveBeenCalledWith(page, 30000);
    expect(body).toEqual({
      success: true,
      message: 'CAPTCHA solved',
    });
  });

  it('uses an explicit timeout and reports timeout failures', async () => {
    captchaDetector.waitForCompletion.mockResolvedValue(false);

    const body = parseJson(await handlers.handleCaptchaWait({ timeout: 1500 }));

    expect(captchaDetector.waitForCompletion).toHaveBeenCalledWith(page, 1500);
    expect(body).toEqual({
      success: false,
      message: 'CAPTCHA wait timed out',
    });
  });

  it('updates captcha configuration through setter callbacks', async () => {
    const body = parseJson(
      await handlers.handleCaptchaConfig({
        autoDetectCaptcha: false,
        autoSwitchHeadless: true,
        captchaTimeout: 120000,
      })
    );

    expect(deps.setAutoDetectCaptcha).toHaveBeenCalledWith(false);
    expect(deps.setAutoSwitchHeadless).toHaveBeenCalledWith(true);
    expect(deps.setCaptchaTimeout).toHaveBeenCalledWith(120000);
    expect(body).toEqual({
      success: true,
      config: {
        autoDetectCaptcha: false,
        autoSwitchHeadless: true,
        captchaTimeout: 120000,
      },
    });
  });
});

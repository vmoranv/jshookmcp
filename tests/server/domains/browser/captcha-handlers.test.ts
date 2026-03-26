import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  CommonSuccessResponse,
  CaptchaDetectionResult,
} from '@tests/shared/common-test-types';

const { loggerState } = vi.hoisted(() => ({
  loggerState: {
    info: vi.fn(),
  },
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { CaptchaHandlers } from '@server/domains/browser/handlers/captcha-handlers';

interface PageControllerMock {
  getPage: Mock<() => Promise<any>>;
}

interface CaptchaDetectorMock {
  detect: Mock<(page: any) => Promise<any>>;
  waitForCompletion: Mock<(page: any, timeout: number) => Promise<boolean>>;
}

describe('CaptchaHandlers', () => {
  const page = { id: 'page-1' };
  const pageController: PageControllerMock = {
    getPage: vi.fn(),
  };
  const captchaDetector: CaptchaDetectorMock = {
    detect: vi.fn(),
    waitForCompletion: vi.fn(),
  };

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

    const body = parseJson<
      CommonSuccessResponse & { captcha_detected: boolean; captcha_info: CaptchaDetectionResult }
    >(await handlers.handleCaptchaDetect({}));

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

    const body = parseJson<CommonSuccessResponse & { message: string }>(
      await handlers.handleCaptchaWait({}),
    );

    expect(loggerState.info).toHaveBeenCalledWith('Waiting for CAPTCHA to be solved...');
    expect(captchaDetector.waitForCompletion).toHaveBeenCalledWith(page, 30000);
    expect(body).toEqual({
      success: true,
      message: 'CAPTCHA solved',
    });
  });

  it('uses an explicit timeout and reports timeout failures', async () => {
    captchaDetector.waitForCompletion.mockResolvedValue(false);

    const body = parseJson<CommonSuccessResponse & { message: string }>(
      await handlers.handleCaptchaWait({ timeout: 1500 }),
    );

    expect(captchaDetector.waitForCompletion).toHaveBeenCalledWith(page, 1500);
    expect(body).toEqual({
      success: false,
      message: 'CAPTCHA wait timed out',
    });
  });

  it('updates captcha configuration through setter callbacks', async () => {
    const body = parseJson<CommonSuccessResponse & { config: any }>(
      await handlers.handleCaptchaConfig({
        autoDetectCaptcha: false,
        autoSwitchHeadless: true,
        captchaTimeout: 120000,
      }),
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

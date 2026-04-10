import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Page } from 'rebrowser-puppeteer-core';
import { CaptchaDetector } from '@modules/captcha/CaptchaDetector';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

class TestCaptchaDetector extends CaptchaDetector {
  public override async checkPageText(page: Page) {
    return super.checkPageText(page);
  }
  public override async verifyByDOM(page: Page) {
    return super.verifyByDOM(page);
  }
  public override async verifySliderElement(page: Page, selector: string) {
    return super.verifySliderElement(page, selector);
  }
}

function runInBrowserContext<T>(
  source: (...args: any[]) => T,
  context: Record<string, unknown>,
  args: any[] = [],
): T {
  const runner = new Function(
    'context',
    'args',
    `with (context) {
      const fn = ${source.toString()};
      return fn(...args);
    }`,
  );
  return runner(context, args) as T;
}

function createDirectEvaluatePage(context: Record<string, unknown>) {
  return {
    evaluate: vi.fn(async (fn: (...args: any[]) => unknown, ...args: any[]) =>
      runInBrowserContext(fn, context, args),
    ),
  } as unknown as Page;
}

describe('CaptchaDetector callback coverage', () => {
  let detector: TestCaptchaDetector;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as Mock).mockReset?.());
    detector = new TestCaptchaDetector();
  });

  it('executes checkPageText positive branch with warning and detailed payload', async () => {
    const page = createDirectEvaluatePage({
      document: {
        body: {
          innerText: '请完成安全验证后继续访问',
        },
      },
      window: {},
    });
    // @ts-expect-error
    vi.spyOn(detector, 'confirmRuleWithDOM').mockResolvedValueOnce(true);

    const result = await detector.checkPageText(page);

    expect(result.detected).toBe(true);
    expect(result.details).toEqual(
      expect.objectContaining({
        ruleId: expect.any(String),
        keyword: expect.any(String),
        matchText: expect.any(String),
      }),
    );
    expect(loggerState.warn).toHaveBeenCalledWith(
      expect.stringContaining('CAPTCHA text rule detected'),
    );
  });

  it('executes widget and browser-check DOM verification callbacks and error fallback', async () => {
    const widgetPage = createDirectEvaluatePage({
      document: {
        querySelector: (selector: string) =>
          selector === 'iframe[src*="challenge" i]' ? { nodeType: 1 } : null,
      },
    });
    await expect(detector.verifyByDOM(widgetPage)).resolves.toBe(true);

    const browserCheckPage = createDirectEvaluatePage({
      document: {
        querySelector: (selector: string) =>
          selector === '[class*="security-check"]' ? { nodeType: 1 } : null,
      },
    });
    await expect(detector.verifyByDOM(browserCheckPage)).resolves.toBe(true);

    const brokenPage = {
      evaluate: vi.fn(async () => {
        throw new Error('dom-eval-failed');
      }),
    } as unknown as Page;
    await expect(detector.verifyByDOM(brokenPage)).resolves.toBe(false);
    expect(loggerState.error).toHaveBeenCalledWith(
      'DOM verification failed during CAPTCHA detection',
      expect.any(Error),
    );
  });

  it('executes remaining slider heuristics and catch path', async () => {
    const createSliderPage = (elementFactory: () => any, cursor = 'default') =>
      createDirectEvaluatePage({
        document: {
          querySelector: (selector: string) =>
            selector === '.captcha-slider' ? elementFactory() : null,
        },
        window: {
          getComputedStyle: () => ({ cursor }),
        },
        console,
      });

    const parentAttrPage = createSliderPage(() => ({
      matches: () => false,
      closest: () => null,
      getBoundingClientRect: () => ({ width: 140, height: 48 }),
      className: 'slide',
      id: 'solver',
      hasAttribute: (name: string) => name === 'data-slide',
      parentElement: {
        className: 'wrapper',
        id: 'verify-shell',
        parentElement: null,
      },
    }));
    await expect(detector.verifySliderElement(parentAttrPage, '.captcha-slider')).resolves.toBe(
      true,
    );

    const keywordRejectPage = createSliderPage(() => ({
      matches: () => false,
      closest: () => null,
      getBoundingClientRect: () => ({ width: 140, height: 48 }),
      className: 'plain',
      id: 'timeline-slider',
      hasAttribute: () => false,
      parentElement: null,
    }));
    await expect(detector.verifySliderElement(keywordRejectPage, '.captcha-slider')).resolves.toBe(
      false,
    );

    const catchPage = {
      evaluate: vi.fn(async () => {
        throw new Error('slider-eval-failed');
      }),
    } as unknown as Page;
    await expect(detector.verifySliderElement(catchPage, '.captcha-slider')).resolves.toBe(false);
    expect(loggerState.error).toHaveBeenCalledWith(
      'Slider element verification failed',
      expect.any(Error),
    );
  });
});

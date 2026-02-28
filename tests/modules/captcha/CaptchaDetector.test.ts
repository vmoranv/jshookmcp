import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import { CaptchaDetector } from '../../../src/modules/captcha/CaptchaDetector.js';

function createPage(overrides: Partial<any> = {}) {
  return {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(async () => 'home'),
    $: vi.fn(async () => null),
    evaluate: vi.fn(async () => false),
    ...overrides,
  } as any;
}

describe('CaptchaDetector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('returns immediately when URL check detects captcha', async () => {
    const detector = new CaptchaDetector() as any;
    const page = createPage();
    vi.spyOn(detector, 'checkUrl').mockResolvedValue({
      detected: true,
      type: 'cloudflare',
      confidence: 99,
    });
    const titleSpy = vi.spyOn(detector, 'checkTitle');

    const result = await detector.detect(page);

    expect(result.detected).toBe(true);
    expect(titleSpy).not.toHaveBeenCalled();
  });

  it('treats known URL exclude keywords as false positives', async () => {
    const detector = new CaptchaDetector() as any;
    const page = createPage({ url: vi.fn(() => 'https://x.test/verify-email') });

    const result = await detector.checkUrl(page);

    expect(result.detected).toBe(false);
    expect(result.falsePositiveReason).toContain('verify-email');
  });

  it('detects cloudflare captcha from URL signature', async () => {
    const detector = new CaptchaDetector() as any;
    const page = createPage({ url: vi.fn(() => 'https://a.com/cdn-cgi/challenge-platform') });

    const result = await detector.checkUrl(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare');
    expect(result.vendor).toBe('cloudflare');
    expect(result.confidence).toBe(95);
  });

  it('detects visible slider captcha elements and infers vendor', async () => {
    const detector = new CaptchaDetector() as any;
    const element = { isIntersectingViewport: vi.fn(async () => true) };
    const page = createPage({
      $: vi.fn(async (selector: string) => (selector.includes('geetest_slider') ? element : null)),
    });
    vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(true);

    const result = await detector.checkDOMElements(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('slider');
    expect(result.vendor).toBe('geetest');
  });

  it('waitForCompletion resolves true once captcha disappears', async () => {
    vi.useFakeTimers();
    const detector = new CaptchaDetector();
    const page = createPage();
    vi.spyOn(detector, 'detect')
      .mockResolvedValueOnce({ detected: true, confidence: 90 })
      .mockResolvedValueOnce({ detected: false, confidence: 0 });

    const promise = detector.waitForCompletion(page, 5000);
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(result).toBe(true);
  });

  it('returns false from waitForCompletion on timeout', async () => {
    vi.useFakeTimers();
    const detector = new CaptchaDetector();
    const page = createPage();
    vi.spyOn(detector, 'detect').mockResolvedValue({ detected: true, confidence: 100 });

    const promise = detector.waitForCompletion(page, 1000);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;

    expect(result).toBe(false);
  });

  it('returns safe fallback when detect pipeline throws', async () => {
    const detector = new CaptchaDetector() as any;
    const page = createPage();
    vi.spyOn(detector, 'checkUrl').mockRejectedValue(new Error('boom'));

    const result = await detector.detect(page);

    expect(result).toEqual({ detected: false, confidence: 0 });
    expect(loggerState.error).toHaveBeenCalled();
  });
});


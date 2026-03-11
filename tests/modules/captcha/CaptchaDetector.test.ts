import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { CaptchaDetector } from '@modules/captcha/CaptchaDetector';
import {
  CAPTCHA_KEYWORDS,
  EXCLUDE_KEYWORDS,
} from '@modules/captcha/CaptchaDetector.constants';

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

  describe('Constants validation', () => {
    it.each([
      ['CAPTCHA_KEYWORDS.title', CAPTCHA_KEYWORDS.title],
      ['CAPTCHA_KEYWORDS.url', CAPTCHA_KEYWORDS.url],
      ['CAPTCHA_KEYWORDS.text', CAPTCHA_KEYWORDS.text],
      ['EXCLUDE_KEYWORDS.title', EXCLUDE_KEYWORDS.title],
      ['EXCLUDE_KEYWORDS.url', EXCLUDE_KEYWORDS.url],
      ['EXCLUDE_KEYWORDS.text', EXCLUDE_KEYWORDS.text],
    ])('has no empty strings in %s', (_label, values) => {
      const emptyStrings = values.filter((keyword: string) => keyword === '');
      expect(emptyStrings).toHaveLength(0);
    });

    it('includes Chinese keywords for detection', () => {
      expect(CAPTCHA_KEYWORDS.title).toContain('验证码');
      expect(CAPTCHA_KEYWORDS.text).toContain('请完成安全验证');
    });

    it('includes Chinese keywords for exclusion', () => {
      expect(EXCLUDE_KEYWORDS.title).toContain('短信验证');
      expect(EXCLUDE_KEYWORDS.text).toContain('输入验证码');
    });

    it.each([
      ['https://example.com/cdn-cgi/challenge/arkose', 'edge_service', 'browser_check'],
      ['https://example.com/cdn-cgi/challenge/funcaptcha', 'edge_service', 'browser_check'],
      ['https://example.com/cdn-cgi/challenge/friendly-captcha', 'edge_service', 'browser_check'],
      ['https://example.com/aliyun/captcha', 'regional_service', 'slider'],
      ['https://example.com/tencent/captcha', 'regional_service', 'slider'],
      ['https://example.com/netease-captcha', 'regional_service', 'slider'],
    ])('detects captcha when URL contains provider signal: %s', async (url, providerHint, type) => {
      const detector = new CaptchaDetector() as any;
      const page = createPage({ url: vi.fn(() => url) });

      const result = await detector.detect(page);

      expect(result.detected).toBe(true);
      expect(result.providerHint).toBe(providerHint);
      expect(result.type).toBe(type);
      expect(result.confidence).toBeGreaterThanOrEqual(85);
    });
  });

  it('returns immediately when URL check detects captcha', async () => {
    const detector = new CaptchaDetector() as any;
    const page = createPage();
    vi.spyOn(detector, 'checkUrl').mockResolvedValue({
      detected: true,
      type: 'unknown',
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
    expect(result.type).toBe('none');
    expect(result.falsePositiveReason).toContain('verify-email');
  });

  it('detects managed challenge from URL signature', async () => {
    const detector = new CaptchaDetector() as any;
    const page = createPage({ url: vi.fn(() => 'https://a.com/cdn-cgi/challenge-platform') });

    const result = await detector.checkUrl(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('browser_check');
    expect(result.providerHint).toBe('edge_service');
    expect(result.confidence).toBe(95);
  });

  it('detects visible slider captcha elements and surfaces a generic provider hint', async () => {
    const detector = new CaptchaDetector() as any;
    const element = { isIntersectingViewport: vi.fn(async () => true) };
    const page = createPage({
      $: vi.fn(async (selector: string) => (selector.includes('geetest_slider') ? element : null)),
    });
    vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(true);

    const result = await detector.checkDOMElements(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('slider');
    expect(result.providerHint).toBe('regional_service');
  });

  it('waitForCompletion resolves true once captcha disappears', async () => {
    vi.useFakeTimers();
    const detector = new CaptchaDetector();
    const page = createPage();
    vi.spyOn(detector, 'detect')
      .mockResolvedValueOnce({ detected: true, type: 'unknown', confidence: 90 })
      .mockResolvedValueOnce({ detected: false, type: 'none', confidence: 0 });

    const promise = detector.waitForCompletion(page, 5000);
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(result).toBe(true);
  });

  it('returns false from waitForCompletion on timeout', async () => {
    vi.useFakeTimers();
    const detector = new CaptchaDetector();
    const page = createPage();
    vi.spyOn(detector, 'detect').mockResolvedValue({ detected: true, type: 'unknown', confidence: 100 });

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

    expect(result).toEqual({ detected: false, type: 'none', confidence: 0 });
    expect(loggerState.error).toHaveBeenCalled();
  });
});


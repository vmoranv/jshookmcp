import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Page } from 'rebrowser-puppeteer-core';
import { CaptchaDetector } from '@modules/captcha/CaptchaDetector';
import { CAPTCHA_KEYWORDS, EXCLUDE_KEYWORDS } from '@modules/captcha/CaptchaDetector.constants';
import type { CaptchaDetectionResult, CaptchaAssessment } from '@modules/captcha/types';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.unmock('@modules/captcha/CaptchaDetector');
vi.unmock('@src/modules/captcha/CaptchaDetector');

class TestCaptchaDetector extends CaptchaDetector {
  public override async checkUrl(page: Page): Promise<CaptchaDetectionResult> {
    return super.checkUrl(page);
  }
  public override async checkTitle(page: Page): Promise<CaptchaDetectionResult> {
    return super.checkTitle(page);
  }
  public override async checkDOMElements(page: Page): Promise<CaptchaDetectionResult> {
    return super.checkDOMElements(page);
  }
  public override async checkVendorSpecific(page: Page): Promise<CaptchaDetectionResult> {
    return super.checkVendorSpecific(page);
  }
  public override async checkPageText(page: Page): Promise<CaptchaDetectionResult> {
    return super.checkPageText(page);
  }
  public override async verifySliderElement(page: Page, selector: string): Promise<boolean> {
    return super.verifySliderElement(page, selector);
  }
}

interface PageMock {
  url: Mock<() => string>;
  title: Mock<() => Promise<string>>;
  $: any;
  evaluate: any;
}

function createPage(overrides: Partial<PageMock> = {}): any {
  return {
    url: vi.fn(() => 'https://vmoranv.github.io/jshookmcp'),
    title: vi.fn(async () => 'home'),
    $: vi.fn(async () => null),
    evaluate: vi.fn(async () => false),
    ...overrides,
  };
}

describe('CaptchaDetector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as Mock).mockReset?.());
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
      [
        'https://vmoranv.github.io/jshookmcp/cdn-cgi/challenge-platform',
        'edge_service',
        'browser_check',
      ],
      [
        'https://vmoranv.github.io/jshookmcp/browser-check/interstitial',
        'edge_service',
        'browser_check',
      ],
      ['https://vmoranv.github.io/jshookmcp/security-check', 'edge_service', 'browser_check'],
      [
        'https://vmoranv.github.io/jshookmcp/widget-challenge?sitekey=abc',
        'embedded_widget',
        'widget',
      ],
      ['https://vmoranv.github.io/jshookmcp/captcha-frame', 'embedded_widget', 'widget'],
    ])('detects captcha when URL contains provider signal: %s', async (url, providerHint, type) => {
      const detector = new CaptchaDetector();
      const page = createPage({ url: vi.fn(() => url) });

      const result = await detector.detect(page);

      expect(result.detected).toBe(true);
      expect(result.providerHint).toBe(providerHint);
      expect(result.type).toBe(type);
      expect(result.confidence).toBeGreaterThanOrEqual(85);
    });
  });

  it('returns immediately when URL check detects captcha', async () => {
    const detector = new TestCaptchaDetector();
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
    const detector = new TestCaptchaDetector();
    const page = createPage({
      url: vi.fn(() => 'https://vmoranv.github.io/jshookmcp/test/verify-email'),
    });

    const result = await detector.checkUrl(page);

    expect(result.detected).toBe(false);
    expect(result.type).toBe('none');
    expect(result.falsePositiveReason).toContain('verify-email');
  });

  it('detects managed challenge from URL signature', async () => {
    const detector = new TestCaptchaDetector();
    const page = createPage({
      url: vi.fn(() => 'https://vmoranv.github.io/jshookmcp/cdn-cgi/challenge-platform'),
    });

    const result = await detector.checkUrl(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('browser_check');
    expect(result.providerHint).toBe('edge_service');
    expect(result.confidence).toBe(95);
  });

  it('detects visible slider captcha elements and surfaces a generic provider hint', async () => {
    const detector = new TestCaptchaDetector();
    const element = { isIntersectingViewport: vi.fn(async () => true) } as any;
    const page = createPage({
      $: vi.fn(async (selector: string) => (selector.includes('captcha-slider') ? element : null)),
    });
    vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(true);

    const result = await detector.checkDOMElements(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('slider');
    expect(result.providerHint).toBeUndefined();
  });

  it('detects embedded widget DOM rules through generic widget selectors', async () => {
    const detector = new TestCaptchaDetector();
    const element = { isIntersectingViewport: vi.fn(async () => true) } as any;
    const page = createPage({
      $: vi.fn(async (selector: string) => (selector.includes('data-sitekey') ? element : null)),
    });

    const result = await detector.checkDOMElements(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('widget');
    expect(result.providerHint).toBe('embedded_widget');
    expect(result.selector).toContain('data-sitekey');
  });

  it('does not rely on vendor-specific runtime globals in mainline detection', async () => {
    const detector = new TestCaptchaDetector();
    const page = createPage({
      evaluate: vi.fn(async () => ({ matchedGlobal: 'SomeCaptchaGlobal' })),
    });

    const result = await detector.checkVendorSpecific(page);

    expect(result).toEqual({ detected: false, type: 'none', confidence: 0 });
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
    vi.spyOn(detector, 'detect').mockResolvedValue({
      detected: true,
      type: 'unknown',
      confidence: 100,
    });

    const promise = detector.waitForCompletion(page, 1000);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;

    expect(result).toBe(false);
  });

  it('returns safe fallback when detect pipeline throws', async () => {
    const detector = new TestCaptchaDetector();
    const page = createPage();
    vi.spyOn(detector, 'checkUrl').mockRejectedValue(new Error('boom'));

    const result = await detector.detect(page);

    expect(result).toEqual({ detected: false, type: 'none', confidence: 0 });
    expect(loggerState.error).toHaveBeenCalled();
  });

  it('builds an assessment with candidates and a manual recommendation for strong signals', async () => {
    const detector = new TestCaptchaDetector();
    const page = createPage();

    vi.spyOn(detector, 'checkUrl').mockResolvedValue({
      detected: true,
      type: 'browser_check',
      url: 'https://vmoranv.github.io/jshookmcp/cdn-cgi/challenge',
      providerHint: 'edge_service',
      confidence: 95,
    });
    vi.spyOn(detector, 'checkTitle').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });
    vi.spyOn(detector, 'checkDOMElements').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });
    vi.spyOn(detector, 'checkPageText').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });
    vi.spyOn(detector, 'checkVendorSpecific').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });

    const assessment: CaptchaAssessment = await detector.assess(page);

    expect(assessment.likelyCaptcha).toBe(true);
    expect(assessment.recommendedNextStep).toBe('manual');
    expect(assessment.candidates).toEqual([
      expect.objectContaining({
        source: 'url',
        type: 'browser_check',
        providerHint: 'edge_service',
        confidence: 95,
      }),
    ]);
    expect(assessment.primaryDetection).toEqual(
      expect.objectContaining({
        detected: true,
        type: 'browser_check',
        confidence: 95,
      }),
    );
  });

  it('marks mixed weak signals for AI review instead of immediate action', async () => {
    const detector = new TestCaptchaDetector();
    const page = createPage();

    vi.spyOn(detector, 'checkUrl').mockResolvedValue({
      detected: true,
      type: 'url_redirect',
      url: 'https://vmoranv.github.io/jshookmcp/challenge',
      confidence: 70,
    });
    vi.spyOn(detector, 'checkTitle').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 88,
      falsePositiveReason: 'Title exclusion: verification code',
    });
    vi.spyOn(detector, 'checkDOMElements').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });
    vi.spyOn(detector, 'checkPageText').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });
    vi.spyOn(detector, 'checkVendorSpecific').mockResolvedValue({
      detected: false,
      type: 'none',
      confidence: 0,
    });

    const assessment: CaptchaAssessment = await detector.assess(page);

    expect(assessment.likelyCaptcha).toBe(false);
    expect(assessment.recommendedNextStep).toBe('ask_ai');
    expect(assessment.excludeScore).toBeDefined();
    if (assessment.excludeScore !== undefined) {
      expect(assessment.excludeScore).toBeGreaterThan(0);
    }
    expect(assessment.primaryDetection).toEqual({
      detected: false,
      type: 'none',
      confidence: 0,
      details: expect.objectContaining({
        candidates: expect.any(Array),
      }),
    });
  });
});

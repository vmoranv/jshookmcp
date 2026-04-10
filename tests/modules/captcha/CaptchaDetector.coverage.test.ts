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

vi.unmock('@modules/captcha/CaptchaDetector');
vi.unmock('@src/modules/captcha/CaptchaDetector');

import { CaptchaDetector } from '@modules/captcha/CaptchaDetector';
import { createPageMock } from '../../server/domains/shared/mock-factories';

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

async function withBrowserGlobals<T>(
  context: Record<string, unknown>,
  callback: () => T | Promise<T>,
): Promise<T> {
  const previousDocument = (globalThis as Record<string, unknown>).document;
  const previousWindow = (globalThis as Record<string, unknown>).window;

  (globalThis as Record<string, unknown>).document = context.document;
  (globalThis as Record<string, unknown>).window = context.window;

  try {
    return await callback();
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = previousDocument;
    }

    if (previousWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = previousWindow;
    }
  }
}

function createDirectEvaluatePage(context: Record<string, unknown>) {
  return createPageMock({
    evaluate: vi.fn(async (fn: (...args: any[]) => unknown, ...args: any[]) =>
      withBrowserGlobals(context, () => fn(...args)),
    ),
  });
}

class TestCaptchaDetector extends CaptchaDetector {
  public override toAssessmentSignal(source: any, result: any) {
    return super.toAssessmentSignal(source, result);
  }
  public override toAssessmentCandidate(source: any, result: any) {
    return super.toAssessmentCandidate(source, result);
  }
  public override getSignalValue(source: any, result: any) {
    return super.getSignalValue(source, result);
  }
  public override matchRule(value: any, rules: any) {
    return super.matchRule(value, rules);
  }
  public override async confirmRuleWithDOM(page: any, rule: any) {
    return super.confirmRuleWithDOM(page, rule);
  }
  public override buildExcludeResult(sourceLabel: any, rule: any, matchText: any) {
    return super.buildExcludeResult(sourceLabel, rule, matchText);
  }
  public override buildCaptchaResult(payload: any) {
    return super.buildCaptchaResult(payload);
  }
  public override async evaluateDomRule(page: any, rule: any) {
    return super.evaluateDomRule(page, rule);
  }
  public override async checkUrl(page: any) {
    return super.checkUrl(page);
  }
  public override async checkTitle(page: any) {
    return super.checkTitle(page);
  }
  public override async checkDOMElements(page: any) {
    return super.checkDOMElements(page);
  }
  public override async checkPageText(page: any) {
    return super.checkPageText(page);
  }
  public override async checkVendorSpecific(page: any) {
    return super.checkVendorSpecific(page);
  }
  public override async verifyByDOM(page: any) {
    return super.verifyByDOM(page);
  }
  public override async verifySliderElement(page: any, selector: any) {
    return super.verifySliderElement(page, selector);
  }
}

describe('CaptchaDetector — coverage expansion', () => {
  let detector: TestCaptchaDetector;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    detector = new TestCaptchaDetector();
  });

  // ── assess: check error recovery per individual check ──

  describe('assess — error handling', () => {
    it('continues running remaining checks when one check throws', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockRejectedValue(new Error('url fail'));
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('url'),
        expect.any(Error),
      );
      expect(assessment.likelyCaptcha).toBe(false);
      expect(assessment.recommendedNextStep).toBe('ignore');
    });

    it('accumulates signals from multiple detected sources', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/cdn-cgi/challenge',
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 78,
        title: 'Verify',
      });
      vi.spyOn(detector, 'checkDOMElements').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 98,
        selector: '[data-sitekey]',
        providerHint: 'embedded_widget',
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(assessment.signals.length).toBeGreaterThanOrEqual(3);
      expect(assessment.candidates.length).toBe(3);
      // Highest confidence wins as primary
      expect(assessment.primaryDetection.type).toBe('widget');
      expect(assessment.primaryDetection.confidence).toBe(98);
      expect(assessment.likelyCaptcha).toBe(true);
    });
  });

  // ── assess: recommendedNextStep edge cases ──

  describe('getRecommendedNextStep', () => {
    it('returns ignore when no candidates', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);
      expect(assessment.recommendedNextStep).toBe('ignore');
    });

    it('returns observe when likely captcha with moderate confidence and no exclude signals', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 90,
        providerHint: 'embedded_widget',
        url: 'https://example.com/captcha-frame',
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);
      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('observe');
    });

    it('returns manual when score minus excludeScore >= 120', async () => {
      const page = createPageMock();

      // Score: 95 + 90 = 185, excludeScore = 0, score - excludeScore = 185 >= 120
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 90,
        providerHint: 'edge_service',
        title: 'Verify',
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('manual');
    });

    it('returns ask_ai when likely captcha but has excludeScore > 0', async () => {
      const page = createPageMock();

      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 90,
        url: 'https://example.com/challenge',
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(assessment.excludeScore).toBeGreaterThan(0);
      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('ask_ai');
    });

    it('returns manual when candidateCount >= 2', async () => {
      const page = createPageMock();

      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 90,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 78,
        title: 'Verify',
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(assessment.candidates.length).toBe(2);
      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('manual');
    });
  });

  // ── assess: primaryDetection with ambiguous signals ──

  describe('assess — ambiguous primaryDetection', () => {
    it('wraps candidates in details when likelyCaptcha is false and candidates exist', async () => {
      const page = createPageMock();

      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 50,
        url: 'https://example.com/verify',
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(assessment.likelyCaptcha).toBe(false);
      expect(assessment.primaryDetection.detected).toBe(false);
      expect(assessment.primaryDetection.details).toEqual({
        candidates: expect.any(Array),
        reason: expect.stringContaining('ambiguous'),
      });
    });

    it('omits details when likelyCaptcha is false and no candidates exist', async () => {
      const page = createPageMock();

      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const assessment = await detector.assess(page);

      expect(assessment.likelyCaptcha).toBe(false);
      expect(assessment.primaryDetection.details).toBeUndefined();
    });
  });

  // ── toAssessmentSignal / toAssessmentCandidate ──

  describe('toAssessmentSignal', () => {
    it('returns exclude signal for falsePositiveReason result', async () => {
      const result = {
        detected: false,
        type: 'none' as const,
        confidence: 88,
        falsePositiveReason: 'Title exclusion: test',
      };
      const signal = detector.toAssessmentSignal('title', result);
      expect(signal).toEqual({
        source: 'title',
        kind: 'exclude',
        value: 'Title exclusion: test',
        confidence: 88,
      });
    });

    it('returns null for non-detected result without falsePositiveReason', async () => {
      const result = { detected: false, type: 'none' as const, confidence: 0 };
      const signal = detector.toAssessmentSignal('url', result);
      expect(signal).toBeNull();
    });

    it('returns captcha signal for detected result', async () => {
      const result = {
        detected: true,
        type: 'widget' as const,
        confidence: 98,
        providerHint: 'embedded_widget',
        selector: '[data-sitekey]',
      };
      const signal = detector.toAssessmentSignal('dom', result);
      expect(signal!.kind).toBe('captcha');
      expect(signal!.source).toBe('dom');
    });
  });

  describe('toAssessmentCandidate', () => {
    it('returns null for non-detected result', async () => {
      const result = { detected: false, type: 'none' as const, confidence: 0 };
      const candidate = detector.toAssessmentCandidate('url', result);
      expect(candidate).toBeNull();
    });

    it('returns null for detected result with type none', async () => {
      const result = { detected: true, type: 'none' as const, confidence: 50 };
      const candidate = detector.toAssessmentCandidate('url', result);
      expect(candidate).toBeNull();
    });

    it('returns candidate for detected result with valid type', async () => {
      const result = {
        detected: true,
        type: 'widget' as const,
        confidence: 98,
        providerHint: 'embedded_widget',
        selector: '[data-sitekey]',
      };
      const candidate = detector.toAssessmentCandidate('dom', result);
      expect(candidate!.source).toBe('dom');
      expect(candidate!.type).toBe('widget');
      expect(candidate!.confidence).toBe(98);
    });
  });

  // ── getSignalValue ──

  describe('getSignalValue', () => {
    it('returns URL from result for url source', () => {
      const value = detector.getSignalValue('url', {
        url: 'https://example.com/challenge',
        detected: true,
        type: 'url_redirect',
        confidence: 90,
      });
      expect(value).toBe('https://example.com/challenge');
    });

    it('returns url-match fallback when url is absent', () => {
      const value = detector.getSignalValue('url', {
        detected: true,
        type: 'url_redirect',
        confidence: 90,
      });
      expect(value).toBe('url-match');
    });

    it('returns title from result for title source', () => {
      const value = detector.getSignalValue('title', {
        title: 'Verify',
        detected: true,
        type: 'page_redirect',
        confidence: 90,
      });
      expect(value).toBe('Verify');
    });

    it('returns title-match fallback when title is absent', () => {
      const value = detector.getSignalValue('title', {
        detected: true,
        type: 'page_redirect',
        confidence: 90,
      });
      expect(value).toBe('title-match');
    });

    it('returns selector for dom source when present', () => {
      const value = detector.getSignalValue('dom', {
        selector: '.captcha-slider',
        type: 'slider',
        detected: true,
        confidence: 90,
      });
      expect(value).toBe('.captcha-slider');
    });

    it('returns type for dom source when selector is absent', () => {
      const value = detector.getSignalValue('dom', {
        type: 'slider',
        detected: true,
        confidence: 90,
      });
      expect(value).toBe('slider');
    });

    it('returns keyword from details for text source', () => {
      const value = detector.getSignalValue('text', {
        type: 'unknown',
        detected: true,
        confidence: 90,
        details: { keyword: 'slide to verify' },
      });
      expect(value).toBe('slide to verify');
    });

    it('returns type for text source when details lack keyword', () => {
      const value = detector.getSignalValue('text', {
        type: 'unknown',
        detected: true,
        confidence: 90,
        details: { other: 'data' },
      });
      expect(value).toBe('unknown');
    });

    it('returns type for text source when details is not an object', () => {
      const value = detector.getSignalValue('text', {
        type: 'unknown',
        detected: true,
        confidence: 90,
        details: 'string',
      });
      expect(value).toBe('unknown');
    });

    it('returns providerHint for vendor source', () => {
      const value = detector.getSignalValue('vendor', {
        providerHint: 'edge_service',
        type: 'browser_check',
        detected: true,
        confidence: 90,
      });
      expect(value).toBe('edge_service');
    });

    it('returns type for vendor source when providerHint is absent', () => {
      const value = detector.getSignalValue('vendor', {
        type: 'browser_check',
        detected: true,
        confidence: 90,
      });
      expect(value).toBe('browser_check');
    });
  });

  // ── detect: title detection ──

  describe('detect — title checks', () => {
    it('detects captcha from English title keywords', async () => {
      const page = createPageMock({
        title: vi.fn(async () => 'Please verify you are human'),
        evaluate: vi.fn(async () => true), // verifyByDOM returns true
      });
      // @ts-expect-error — auto-suppressed [TS2345]
      const result = await detector.detect(page);
      // If URL does not match, falls through to title
      expect(result.type).not.toBe('none');
    });

    it('detects captcha from Chinese title keywords', async () => {
      const page = createPageMock({
        title: vi.fn(async () => '安全验证 - 请完成'),
        evaluate: vi.fn(async () => true),
      });
      // @ts-expect-error — auto-suppressed [TS2345]
      const result = await detector.detect(page);
      expect(result.detected).toBe(true);
    });

    it('excludes title with OTP-related patterns', async () => {
      const page = createPageMock({
        title: vi.fn(async () => 'Enter verification code'),
      });
      const result = await detector.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Title exclusion');
    });

    it('excludes title with 2FA patterns', async () => {
      const page = createPageMock({
        title: vi.fn(async () => 'Two-factor authentication'),
      });
      const result = await detector.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Title exclusion');
    });

    it('returns not-detected for normal title', async () => {
      const page = createPageMock({
        title: vi.fn(async () => 'Welcome to My App'),
      });
      const result = await detector.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles title rule requiring DOM confirmation when DOM is absent', async () => {
      const page = createPageMock({
        title: vi.fn(async () => 'Security check'),
        evaluate: vi.fn(async () => false),
      });
      const result = await detector.checkTitle(page);
      // DOM confirmation fails → false positive
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('TitleDOM exclusion');
    });
  });

  // ── detect: text checks ──

  describe('detect — text checks', () => {
    it('detects captcha from English body text', async () => {
      // Need separate evaluate calls for text and DOM verification
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce('Slide to verify that you are human')
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(true) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page2 = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.checkPageText(page2);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(78);
    });

    it('detects captcha from Chinese body text', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce('请完成安全验证以继续')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      const page = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.checkPageText(page);
      expect(result.detected).toBe(true);
    });

    it('excludes body text with OTP patterns', async () => {
      const page = createPageMock({
        evaluate: vi.fn(async () => 'We sent a code to your email. Enter verification code below.'),
      });
      const result = await detector.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Text exclusion');
    });

    it('excludes body text with 2FA patterns', async () => {
      const page = createPageMock({
        evaluate: vi.fn(async () => 'Enter your authenticator code to continue'),
      });
      const result = await detector.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Text exclusion');
    });

    it('handles text rule requiring DOM confirmation when DOM is absent', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce('Please verify you are human')
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('TextDOM exclusion');
    });
  });

  // ── detect: URL checks with DOM confirmation ──

  describe('detect — URL checks with DOM confirmation', () => {
    it('requires and passes DOM confirmation for generic URL patterns', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(true) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page = createPageMock({
        url: vi.fn(() => 'https://example.com/verify'),
        evaluate: mockEvaluate,
      });

      const result = await detector.checkUrl(page);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('url_redirect');
    });

    it('fails DOM confirmation for generic URL patterns', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPageMock({
        url: vi.fn(() => 'https://example.com/verify'),
        evaluate: mockEvaluate,
      });

      const result = await detector.checkUrl(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('URLDOM exclusion');
    });
  });

  // ── detect: DOM element checks ──

  describe('detect — DOM element checks', () => {
    it('skips non-visible elements when requiresVisibility is true', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => false) };
      const page = createPageMock({
        $: vi.fn(async (sel: string) => (sel.includes('captcha-slider') ? element : null)),
      });
      vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(true);

      await detector.checkDOMElements(page);
      // Slider is not visible -> should not match on slider but may match widget
      expect(element.isIntersectingViewport).toHaveBeenCalled();
    });

    it('detects browser check DOM elements', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async (sel: string) => (sel.includes('challenge-form') ? element : null)),
      });

      const result = await detector.checkDOMElements(page);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('browser_check');
      expect(result.providerHint).toBe('edge_service');
    });

    it('returns not-detected when no DOM rules match', async () => {
      const page = createPageMock({
        $: vi.fn(async () => null),
      });
      const result = await detector.checkDOMElements(page);
      expect(result.detected).toBe(false);
    });

    it('rejects slider after verifySliderElement fails', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async (sel: string) => {
          // Only match slider selectors, not widget or browserCheck selectors
          if (
            sel.includes('captcha-slider') ||
            sel.includes('verify-slider') ||
            sel.includes('slide-verify') ||
            (sel.includes('captcha') && sel.includes('slider')) ||
            (sel.includes('verify') && sel.includes('slider')) ||
            sel.includes('aria-label')
          ) {
            return element;
          }
          return null;
        }),
      });
      vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(false);

      await detector.checkDOMElements(page);
      // Slider rejected, other DOM rules should also not match (no widget/browserCheck selectors)
      // This tests the slider verification rejection path
      expect(loggerState.debug).toHaveBeenCalledWith(
        expect.stringContaining('rejected selector after slider verification'),
      );
    });
  });

  // ── verifyByDOM ──

  describe('verifyByDOM', () => {
    it('returns true when slider elements found', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.verifyByDOM(page);
      expect(result).toBe(true);
    });

    it('returns true when widget elements found', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(true) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.verifyByDOM(page);
      expect(result).toBe(true);
    });

    it('returns true when browser check elements found', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.verifyByDOM(page);
      expect(result).toBe(true);
    });

    it('returns false when no DOM elements found', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      const page = createPageMock({ evaluate: mockEvaluate });

      const result = await detector.verifyByDOM(page);
      expect(result).toBe(false);
    });

    it('returns false and logs error when evaluate throws', async () => {
      const page = createPageMock({
        evaluate: vi.fn().mockRejectedValue(new Error('page crashed')),
      });

      const result = await detector.verifyByDOM(page);
      expect(result).toBe(false);
      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('DOM verification failed'),
        expect.any(Error),
      );
    });
  });

  // ── verifySliderElement ──

  describe('verifySliderElement', () => {
    it('returns false and logs error when evaluate throws', async () => {
      const page = createPageMock({
        evaluate: vi.fn().mockRejectedValue(new Error('eval failed')),
      });

      const result = await detector.verifySliderElement(page, '.slider');
      expect(result).toBe(false);
      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('Slider element verification failed'),
        expect.any(Error),
      );
    });

    it('calls evaluate with selector and exclude selectors', async () => {
      const page = createPageMock({
        evaluate: vi.fn().mockResolvedValue(true),
      });

      const result = await detector.verifySliderElement(page, '.captcha-slider');
      expect(result).toBe(true);
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        '.captcha-slider',
        expect.any(Array), // EXCLUDE_SELECTORS
      );
    });
  });

  // ── detect: full flow shortcuts ──

  describe('detect — flow shortcuts', () => {
    it('returns immediately when title check detects captcha', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 82,
      });
      const domSpy = vi.spyOn(detector, 'checkDOMElements');

      // @ts-expect-error — auto-suppressed [TS2345]
      const result = await detector.detect(page);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('page_redirect');
      expect(domSpy).not.toHaveBeenCalled();
    });

    it('returns immediately when DOM check detects captcha', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(detector, 'checkDOMElements').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 98,
      });
      const textSpy = vi.spyOn(detector, 'checkPageText');

      // @ts-expect-error — auto-suppressed [TS2345]
      const result = await detector.detect(page);

      expect(result.detected).toBe(true);
      expect(textSpy).not.toHaveBeenCalled();
    });

    it('returns immediately when text check detects captcha', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
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
        detected: true,
        type: 'unknown',
        confidence: 78,
      });
      const vendorSpy = vi.spyOn(detector, 'checkVendorSpecific');

      // @ts-expect-error — auto-suppressed [TS2345]
      const result = await detector.detect(page);

      expect(result.detected).toBe(true);
      expect(vendorSpy).not.toHaveBeenCalled();
    });

    it('returns not-detected when all checks fail', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
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

      // @ts-expect-error — auto-suppressed [TS2345]
      const result = await detector.detect(page);

      expect(result).toEqual({ detected: false, type: 'none', confidence: 0 });
      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('No CAPTCHA detected'));
    });
  });

  // ── confirmRuleWithDOM ──

  describe('confirmRuleWithDOM', () => {
    it('returns true when rule does not require DOM confirmation', async () => {
      const page = createPageMock();
      const rule = { requiresDomConfirmation: false };
      const result = await detector.confirmRuleWithDOM(page, rule as any);
      expect(result).toBe(true);
    });

    it('returns true when rule requires DOM confirmation and none is set (undefined)', async () => {
      const page = createPageMock();
      const rule = {};
      const result = await detector.confirmRuleWithDOM(page, rule as any);
      expect(result).toBe(true);
    });
  });

  // ── matchRule ──

  describe('matchRule', () => {
    it('returns matching rule and text', () => {
      const rules = [{ pattern: /captcha/i, id: 'test', confidence: 90, label: 'test' }];
      const result = detector.matchRule('https://example.com/captcha', rules);
      expect(result).toEqual({ rule: rules[0], matchText: 'captcha' });
    });

    it('returns null when no rule matches', () => {
      const rules = [{ pattern: /captcha/i, id: 'test', confidence: 90, label: 'test' }];
      const result = detector.matchRule('https://example.com/about', rules);
      expect(result).toBeNull();
    });
  });

  // ── buildExcludeResult / buildCaptchaResult ──

  describe('buildExcludeResult', () => {
    it('builds exclude result with source label', () => {
      const rule = { id: 'test-rule', confidence: 88, label: 'test', pattern: /test/ };
      const result = detector.buildExcludeResult('URL', rule, 'verify-email');

      expect(result.detected).toBe(false);
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(88);
      expect(result.falsePositiveReason).toBe('URL exclusion: verify-email');
    });
  });

  describe('buildCaptchaResult', () => {
    it('builds captcha result with all fields', () => {
      const result = detector.buildCaptchaResult({
        confidence: 95,
        type: 'browser_check',
        providerHint: 'edge_service',
        url: 'https://example.com',
        title: 'Check',
        selector: '#challenge',
        details: { extra: true },
      });

      expect(result.detected).toBe(true);
      expect(result.confidence).toBe(95);
      expect(result.type).toBe('browser_check');
      expect(result.providerHint).toBe('edge_service');
      expect(result.url).toBe('https://example.com');
      expect(result.title).toBe('Check');
      expect(result.selector).toBe('#challenge');
      expect(result.details).toEqual({ extra: true });
    });
  });

  describe('branch coverage extras', () => {
    it('maps signals, candidates and rule matches across all source types', async () => {
      expect(
        detector.toAssessmentSignal('url', {
          detected: true,
          type: 'browser_check',
          confidence: 91,
          providerHint: 'edge_service',
          url: 'https://example.com/captcha',
          details: { keyword: 'verify' },
        }),
      ).toEqual(
        expect.objectContaining({
          source: 'url',
          kind: 'captcha',
          value: 'https://example.com/captcha',
        }),
      );

      expect(
        detector.toAssessmentSignal('text', {
          detected: false,
          type: 'none',
          confidence: 42,
          falsePositiveReason: 'Text exclusion: verify',
        }),
      ).toEqual(
        expect.objectContaining({
          source: 'text',
          kind: 'exclude',
          value: 'Text exclusion: verify',
        }),
      );

      expect(
        detector.toAssessmentSignal('vendor', {
          detected: false,
          type: 'none',
          confidence: 0,
        }),
      ).toBeNull();

      expect(
        detector.toAssessmentCandidate('dom', {
          detected: false,
          type: 'none',
          confidence: 0,
        }),
      ).toBeNull();

      expect(
        detector.toAssessmentCandidate('dom', {
          detected: true,
          type: 'widget',
          confidence: 88,
          selector: '[data-sitekey]',
          providerHint: 'embedded_widget',
        }),
      ).toEqual(
        expect.objectContaining({
          source: 'dom',
          value: '[data-sitekey]',
          type: 'widget',
        }),
      );

      expect(
        detector.getSignalValue('text', {
          detected: true,
          type: 'unknown',
          confidence: 75,
          details: { keyword: '安全验证' },
        }),
      ).toBe('安全验证');
      expect(
        detector.getSignalValue('vendor', {
          detected: true,
          type: 'unknown',
          confidence: 75,
        }),
      ).toBe('unknown');

      expect(
        detector.matchRule('https://example.com/challenge', [
          { id: 'a', label: 'A', pattern: /challenge/i, confidence: 10 },
          { id: 'b', label: 'B', pattern: /verify/i, confidence: 20 },
        ]),
      ).toEqual(
        expect.objectContaining({
          matchText: 'challenge',
          rule: expect.objectContaining({ id: 'a' }),
        }),
      );

      const page = createPageMock();
      const rule = { requiresDomConfirmation: true };
      vi.spyOn(detector, 'verifyByDOM').mockResolvedValueOnce(false);
      await expect(detector.confirmRuleWithDOM(page, rule as any)).resolves.toBe(false);
    });

    it('evaluates DOM rules and handles verification failures', async () => {
      const page = createPageMock();
      page.$.mockResolvedValueOnce(null);

      await expect(
        detector.evaluateDomRule(page, {
          id: 'visible-rule',
          label: 'visible rule',
          selectors: ['.captcha-slider'],
          confidence: 80,
          typeHint: 'slider',
          requiresVisibility: true,
        } as any),
      ).resolves.toBeNull();

      const visible = {
        isIntersectingViewport: vi.fn(async () => true),
      };
      page.$.mockResolvedValueOnce(visible);
      vi.spyOn(detector, 'verifySliderElement').mockResolvedValueOnce(false);
      await expect(
        detector.evaluateDomRule(page, {
          id: 'slider-rule',
          label: 'slider rule',
          selectors: ['.captcha-slider'],
          confidence: 80,
          typeHint: 'slider',
          verifier: 'slider',
        } as any),
      ).resolves.toBeNull();

      page.$.mockResolvedValueOnce(visible);
      vi.spyOn(detector, 'verifySliderElement').mockResolvedValueOnce(true);
      await expect(
        detector.evaluateDomRule(page, {
          id: 'slider-rule',
          label: 'slider rule',
          selectors: ['.captcha-slider'],
          confidence: 80,
          typeHint: 'slider',
          verifier: 'slider',
        } as any),
      ).resolves.toEqual({
        selector: '.captcha-slider',
        rule: expect.objectContaining({ id: 'slider-rule' }),
      });

      const domPage = createPageMock();
      domPage.evaluate.mockRejectedValueOnce(new Error('dom failure'));
      await expect(detector.verifyByDOM(domPage)).resolves.toBe(false);
    });

    it('covers slider verification rejection, success and catch paths', async () => {
      const createEvaluatePage = (context: Record<string, unknown>) =>
        ({
          evaluate: vi.fn(
            async (fn: (...args: any[]) => unknown, selector: string, exclude: string[]) =>
              runInBrowserContext(fn, context, [selector, exclude]),
          ),
        }) as any;

      const blockedContext = {
        document: {
          querySelector: (selector: string) =>
            selector === '.captcha-slider'
              ? {
                  matches: () => true,
                  closest: () => null,
                  getBoundingClientRect: () => ({ width: 120, height: 60 }),
                  className: 'captcha slider',
                  id: 'captcha',
                  hasAttribute: () => true,
                  parentElement: null,
                }
              : null,
        },
        window: {
          getComputedStyle: () => ({ cursor: 'grab' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(blockedContext), '.captcha-slider'),
      ).resolves.toBe(false);

      const successContext = {
        document: {
          querySelector: (selector: string) => {
            if (selector !== '.captcha-slider') return null;
            const parent = {
              className: 'captcha-shell',
              id: 'parent',
              parentElement: null,
            };
            return {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 160, height: 40 }),
              className: 'captcha slider',
              id: 'solve-me',
              hasAttribute: (name: string) => name === 'data-captcha',
              parentElement: parent,
            };
          },
        },
        window: {
          getComputedStyle: () => ({ cursor: 'default' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(successContext), '.captcha-slider'),
      ).resolves.toBe(true);

      const throwingPage = {
        evaluate: vi.fn(async () => {
          throw new Error('boom');
        }),
      } as any;
      await expect(detector.verifySliderElement(throwingPage, '.captcha-slider')).resolves.toBe(
        false,
      );
    });

    it('covers checkUrl, checkTitle and checkPageText fallback branches', async () => {
      const excludeUrlPage = createPageMock();
      excludeUrlPage.url.mockReturnValue('https://example.com/verify-email');
      await expect(detector.checkUrl(excludeUrlPage)).resolves.toMatchObject({
        detected: false,
        type: 'none',
        falsePositiveReason: expect.stringContaining('verify-email'),
      });

      const confirmUrlPage = createPageMock();
      confirmUrlPage.url.mockReturnValue('https://example.com/cdn-cgi/challenge-platform');
      vi.spyOn(detector, 'confirmRuleWithDOM').mockResolvedValueOnce(false);
      await expect(detector.checkUrl(confirmUrlPage)).resolves.toMatchObject({
        detected: false,
        type: 'none',
        falsePositiveReason: expect.stringContaining('URLDOM exclusion'),
      });

      const titlePage = createPageMock();
      titlePage.title.mockResolvedValueOnce('短信验证');
      await expect(detector.checkTitle(titlePage)).resolves.toMatchObject({
        detected: false,
        type: 'none',
        falsePositiveReason: expect.stringContaining('Title exclusion'),
      });

      const textPage = createPageMock();
      textPage.evaluate.mockResolvedValueOnce('请完成安全验证');
      vi.spyOn(detector, 'confirmRuleWithDOM').mockResolvedValueOnce(false);
      await expect(detector.checkPageText(textPage)).resolves.toMatchObject({
        detected: false,
        type: 'none',
        falsePositiveReason: expect.stringContaining('TextDOM exclusion'),
      });
    });
  });

  describe('browser-context callback coverage', () => {
    it('covers verifyByDOM selector branches inside browser callbacks', async () => {
      const createEvaluatePage = (context: Record<string, unknown>) =>
        createPageMock({
          evaluate: vi.fn(async (fn: (...args: any[]) => unknown) =>
            runInBrowserContext(fn, context),
          ),
        });

      await expect(
        detector.verifyByDOM(
          createEvaluatePage({
            document: {
              querySelector: (selector: string) =>
                selector === '.captcha-slider' ? { nodeType: 1 } : null,
            },
          }),
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifyByDOM(
          createEvaluatePage({
            document: {
              querySelector: (selector: string) =>
                selector === '[data-sitekey]' ? { nodeType: 1 } : null,
            },
          }),
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifyByDOM(
          createEvaluatePage({
            document: {
              querySelector: (selector: string) =>
                selector === '#challenge-form' ? { nodeType: 1 } : null,
            },
          }),
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifyByDOM(
          createEvaluatePage({
            document: {
              querySelector: () => null,
            },
          }),
        ),
      ).resolves.toBe(false);
    });

    it('covers verifySliderElement rejection and success branches in browser callbacks', async () => {
      const createEvaluatePage = (context: Record<string, unknown>) =>
        createPageMock({
          evaluate: vi.fn(
            async (fn: (...args: any[]) => unknown, selector: string, exclude: string[]) =>
              runInBrowserContext(fn, context, [selector, exclude]),
          ),
        });

      const noElementContext = {
        document: {
          querySelector: () => null,
        },
        window: {
          getComputedStyle: () => ({ cursor: 'default' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(noElementContext), '.captcha-slider'),
      ).resolves.toBe(false);

      const closestContext = {
        document: {
          querySelector: (selector: string) =>
            selector === '.captcha-slider'
              ? {
                  matches: () => false,
                  closest: () => ({}),
                  getBoundingClientRect: () => ({ width: 120, height: 60 }),
                  className: 'captcha slider',
                  id: 'captcha',
                  hasAttribute: () => true,
                  parentElement: null,
                }
              : null,
        },
        window: {
          getComputedStyle: () => ({ cursor: 'grab' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(closestContext), '.captcha-slider'),
      ).resolves.toBe(false);

      const sizeContext = {
        document: {
          querySelector: (selector: string) =>
            selector === '.captcha-slider'
              ? {
                  matches: () => false,
                  closest: () => null,
                  getBoundingClientRect: () => ({ width: 10, height: 10 }),
                  className: 'captcha slider',
                  id: 'captcha',
                  hasAttribute: () => true,
                  parentElement: null,
                }
              : null,
        },
        window: {
          getComputedStyle: () => ({ cursor: 'grab' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(sizeContext), '.captcha-slider'),
      ).resolves.toBe(false);

      const keywordContext = {
        document: {
          querySelector: (selector: string) =>
            selector === '.captcha-slider'
              ? {
                  matches: () => false,
                  closest: () => null,
                  getBoundingClientRect: () => ({ width: 120, height: 60 }),
                  className: 'video-player',
                  id: 'video-player',
                  hasAttribute: () => true,
                  parentElement: null,
                }
              : null,
        },
        window: {
          getComputedStyle: () => ({ cursor: 'default' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(keywordContext), '.captcha-slider'),
      ).resolves.toBe(false);

      const invalidContext = {
        document: {
          querySelector: (selector: string) =>
            selector === '.captcha-slider'
              ? {
                  matches: () => false,
                  closest: () => null,
                  getBoundingClientRect: () => ({ width: 140, height: 50 }),
                  className: 'plain slider',
                  id: 'plain-slider',
                  hasAttribute: () => false,
                  parentElement: null,
                }
              : null,
        },
        window: {
          getComputedStyle: () => ({ cursor: 'default' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(invalidContext), '.captcha-slider'),
      ).resolves.toBe(false);

      const conditionBContext = {
        document: {
          querySelector: (selector: string) => {
            if (selector !== '.captcha-slider') return null;

            const parent = {
              className: 'captcha-shell',
              id: 'shell',
              parentElement: null,
            };

            return {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 150, height: 50 }),
              className: 'slide',
              id: 'solver',
              hasAttribute: (name: string) => name === 'data-captcha',
              parentElement: parent,
            };
          },
        },
        window: {
          getComputedStyle: () => ({ cursor: 'default' }),
        },
        console,
      };
      await expect(
        detector.verifySliderElement(createEvaluatePage(conditionBContext), '.captcha-slider'),
      ).resolves.toBe(true);
    });

    it('returns not-detected when a detection check throws during detect', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockRejectedValue(new Error('boom'));

      // @ts-expect-error
      await expect(detector.detect(page)).resolves.toEqual({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('CAPTCHA detection failed'),
        expect.any(Error),
      );
    });
  });

  describe('direct browser callback coverage', () => {
    it('covers detect url shortcut return', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/cdn-cgi/challenge',
      });
      const titleSpy = vi.spyOn(detector, 'checkTitle');

      await expect(detector.detect(page as any)).resolves.toMatchObject({
        detected: true,
        type: 'browser_check',
      });
      expect(titleSpy).not.toHaveBeenCalled();
    });

    it('covers checkPageText, verifyByDOM and verifySliderElement callback branches', async () => {
      const textPage = createDirectEvaluatePage({
        document: {
          body: {
            innerText: '请输入验证码后继续',
          },
        },
        window: {},
      });

      await expect(detector.checkPageText(textPage as any)).resolves.toMatchObject({
        detected: false,
        type: 'none',
        falsePositiveReason: expect.stringContaining('Text exclusion'),
      });

      vi.spyOn(detector, 'confirmRuleWithDOM').mockResolvedValueOnce(true);
      const captchaTextPage = createDirectEvaluatePage({
        document: {
          body: {
            innerText: '请完成安全验证以继续',
          },
        },
        window: {},
      });

      await expect(detector.checkPageText(captchaTextPage as any)).resolves.toMatchObject({
        detected: true,
        type: expect.any(String),
      });

      await expect(detector.checkVendorSpecific(createPageMock() as any)).resolves.toEqual({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const sliderElement = {
        matches: () => false,
        closest: () => null,
        getBoundingClientRect: () => ({ width: 120, height: 48 }),
        className: 'captcha slider',
        id: 'captcha-slider',
        hasAttribute: (name: string) => name === 'data-captcha',
        parentElement: null,
      };

      await expect(
        detector.verifyByDOM(
          createDirectEvaluatePage({
            document: {
              querySelector: (selector: string) =>
                selector === '.captcha-slider' ? sliderElement : null,
            },
          }),
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifyByDOM(
          createDirectEvaluatePage({
            document: {
              querySelector: (selector: string) =>
                selector === '[data-sitekey]' ? { nodeType: 1 } : null,
            },
          }),
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifyByDOM(
          createDirectEvaluatePage({
            document: {
              querySelector: (selector: string) =>
                selector === '#challenge-form' ? { nodeType: 1 } : null,
            },
          }),
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifyByDOM(
          createDirectEvaluatePage({
            document: {
              querySelector: () => null,
            },
          }),
        ),
      ).resolves.toBe(false);

      const createSliderPage = (element: any, cursor = 'default') =>
        createDirectEvaluatePage({
          document: {
            querySelector: (selector: string) => (selector === '.captcha-slider' ? element : null),
          },
          window: {
            getComputedStyle: () => ({ cursor }),
          },
          console,
        });

      await expect(
        detector.verifySliderElement(createSliderPage(null, 'default'), '.captcha-slider'),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 0, height: 48 }),
              className: 'captcha slider',
              id: 'captcha-slider',
              hasAttribute: () => false,
              parentElement: null,
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => true,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'captcha slider',
              id: 'captcha-slider',
              hasAttribute: () => false,
              parentElement: null,
            },
            'grab',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => ({}),
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'captcha slider',
              id: 'captcha-slider',
              hasAttribute: () => false,
              parentElement: null,
            },
            'grab',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'captcha',
              id: 'captcha',
              hasAttribute: () => false,
              parentElement: null,
            },
            'grab',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'captcha slider',
              id: 'captcha-slider',
              hasAttribute: () => false,
              parentElement: null,
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'slide',
              id: 'solver',
              hasAttribute: () => false,
              parentElement: {
                className: 'captcha',
                id: 'captcha',
                parentElement: null,
              },
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 10, height: 10 }),
              className: 'captcha slider',
              id: 'captcha-slider',
              hasAttribute: () => false,
              parentElement: null,
            },
            'grab',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'video-player',
              id: 'video-player',
              hasAttribute: () => false,
              parentElement: null,
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'captcha slider',
              id: 'captcha-slider',
              hasAttribute: (name: string) => name === 'data-verify',
              parentElement: null,
            },
            'grab',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'slide',
              id: 'solver',
              hasAttribute: (name: string) => name === 'data-verify',
              parentElement: {
                className: 'captcha',
                id: 'captcha',
                parentElement: null,
              },
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(true);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'plain box',
              id: 'plain-box',
              hasAttribute: () => false,
              parentElement: null,
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);

      await expect(
        detector.verifySliderElement(
          createSliderPage(
            {
              matches: () => false,
              closest: () => null,
              getBoundingClientRect: () => ({ width: 120, height: 48 }),
              className: 'plain box',
              id: 'plain-box',
              hasAttribute: () => false,
              parentElement: {
                className: 'layout',
                id: 'wrapper',
                parentElement: null,
              },
            },
            'default',
          ),
          '.captcha-slider',
        ),
      ).resolves.toBe(false);
    });

    it('covers waitForCompletion timeout path', async () => {
      vi.useFakeTimers();
      const timeoutDetector = new TestCaptchaDetector();
      const page = createPageMock();

      vi.spyOn(timeoutDetector, 'detect').mockResolvedValue({
        detected: true,
        type: 'unknown',
        confidence: 100,
      });

      const promise = timeoutDetector.waitForCompletion(page as any, 1000);
      await vi.advanceTimersByTimeAsync(2500);

      await expect(promise).resolves.toBe(false);
    });
  });
});

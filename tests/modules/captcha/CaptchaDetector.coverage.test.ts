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

function createPage(overrides: Partial<any> = {}) {
  return {
    url: vi.fn(() => 'https://example.com/normal-page'),
    title: vi.fn(async () => 'Normal Page'),
    $: vi.fn(async () => null),
    evaluate: vi.fn(async () => ''),
    ...overrides,
  } as any;
}

describe('CaptchaDetector — coverage expansion', () => {
  let detector: CaptchaDetector;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    detector = new CaptchaDetector();
  });

  // ── assess: check error recovery per individual check ──

  describe('assess — error handling', () => {
    it('continues running remaining checks when one check throws', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockRejectedValue(new Error('url fail'));
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('url'),
        expect.any(Error)
      );
      expect(assessment.likelyCaptcha).toBe(false);
      expect(assessment.recommendedNextStep).toBe('ignore');
    });

    it('accumulates signals from multiple detected sources', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/cdn-cgi/challenge',
      });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 78,
        title: 'Verify',
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 98,
        selector: '[data-sitekey]',
        providerHint: 'embedded_widget',
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

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
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({ detected: false, type: 'none', confidence: 0 });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);
      expect(assessment.recommendedNextStep).toBe('ignore');
    });

    it('returns observe when likely captcha with moderate confidence and no exclude signals', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 90,
        providerHint: 'embedded_widget',
        url: 'https://example.com/captcha-frame',
      });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);
      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('observe');
    });

    it('returns manual when score minus excludeScore >= 120', async () => {
      const det = detector as any;
      const page = createPage();

      // Score: 95 + 90 = 185, excludeScore = 0, score - excludeScore = 185 >= 120
      vi.spyOn(det, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
      });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 90,
        providerHint: 'edge_service',
        title: 'Verify',
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('manual');
    });

    it('returns ask_ai when likely captcha but has excludeScore > 0', async () => {
      const det = detector as any;
      const page = createPage();

      vi.spyOn(det, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 90,
        url: 'https://example.com/challenge',
      });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 88,
        falsePositiveReason: 'Title exclusion: verification code',
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

      expect(assessment.excludeScore).toBeGreaterThan(0);
      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('ask_ai');
    });

    it('returns manual when candidateCount >= 2', async () => {
      const det = detector as any;
      const page = createPage();

      vi.spyOn(det, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 90,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
      });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 78,
        title: 'Verify',
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

      expect(assessment.candidates.length).toBe(2);
      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.recommendedNextStep).toBe('manual');
    });
  });

  // ── assess: primaryDetection with ambiguous signals ──

  describe('assess — ambiguous primaryDetection', () => {
    it('wraps candidates in details when likelyCaptcha is false and candidates exist', async () => {
      const det = detector as any;
      const page = createPage();

      vi.spyOn(det, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 50,
        url: 'https://example.com/verify',
      });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

      expect(assessment.likelyCaptcha).toBe(false);
      expect(assessment.primaryDetection.detected).toBe(false);
      expect(assessment.primaryDetection.details).toEqual({
        candidates: expect.any(Array),
        reason: expect.stringContaining('ambiguous'),
      });
    });

    it('omits details when likelyCaptcha is false and no candidates exist', async () => {
      const det = detector as any;
      const page = createPage();

      vi.spyOn(det, 'checkUrl').mockResolvedValue({ detected: false, type: 'none', confidence: 0 });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const assessment = await det.assess(page);

      expect(assessment.likelyCaptcha).toBe(false);
      expect(assessment.primaryDetection.details).toBeUndefined();
    });
  });

  // ── toAssessmentSignal / toAssessmentCandidate ──

  describe('toAssessmentSignal', () => {
    it('returns exclude signal for falsePositiveReason result', async () => {
      const det = detector as any;
      const result = {
        detected: false,
        type: 'none',
        confidence: 88,
        falsePositiveReason: 'Title exclusion: test',
      };
      const signal = det.toAssessmentSignal('title', result);
      expect(signal).toEqual({
        source: 'title',
        kind: 'exclude',
        value: 'Title exclusion: test',
        confidence: 88,
      });
    });

    it('returns null for non-detected result without falsePositiveReason', async () => {
      const det = detector as any;
      const result = { detected: false, type: 'none', confidence: 0 };
      const signal = det.toAssessmentSignal('url', result);
      expect(signal).toBeNull();
    });

    it('returns captcha signal for detected result', async () => {
      const det = detector as any;
      const result = {
        detected: true,
        type: 'widget',
        confidence: 98,
        providerHint: 'embedded_widget',
        selector: '[data-sitekey]',
      };
      const signal = det.toAssessmentSignal('dom', result);
      expect(signal!.kind).toBe('captcha');
      expect(signal!.source).toBe('dom');
    });
  });

  describe('toAssessmentCandidate', () => {
    it('returns null for non-detected result', async () => {
      const det = detector as any;
      const result = { detected: false, type: 'none', confidence: 0 };
      const candidate = det.toAssessmentCandidate('url', result);
      expect(candidate).toBeNull();
    });

    it('returns null for detected result with type none', async () => {
      const det = detector as any;
      const result = { detected: true, type: 'none', confidence: 50 };
      const candidate = det.toAssessmentCandidate('url', result);
      expect(candidate).toBeNull();
    });

    it('returns candidate for detected result with valid type', async () => {
      const det = detector as any;
      const result = {
        detected: true,
        type: 'widget',
        confidence: 98,
        providerHint: 'embedded_widget',
        selector: '[data-sitekey]',
      };
      const candidate = det.toAssessmentCandidate('dom', result);
      expect(candidate!.source).toBe('dom');
      expect(candidate!.type).toBe('widget');
      expect(candidate!.confidence).toBe(98);
    });
  });

  // ── getSignalValue ──

  describe('getSignalValue', () => {
    it('returns URL from result for url source', () => {
      const det = detector as any;
      const value = det.getSignalValue('url', { url: 'https://example.com/challenge' });
      expect(value).toBe('https://example.com/challenge');
    });

    it('returns url-match fallback when url is absent', () => {
      const det = detector as any;
      const value = det.getSignalValue('url', {});
      expect(value).toBe('url-match');
    });

    it('returns title from result for title source', () => {
      const det = detector as any;
      const value = det.getSignalValue('title', { title: 'Verify' });
      expect(value).toBe('Verify');
    });

    it('returns title-match fallback when title is absent', () => {
      const det = detector as any;
      const value = det.getSignalValue('title', {});
      expect(value).toBe('title-match');
    });

    it('returns selector for dom source when present', () => {
      const det = detector as any;
      const value = det.getSignalValue('dom', { selector: '.captcha-slider', type: 'slider' });
      expect(value).toBe('.captcha-slider');
    });

    it('returns type for dom source when selector is absent', () => {
      const det = detector as any;
      const value = det.getSignalValue('dom', { type: 'slider' });
      expect(value).toBe('slider');
    });

    it('returns keyword from details for text source', () => {
      const det = detector as any;
      const value = det.getSignalValue('text', {
        type: 'unknown',
        details: { keyword: 'slide to verify' },
      });
      expect(value).toBe('slide to verify');
    });

    it('returns type for text source when details lack keyword', () => {
      const det = detector as any;
      const value = det.getSignalValue('text', { type: 'unknown', details: { other: 'data' } });
      expect(value).toBe('unknown');
    });

    it('returns type for text source when details is not an object', () => {
      const det = detector as any;
      const value = det.getSignalValue('text', { type: 'unknown', details: 'string' });
      expect(value).toBe('unknown');
    });

    it('returns providerHint for vendor source', () => {
      const det = detector as any;
      const value = det.getSignalValue('vendor', {
        providerHint: 'edge_service',
        type: 'browser_check',
      });
      expect(value).toBe('edge_service');
    });

    it('returns type for vendor source when providerHint is absent', () => {
      const det = detector as any;
      const value = det.getSignalValue('vendor', { type: 'browser_check' });
      expect(value).toBe('browser_check');
    });
  });

  // ── detect: title detection ──

  describe('detect — title checks', () => {
    it('detects captcha from English title keywords', async () => {
      const page = createPage({
        title: vi.fn(async () => 'Please verify you are human'),
        evaluate: vi.fn(async () => true), // verifyByDOM returns true
      });
      const result = await detector.detect(page);
      // If URL does not match, falls through to title
      expect(result.type).not.toBe('none');
    });

    it('detects captcha from Chinese title keywords', async () => {
      const page = createPage({
        title: vi.fn(async () => '安全验证 - 请完成'),
        evaluate: vi.fn(async () => true),
      });
      const result = await detector.detect(page);
      expect(result.detected).toBe(true);
    });

    it('excludes title with OTP-related patterns', async () => {
      const det = detector as any;
      const page = createPage({
        title: vi.fn(async () => 'Enter verification code'),
      });
      const result = await det.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Title exclusion');
    });

    it('excludes title with 2FA patterns', async () => {
      const det = detector as any;
      const page = createPage({
        title: vi.fn(async () => 'Two-factor authentication'),
      });
      const result = await det.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Title exclusion');
    });

    it('returns not-detected for normal title', async () => {
      const det = detector as any;
      const page = createPage({
        title: vi.fn(async () => 'Welcome to My App'),
      });
      const result = await det.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles title rule requiring DOM confirmation when DOM is absent', async () => {
      const det = detector as any;
      const page = createPage({
        title: vi.fn(async () => 'Security check'),
        evaluate: vi.fn(async () => false),
      });
      const result = await det.checkTitle(page);
      // DOM confirmation fails → false positive
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('TitleDOM exclusion');
    });
  });

  // ── detect: text checks ──

  describe('detect — text checks', () => {
    it('detects captcha from English body text', async () => {
      const det = detector as any;
      // Need separate evaluate calls for text and DOM verification
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce('Slide to verify that you are human')
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(true) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page2 = createPage({ evaluate: mockEvaluate });

      const result = await det.checkPageText(page2);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(78);
    });

    it('detects captcha from Chinese body text', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce('请完成安全验证以继续')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      const page = createPage({ evaluate: mockEvaluate });

      const result = await det.checkPageText(page);
      expect(result.detected).toBe(true);
    });

    it('excludes body text with OTP patterns', async () => {
      const det = detector as any;
      const page = createPage({
        evaluate: vi.fn(async () => 'We sent a code to your email. Enter verification code below.'),
      });
      const result = await det.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Text exclusion');
    });

    it('excludes body text with 2FA patterns', async () => {
      const det = detector as any;
      const page = createPage({
        evaluate: vi.fn(async () => 'Enter your authenticator code to continue'),
      });
      const result = await det.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('Text exclusion');
    });

    it('handles text rule requiring DOM confirmation when DOM is absent', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce('Please verify you are human')
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPage({ evaluate: mockEvaluate });

      const result = await det.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('TextDOM exclusion');
    });
  });

  // ── detect: URL checks with DOM confirmation ──

  describe('detect — URL checks with DOM confirmation', () => {
    it('requires and passes DOM confirmation for generic URL patterns', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(true) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page = createPage({
        url: vi.fn(() => 'https://example.com/verify'),
        evaluate: mockEvaluate,
      });

      const result = await det.checkUrl(page);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('url_redirect');
    });

    it('fails DOM confirmation for generic URL patterns', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPage({
        url: vi.fn(() => 'https://example.com/verify'),
        evaluate: mockEvaluate,
      });

      const result = await det.checkUrl(page);
      expect(result.detected).toBe(false);
      expect(result.falsePositiveReason).toContain('URLDOM exclusion');
    });
  });

  // ── detect: DOM element checks ──

  describe('detect — DOM element checks', () => {
    it('skips non-visible elements when requiresVisibility is true', async () => {
      const det = detector as any;
      const element = { isIntersectingViewport: vi.fn(async () => false) };
      const page = createPage({
        $: vi.fn(async (sel: string) => (sel.includes('captcha-slider') ? element : null)),
      });
      vi.spyOn(det, 'verifySliderElement').mockResolvedValue(true);

      await det.checkDOMElements(page);
      // Slider is not visible -> should not match on slider but may match widget
      expect(element.isIntersectingViewport).toHaveBeenCalled();
    });

    it('detects browser check DOM elements', async () => {
      const det = detector as any;
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPage({
        $: vi.fn(async (sel: string) => (sel.includes('challenge-form') ? element : null)),
      });

      const result = await det.checkDOMElements(page);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('browser_check');
      expect(result.providerHint).toBe('edge_service');
    });

    it('returns not-detected when no DOM rules match', async () => {
      const det = detector as any;
      const page = createPage({
        $: vi.fn(async () => null),
      });
      const result = await det.checkDOMElements(page);
      expect(result.detected).toBe(false);
    });

    it('rejects slider after verifySliderElement fails', async () => {
      const det = detector as any;
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPage({
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
      vi.spyOn(det, 'verifySliderElement').mockResolvedValue(false);

      await det.checkDOMElements(page);
      // Slider rejected, other DOM rules should also not match (no widget/browserCheck selectors)
      // This tests the slider verification rejection path
      expect(loggerState.debug).toHaveBeenCalledWith(
        expect.stringContaining('rejected selector after slider verification')
      );
    });
  });

  // ── verifyByDOM ──

  describe('verifyByDOM', () => {
    it('returns true when slider elements found', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPage({ evaluate: mockEvaluate });

      const result = await det.verifyByDOM(page);
      expect(result).toBe(true);
    });

    it('returns true when widget elements found', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(true) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPage({ evaluate: mockEvaluate });

      const result = await det.verifyByDOM(page);
      expect(result).toBe(true);
    });

    it('returns true when browser check elements found', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page = createPage({ evaluate: mockEvaluate });

      const result = await det.verifyByDOM(page);
      expect(result).toBe(true);
    });

    it('returns false when no DOM elements found', async () => {
      const det = detector as any;
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      const page = createPage({ evaluate: mockEvaluate });

      const result = await det.verifyByDOM(page);
      expect(result).toBe(false);
    });

    it('returns false and logs error when evaluate throws', async () => {
      const det = detector as any;
      const page = createPage({
        evaluate: vi.fn().mockRejectedValue(new Error('page crashed')),
      });

      const result = await det.verifyByDOM(page);
      expect(result).toBe(false);
      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('DOM verification failed'),
        expect.any(Error)
      );
    });
  });

  // ── verifySliderElement ──

  describe('verifySliderElement', () => {
    it('returns false and logs error when evaluate throws', async () => {
      const det = detector as any;
      const page = createPage({
        evaluate: vi.fn().mockRejectedValue(new Error('eval failed')),
      });

      const result = await det.verifySliderElement(page, '.slider');
      expect(result).toBe(false);
      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('Slider element verification failed'),
        expect.any(Error)
      );
    });

    it('calls evaluate with selector and exclude selectors', async () => {
      const det = detector as any;
      const page = createPage({
        evaluate: vi.fn().mockResolvedValue(true),
      });

      const result = await det.verifySliderElement(page, '.captcha-slider');
      expect(result).toBe(true);
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        '.captcha-slider',
        expect.any(Array) // EXCLUDE_SELECTORS
      );
    });
  });

  // ── detect: full flow shortcuts ──

  describe('detect — flow shortcuts', () => {
    it('returns immediately when title check detects captcha', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({ detected: false, type: 'none', confidence: 0 });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 82,
      });
      const domSpy = vi.spyOn(det, 'checkDOMElements');

      const result = await det.detect(page);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('page_redirect');
      expect(domSpy).not.toHaveBeenCalled();
    });

    it('returns immediately when DOM check detects captcha', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({ detected: false, type: 'none', confidence: 0 });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 98,
      });
      const textSpy = vi.spyOn(det, 'checkPageText');

      const result = await det.detect(page);

      expect(result.detected).toBe(true);
      expect(textSpy).not.toHaveBeenCalled();
    });

    it('returns immediately when text check detects captcha', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({ detected: false, type: 'none', confidence: 0 });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: true,
        type: 'unknown',
        confidence: 78,
      });
      const vendorSpy = vi.spyOn(det, 'checkVendorSpecific');

      const result = await det.detect(page);

      expect(result.detected).toBe(true);
      expect(vendorSpy).not.toHaveBeenCalled();
    });

    it('returns not-detected when all checks fail', async () => {
      const det = detector as any;
      const page = createPage();
      vi.spyOn(det, 'checkUrl').mockResolvedValue({ detected: false, type: 'none', confidence: 0 });
      vi.spyOn(det, 'checkTitle').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkDOMElements').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkPageText').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(det, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const result = await det.detect(page);

      expect(result).toEqual({ detected: false, type: 'none', confidence: 0 });
      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('No CAPTCHA detected'));
    });
  });

  // ── confirmRuleWithDOM ──

  describe('confirmRuleWithDOM', () => {
    it('returns true when rule does not require DOM confirmation', async () => {
      const det = detector as any;
      const page = createPage();
      const rule = { requiresDomConfirmation: false };
      const result = await det.confirmRuleWithDOM(page, rule);
      expect(result).toBe(true);
    });

    it('returns true when rule requires DOM confirmation and none is set (undefined)', async () => {
      const det = detector as any;
      const page = createPage();
      const rule = {};
      const result = await det.confirmRuleWithDOM(page, rule);
      expect(result).toBe(true);
    });
  });

  // ── matchRule ──

  describe('matchRule', () => {
    it('returns matching rule and text', () => {
      const det = detector as any;
      const rules = [{ pattern: /captcha/i, id: 'test', confidence: 90 }];
      const result = det.matchRule('https://example.com/captcha', rules);
      expect(result).toEqual({ rule: rules[0], matchText: 'captcha' });
    });

    it('returns null when no rule matches', () => {
      const det = detector as any;
      const rules = [{ pattern: /captcha/i, id: 'test', confidence: 90 }];
      const result = det.matchRule('https://example.com/about', rules);
      expect(result).toBeNull();
    });
  });

  // ── buildExcludeResult / buildCaptchaResult ──

  describe('buildExcludeResult', () => {
    it('builds exclude result with source label', () => {
      const det = detector as any;
      const rule = { id: 'test-rule', confidence: 88 };
      const result = det.buildExcludeResult('URL', rule, 'verify-email');

      expect(result.detected).toBe(false);
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(88);
      expect(result.falsePositiveReason).toBe('URL exclusion: verify-email');
    });
  });

  describe('buildCaptchaResult', () => {
    it('builds captcha result with all fields', () => {
      const det = detector as any;
      const result = det.buildCaptchaResult({
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
});

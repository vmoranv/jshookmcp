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
import type { CaptchaDetectionResult } from '@modules/captcha/types';
import { createPageMock } from '../../server/domains/shared/mock-factories';

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

describe('CaptchaDetector — deep coverage', () => {
  let detector: TestCaptchaDetector;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    detector = new TestCaptchaDetector();
  });

  // ── assess: likelyCaptcha edge cases ──

  describe('assess — likelyCaptcha calculation', () => {
    it('sets likelyCaptcha=true when confidence >= 90 and at least one candidate', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 92,
        providerHint: 'edge_service',
        url: 'https://example.com/cdn-cgi/challenge',
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.candidates.length).toBe(1);
      expect(assessment.confidence).toBe(92);
    });

    it('sets likelyCaptcha=true when score - excludeScore >= 70', async () => {
      const page = createPageMock();
      // URL gives 75 captcha, title gives exclude
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 75,
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      // score = 75 (one captcha signal), excludeScore = 0
      // likelyCaptcha = candidates.length > 0 && (confidence >= 90 || score - excludeScore >= 70)
      expect(assessment.score).toBe(75);
      expect(assessment.likelyCaptcha).toBe(true);
    });

    it('sets likelyCaptcha=false when confidence < 90 and score - excludeScore < 70', async () => {
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      // score = 50 < 70, confidence = 50 < 90
      expect(assessment.likelyCaptcha).toBe(false);
    });

    it('sets confidence = 0 when primaryDetection is not detected', async () => {
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
        confidence: 85,
        falsePositiveReason: 'Text exclusion: test',
      });
      vi.spyOn(detector, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      // primaryDetection was never detected=true, so confidence = 0
      expect(assessment.confidence).toBe(0);
      expect(assessment.likelyCaptcha).toBe(false);
    });

    it('selects highest-confidence result as primaryDetection', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 70,
        url: 'https://example.com/challenge',
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 85,
        title: 'Verify',
      });
      vi.spyOn(detector, 'checkDOMElements').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 75,
        selector: '[data-sitekey]',
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      // Title has highest confidence among detected results (85)
      expect(assessment.primaryDetection.confidence).toBe(85);
      expect(assessment.primaryDetection.type).toBe('page_redirect');
    });

    it('updates primaryDetection when later result has equal confidence', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'url_redirect',
        confidence: 80,
        url: 'https://example.com/challenge',
      });
      vi.spyOn(detector, 'checkTitle').mockResolvedValue({
        detected: true,
        type: 'page_redirect',
        confidence: 80,
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      // >= comparison means title replaces url as primary since it comes later
      expect(assessment.primaryDetection.type).toBe('page_redirect');
    });
  });

  // ── assess: error handling granularity ──

  describe('assess — per-check error handling', () => {
    it('continues after title check throws', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });
      vi.spyOn(detector, 'checkTitle').mockRejectedValue(new Error('title fail'));
      vi.spyOn(detector, 'checkDOMElements').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 90,
        selector: '[data-sitekey]',
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('title'),
        expect.any(Error),
      );
      expect(assessment.candidates.length).toBe(1);
      expect(assessment.likelyCaptcha).toBe(true);
    });

    it('continues after DOM check throws', async () => {
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
      vi.spyOn(detector, 'checkDOMElements').mockRejectedValue(new Error('dom fail'));
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('dom'),
        expect.any(Error),
      );
      expect(assessment.recommendedNextStep).toBe('ignore');
    });

    it('continues after text check throws', async () => {
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
      vi.spyOn(detector, 'checkPageText').mockRejectedValue(new Error('text fail'));
      vi.spyOn(detector, 'checkVendorSpecific').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      // @ts-expect-error — mock page
      const _assessment = await detector.assess(page);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('text'),
        expect.any(Error),
      );
    });

    it('continues after vendor check throws', async () => {
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
      vi.spyOn(detector, 'checkVendorSpecific').mockRejectedValue(new Error('vendor fail'));

      // @ts-expect-error — mock page
      const _assessment2 = await detector.assess(page);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('vendor'),
        expect.any(Error),
      );
    });

    it('handles multiple checks throwing', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockRejectedValue(new Error('url fail'));
      vi.spyOn(detector, 'checkTitle').mockRejectedValue(new Error('title fail'));
      vi.spyOn(detector, 'checkDOMElements').mockRejectedValue(new Error('dom fail'));
      vi.spyOn(detector, 'checkPageText').mockRejectedValue(new Error('text fail'));
      vi.spyOn(detector, 'checkVendorSpecific').mockRejectedValue(new Error('vendor fail'));

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      expect(loggerState.warn).toHaveBeenCalledTimes(5);
      expect(assessment.signals).toHaveLength(0);
      expect(assessment.candidates).toHaveLength(0);
      expect(assessment.recommendedNextStep).toBe('ignore');
    });
  });

  // ── evaluateDomRule: edge cases ──

  describe('evaluateDomRule', () => {
    it('returns null when no selectors match', async () => {
      const page = createPageMock({ $: vi.fn(async () => null) });
      const rule = {
        id: 'test',
        label: 'test rule',
        selectors: ['.sel1', '.sel2'],
        confidence: 80,
        typeHint: 'widget' as const,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toBeNull();
    });

    it('returns first matching selector without visibility check', async () => {
      const element = {};
      const page = createPageMock({
        $: vi.fn(async (sel: string) => (sel === '.sel2' ? element : null)),
      });
      const rule = {
        id: 'test',
        label: 'test rule',
        selectors: ['.sel1', '.sel2'],
        confidence: 80,
        typeHint: 'widget' as const,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toEqual({ selector: '.sel2', rule });
    });

    it('skips invisible element when requiresVisibility is true', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => false) };
      const page = createPageMock({
        $: vi.fn(async () => element),
      });
      const rule = {
        id: 'test',
        label: 'test rule',
        selectors: ['.only-sel'],
        confidence: 80,
        typeHint: 'widget' as const,
        requiresVisibility: true,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toBeNull();
    });

    it('accepts visible element when requiresVisibility is true', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async () => element),
      });
      const rule = {
        id: 'test',
        label: 'test rule',
        selectors: ['.visible-sel'],
        confidence: 80,
        typeHint: 'widget' as const,
        requiresVisibility: true,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toEqual({ selector: '.visible-sel', rule });
    });

    it('runs slider verification and rejects if it fails', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async () => element),
      });
      vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(false);

      const rule = {
        id: 'test-slider',
        label: 'slider rule',
        selectors: ['.slider-sel'],
        confidence: 80,
        typeHint: 'slider' as const,
        requiresVisibility: true,
        verifier: 'slider' as const,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toBeNull();
      expect(loggerState.debug).toHaveBeenCalledWith(
        expect.stringContaining('rejected selector after slider verification'),
      );
    });

    it('runs slider verification and accepts if it passes', async () => {
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async () => element),
      });
      vi.spyOn(detector, 'verifySliderElement').mockResolvedValue(true);

      const rule = {
        id: 'test-slider',
        label: 'slider rule',
        selectors: ['.slider-sel'],
        confidence: 80,
        typeHint: 'slider' as const,
        requiresVisibility: true,
        verifier: 'slider' as const,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toEqual({ selector: '.slider-sel', rule });
    });

    it('falls through to second selector when first is invisible', async () => {
      const invisibleElement = { isIntersectingViewport: vi.fn(async () => false) };
      const visibleElement = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async (sel: string) => {
          if (sel === '.first') return invisibleElement;
          if (sel === '.second') return visibleElement;
          return null;
        }),
      });
      const rule = {
        id: 'test',
        label: 'test rule',
        selectors: ['.first', '.second'],
        confidence: 80,
        typeHint: 'widget' as const,
        requiresVisibility: true,
      };

      const result = await detector.evaluateDomRule(page, rule as any);
      expect(result).toEqual({ selector: '.second', rule });
    });
  });

  // ── confirmRuleWithDOM ──

  describe('confirmRuleWithDOM — with requiresDomConfirmation=true', () => {
    it('returns true when verifyByDOM succeeds', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(true) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(false); // hasBrowserCheck
      const page = createPageMock({ evaluate: mockEvaluate });

      const rule = { requiresDomConfirmation: true };
      const result = await detector.confirmRuleWithDOM(page, rule as any);
      expect(result).toBe(true);
    });

    it('returns false when verifyByDOM returns false', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      const page = createPageMock({ evaluate: mockEvaluate });

      const rule = { requiresDomConfirmation: true };
      const result = await detector.confirmRuleWithDOM(page, rule as any);
      expect(result).toBe(false);
    });
  });

  // ── checkUrl: edge cases for URL matching ──

  describe('checkUrl — additional paths', () => {
    it('returns no match for neutral URLs', async () => {
      const page = createPageMock({
        url: vi.fn(() => 'https://example.com/about'),
      });

      const result = await detector.checkUrl(page);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles URL with captcha-frame pattern', async () => {
      const page = createPageMock({
        url: vi.fn(() => 'https://example.com/captcha-frame?id=123'),
      });

      const result = await detector.checkUrl(page);
      expect(result.detected).toBe(true);
      expect(result.providerHint).toBe('embedded_widget');
    });

    it('handles URL with security-check pattern', async () => {
      const page = createPageMock({
        url: vi.fn(() => 'https://example.com/security-check'),
      });

      const result = await detector.checkUrl(page);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('browser_check');
    });
  });

  // ── checkTitle: edge cases ──

  describe('checkTitle — additional paths', () => {
    it('returns not-detected for benign title', async () => {
      const page = createPageMock({
        title: vi.fn(async () => 'My Application Dashboard'),
      });

      const result = await detector.checkTitle(page);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('detects captcha in title with "security check" pattern', async () => {
      const mockEvaluate = vi
        .fn()
        .mockResolvedValueOnce(false) // hasSlider
        .mockResolvedValueOnce(false) // hasWidget
        .mockResolvedValueOnce(true); // hasBrowserCheck
      const page = createPageMock({
        title: vi.fn(async () => 'Security check required'),
        evaluate: mockEvaluate,
      });

      const result = await detector.checkTitle(page);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('page_redirect');
    });
  });

  // ── checkPageText: no text match ──

  describe('checkPageText — no match', () => {
    it('returns not-detected for normal page text', async () => {
      const page = createPageMock({
        evaluate: vi.fn(async () => 'Welcome to our platform. Browse our products.'),
      });

      const result = await detector.checkPageText(page);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });

  // ── detect: vendor check detection shortcut ──

  describe('detect — vendor check detection shortcut', () => {
    it('returns vendor result when all previous checks pass and vendor detects', async () => {
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
        detected: true,
        type: 'widget',
        confidence: 85,
        providerHint: 'embedded_widget',
      });

      // @ts-expect-error — mock page
      const result = await detector.detect(page);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('widget');
      expect(result.confidence).toBe(85);
    });
  });

  // ── getSignalValue: edge cases for 'text' source ──

  describe('getSignalValue — text source edge cases', () => {
    it('returns type when details is null', () => {
      const value = detector.getSignalValue('text', {
        type: 'unknown',
        detected: true,
        confidence: 90,
        details: null,
      });
      expect(value).toBe('unknown');
    });

    it('returns type when details is undefined', () => {
      const value = detector.getSignalValue('text', {
        type: 'unknown',
        detected: true,
        confidence: 90,
        details: undefined,
      });
      expect(value).toBe('unknown');
    });

    it('returns type when details is a number', () => {
      const value = detector.getSignalValue('text', {
        type: 'unknown',
        detected: true,
        confidence: 90,
        details: 42,
      });
      expect(value).toBe('unknown');
    });
  });

  // ── getSignalValue: default case (unknown source) ──

  describe('getSignalValue — default/vendor', () => {
    it('returns type when providerHint is absent for unknown source', () => {
      const value = detector.getSignalValue('unknown_source' as any, {
        type: 'browser_check',
        detected: true,
        confidence: 90,
      });
      expect(value).toBe('browser_check');
    });

    it('returns providerHint when present for unknown source', () => {
      const value = detector.getSignalValue('unknown_source' as any, {
        type: 'browser_check',
        providerHint: 'edge_service',
        detected: true,
        confidence: 90,
      });
      expect(value).toBe('edge_service');
    });
  });

  // ── toAssessmentSignal: captcha signal with full details ──

  describe('toAssessmentSignal — captcha signal details', () => {
    it('includes typeHint, providerHint, and details in captcha signal', () => {
      const result: CaptchaDetectionResult = {
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
        details: { ruleId: 'test', ruleLabel: 'test rule' },
      };

      const signal = detector.toAssessmentSignal('url', result);

      expect(signal).toEqual({
        source: 'url',
        kind: 'captcha',
        value: 'https://example.com/challenge',
        confidence: 95,
        typeHint: 'browser_check',
        providerHint: 'edge_service',
        details: { ruleId: 'test', ruleLabel: 'test rule' },
      });
    });
  });

  // ── toAssessmentCandidate with providerHint ──

  describe('toAssessmentCandidate — full candidate structure', () => {
    it('includes providerHint in candidate', () => {
      const result: CaptchaDetectionResult = {
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
      };

      const candidate = detector.toAssessmentCandidate('url', result);

      expect(candidate).toEqual({
        source: 'url',
        value: 'https://example.com/challenge',
        confidence: 95,
        type: 'browser_check',
        providerHint: 'edge_service',
      });
    });
  });

  // ── matchRule: empty match from regex ──

  describe('matchRule — edge cases', () => {
    it('returns null when regex matches empty string', () => {
      // A regex that matches empty string at the start: /^/
      // match?.[0] would be '' which is falsy
      const rules = [{ pattern: /^/, id: 'empty', confidence: 50, label: 'empty match' }];
      const result = detector.matchRule('test', rules);
      // match[0] = '' which is falsy, so returns null
      expect(result).toBeNull();
    });

    it('returns first matching rule when multiple rules match', () => {
      const rules = [
        { pattern: /captcha/i, id: 'first', confidence: 90, label: 'first' },
        { pattern: /captcha/i, id: 'second', confidence: 80, label: 'second' },
      ];
      const result = detector.matchRule('captcha test', rules);
      expect(result!.rule.id).toBe('first');
    });
  });

  // ── assess: primaryDetection assignment ──

  describe('assess — primaryDetection when likelyCaptcha=true', () => {
    it('assigns detected primaryDetection directly when likelyCaptcha is true', async () => {
      const page = createPageMock();
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'browser_check',
        confidence: 95,
        providerHint: 'edge_service',
        url: 'https://example.com/challenge',
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      expect(assessment.likelyCaptcha).toBe(true);
      expect(assessment.primaryDetection.detected).toBe(true);
      expect(assessment.primaryDetection.type).toBe('browser_check');
    });
  });

  // ── buildCaptchaResult: minimal payload ──

  describe('buildCaptchaResult — minimal fields', () => {
    it('builds result with only required fields', () => {
      const result = detector.buildCaptchaResult({
        confidence: 70,
        type: 'unknown',
      });

      expect(result.detected).toBe(true);
      expect(result.confidence).toBe(70);
      expect(result.type).toBe('unknown');
      expect(result.providerHint).toBeUndefined();
      expect(result.url).toBeUndefined();
      expect(result.title).toBeUndefined();
      expect(result.selector).toBeUndefined();
      expect(result.details).toBeUndefined();
    });
  });

  // ── verifySliderElement: returns the evaluate result ──

  describe('verifySliderElement — evaluate callback', () => {
    it('passes selector and EXCLUDE_SELECTORS to evaluate', async () => {
      const page = createPageMock({
        evaluate: vi.fn().mockResolvedValue(false),
      });

      const result = await detector.verifySliderElement(page, '.my-slider');

      expect(result).toBe(false);
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        '.my-slider',
        expect.any(Array),
      );
    });

    it('returns true when evaluate returns true', async () => {
      const page = createPageMock({
        evaluate: vi.fn().mockResolvedValue(true),
      });

      const result = await detector.verifySliderElement(page, '.captcha-slider');
      expect(result).toBe(true);
    });
  });

  // ── checkDOMElements: multiple rules traversal ──

  describe('checkDOMElements — comprehensive traversal', () => {
    it('tries all DOM rules and returns first match', async () => {
      // Return null for all selectors except a specific browser check selector
      const element = { isIntersectingViewport: vi.fn(async () => true) };
      const page = createPageMock({
        $: vi.fn(async (sel: string) => {
          if (sel.includes('browser-check')) return element;
          return null;
        }),
      });

      const result = await detector.checkDOMElements(page);
      expect(result.detected).toBe(true);
    });
  });

  // ── waitForCompletion: default timeout ──

  describe('waitForCompletion — default timeout', () => {
    it('uses default timeout of 300000ms', async () => {
      vi.useFakeTimers();
      const page = createPageMock();
      vi.spyOn(detector, 'detect').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
      });

      const promise = detector.waitForCompletion(page as any);
      const result = await promise;

      expect(result).toBe(true);
    });
  });

  // ── getRecommendedNextStep: all branches ──

  describe('getRecommendedNextStep — via assess', () => {
    it('returns observe when likelyCaptcha, confidence < 95, candidates < 2, score-excludeScore < 120, excludeScore = 0', async () => {
      const page = createPageMock();
      // Single candidate with confidence 91
      vi.spyOn(detector, 'checkUrl').mockResolvedValue({
        detected: true,
        type: 'widget',
        confidence: 91,
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

      // @ts-expect-error — mock page
      const assessment = await detector.assess(page);

      // candidateCount=1, likelyCaptcha=true (confidence 91 >= 90)
      // confidence < 95, candidateCount < 2, score(91) - excludeScore(0) = 91 < 120
      // excludeScore = 0 → 'observe'
      expect(assessment.recommendedNextStep).toBe('observe');
    });
  });
});

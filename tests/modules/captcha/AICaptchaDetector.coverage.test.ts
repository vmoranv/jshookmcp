import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const fsState = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('fs/promises', () => ({
  mkdir: fsState.mkdir,
  writeFile: fsState.writeFile,
}));

import { AICaptchaDetector } from '@modules/captcha/AICaptchaDetector';
import type { AICaptchaDetectionResult, CaptchaPageInfo } from '@modules/captcha/types';

class TestAICaptchaDetector extends AICaptchaDetector {
  public getScreenshotDir() {
    return this.screenshotDir;
  }

  public override async saveScreenshot(base64: string): Promise<string> {
    return super.saveScreenshot(base64);
  }

  public override async getPageInfo(page: any): Promise<CaptchaPageInfo> {
    return super.getPageInfo(page);
  }

  public normalizeType(type: unknown, detected: boolean) {
    return super.normalizeCaptchaType(type, detected);
  }

  public normalizeProvider(providerHint: unknown, detected: boolean) {
    return super.normalizeProviderHint(providerHint, detected);
  }

  public normalizeDetectedValue(value: unknown) {
    return super.normalizeDetected(value);
  }

  public normalizeConfidenceValue(value: unknown) {
    return super.normalizeConfidence(value);
  }

  public evaluateFallback(pageInfo: CaptchaPageInfo) {
    return super.evaluateFallbackTextAnalysis(pageInfo);
  }

  public applyGuardrails(pageInfo: CaptchaPageInfo, result: AICaptchaDetectionResult) {
    return super.applyLocalGuardrails(pageInfo, result);
  }

  public hasStrongElements(elements: string[]) {
    return super.hasStrongCaptchaElementSignals(elements);
  }

  public hasStrongOverride(pageInfo: CaptchaPageInfo) {
    return super.hasStrongOverrideSignals(pageInfo);
  }
}

function createPage(overrides: Record<string, unknown> = {}) {
  return {
    screenshot: vi.fn(async () => Buffer.from('img').toString('base64')),
    url: vi.fn(() => 'https://example.com/login'),
    title: vi.fn(async () => 'Login Page'),
    evaluate: vi.fn(async () => ({
      bodyText: 'Welcome',
      hasIframes: false,
      suspiciousElements: [],
    })),
    ...overrides,
  } as any;
}

describe('AICaptchaDetector — deep coverage', () => {
  let detector: TestAICaptchaDetector;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    fsState.mkdir.mockReset();
    fsState.writeFile.mockReset();
    detector = new TestAICaptchaDetector();
  });

  // ── constructor ──

  describe('constructor', () => {
    it('uses default screenshot directory', () => {
      const d = new TestAICaptchaDetector();
      expect(d.getScreenshotDir()).toBe('./screenshots');
    });

    it('uses custom screenshot directory', () => {
      const d = new TestAICaptchaDetector('/custom/dir');
      expect(d.getScreenshotDir()).toBe('/custom/dir');
    });
  });

  // ── saveScreenshot ──

  describe('saveScreenshot', () => {
    it('creates directory, writes file, and returns path', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(12345);
      const path = await detector.saveScreenshot(Buffer.from('test').toString('base64'));

      expect(fsState.mkdir).toHaveBeenCalledWith('./screenshots', { recursive: true });
      expect(fsState.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('captcha-12345.png'),
        expect.any(Buffer),
      );
      expect(path).toContain('captcha-12345.png');
    });

    it('throws and logs error when mkdir fails', async () => {
      fsState.mkdir.mockRejectedValue(new Error('permission denied'));

      await expect(detector.saveScreenshot(Buffer.from('test').toString('base64'))).rejects.toThrow(
        'permission denied',
      );

      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist'),
        expect.any(Error),
      );
    });

    it('throws and logs error when writeFile fails', async () => {
      fsState.writeFile.mockRejectedValue(new Error('disk full'));

      await expect(detector.saveScreenshot(Buffer.from('test').toString('base64'))).rejects.toThrow(
        'disk full',
      );

      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist'),
        expect.any(Error),
      );
    });
  });

  // ── detect: error handling ──

  describe('detect — error handling', () => {
    it('returns safe fallback with Error message when detect throws Error', async () => {
      const page = createPage({
        title: vi.fn(async () => {
          throw new Error('page crashed');
        }),
      });

      const result = await detector.detect(page);

      expect(result.detected).toBe(false);
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain('page crashed');
    });

    it('returns safe fallback with stringified non-Error when detect throws string', async () => {
      const page = createPage({
        title: vi.fn(async () => {
          throw 'string error';
        }),
      });

      const result = await detector.detect(page);

      expect(result.detected).toBe(false);
      expect(result.reasoning).toContain('string error');
    });

    it('returns safe fallback when evaluate throws', async () => {
      const page = createPage({
        evaluate: vi.fn(async () => {
          throw new Error('eval failed');
        }),
      });

      const result = await detector.detect(page);

      expect(result.detected).toBe(false);
      expect(result.reasoning).toContain('eval failed');
    });
  });

  // ── getPageInfo ──

  describe('getPageInfo', () => {
    it('extracts page info with url, title, bodyText, hasIframes, suspiciousElements', async () => {
      const page = createPage({
        url: vi.fn(() => 'https://test.com/challenge'),
        title: vi.fn(async () => 'Security Check'),
        evaluate: vi.fn(async () => ({
          bodyText: 'Please verify',
          hasIframes: true,
          suspiciousElements: ['[class*="captcha"] (2)'],
        })),
      });

      const info = await detector.getPageInfo(page);

      expect(info.url).toBe('https://test.com/challenge');
      expect(info.title).toBe('Security Check');
      expect(info.bodyText).toBe('Please verify');
      expect(info.hasIframes).toBe(true);
      expect(info.suspiciousElements).toEqual(['[class*="captcha"] (2)']);
    });
  });

  // ── normalizeCaptchaType ──

  describe('normalizeCaptchaType', () => {
    it('returns "none" when detected is false', () => {
      expect(detector.normalizeType('slider', false)).toBe('none');
    });

    it('returns the type as-is when it is a valid CaptchaType', () => {
      expect(detector.normalizeType('slider', true)).toBe('slider');
      expect(detector.normalizeType('widget', true)).toBe('widget');
      expect(detector.normalizeType('browser_check', true)).toBe('browser_check');
      expect(detector.normalizeType('image', true)).toBe('image');
      expect(detector.normalizeType('page_redirect', true)).toBe('page_redirect');
      expect(detector.normalizeType('url_redirect', true)).toBe('url_redirect');
      expect(detector.normalizeType('text_input', true)).toBe('text_input');
      expect(detector.normalizeType('unknown', true)).toBe('unknown');
      expect(detector.normalizeType('none', true)).toBe('none');
    });

    it('normalizes legacy alias "checkbox" to "widget"', () => {
      expect(detector.normalizeType('checkbox', true)).toBe('widget');
    });

    it('normalizes legacy alias "challenge_widget" to "widget"', () => {
      expect(detector.normalizeType('challenge_widget', true)).toBe('widget');
    });

    it('normalizes legacy alias "browsercheck" to "browser_check"', () => {
      expect(detector.normalizeType('browsercheck', true)).toBe('browser_check');
    });

    it('normalizes legacy alias "browser-check" to "browser_check"', () => {
      expect(detector.normalizeType('browser-check', true)).toBe('browser_check');
    });

    it('normalizes legacy alias "redirect" to "page_redirect"', () => {
      expect(detector.normalizeType('redirect', true)).toBe('page_redirect');
    });

    it('normalizes case-insensitively for aliases', () => {
      expect(detector.normalizeType('CHECKBOX', true)).toBe('widget');
      expect(detector.normalizeType('Browsercheck', true)).toBe('browser_check');
    });

    it('returns "unknown" for unrecognized string type', () => {
      expect(detector.normalizeType('foobar', true)).toBe('unknown');
    });

    it('returns "unknown" for non-string type when detected', () => {
      expect(detector.normalizeType(123, true)).toBe('unknown');
      expect(detector.normalizeType(null, true)).toBe('unknown');
      expect(detector.normalizeType(undefined, true)).toBe('unknown');
      expect(detector.normalizeType({}, true)).toBe('unknown');
    });
  });

  // ── normalizeProviderHint ──

  describe('normalizeProviderHint', () => {
    it('returns the providerHint as-is when it is a valid CaptchaProviderHint', () => {
      expect(detector.normalizeProvider('regional_service', true)).toBe('regional_service');
      expect(detector.normalizeProvider('embedded_widget', true)).toBe('embedded_widget');
      expect(detector.normalizeProvider('edge_service', true)).toBe('edge_service');
      expect(detector.normalizeProvider('managed_service', true)).toBe('managed_service');
      expect(detector.normalizeProvider('external_review', true)).toBe('external_review');
      expect(detector.normalizeProvider('unknown', true)).toBe('unknown');
    });

    it('normalizes legacy alias "regional" to "regional_service"', () => {
      expect(detector.normalizeProvider('regional', true)).toBe('regional_service');
    });

    it('normalizes legacy alias "embedded" to "embedded_widget"', () => {
      expect(detector.normalizeProvider('embedded', true)).toBe('embedded_widget');
    });

    it('normalizes legacy alias "widget" to "embedded_widget"', () => {
      expect(detector.normalizeProvider('widget', true)).toBe('embedded_widget');
    });

    it('normalizes legacy alias "edge" to "edge_service"', () => {
      expect(detector.normalizeProvider('edge', true)).toBe('edge_service');
    });

    it('normalizes legacy alias "managed" to "managed_service"', () => {
      expect(detector.normalizeProvider('managed', true)).toBe('managed_service');
    });

    it('normalizes legacy alias "external-ai-required" to "external_review"', () => {
      expect(detector.normalizeProvider('external-ai-required', true)).toBe('external_review');
    });

    it('normalizes case-insensitively for aliases', () => {
      expect(detector.normalizeProvider('REGIONAL', true)).toBe('regional_service');
      expect(detector.normalizeProvider('Edge', true)).toBe('edge_service');
    });

    it('returns "unknown" for unrecognized string when detected', () => {
      expect(detector.normalizeProvider('foobar', true)).toBe('unknown');
    });

    it('returns undefined for unrecognized string when not detected', () => {
      expect(detector.normalizeProvider('foobar', false)).toBeUndefined();
    });

    it('returns "unknown" for non-string when detected', () => {
      expect(detector.normalizeProvider(123, true)).toBe('unknown');
      expect(detector.normalizeProvider(null, true)).toBe('unknown');
      expect(detector.normalizeProvider(undefined, true)).toBe('unknown');
    });

    it('returns undefined for non-string when not detected', () => {
      expect(detector.normalizeProvider(123, false)).toBeUndefined();
      expect(detector.normalizeProvider(null, false)).toBeUndefined();
      expect(detector.normalizeProvider(undefined, false)).toBeUndefined();
    });
  });

  // ── normalizeDetected ──

  describe('normalizeDetected', () => {
    it('returns boolean as-is', () => {
      expect(detector.normalizeDetectedValue(true)).toBe(true);
      expect(detector.normalizeDetectedValue(false)).toBe(false);
    });

    it('normalizes string "true"', () => {
      expect(detector.normalizeDetectedValue('true')).toBe(true);
      expect(detector.normalizeDetectedValue('TRUE')).toBe(true);
      expect(detector.normalizeDetectedValue(' True ')).toBe(true);
    });

    it('normalizes string "false"', () => {
      expect(detector.normalizeDetectedValue('false')).toBe(false);
      expect(detector.normalizeDetectedValue('FALSE')).toBe(false);
      expect(detector.normalizeDetectedValue(' False ')).toBe(false);
    });

    it('normalizes number 1 to true', () => {
      expect(detector.normalizeDetectedValue(1)).toBe(true);
    });

    it('normalizes number 0 to false', () => {
      expect(detector.normalizeDetectedValue(0)).toBe(false);
    });

    it('returns false for other string values', () => {
      expect(detector.normalizeDetectedValue('yes')).toBe(false);
      expect(detector.normalizeDetectedValue('no')).toBe(false);
      expect(detector.normalizeDetectedValue('')).toBe(false);
    });

    it('returns false for other number values', () => {
      expect(detector.normalizeDetectedValue(2)).toBe(false);
      expect(detector.normalizeDetectedValue(-1)).toBe(false);
      expect(detector.normalizeDetectedValue(0.5)).toBe(false);
    });

    it('returns false for null/undefined/object', () => {
      expect(detector.normalizeDetectedValue(null)).toBe(false);
      expect(detector.normalizeDetectedValue(undefined)).toBe(false);
      expect(detector.normalizeDetectedValue({})).toBe(false);
      expect(detector.normalizeDetectedValue([])).toBe(false);
    });
  });

  // ── normalizeConfidence ──

  describe('normalizeConfidence', () => {
    it('returns the number clamped to 0-100', () => {
      expect(detector.normalizeConfidenceValue(50)).toBe(50);
      expect(detector.normalizeConfidenceValue(0)).toBe(0);
      expect(detector.normalizeConfidenceValue(100)).toBe(100);
    });

    it('clamps values below 0 to 0', () => {
      expect(detector.normalizeConfidenceValue(-10)).toBe(0);
      expect(detector.normalizeConfidenceValue(-100)).toBe(0);
    });

    it('clamps values above 100 to 100', () => {
      expect(detector.normalizeConfidenceValue(150)).toBe(100);
      expect(detector.normalizeConfidenceValue(1000)).toBe(100);
    });

    it('handles string numbers', () => {
      expect(detector.normalizeConfidenceValue('75')).toBe(75);
      expect(detector.normalizeConfidenceValue('150')).toBe(100);
      expect(detector.normalizeConfidenceValue('-5')).toBe(0);
    });

    it('returns 0 for NaN', () => {
      expect(detector.normalizeConfidenceValue(NaN)).toBe(0);
    });

    it('returns 0 for non-numeric strings', () => {
      expect(detector.normalizeConfidenceValue('abc')).toBe(0);
    });

    it('returns 0 for Infinity', () => {
      expect(detector.normalizeConfidenceValue(Infinity)).toBe(0);
      expect(detector.normalizeConfidenceValue(-Infinity)).toBe(0);
    });

    it('returns 0 for null/undefined', () => {
      expect(detector.normalizeConfidenceValue(null)).toBe(0);
      expect(detector.normalizeConfidenceValue(undefined)).toBe(0);
    });
  });

  // ── hasStrongCaptchaElementSignals ──

  describe('hasStrongCaptchaElementSignals', () => {
    it('returns true when element contains captcha signal', () => {
      expect(detector.hasStrongElements(['[class*="captcha"] (2)'])).toBe(true);
    });

    it('returns true when element contains challenge signal', () => {
      expect(detector.hasStrongElements(['#challenge-form (1)'])).toBe(true);
    });

    it('returns true when element contains slider signal', () => {
      expect(detector.hasStrongElements(['.slider-container (1)'])).toBe(true);
    });

    it('returns true when element contains widget signal', () => {
      expect(detector.hasStrongElements(['[class*="widget"] (1)'])).toBe(true);
    });

    it('returns true when element contains checkbox signal', () => {
      expect(detector.hasStrongElements(['input[type="checkbox"] (1)'])).toBe(true);
    });

    it('returns true when element contains sitekey signal', () => {
      expect(detector.hasStrongElements(['[data-sitekey] (1)'])).toBe(true);
    });

    it('returns true when element contains browser-check signal', () => {
      expect(detector.hasStrongElements(['[class*="browser-check"] (1)'])).toBe(true);
    });

    it('returns true when element contains security-check signal', () => {
      expect(detector.hasStrongElements(['[class*="security-check"] (1)'])).toBe(true);
    });

    it('returns false when no captcha signals in elements', () => {
      expect(detector.hasStrongElements(['[class*="navbar"] (1)'])).toBe(false);
      expect(detector.hasStrongElements(['[class*="footer"] (1)'])).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(detector.hasStrongElements([])).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(detector.hasStrongElements(['[class*="CAPTCHA"] (1)'])).toBe(true);
      expect(detector.hasStrongElements(['[class*="SLIDER"] (1)'])).toBe(true);
    });
  });

  // ── hasStrongOverrideSignals ──

  describe('hasStrongOverrideSignals', () => {
    it('returns true when both element signals and captcha keywords present', () => {
      const result = detector.hasStrongOverride({
        url: 'https://example.com',
        title: '安全验证',
        bodyText: '请完成安全验证',
        hasIframes: false,
        suspiciousElements: ['.captcha-slider (1)'],
      });
      expect(result).toBe(true);
    });

    it('returns false when element signals present but no captcha keywords', () => {
      const result = detector.hasStrongOverride({
        url: 'https://example.com',
        title: 'Normal Page',
        bodyText: 'Welcome back',
        hasIframes: false,
        suspiciousElements: ['.captcha-container (1)'],
      });
      expect(result).toBe(false);
    });

    it('returns false when captcha keywords present but no element signals', () => {
      const result = detector.hasStrongOverride({
        url: 'https://example.com',
        title: '安全验证',
        bodyText: '请完成安全验证',
        hasIframes: false,
        suspiciousElements: [],
      });
      expect(result).toBe(false);
    });

    it('returns false when neither present', () => {
      const result = detector.hasStrongOverride({
        url: 'https://example.com',
        title: 'Normal Page',
        bodyText: 'Welcome back',
        hasIframes: false,
        suspiciousElements: [],
      });
      expect(result).toBe(false);
    });
  });

  // ── applyLocalGuardrails ──

  describe('applyLocalGuardrails — pass-through for detected results', () => {
    it('returns the AI result as-is when detected=true', () => {
      const aiResult: AICaptchaDetectionResult = {
        detected: true,
        type: 'slider',
        confidence: 95,
        reasoning: 'Slider CAPTCHA detected',
      };
      const pageInfo: CaptchaPageInfo = {
        url: 'https://example.com',
        title: 'Normal',
        bodyText: 'Normal page',
        hasIframes: false,
        suspiciousElements: [],
      };

      const result = detector.applyGuardrails(pageInfo, aiResult);
      expect(result).toBe(aiResult);
    });

    it('returns the AI result as-is when not detected and no strong override signals', () => {
      const aiResult: AICaptchaDetectionResult = {
        detected: false,
        type: 'none',
        confidence: 90,
        reasoning: 'No CAPTCHA found',
      };
      const pageInfo: CaptchaPageInfo = {
        url: 'https://example.com',
        title: 'Normal',
        bodyText: 'Normal page',
        hasIframes: false,
        suspiciousElements: [],
      };

      const result = detector.applyGuardrails(pageInfo, aiResult);
      expect(result).toBe(aiResult);
    });
  });

  // ── evaluateFallbackTextAnalysis ──

  describe('evaluateFallbackTextAnalysis', () => {
    it('detects CAPTCHA when strong elements and keywords present', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com',
        title: 'Security Check',
        bodyText: 'Please complete the captcha verification',
        hasIframes: false,
        suspiciousElements: ['[class*="captcha"] (1)'],
      });

      expect(result.detected).toBe(true);
      expect(result.type).toBe('unknown');
      expect(result.confidence).toBe(60);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('returns not-detected with high confidence when excluded keywords match without captcha signals', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com',
        title: 'Login',
        bodyText: 'Enter verification code sent to your email',
        hasIframes: false,
        suspiciousElements: ['[class*="verify"] (1)'],
      });

      expect(result.detected).toBe(false);
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(95);
      expect(result.reasoning).toContain('OTP');
    });

    it('detects with lower confidence when both CAPTCHA and exclude signals present', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com',
        title: '安全验证',
        bodyText: '请输入验证码后拖动滑块完成安全验证',
        hasIframes: false,
        suspiciousElements: ['.captcha-slider (1)'],
      });

      expect(result.detected).toBe(true);
      expect(result.type).toBe('unknown');
      expect(result.confidence).toBe(55);
      expect(result.reasoning).toContain('strong CAPTCHA signals despite OTP');
    });

    it('returns not-detected for normal page without any signals', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com',
        title: 'Home',
        bodyText: 'Welcome to our platform',
        hasIframes: false,
        suspiciousElements: [],
      });

      expect(result.detected).toBe(false);
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(90);
      expect(result.reasoning).toContain('did not find strong CAPTCHA signals');
    });

    it('returns not-detected when only element signals match but no keywords', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com',
        title: 'Dashboard',
        bodyText: 'Your account overview',
        hasIframes: false,
        suspiciousElements: ['[class*="captcha"] (1)'],
      });

      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(90);
    });

    it('returns not-detected when only keywords match but no element signals', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com',
        title: 'Security check',
        bodyText: 'Please complete captcha',
        hasIframes: false,
        suspiciousElements: [],
      });

      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(90);
    });

    it('checks URL in searchable text for keywords', () => {
      const result = detector.evaluateFallback({
        url: 'https://example.com/captcha-challenge',
        title: 'Test',
        bodyText: 'Please complete verification',
        hasIframes: false,
        suspiciousElements: ['.captcha-widget (1)'],
      });

      // 'captcha' appears in URL, 'captcha' is a FALLBACK_CAPTCHA_KEYWORD
      expect(result.detected).toBe(true);
    });
  });

  // ── waitForCompletion ──

  describe('waitForCompletion', () => {
    it('returns true when confidence drops below 50', async () => {
      vi.useFakeTimers();
      vi.spyOn(detector, 'detect')
        .mockResolvedValueOnce({
          detected: true,
          type: 'unknown',
          confidence: 80,
          reasoning: '',
        })
        .mockResolvedValueOnce({
          detected: true,
          type: 'unknown',
          confidence: 45,
          reasoning: '',
        });

      const promise = detector.waitForCompletion(createPage(), 10000);
      await vi.advanceTimersByTimeAsync(3100);
      const result = await promise;

      expect(result).toBe(true);
    });

    it('returns true when detected becomes false', async () => {
      vi.useFakeTimers();
      vi.spyOn(detector, 'detect')
        .mockResolvedValueOnce({
          detected: true,
          type: 'unknown',
          confidence: 80,
          reasoning: '',
        })
        .mockResolvedValueOnce({
          detected: false,
          type: 'none',
          confidence: 0,
          reasoning: '',
        });

      const promise = detector.waitForCompletion(createPage(), 10000);
      await vi.advanceTimersByTimeAsync(3100);
      const result = await promise;

      expect(result).toBe(true);
    });

    it('returns false after timeout when captcha persists', async () => {
      vi.useFakeTimers();
      vi.spyOn(detector, 'detect').mockResolvedValue({
        detected: true,
        type: 'unknown',
        confidence: 90,
        reasoning: '',
      });

      const promise = detector.waitForCompletion(createPage(), 2000);
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result).toBe(false);
      expect(loggerState.error).toHaveBeenCalledWith(expect.stringContaining('Timed out'));
    });

    it('uses default timeout of 300000ms', async () => {
      vi.useFakeTimers();
      vi.spyOn(detector, 'detect').mockResolvedValue({
        detected: false,
        type: 'none',
        confidence: 0,
        reasoning: '',
      });

      const promise = detector.waitForCompletion(createPage());
      const result = await promise;

      expect(result).toBe(true);
      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('no longer detected'));
    });
  });

  // ── detect: full flow ──

  describe('detect — full flow', () => {
    it('logs detection result info', async () => {
      const page = createPage({
        title: vi.fn(async () => 'Normal Page'),
        evaluate: vi.fn(async () => ({
          bodyText: 'Normal content',
          hasIframes: false,
          suspiciousElements: [],
        })),
      });

      await detector.detect(page);

      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('Running rule-based'));
      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('not_detected'));
    });

    it('logs detected result', async () => {
      const page = createPage({
        title: vi.fn(async () => '安全验证'),
        evaluate: vi.fn(async () => ({
          bodyText: '请完成安全验证并拖动滑块',
          hasIframes: false,
          suspiciousElements: ['.captcha-slider (1)'],
        })),
      });

      await detector.detect(page);

      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('detected'));
    });
  });

  // ── applyLocalGuardrails: preserves screenshotPath ──

  describe('applyLocalGuardrails — screenshotPath preservation', () => {
    it('preserves screenshotPath from AI result in override', () => {
      const aiResult: AICaptchaDetectionResult = {
        detected: false,
        type: 'none',
        confidence: 90,
        reasoning: 'no captcha',
        screenshotPath: '/path/to/screenshot.png',
      };
      const pageInfo: CaptchaPageInfo = {
        url: 'https://example.com',
        title: '安全验证',
        bodyText: '请完成安全验证',
        hasIframes: false,
        suspiciousElements: ['.captcha-slider (1)'],
      };

      const result = detector.applyGuardrails(pageInfo, aiResult);
      expect(result.detected).toBe(true);
      expect(result.screenshotPath).toBe('/path/to/screenshot.png');
    });

    it('does not set screenshotPath when AI result has none', () => {
      const aiResult: AICaptchaDetectionResult = {
        detected: false,
        type: 'none',
        confidence: 90,
        reasoning: 'no captcha',
      };
      const pageInfo: CaptchaPageInfo = {
        url: 'https://example.com',
        title: '安全验证',
        bodyText: '请完成安全验证',
        hasIframes: false,
        suspiciousElements: ['.captcha-slider (1)'],
      };

      const result = detector.applyGuardrails(pageInfo, aiResult);
      expect(result.detected).toBe(true);
      expect(result.screenshotPath).toBeUndefined();
    });
  });
});

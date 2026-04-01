import { describe, expect, it } from 'vitest';

import {
  CAPTCHA_KEYWORDS,
  CAPTCHA_MATCH_RULES,
  DOM_MATCH_RULES,
  EXCLUDE_KEYWORDS,
  EXCLUDE_MATCH_RULES,
  FALLBACK_CAPTCHA_KEYWORDS,
  FALLBACK_EXCLUDE_KEYWORDS,
  CAPTCHA_SELECTORS,
  EXCLUDE_SELECTORS,
} from '@modules/captcha/CaptchaDetector.constants';

describe('CaptchaDetector.constants', () => {
  describe('re-exports validation', () => {
    it('exports CAPTCHA_KEYWORDS with url, title, text arrays', () => {
      expect(CAPTCHA_KEYWORDS).toBeDefined();
      expect(Array.isArray(CAPTCHA_KEYWORDS.url)).toBe(true);
      expect(Array.isArray(CAPTCHA_KEYWORDS.title)).toBe(true);
      expect(Array.isArray(CAPTCHA_KEYWORDS.text)).toBe(true);
    });

    it('exports EXCLUDE_KEYWORDS with url, title, text arrays', () => {
      expect(EXCLUDE_KEYWORDS).toBeDefined();
      expect(Array.isArray(EXCLUDE_KEYWORDS.url)).toBe(true);
      expect(Array.isArray(EXCLUDE_KEYWORDS.title)).toBe(true);
      expect(Array.isArray(EXCLUDE_KEYWORDS.text)).toBe(true);
    });

    it('exports CAPTCHA_MATCH_RULES with url, title, text rule arrays', () => {
      expect(CAPTCHA_MATCH_RULES).toBeDefined();
      expect(Array.isArray(CAPTCHA_MATCH_RULES.url)).toBe(true);
      expect(Array.isArray(CAPTCHA_MATCH_RULES.title)).toBe(true);
      expect(Array.isArray(CAPTCHA_MATCH_RULES.text)).toBe(true);
    });

    it('exports EXCLUDE_MATCH_RULES with url, title, text rule arrays', () => {
      expect(EXCLUDE_MATCH_RULES).toBeDefined();
      expect(Array.isArray(EXCLUDE_MATCH_RULES.url)).toBe(true);
      expect(Array.isArray(EXCLUDE_MATCH_RULES.title)).toBe(true);
      expect(Array.isArray(EXCLUDE_MATCH_RULES.text)).toBe(true);
    });

    it('exports DOM_MATCH_RULES as an array', () => {
      expect(Array.isArray(DOM_MATCH_RULES)).toBe(true);
      expect(DOM_MATCH_RULES.length).toBeGreaterThan(0);
    });

    it('exports FALLBACK_CAPTCHA_KEYWORDS as an array', () => {
      expect(Array.isArray(FALLBACK_CAPTCHA_KEYWORDS)).toBe(true);
      expect(FALLBACK_CAPTCHA_KEYWORDS.length).toBeGreaterThan(0);
    });

    it('exports FALLBACK_EXCLUDE_KEYWORDS as an array', () => {
      expect(Array.isArray(FALLBACK_EXCLUDE_KEYWORDS)).toBe(true);
      expect(FALLBACK_EXCLUDE_KEYWORDS.length).toBeGreaterThan(0);
    });

    it('exports CAPTCHA_SELECTORS as an object with selector categories', () => {
      expect(CAPTCHA_SELECTORS).toBeDefined();
      expect(typeof CAPTCHA_SELECTORS).toBe('object');
      expect(Array.isArray(CAPTCHA_SELECTORS.slider)).toBe(true);
      expect(Array.isArray(CAPTCHA_SELECTORS.widget)).toBe(true);
      expect(Array.isArray(CAPTCHA_SELECTORS.browserCheck)).toBe(true);
      expect(Array.isArray(CAPTCHA_SELECTORS.generic)).toBe(true);
    });

    it('exports EXCLUDE_SELECTORS as an array', () => {
      expect(Array.isArray(EXCLUDE_SELECTORS)).toBe(true);
      expect(EXCLUDE_SELECTORS.length).toBeGreaterThan(0);
    });
  });

  describe('CAPTCHA_MATCH_RULES structure', () => {
    it('each url rule has required properties', () => {
      for (const rule of CAPTCHA_MATCH_RULES.url) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('label');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('confidence');
        expect(rule.pattern).toBeInstanceOf(RegExp);
        expect(typeof rule.confidence).toBe('number');
      }
    });

    it('each title rule has required properties', () => {
      for (const rule of CAPTCHA_MATCH_RULES.title) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('label');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('confidence');
        expect(rule.pattern).toBeInstanceOf(RegExp);
      }
    });

    it('each text rule has required properties', () => {
      for (const rule of CAPTCHA_MATCH_RULES.text) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('label');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('confidence');
        expect(rule.pattern).toBeInstanceOf(RegExp);
      }
    });
  });

  describe('DOM_MATCH_RULES structure', () => {
    it('each DOM rule has required properties', () => {
      for (const rule of DOM_MATCH_RULES) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('label');
        expect(rule).toHaveProperty('selectors');
        expect(rule).toHaveProperty('confidence');
        expect(rule).toHaveProperty('typeHint');
        expect(Array.isArray(rule.selectors)).toBe(true);
        expect(rule.selectors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('FALLBACK keywords content', () => {
    it('includes both English and Chinese captcha keywords', () => {
      // English
      expect(FALLBACK_CAPTCHA_KEYWORDS.some((k) => k.includes('captcha'))).toBe(true);
      expect(FALLBACK_CAPTCHA_KEYWORDS.some((k) => k.includes('verify'))).toBe(true);
      // Chinese
      expect(FALLBACK_CAPTCHA_KEYWORDS.some((k) => k.includes('验证'))).toBe(true);
    });

    it('includes both English and Chinese exclude keywords', () => {
      // English
      expect(FALLBACK_EXCLUDE_KEYWORDS.some((k) => k.includes('verification code'))).toBe(true);
      // Chinese
      expect(FALLBACK_EXCLUDE_KEYWORDS.some((k) => k.includes('验证码'))).toBe(true);
    });
  });
});

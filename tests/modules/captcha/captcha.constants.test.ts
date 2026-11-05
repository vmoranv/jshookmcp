import { describe, expect, it } from 'vitest';

import {
  CAPTCHA_MATCH_RULES,
  DOM_MATCH_RULES,
  FALLBACK_CAPTCHA_KEYWORDS,
  FALLBACK_EXCLUDE_KEYWORDS,
} from '@modules/captcha/CaptchaDetector.constants';

describe('CaptchaDetector.constants', () => {
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

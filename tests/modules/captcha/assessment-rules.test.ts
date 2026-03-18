import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CAPTCHA_MATCH_RULES, EXCLUDE_MATCH_RULES } from '@modules/captcha/rules/assessment-rules';

describe('captcha assessment rules', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('contains high-confidence include rules for URLs, titles and challenge text', () => {
    expect(CAPTCHA_MATCH_RULES.url[0]?.pattern.test('/cdn-cgi/challenge-platform')).toBe(true);
    expect(CAPTCHA_MATCH_RULES.title[0]?.pattern.test('Security Check')).toBe(true);
    expect(CAPTCHA_MATCH_RULES.text[1]?.pattern.test('请完成安全验证')).toBe(true);
  });

  it('contains exclusion rules for otp and account verification flows', () => {
    expect(EXCLUDE_MATCH_RULES.url[0]?.pattern.test('/verify-email')).toBe(true);
    expect(EXCLUDE_MATCH_RULES.title[0]?.pattern.test('Enter verification code')).toBe(true);
    expect(EXCLUDE_MATCH_RULES.text[1]?.pattern.test('Two-factor authentication')).toBe(true);
  });
});

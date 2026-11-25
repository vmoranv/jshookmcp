import { describe, expect, it } from 'vitest';
import { compileSafeRegex, MAX_PATTERN_LENGTH } from '@utils/safeRegExp';

describe('utils/safeRegExp', () => {
  it('compiles simple literal patterns', () => {
    const re = compileSafeRegex('hello');
    expect(re.test('hello world')).toBe(true);
    expect(re.test('goodbye')).toBe(false);
  });

  it('compiles patterns with flags', () => {
    const re = compileSafeRegex('HELLO', 'i');
    expect(re.test('hello')).toBe(true);
  });

  it('strips stateful g/y flags', () => {
    const re = compileSafeRegex('hello', 'gi');
    expect(re.flags).not.toContain('g');
    expect(re.flags).toContain('i');
  });

  it('rejects empty pattern', () => {
    expect(() => compileSafeRegex('')).toThrow('non-empty string');
  });

  it('rejects non-string pattern', () => {
    expect(() => compileSafeRegex(123 as unknown as string)).toThrow('non-empty string');
  });

  it('rejects pattern exceeding max length', () => {
    const longPattern = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
    expect(() => compileSafeRegex(longPattern)).toThrow('exceeds maximum');
  });

  it('accepts pattern at exactly max length', () => {
    const maxPattern = 'a'.repeat(MAX_PATTERN_LENGTH);
    expect(() => compileSafeRegex(maxPattern)).not.toThrow();
  });

  it('rejects nested quantifier (a+)+', () => {
    expect(() => compileSafeRegex('(a+)+')).toThrow('nested quantifiers');
  });

  it('rejects nested quantifier (a*)*', () => {
    expect(() => compileSafeRegex('(a*)*')).toThrow('nested quantifiers');
  });

  it('rejects nested quantifier (a?)?', () => {
    expect(() => compileSafeRegex('(a?)?')).toThrow('nested quantifiers');
  });

  it('rejects nested quantifier with {n,m}', () => {
    expect(() => compileSafeRegex('(a{1,3}){2,5}')).toThrow('nested quantifiers');
  });

  it('accepts non-nested quantifier groups', () => {
    // A group with a quantifier inside but the group itself is NOT quantified
    expect(() => compileSafeRegex('(a+|b+)')).not.toThrow();
  });

  it('accepts simple quantifiers', () => {
    expect(() => compileSafeRegex('a+')).not.toThrow();
    expect(() => compileSafeRegex('a*')).not.toThrow();
    expect(() => compileSafeRegex('a?')).not.toThrow();
    expect(() => compileSafeRegex('a{1,3}')).not.toThrow();
  });

  it('rejects invalid regex syntax', () => {
    expect(() => compileSafeRegex('[invalid')).toThrow();
  });

  it('repeated test() calls are stable (no g/y flag mutation)', () => {
    const re = compileSafeRegex('hello', 'g');
    expect(re.flags).not.toContain('g');
    expect(re.test('hello')).toBe(true);
    expect(re.test('hello')).toBe(true);
    expect(re.test('hello')).toBe(true);
  });

  it('MAX_PATTERN_LENGTH is 256', () => {
    expect(MAX_PATTERN_LENGTH).toBe(256);
  });
});


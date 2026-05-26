import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  classifyOne,
  compileRuleInput,
  mergeRules,
  categorize,
} from '@modules/dart-inspector/classifiers';
import type {
  CategoryRule,
  CategoryRuleInput,
  ExtractedString,
} from '@modules/dart-inspector/types';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

function mkString(value: string): ExtractedString {
  return { value, offsets: [0], encoding: 'ascii' };
}

describe('DEFAULT_RULES classification', () => {
  it('matches HTTPS URLs to urls', () => {
    expect(classifyOne(withPath(TEST_URLS.api, '/v1/login'), DEFAULT_RULES)).toBe('urls');
  });

  it('matches HTTP URLs to urls', () => {
    expect(classifyOne('http://127.0.0.1:8080/api', DEFAULT_RULES)).toBe('urls');
  });

  it('matches absolute slash paths to paths', () => {
    expect(classifyOne('/api/v1/users/profile', DEFAULT_RULES)).toBe('paths');
    expect(classifyOne('/v1/login', DEFAULT_RULES)).toBe('paths');
  });

  it('excludes image-like paths from paths', () => {
    expect(classifyOne('/static/logo.png', DEFAULT_RULES)).toBeUndefined();
    expect(classifyOne('/img/banner.jpg', DEFAULT_RULES)).toBeUndefined();
    expect(classifyOne('/icons/foo.svg', DEFAULT_RULES)).toBeUndefined();
    expect(classifyOne('/anim.gif', DEFAULT_RULES)).toBeUndefined();
    expect(classifyOne('/photo.webp', DEFAULT_RULES)).toBeUndefined();
  });

  it('matches package: refs to packageRefs', () => {
    expect(classifyOne('package:dio/src/dio.dart', DEFAULT_RULES)).toBe('packageRefs');
    expect(classifyOne('package:flutter/material.dart', DEFAULT_RULES)).toBe('packageRefs');
  });

  it('rejects malformed package refs', () => {
    expect(classifyOne('package:', DEFAULT_RULES)).toBeUndefined();
    expect(classifyOne('package:/missing-name.dart', DEFAULT_RULES)).toBeUndefined();
  });

  it('matches Dart-style class names to classNames', () => {
    expect(classifyOne('LoginViewModel', DEFAULT_RULES)).toBe('classNames');
    expect(classifyOne('_PrivateClass', DEFAULT_RULES)).toBe('classNames');
    expect(classifyOne('Api', DEFAULT_RULES)).toBe('classNames');
  });

  it('excludes ALL_CAPS strings from classNames', () => {
    // 'AES' is all-uppercase → falls through to cryptoKeywords (matches first)
    expect(classifyOne('AES', DEFAULT_RULES)).toBe('cryptoKeywords');
    // 'XYZ' is all-uppercase non-crypto → unclassified
    expect(classifyOne('XYZ', DEFAULT_RULES)).toBeUndefined();
  });

  it('matches crypto keywords case-insensitively', () => {
    expect(classifyOne('AES', DEFAULT_RULES)).toBe('cryptoKeywords');
    expect(classifyOne('rsa', DEFAULT_RULES)).toBe('cryptoKeywords');
    expect(classifyOne('HMAC', DEFAULT_RULES)).toBe('cryptoKeywords');
    expect(classifyOne('SHA256', DEFAULT_RULES)).toBe('cryptoKeywords');
    expect(classifyOne('encrypt', DEFAULT_RULES)).toBe('cryptoKeywords');
    expect(classifyOne('cipher', DEFAULT_RULES)).toBe('cryptoKeywords');
  });

  it('returns undefined for unrelated strings', () => {
    expect(classifyOne('hello world', DEFAULT_RULES)).toBeUndefined();
    expect(classifyOne('', DEFAULT_RULES)).toBeUndefined();
  });
});

describe('classifyOne is order-sensitive (first match wins)', () => {
  it('uses first matching rule', () => {
    const rules: CategoryRule[] = [
      { category: 'apiRoutes', pattern: /^\/api\// },
      { category: 'paths', pattern: /^\/.+/ },
    ];
    expect(classifyOne('/api/v1/users', rules)).toBe('apiRoutes');
  });

  it('falls through when first rule excludes via exclude regex', () => {
    const rules: CategoryRule[] = [
      { category: 'paths', pattern: /^\/.+/, exclude: /\.png$/ },
      { category: 'fallback', pattern: /^\/.+/ },
    ];
    expect(classifyOne('/static/logo.png', rules)).toBe('fallback');
  });
});

describe('compileRuleInput', () => {
  it('compiles a basic rule', () => {
    const input: CategoryRuleInput = { category: 'flag', pattern: '^FLAG_', flags: 'i' };
    const rule = compileRuleInput(input);
    expect(rule.category).toBe('flag');
    expect(rule.pattern).toBeInstanceOf(RegExp);
    expect(rule.pattern.test('flag_debug')).toBe(true);
    expect(rule.pattern.flags).toContain('i');
  });

  it('compiles exclude pattern when provided', () => {
    const rule = compileRuleInput({
      category: 'x',
      pattern: 'foo',
      exclude: 'bar',
      excludeFlags: 'i',
    });
    expect(rule.exclude).toBeInstanceOf(RegExp);
    expect(rule.exclude?.test('BAR')).toBe(true);
  });

  it('rejects invalid regex syntax with VALIDATION ToolError', () => {
    expect(() => compileRuleInput({ category: 'x', pattern: '(' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('rejects oversized pattern', () => {
    const longPattern = 'a'.repeat(257);
    expect(() => compileRuleInput({ category: 'x', pattern: longPattern })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('rejects disallowed flags', () => {
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: 'g' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: 'm' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: 'y' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('rejects catastrophic backtracking patterns', () => {
    expect(() => compileRuleInput({ category: 'x', pattern: '(a+)+' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
    expect(() => compileRuleInput({ category: 'x', pattern: '(a*)+b' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
    expect(() => compileRuleInput({ category: 'x', pattern: '(a|b)+c+' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('accepts allowed flags i and u individually and combined', () => {
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: 'i' })).not.toThrow();
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: 'u' })).not.toThrow();
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: 'iu' })).not.toThrow();
    expect(() => compileRuleInput({ category: 'x', pattern: 'foo', flags: '' })).not.toThrow();
  });

  it('rejects empty category', () => {
    expect(() => compileRuleInput({ category: '', pattern: 'foo' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });
});

describe('mergeRules', () => {
  const defaults: CategoryRule[] = [{ category: 'a', pattern: /a/ }];
  const custom: CategoryRule[] = [{ category: 'b', pattern: /b/ }];

  it("'append' puts defaults first", () => {
    const merged = mergeRules(defaults, custom, 'append');
    expect(merged.map((r) => r.category)).toEqual(['a', 'b']);
  });

  it("'prepend' puts custom first", () => {
    const merged = mergeRules(defaults, custom, 'prepend');
    expect(merged.map((r) => r.category)).toEqual(['b', 'a']);
  });

  it("'replace' uses only custom", () => {
    const merged = mergeRules(defaults, custom, 'replace');
    expect(merged.map((r) => r.category)).toEqual(['b']);
  });

  it('handles undefined custom as defaults regardless of mode', () => {
    expect(mergeRules(defaults, undefined, 'append').map((r) => r.category)).toEqual(['a']);
    expect(mergeRules(defaults, undefined, 'prepend').map((r) => r.category)).toEqual(['a']);
  });

  it("'replace' with undefined custom yields empty (caller opted in to clear)", () => {
    expect(mergeRules(defaults, undefined, 'replace')).toEqual([]);
  });

  it('returns frozen / readonly result', () => {
    const merged = mergeRules(defaults, custom, 'append');
    // Should not be mutable; either frozen or fresh array unaffected by source mutation
    const inputCopy = [...defaults];
    inputCopy.push({ category: 'c', pattern: /c/ });
    expect(merged.map((r) => r.category)).toEqual(['a', 'b']);
  });
});

describe('categorize', () => {
  it('groups strings by their first-matching rule', () => {
    const strings: ExtractedString[] = [
      mkString(TEST_URLS.api),
      mkString('/v1/users'),
      mkString('package:dio/src/dio.dart'),
      mkString('LoginViewModel'),
      mkString('AES'),
    ];
    const out = categorize(strings, DEFAULT_RULES, false);
    expect(out.urls?.map((s) => s.value)).toEqual([TEST_URLS.api]);
    expect(out.paths?.map((s) => s.value)).toEqual(['/v1/users']);
    expect(out.packageRefs?.map((s) => s.value)).toEqual(['package:dio/src/dio.dart']);
    expect(out.classNames?.map((s) => s.value)).toEqual(['LoginViewModel']);
    expect(out.cryptoKeywords?.map((s) => s.value)).toEqual(['AES']);
  });

  it('drops unclassified strings when includeRaw=false', () => {
    const strings = [mkString('https://x'), mkString('random gibberish')];
    const out = categorize(strings, DEFAULT_RULES, false);
    expect(out.raw).toBeUndefined();
    expect(out.urls?.map((s) => s.value)).toEqual(['https://x']);
  });

  it('collects unclassified strings into raw when includeRaw=true', () => {
    const strings = [mkString('https://x'), mkString('random gibberish')];
    const out = categorize(strings, DEFAULT_RULES, true);
    expect(out.raw?.map((s) => s.value)).toEqual(['random gibberish']);
  });

  it('sorts each category alphabetically by value', () => {
    const strings = [
      mkString('https://b.com'),
      mkString('https://a.com'),
      mkString('https://c.com'),
    ];
    const out = categorize(strings, DEFAULT_RULES, false);
    expect(out.urls?.map((s) => s.value)).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('preserves ExtractedString offsets and encoding', () => {
    const item: ExtractedString = {
      value: TEST_URLS.api,
      offsets: [100, 200],
      encoding: 'utf16le',
    };
    const out = categorize([item], DEFAULT_RULES, false);
    expect(out.urls?.[0]).toEqual(item);
  });

  it('returns empty arrays for categories with no matches (not missing keys)', () => {
    const strings = [mkString('https://only-url.com')];
    const out = categorize(strings, DEFAULT_RULES, false);
    // urls populated, others empty arrays (avoids "undefined" surprises downstream)
    expect(out.urls).toHaveLength(1);
    expect(out.paths).toEqual([]);
    expect(out.classNames).toEqual([]);
    expect(out.packageRefs).toEqual([]);
    expect(out.cryptoKeywords).toEqual([]);
  });
});

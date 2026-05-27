/**
 * ReDoS integration tests for the apk-packer module.
 *
 * Mirrors the dart-inspector two-red-line model:
 *   1. **Compile-time** — `compileSignatureInput()` rejects patterns
 *      matching the catastrophic-backtracking heuristics (`(a+)+`, etc.).
 *   2. **Runtime** — `testPatternTimed` rejects a match attempt that
 *      exceeds the configured budget. Post-hoc; V8 cannot preempt regex
 *      execution.
 */
import { describe, it, expect } from 'vitest';

import { compileSignatureInput, testPatternTimed } from '@modules/apk-packer/classifiers';
import { APK_PACKER_MAX_REGEX_PATTERN_LENGTH } from '@modules/apk-packer/constants';

describe('ReDoS red line 1 — compile-time heuristic rejection', () => {
  it('rejects (a+)+ as catastrophic at compile time', () => {
    expect(() =>
      compileSignatureInput({
        name: 'evil',
        category: 'attacker',
        libPatterns: ['^(a+)+$'],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: 'ToolError',
        code: 'VALIDATION',
        message: expect.stringContaining('catastrophic'),
      }),
    );
  });

  it('rejects (a|b)+c+ as catastrophic at compile time', () => {
    expect(() =>
      compileSignatureInput({
        name: 'evil',
        category: 'attacker',
        libPatterns: ['^(a|b)+c+$'],
      }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('rejects (a*)+b as catastrophic at compile time', () => {
    expect(() =>
      compileSignatureInput({
        name: 'evil',
        category: 'attacker',
        libPatterns: ['(a*)+b'],
      }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('rejects oversized pattern over APK_PACKER_MAX_REGEX_PATTERN_LENGTH', () => {
    const longPattern = '^lib' + 'a'.repeat(APK_PACKER_MAX_REGEX_PATTERN_LENGTH) + '\\.so$';
    expect(() =>
      compileSignatureInput({
        name: 'long',
        category: 'attacker',
        libPatterns: [longPattern],
      }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('rejects invalid regex syntax with VALIDATION', () => {
    expect(() =>
      compileSignatureInput({
        name: 'bad-syntax',
        category: 'attacker',
        libPatterns: ['^lib(.+\\.so$'],
      }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('rejects empty name', () => {
    expect(() =>
      compileSignatureInput({ name: '', category: 'x', libPatterns: ['libfoo.so'] }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('rejects empty libPatterns array', () => {
    expect(() => compileSignatureInput({ name: 'x', category: 'y', libPatterns: [] })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('accepts literal filenames untouched (no regex compilation)', () => {
    const sig = compileSignatureInput({
      name: 'safe',
      category: 'safe',
      libPatterns: ['libfoo.so', 'libbar.so'],
    });
    expect(sig.libPatterns).toEqual(['libfoo.so', 'libbar.so']);
  });

  it('lowercases literal filenames', () => {
    const sig = compileSignatureInput({
      name: 'safe',
      category: 'safe',
      libPatterns: ['LIBFOO.SO'],
    });
    expect(sig.libPatterns[0]).toBe('libfoo.so');
  });

  it('compiles safe regex sources with the i flag', () => {
    const sig = compileSignatureInput({
      name: 'safe',
      category: 'safe',
      libPatterns: ['^libfoo[0-9]+\\.so$'],
    });
    expect(sig.libPatterns[0]).toBeInstanceOf(RegExp);
    expect((sig.libPatterns[0] as RegExp).flags).toContain('i');
  });
});

describe('ReDoS red line 2 — runtime per-test timeout', () => {
  it('aborts when a single .test() exceeds the timeout budget', () => {
    const slow = new RegExp('^(a|a)*$');
    const longA = 'a'.repeat(30);
    expect(() => testPatternTimed(slow, longA, 0, 'evil')).toThrowError(
      expect.objectContaining({
        name: 'ToolError',
        code: 'TIMEOUT',
        message: expect.stringContaining('APK_PACKER_REGEX_TIMEOUT_MS'),
      }),
    );
  });

  it('does NOT fire under a normal timeout for a trivial regex', () => {
    const fast = /^libfoo\.so$/;
    expect(() => testPatternTimed(fast, 'libfoo.so', 50, 'safe')).not.toThrow();
    expect(testPatternTimed(fast, 'libfoo.so', 50, 'safe')).toBe(true);
  });
});

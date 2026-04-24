import { describe, it, expect, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { detectJSDefenderPatterns } from '@modules/deobfuscator/JSDefenderDeobfuscator';

describe('JSDefenderDeobfuscator', () => {
  it('detects console interception patterns', () => {
    const code = `var _0xconsole = console.log, console.log = function(){};`;
    const results = detectJSDefenderPatterns(code);
    const found = results.find((r) => r.pattern === 'console-interception');
    expect(found).toBeTruthy();
    expect(found?.confidence).toBe(0.8);
  });

  it('returns empty array for clean code', () => {
    const code = `function add(a, b) { return a + b; }`;
    const results = detectJSDefenderPatterns(code);
    expect(results).toBeInstanceOf(Array);
    expect(results).toHaveLength(0);
  });

  it('returns confidence scores between 0 and 1', () => {
    const code = `var _0xconsole = console.log, console.log = function(){};`;
    const results = detectJSDefenderPatterns(code);
    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('returns array with pattern and confidence fields', () => {
    const code = `var _0xconsole = console.log, console.log = function(){};`;
    const results = detectJSDefenderPatterns(code);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.pattern).toBe('string');
      expect(typeof r.confidence).toBe('number');
    }
  });
});

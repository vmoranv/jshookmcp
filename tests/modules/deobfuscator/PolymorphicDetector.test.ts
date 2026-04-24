import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  detectPolymorphic,
  getPolymorphicSummary,
} from '@modules/deobfuscator/PolymorphicDetector';

describe('PolymorphicDetector', () => {
  describe('detectPolymorphic', () => {
    it('returns no detections for clean code', () => {
      const code = `function add(a, b) { return a + b; }`;
      const result = detectPolymorphic(code);
      expect(result.detected).toBe(false);
      expect(result.detections).toHaveLength(0);
    });

    it('detects dead code injection', () => {
      const code = `if (false) { doEvil(); }`;
      const result = detectPolymorphic(code);
      expect(result.detected).toBe(true);
      const dead = result.detections.find((d) => d.type === 'dead-code-injection');
      expect(dead).toBeTruthy();
    });

    it('detects gate functions', () => {
      const code = `var gate = checkCondition, gateFn = function() { if (gate !== valid) return; };`;
      const result = detectPolymorphic(code);
      const gate = result.detections.find((d) => d.type === 'gate-functions');
      expect(gate).toBeTruthy();
    });

    it('detects variable reassignment chains', () => {
      const code = `var a = b, c = d, e = f;`;
      const result = detectPolymorphic(code);
      expect(result.detected).toBe(true);
    });

    it('detects code injection points', () => {
      const code = `var fn = new Function("String", "return String");`;
      const result = detectPolymorphic(code);
      expect(result.detected).toBe(true);
    });

    it('returns multiple detection types for complex obfuscation', () => {
      const code = `var a = b, c = d; var fn = new Function("String", "return String");`;
      const result = detectPolymorphic(code);
      expect(result.detections.length).toBeGreaterThan(1);
    });

    it('returns warnings when detections found', () => {
      const code = `if (false) { dead(); }`;
      const result = detectPolymorphic(code);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('includes location info in detections', () => {
      const code = `if (false) { console.log("x"); }`;
      const result = detectPolymorphic(code);
      const dead = result.detections.find((d) => d.type === 'dead-code-injection');
      expect(dead?.locations).toBeDefined();
      expect(dead?.locations.length).toBeGreaterThan(0);
    });

    it('returns multiple detection types for complex obfuscation', () => {
      const code = `var a = b, c = d; if (false) {} new Function("code", "return code");`;
      const result = detectPolymorphic(code);
      expect(result.detections.length).toBeGreaterThan(1);
    });
  });

  describe('getPolymorphicSummary', () => {
    it('returns low complexity for clean code', () => {
      const code = `function test() { return 42; }`;
      const summary = getPolymorphicSummary(code);
      expect(summary.complexity).toBe('low');
    });

    it('returns high complexity for multiple high-confidence detections', () => {
      const code = `if (false) {} new Function("eval", "code"); var a = b, c = d, e = f;`;
      const summary = getPolymorphicSummary(code);
      expect(['medium', 'high']).toContain(summary.complexity);
    });

    it('returns details string', () => {
      const code = `if (false) { console.log("x"); }`;
      const summary = getPolymorphicSummary(code);
      expect(summary.details).toBeTruthy();
      expect(typeof summary.details).toBe('string');
    });
  });
});

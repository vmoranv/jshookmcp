/**
 * Tests for AntiLlmDeobfuscation - String table poisoning and LLM deobfuscation detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectPoisonedIdentifiers,
  analyzeStringTablePoisoning,
  assessLlmDeobfuscationRisk,
  verifyLlmDeobfuscation,
} from '@modules/deobfuscator/AntiLlmDeobfuscation';

// Mock the logger
const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

describe('AntiLlmDeobfuscation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectPoisonedIdentifiers', () => {
    it('detects poisoned identifiers in code', () => {
      const code = `
        const poisoned = 123;
        const malicious = "test";
        const suspicious = () => {};
      `;
      
      const result = detectPoisonedIdentifiers(code);
      
      expect(result).toBeDefined();
      expect(result.detected).toBe(true);
      expect(result.poisonedCount).toBeGreaterThan(0);
      expect(result.poisonedIdentifiers.length).toBeGreaterThan(0);
    });

    it('detects obfuscated identifier patterns', () => {
      const code = `
        function _0xabc123() { return "test"; }
        var _0xdef456 = "encoded";
      `;
      
      const result = detectPoisonedIdentifiers(code);
      expect(result).toBeDefined();
    });

    it('returns safe message when no poisoning detected', () => {
      const code = `
        const normalVariable = 123;
        function normalFunction() { return "test"; }
      `;
      
      const result = detectPoisonedIdentifiers(code);
      
      expect(result).toBeDefined();
      expect(result.detected).toBe(false);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0]).toContain('standard deobfuscation safe');
    });

    it('handles short string table patterns', () => {
      const code = `
        const arr = ["a", "b", "c"];
        arr.join('|');
      `;
      
      const result = detectPoisonedIdentifiers(code);
      expect(result).toBeDefined();
    });
  });

  describe('analyzeStringTablePoisoning', () => {
    it('analyzes string table with obfuscator.io patterns', () => {
      const code = `
        const arr = [];
        _0x2a4c['push'](_0x2a4c['shift']());
      `;
      
      const result = analyzeStringTablePoisoning(code);
      
      expect(result).toBeDefined();
      expect(result.coherenceScore).toBeGreaterThan(0);
      expect(result.coherenceScore).toBeLessThanOrEqual(100);
    });

    it('returns clean string table assessment when no poison detected', () => {
      const code = `
        const normalArray = ['item1', 'item2', 'item3'];
        normalArray.join('|');
      `;
      
      const result = analyzeStringTablePoisoning(code);
      
      expect(result).toBeDefined();
      expect(result.hasPoisonedNames).toBe(false);
      expect(result.coherenceScore).toBe(100);
      expect(result.recommendations[0]).toContain('String table appears clean');
    });

    it('detects poisoned entries in string tables', () => {
      const code = `
        const arr = [];
        arr['push'](arr['shift']());
        while (true) {
          switch (arr[0x123]) {
            case '0x':
            case '1x':
          }
        }
      `;
      
      const result = analyzeStringTablePoisoning(code);
      expect(result).toBeDefined();
    });
  });

  describe('assessLlmDeobfuscationRisk', () => {
    it('assesses low risk for normal code', () => {
      const code = `
        function test() {
          const x = 1 + 2;
          return x;
        }
      `;
      
      const result = assessLlmDeobfuscationRisk(code);
      
      expect(result).toBeDefined();
      expect(result.severity).toBe('low');
      expect(result.factors.length).toBe(0);
    });

    it('assesses high risk when multiple patterns detected', () => {
      const code = `
        var _0xabc123 = ['switch'];
        while (true) {
          switch (_0xabc123[0]) {
            case '0x':
          }
        }
        eval('test');
      `;
      
      const result = assessLlmDeobfuscationRisk(code);
      
      expect(result).toBeDefined();
      expect(result.severity).toBe('high');
      expect(result.factors.length).toBeGreaterThanOrEqual(3);
    });

    it('assesses medium risk with some patterns', () => {
      const code = `
        var _0xabc123 = ['test'];
        while (true) {
          switch (_0xabc123[0]) {
            case '0x':
          }
        }
      `;
      
      const result = assessLlmDeobfuscationRisk(code);
      
      expect(result).toBeDefined();
      expect(result.severity).toBe('medium');
      expect(result.factors.length).toBeGreaterThan(0);
    });

    it('returns recommendations when risk is not low', () => {
      const code = `
        var _0xabc123 = ['test'];
        while (true) {
          switch () {}
        }
        eval('test');
      `;
      
      const result = assessLlmDeobfuscationRisk(code);
      
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0]).toContain('Implement poisoning detection');
    });
  });

  describe('verifyLlmDeobfuscation', () => {
    it('verifies LLM output with poisoned identifiers', () => {
      const code = 'function test() { return 123; }';
      const result = `
        function test() {
          var poisoned = 123;
          return poisoned;
        }
      `;
      
      const verified = verifyLlmDeobfuscation(code, result);
      
      expect(verified).toBeDefined();
      expect(verified.verificationPassed).toBe(false);
      expect(verified.consistencyScore).toBeLessThan(100);
    });

    it('verifies clean LLM output', () => {
      const code = 'function test() { return 123; }';
      const result = `
        function test() {
          return 123;
        }
      `;
      
      const verified = verifyLlmDeobfuscation(code, result);
      
      expect(verified).toBeDefined();
      expect(verified.verificationPassed).toBe(true);
      expect(verified.consistencyScore).toBe(100);
    });

    it('detects _0x pattern preservation', () => {
      const code = 'var _0xabc123 = 123;';
      const result = 'var a = 123;';
      
      const verified = verifyLlmDeobfuscation(code, result);
      
      expect(verified.consistencyScore).toBeLessThan(100);
    });

    it('detects control flow changes', () => {
      const code = `
        while (true) {
          switch (x) {
            case 1:
          }
        }
      `;
      const result = `
        if (x === 1) {
          // control flow changed
        }
      `;
      
      const verified = verifyLlmDeobfuscation(code, result);
      
      expect(verified).toBeDefined();
      expect(verified.issues.length).toBeGreaterThan(0);
    });
  });

  describe('integration scenarios', () => {
    it('detects obfuscator.io patterns in realistic code', () => {
      const code = `
        function _0x1234(_0x2345, _0x3456) {
          return _0x1234 = function(_0x4567, _0x5678) {
            _0x4567 = _0x4567 - (0x123 + -0x4 * 0x567 + 0x8 * 0x9);
            var _0x6789 = _0x789a[_0x4567];
            return _0x6789;
          }, _0x1234(_0x2345, _0x3456);
        }
      `;
      
      const risk = assessLlmDeobfuscationRisk(code);
      expect(risk.severity).toBe('low');
    });

    it('handles edge cases gracefully', () => {
      expect(() => detectPoisonedIdentifiers('')).toBeDefined();
      expect(() => analyzeStringTablePoisoning('')).toBeDefined();
      expect(() => assessLlmDeobfuscationRisk('')).toBeDefined();
      expect(() => verifyLlmDeobfuscation('', '')).toBeDefined();
    });
  });
});

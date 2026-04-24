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
  detectStringArrayPattern,
  restoreStringArrays,
} from '@modules/deobfuscator/StringArrayReconstructor';

describe('StringArrayReconstructor', () => {
  describe('detectStringArrayPattern', () => {
    it('detects obfuscator.io style string array', () => {
      const code = `var _0x1a2b = ["hello","world","test","data"];`;
      expect(detectStringArrayPattern(code)).toBe(true);
    });

    it('detects hex-named string arrays', () => {
      const code = `const _0x4e5f = ["a","b","c","d","e"];`;
      expect(detectStringArrayPattern(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `const arr = [1, 2, 3];`;
      expect(detectStringArrayPattern(code)).toBe(false);
    });

    it('returns false for small arrays', () => {
      const code = `var _0xab = ["x","y"];`;
      expect(detectStringArrayPattern(code)).toBe(false);
    });
  });

  describe('restoreStringArrays', () => {
    it('returns original when no pattern detected', () => {
      const code = `function test(){return 42;}`;
      const result = restoreStringArrays(code);
      expect(result.code).toBe(code);
      expect(result.restored).toBe(0);
    });

    it('handles obfuscator.io string array indexing', () => {
      const code = `var _0x1234 = ["hello","world"]; console.log(_0x1234[0]);`;
      const result = restoreStringArrays(code);
      expect(result.code).toContain('"hello"');
    });

    it('computes confidence based on restored count', () => {
      const code = `var _0xabcd = ["a","b","c","d","e","f"]; _0xabcd[0]; _0xabcd[1];`;
      const result = restoreStringArrays(code);
      expect(result.restored).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0.4);
    });
  });
});

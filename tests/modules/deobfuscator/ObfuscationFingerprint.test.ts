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

import { fingerprintObfuscator } from '@modules/deobfuscator/ObfuscationFingerprint';

describe('ObfuscationFingerprint', () => {
  describe('fingerprintObfuscator', () => {
    it('identifies obfuscator.io patterns', () => {
      const code = `var _0x1a2b = ["hello","world"]; while(_0x1a2b){switch(_0x1a2b){}}`;
      const result = fingerprintObfuscator(code);
      expect(result.tool).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('identifies webpack patterns', () => {
      const code = `var __webpack_require__ = 1; var __webpack_modules__ = {};`;
      const result = fingerprintObfuscator(code);
      expect(result.tool).toBe('webpack');
    });

    it('identifies terser patterns', () => {
      const code = `/* @__PURE__@ */ function x(){} /* @license terser */`;
      const result = fingerprintObfuscator(code);
      expect(result.tool).toBeTruthy();
    });

    it('returns null tool for clean code', () => {
      const code = `function add(a, b) { return a + b; }`;
      const result = fingerprintObfuscator(code);
      expect(result.tool).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('returns markers array', () => {
      const code = `__webpack_require__; /* @license */`;
      const result = fingerprintObfuscator(code);
      expect(result.markers).toBeInstanceOf(Array);
    });
  });
});

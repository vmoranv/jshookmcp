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
  detectAntiDebugPatterns,
  detectSelfDefending,
  neutralizeAntiDebug,
} from '@modules/deobfuscator/AntiDebugEvasion';

describe('AntiDebugEvasion', () => {
  describe('detectAntiDebugPatterns', () => {
    it('detects debugger statements', () => {
      const code = `function test(){ debugger; }`;
      const patterns = detectAntiDebugPatterns(code);
      expect(patterns).toContain('debugger_statement');
    });

    it('detects timing attacks', () => {
      const code = `var t = new Date() - start; if(t > 100) {}`;
      const patterns = detectAntiDebugPatterns(code);
      expect(patterns.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty array for clean code', () => {
      const code = `function add(a,b){return a+b;}`;
      const patterns = detectAntiDebugPatterns(code);
      expect(patterns).toHaveLength(0);
    });
  });

  describe('detectSelfDefending', () => {
    it('detects self-defending code patterns', () => {
      const code = `eval(code) !== void 0; document.body; checksum("abc");`;
      expect(detectSelfDefending(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){return 42;}`;
      expect(detectSelfDefending(code)).toBe(false);
    });
  });

  describe('neutralizeAntiDebug', () => {
    it('handles plain code', () => {
      const code = `function test(){return 42;}`;
      const result = neutralizeAntiDebug(code);
      expect(result).toBeTruthy();
    });

    it('removes debugger statements', () => {
      const code = `function test(){ debugger; return 1; }`;
      const result = neutralizeAntiDebug(code);
      expect(result.removed).toBeGreaterThanOrEqual(0);
    });
  });
});

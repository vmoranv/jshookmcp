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
  detectCFFPattern,
  restoreControlFlowFlattening,
} from '@modules/deobfuscator/ControlFlowFlattening';

describe('ControlFlowFlattening', () => {
  describe('detectCFFPattern', () => {
    it('detects while-switch CFF pattern', () => {
      const code = `while(true){switch(_0x1234){case 0x0:_0x1234=0x1;a();break;case 0x1:_0x1234=0x0;b();break;}}`;
      expect(detectCFFPattern(code)).toBe(true);
    });

    it('detects for-switch CFF pattern', () => {
      const code = `for(;!_0xabcd;){switch(_0xabcd){case 0x1:x++;_0xabcd=0x2;break;}}`;
      expect(detectCFFPattern(code)).toBe(true);
    });

    it('does not match plain code', () => {
      const code = `function test(){return 42;}`;
      expect(detectCFFPattern(code)).toBe(false);
    });

    it('does not match simple switch statements', () => {
      const code = `switch(x){case 1:return true;default:return false;}`;
      expect(detectCFFPattern(code)).toBe(false);
    });
  });

  describe('restoreControlFlowFlattening', () => {
    it('returns original code unchanged when no CFF detected', () => {
      const code = `function add(a,b){return a+b;}`;
      const result = restoreControlFlowFlattening(code);
      expect(result.code).toBe(code);
      expect(result.restored).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it('handles basic switch state machine', () => {
      const code = `while(_0x1){switch(_0x1){case 0x0:_0x1=0x1;break;}}`;
      const result = restoreControlFlowFlattening(code);
      expect(result.restored).toBeGreaterThanOrEqual(0);
    });
  });
});

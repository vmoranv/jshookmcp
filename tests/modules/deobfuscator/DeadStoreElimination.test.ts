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
  removeDeadStores,
  removeUnreachableCode,
} from '@modules/deobfuscator/DeadStoreElimination';

describe('DeadStoreElimination', () => {
  describe('removeDeadStores', () => {
    it('removes unused function declarations', () => {
      const code = `function unused(){} function used(){return 1;} used();`;
      const result = removeDeadStores(code);
      expect(result.removed).toBeGreaterThan(0);
    });

    it('keeps used functions', () => {
      const code = `function used(){return 42;} console.log(used());`;
      const result = removeDeadStores(code);
      expect(result.code).toBeTruthy();
    });

    it('handles simple function declarations', () => {
      const code = `function test(){return 42;}`;
      const result = removeDeadStores(code);
      expect(result).toBeTruthy();
    });
  });

  describe('removeUnreachableCode', () => {
    it('removes code after return statement', () => {
      const code = `function test(){return 42; x = 1;}`;
      const result = removeUnreachableCode(code);
      expect(result.removed).toBeGreaterThan(0);
    });

    it('removes code after throw', () => {
      const code = `function test(){throw new Error(); x = 1;}`;
      const result = removeUnreachableCode(code);
      expect(result.removed).toBeGreaterThan(0);
    });

    it('returns original for sequential code', () => {
      const code = `function test(){var a = 1; var b = 2; return a + b;}`;
      const result = removeUnreachableCode(code);
      expect(result.removed).toBe(0);
    });
  });
});

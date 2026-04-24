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

import { advancedConstantPropagation } from '@modules/deobfuscator/ConstantPropagation';

describe('ConstantPropagation', () => {
  describe('advancedConstantPropagation', () => {
    it('folds numeric binary expressions', () => {
      const code = `var x = 1 + 1;`;
      const result = advancedConstantPropagation(code);
      expect(result.code).toContain('2');
    });

    it('folds string concatenation', () => {
      const code = `var x = "hello" + "world";`;
      const result = advancedConstantPropagation(code);
      expect(result.code).toContain('helloworld');
    });

    it('eliminates tautological comparisons', () => {
      const code = `var x = 1 === 1;`;
      const result = advancedConstantPropagation(code);
      expect(result.code).toBeTruthy();
    });

    it('folds unary expressions', () => {
      const code = `var x = !false;`;
      const result = advancedConstantPropagation(code);
      expect(result.code).toContain('true');
    });

    it('returns original for complex dynamic code', () => {
      const code = `var x = a + b;`;
      const result = advancedConstantPropagation(code);
      expect(result.folded).toBe(0);
    });
  });
});

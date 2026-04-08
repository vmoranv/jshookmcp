import { describe, it, expect } from 'vitest';
import { extractBytecodeForFunction } from '@modules/v8-inspector/BytecodeExtractor';

describe('BytecodeExtractor', () => {
  describe('extractBytecodeForFunction', () => {
    it('should return unavailable when natives syntax is not available', async () => {
      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DebugPrint') throw new Error('natives not available');
        return {};
      };
      const result = await extractBytecodeForFunction(evaluateFn, 'myFunc');
      expect(result).toHaveProperty('available', false);
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('action');
    });

    it('should return unavailable when function not found', async () => {
      let callCount = 0;
      const evaluateFn = async (expr: string) => {
        callCount++;
        if (expr === 'typeof %DebugPrint') return 'function';
        return { value: 'undefined' };
      };
      const result = await extractBytecodeForFunction(evaluateFn, 'nonexistent');
      expect(result).toHaveProperty('available', false);
      expect(callCount).toBeGreaterThan(1);
    });

    it('should extract bytecode instructions from DebugPrint output', async () => {
      const mockOutput = ['0 @ LdaZero', '2 @ Star r0', '4 @ LdaSmi 42', '6 @ Return'].join('\n');

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DebugPrint') return 'function';
        return { value: mockOutput };
      };
      const result = await extractBytecodeForFunction(evaluateFn, 'myFunc');
      if (!('available' in result) || !result.available) {
        throw new Error('Expected available result');
      }
      expect(result.available).toBe(true);
      expect(result.instructions.length).toBeGreaterThan(0);
      expect(result.instructions[0]?.opcode).toBe('LdaZero');
      expect(result.instructions[1]?.opcode).toBe('Star');
      expect(result.instructions[2]?.opcode).toBe('LdaSmi');
      expect(result.instructions[3]?.opcode).toBe('Return');
    });

    it('should detect string obfuscation pattern', async () => {
      const charLoads = Array.from({ length: 15 }, (_, i) => `${i * 2} @ LdaConstant "a"`).join(
        '\n',
      );
      const mockOutput = `${charLoads}\n30 @ Return`;

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DebugPrint') return 'function';
        return { value: mockOutput };
      };
      const result = await extractBytecodeForFunction(evaluateFn, 'obfuscatedFunc');
      if (!('available' in result) || !result.available) {
        throw new Error('Expected available result');
      }
      const stringPatterns = result.patterns.filter((p) => p.type === 'string-obfuscation');
      expect(stringPatterns.length).toBeGreaterThan(0);
    });

    it('should detect dead code pattern', async () => {
      const mockOutput = '0 @ LdaZero\n2 @ Return\n4 @ LdaSmi 10\n6 @ Star r0';

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DebugPrint') return 'function';
        return { value: mockOutput };
      };
      const result = await extractBytecodeForFunction(evaluateFn, 'deadCodeFunc');
      if (!('available' in result) || !result.available) {
        throw new Error('Expected available result');
      }
      const deadCodePatterns = result.patterns.filter((p) => p.type === 'dead-code');
      expect(deadCodePatterns.length).toBeGreaterThan(0);
    });

    it('should return error details when evaluation fails', async () => {
      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DebugPrint') return 'function';
        throw new Error('CDP connection lost');
      };
      const result = await extractBytecodeForFunction(evaluateFn, 'myFunc');
      expect(result).toHaveProperty('available', false);
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('action');
    });
  });
});

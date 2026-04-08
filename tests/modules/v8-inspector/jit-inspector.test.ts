import { describe, it, expect } from 'vitest';
import { inspectJitFunction } from '@modules/v8-inspector/JitCodeInspector';

describe('JitCodeInspector', () => {
  describe('inspectJitFunction', () => {
    it('should return unavailable when natives syntax is not available', async () => {
      const evaluateFn = async () => {
        throw new Error('natives not available');
      };
      const result = await inspectJitFunction(evaluateFn, 'myFunc');
      expect(result).toHaveProperty('available', false);
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('action');
    });

    it('should return unavailable when function is undefined', async () => {
      let callCount = 0;
      const evaluateFn = async (expr: string) => {
        callCount++;
        if (expr === 'typeof %DisassembleFunction') return 'function';
        return { value: 'undefined' };
      };
      const result = await inspectJitFunction(evaluateFn, 'nonexistent');
      expect(result).toHaveProperty('available', false);
      expect(callCount).toBeGreaterThan(1);
    });

    it('should parse assembly output', async () => {
      const mockAssembly = [
        '  mov eax, 1',
        '  call rbx',
        '  push rbp',
        '  lea rdi, [rip+0x1234]',
      ].join('\n');

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DisassembleFunction') return 'function';
        return { value: mockAssembly };
      };
      const result = await inspectJitFunction(evaluateFn, 'myFunc');
      if (result.available !== true) {
        throw new Error('Expected available result');
      }
      expect(result.functionName).toBe('myFunc');
      expect(result.assembly).toContain('mov eax');
      expect(result.machineCodeSize).toBeGreaterThan(0);
    });

    it('should detect TurboFan optimization', async () => {
      const mockAssembly = ['  ;; TurboFan optimized code', '  mov eax, 1', '  call rbx'].join(
        '\n',
      );

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DisassembleFunction') return 'function';
        return { value: mockAssembly };
      };
      const result = await inspectJitFunction(evaluateFn, 'optimizedFunc');
      if (result.available !== true) {
        throw new Error('Expected available result');
      }
      expect(result.optimizationLevel).toBe('TurboFan (optimized)');
    });

    it('should detect interpreted (Ignition) code', async () => {
      const mockAssembly = ['  ;; Ignition interpreter', '  mov eax, 1'].join('\n');

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DisassembleFunction') return 'function';
        return { value: mockAssembly };
      };
      const result = await inspectJitFunction(evaluateFn, 'interpretedFunc');
      if (result.available !== true) {
        throw new Error('Expected available result');
      }
      expect(result.optimizationLevel).toBe('Ignition (interpreted)');
    });

    it('should extract bailouts from assembly', async () => {
      const mockAssembly = [
        '  mov eax, 1',
        '  ;; deopt at line 42',
        '  ;; bailout reason: type changed',
        '  call rbx',
      ].join('\n');

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DisassembleFunction') return 'function';
        return { value: mockAssembly };
      };
      const result = await inspectJitFunction(evaluateFn, 'bailoutFunc');
      if (result.available !== true) {
        throw new Error('Expected available result');
      }
      expect(result.bailouts.length).toBeGreaterThan(0);
    });

    it('should return large assembly without truncation (truncation done in handler)', async () => {
      const mockAssembly = '  mov eax, 1\n'.repeat(5000);

      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DisassembleFunction') return 'function';
        return { value: mockAssembly };
      };
      const result = await inspectJitFunction(evaluateFn, 'largeFunc');
      if (result.available !== true) {
        throw new Error(`Expected available result, got: ${JSON.stringify(result).slice(0, 200)}`);
      }
      // Raw module returns full assembly; handler truncates to 10000
      expect(result.assembly.length).toBeGreaterThan(10000);
    });

    it('should return error details when evaluation fails', async () => {
      const evaluateFn = async (expr: string) => {
        if (expr === 'typeof %DisassembleFunction') return 'function';
        throw new Error('CDP connection lost');
      };
      const result = await inspectJitFunction(evaluateFn, 'myFunc');
      expect(result).toHaveProperty('available', false);
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('action');
    });
  });
});

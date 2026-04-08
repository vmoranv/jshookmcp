/* eslint-disable unicorn/consistent-function-scoping */
import { describe, expect, it, vi } from 'vitest';
import { BytecodeExtractor } from '@modules/v8-inspector/BytecodeExtractor';

function createExtractor(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  const session = {
    send: vi.fn(send),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    createCDPSession: vi.fn().mockResolvedValue(session),
  };
  return new BytecodeExtractor(() => Promise.resolve(page));
}

describe('BytecodeExtractor', () => {
  it('disassembles pseudo bytecode into instructions', () => {
    const extractor = new BytecodeExtractor();
    const instructions = extractor.disassembleBytecode('0 @ LdaZero\n2 @ Star r0\n4 @ Return');
    expect(instructions).toHaveLength(3);
  });

  it('extracts pseudo bytecode from script coverage', async () => {
    const extractor = createExtractor(async (method) => {
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource: 'function myFunc() { return 1; }' };
      }
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              scriptId: '1',
              functions: [{ functionName: 'myFunc', ranges: [{ startOffset: 0, endOffset: 30 }] }],
            },
          ],
        };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: false } };
      }
      return {};
    });

    const extracted = await extractor.extractBytecode('1');
    expect(extracted).not.toBeNull();
    expect(typeof extracted?.functionName).toBe('string');
    expect(extracted?.bytecode.length).toBeGreaterThan(0);
  });

  it('returns an array when finding hidden classes', async () => {
    const extractor = createExtractor(async (method) => {
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource: 'const model = { foo: 1, bar: 2 };' };
      }
      return {};
    });

    const hiddenClasses = await extractor.findHiddenClasses('1');
    expect(Array.isArray(hiddenClasses)).toBe(true);
  });
});

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

  it('reports native bytecode as unavailable when natives syntax is disabled', async () => {
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

    const result = await extractor.attemptNativeBytecodeExtraction('1');
    expect(result).toMatchObject({
      available: false,
      supportsNativesSyntax: false,
      rawIgnitionBytecodeAvailable: false,
    });
    expect(result?.reason).toContain('natives syntax');
  });

  it('returns native disassembly text when the runtime exposes it', async () => {
    let runtimeEvaluateCount = 0;
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
        runtimeEvaluateCount += 1;
        if (runtimeEvaluateCount === 1) {
          return { result: { value: true } };
        }
        return {
          result: {
            value: {
              disassembly: '0 @ LdaZero\n1 @ Return',
              nativeSourcePosition: 0,
            },
          },
        };
      }
      return {};
    });

    const result = await extractor.attemptNativeBytecodeExtraction('1');
    expect(result).toEqual({
      available: true,
      bytecode: '0 @ LdaZero\n1 @ Return',
      format: 'v8-disassembly',
      functionName: 'myFunc',
      rawIgnitionBytecodeAvailable: false,
      reason: 'Native V8 disassembly text returned via %DisassembleFunction',
      sourcePosition: 0,
      supportsNativesSyntax: true,
    });
  });
});

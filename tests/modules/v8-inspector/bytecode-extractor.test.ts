/* eslint-disable unicorn/consistent-function-scoping */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BytecodeExtractor } from '@modules/v8-inspector/BytecodeExtractor';
import * as NativeBytecodePrinter from '@modules/v8-inspector/NativeBytecodePrinter';
import { VersionDetector } from '@modules/v8-inspector/VersionDetector';

function createExtractor(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  return createExtractorHarness(send).extractor;
}

function createExtractorHarness(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  const session = {
    send: vi.fn(send),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    createCDPSession: vi.fn().mockResolvedValue(session),
  };
  return {
    extractor: new BytecodeExtractor(() => Promise.resolve(page)),
    page,
    session,
  };
}

describe('BytecodeExtractor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disassembles pseudo bytecode into instructions', () => {
    const extractor = new BytecodeExtractor();
    const instructions = extractor.disassembleBytecode('0 @ LdaZero\n2 @ Star r0\n4 @ Return');
    expect(instructions).toHaveLength(3);
  });

  it('disassembles all supported bytecode text formats and skips junk lines', () => {
    const extractor = new BytecodeExtractor();
    const instructions = extractor.disassembleBytecode(
      [
        '12 S> 123 @ 4 : 13 00 LdaNamedProperty a0, [0], [1]',
        '6 @ Star r0',
        '0x10 @ 8: Return',
        '16 Return foo, bar',
        'ignored',
      ].join('\n'),
    );

    expect(instructions).toEqual([
      { offset: 4, opcode: 'LdaNamedProperty', operands: ['a0', '[0]', '[1]'] },
      { offset: 6, opcode: 'Star', operands: ['r0'] },
      { offset: 8, opcode: 'Return', operands: [] },
      { offset: 16, opcode: 'Return', operands: ['foo', 'bar'] },
    ]);
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

  it('covers pseudo-bytecode opcode inference branches from extracted source', async () => {
    const scriptSource = [
      'function demo() {}',
      'return value;',
      'value => value + 1',
      'runTask(foo, bar)',
      'answer = compute()',
      'if (ready) proceed()',
      'while (keepGoing) spin()',
      '{ inline: true }',
      'value + 1',
    ].join('\n');

    const extractor = createExtractor(async (method) => {
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource };
      }
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              scriptId: '1',
              functions: [
                {
                  functionName: 'demo',
                  ranges: [{ startOffset: 0, endOffset: scriptSource.length }],
                },
              ],
            },
          ],
        };
      }
      return {};
    });

    const extracted = await extractor.extractBytecode('1');

    expect(extracted?.bytecode).toContain('0 FunctionDeclaration');
    expect(extracted?.bytecode).toContain('1 Return value;');
    expect(extracted?.bytecode).toContain('2 CreateClosure');
    expect(extracted?.bytecode).toContain('3 Call runTask');
    expect(extracted?.bytecode).toContain('4 Store answer, compute()');
    expect(extracted?.bytecode).toContain('5 JumpIfTrue if (ready) proceed()');
    expect(extracted?.bytecode).toContain('6 Loop while (keepGoing) spin()');
    expect(extracted?.bytecode).toContain('7 LoadLiteral { inline: true }');
    expect(extracted?.bytecode).toContain('8 Evaluate value + 1');
  });

  it('infers function names from nearby assigned functions when coverage is anonymous', async () => {
    const scriptSource = 'const handler = async (event) => event.type;';
    const functionOffset = scriptSource.indexOf('handler');
    const extractor = createExtractor(async (method) => {
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource };
      }
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              scriptId: '1',
              functions: [
                {
                  functionName: 'anonymous',
                  ranges: [{ startOffset: 0, endOffset: scriptSource.length }],
                },
              ],
            },
          ],
        };
      }
      return {};
    });

    const extracted = await extractor.extractBytecode('1', functionOffset);

    expect(extracted).toMatchObject({
      functionName: 'handler',
      sourcePosition: functionOffset,
    });
    expect(extracted?.bytecode).toContain('CreateClosure');
  });

  it('returns null when a page cannot create a CDP session', async () => {
    const extractor = new BytecodeExtractor(() => Promise.resolve({}));
    await expect(extractor.extractBytecode('1')).resolves.toBeNull();
    await expect(extractor.attemptNativeBytecodeExtraction('1')).resolves.toBeNull();
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

  it('deduplicates hidden class properties and only adds transition maps when needed', async () => {
    const extractor = createExtractor(async (method) => {
      if (method === 'Debugger.getScriptSource') {
        return {
          scriptSource:
            'const first = { foo: 1, foo: 2 }; const second = { bar: 1, baz: 2 }; const empty = {};',
        };
      }
      return {};
    });

    const hiddenClasses = await extractor.findHiddenClasses('1');

    expect(hiddenClasses).toEqual([
      { address: 'hidden-class-0', properties: ['foo'] },
      {
        address: 'hidden-class-1',
        properties: ['bar', 'baz'],
        transitionMap: 'bar -> baz',
      },
    ]);
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

  it('falls back to isolated ignition bytecode when native disassembly text is unavailable', async () => {
    let runtimeEvaluateCount = 0;
    const scriptSource = [
      'function myFunc() { return document.title; }',
      'window.myFunc = myFunc;',
      'myFunc();',
    ].join('\n');
    const extractor = createExtractor(async (method) => {
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource };
      }
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              scriptId: '1',
              functions: [
                {
                  functionName: 'myFunc',
                  ranges: [
                    {
                      startOffset: 0,
                      endOffset: 'function myFunc() { return document.title; }'.length,
                    },
                  ],
                },
              ],
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
              disassembly: null,
              disassemblyType: 'undefined',
              nativeSourcePosition: 0,
            },
          },
        };
      }
      return {};
    });

    const result = await extractor.attemptNativeBytecodeExtraction('1');
    expect(result).not.toBeNull();
    expect(result?.available).toBe(true);
    expect(result?.format).toBe('ignition-bytecode');
    expect(result?.functionName).toBe('myFunc');
    expect(result?.rawIgnitionBytecodeAvailable).toBe(true);
    expect(result?.supportsNativesSyntax).toBe(true);
    expect(result?.reason).toContain('--print-bytecode');
    expect(result?.bytecode).toContain('Bytecode length:');
    expect(result?.bytecode).toContain('Return');
  });

  it('reports unstructured runtime responses during native bytecode extraction', async () => {
    vi.spyOn(VersionDetector.prototype, 'supportsNativesSyntax').mockResolvedValue(true);
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
        return null;
      }
      return {};
    });

    const result = await extractor.attemptNativeBytecodeExtraction('1');

    expect(result).toMatchObject({
      available: false,
      reason: 'Runtime.evaluate did not return structured data',
      supportsNativesSyntax: true,
    });
  });

  it('reports runtime exceptions during native bytecode extraction', async () => {
    vi.spyOn(VersionDetector.prototype, 'supportsNativesSyntax').mockResolvedValue(true);
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
        return { exceptionDetails: { text: 'boom' } };
      }
      return {};
    });

    const result = await extractor.attemptNativeBytecodeExtraction('1');

    expect(result).toMatchObject({
      available: false,
      reason: 'Runtime.evaluate raised an exception while probing native bytecode',
      supportsNativesSyntax: true,
    });
  });

  it('formats native extraction failures when the isolated printer also fails', async () => {
    vi.spyOn(VersionDetector.prototype, 'supportsNativesSyntax').mockResolvedValue(true);
    const printerSpy = vi
      .spyOn(NativeBytecodePrinter, 'printNativeIgnitionBytecode')
      .mockResolvedValue({
        available: false,
        bytecode: null,
        format: null,
        functionName: 'myFunc',
        reason: 'printer failed',
        rawIgnitionBytecodeAvailable: false,
      });

    const { extractor } = createExtractorHarness(async (method) => {
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
        return {
          result: {
            value: {
              disassembly: null,
              disassemblyError: 'native failure',
              nativeSourcePosition: 12,
            },
          },
        };
      }
      return {};
    });

    const result = await extractor.attemptNativeBytecodeExtraction('1');

    expect(printerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'myFunc',
        sourceSlice: expect.stringContaining('function myFunc()'),
      }),
    );
    expect(result).toMatchObject({
      available: false,
      sourcePosition: 12,
      supportsNativesSyntax: true,
    });
    expect(result?.reason).toBe('native failure; isolated printer: printer failed');
  });
});

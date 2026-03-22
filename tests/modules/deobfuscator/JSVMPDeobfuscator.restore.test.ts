import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateVMAnalysisMessages: vi.fn(() => [{ role: 'user', content: 'analyze vm' }]),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@services/prompts/deobfuscation', () => ({
  generateVMAnalysisMessages: promptState.generateVMAnalysisMessages,
}));

vi.mock('@modules/security/ExecutionSandbox', () => ({
  ExecutionSandbox: class ExecutionSandbox {},
}));

import {
  restoreCustomVMBasic,
  restoreJSVMPCode,
} from '@modules/deobfuscator/JSVMPDeobfuscator.restore';

describe('JSVMPDeobfuscator.restore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => fn.mockReset());
    promptState.generateVMAnalysisMessages.mockClear();
  });

  it('restores obfuscator.io string-array references through the sandbox', async () => {
    const sandbox = {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        output: ['hello', 'world'],
      }),
    };

    const result = await restoreJSVMPCode(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      { sandbox } as any,
      'var _0xabc=["hello","world"];console.log(_0xabc[1],0x10);',
      'obfuscator.io',
      false
    );

    expect(sandbox.execute).toHaveBeenCalledWith({
      code: 'return ["hello","world"];',
      timeoutMs: 3000,
    });
    expect(result.code).toContain('"world"');
    expect(result.code).toContain('16');
    expect(result.warnings).toContain('obfuscator.io detected, may need special handling');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('skips sandbox execution for oversized JSFuck payloads', async () => {
    const sandbox = {
      execute: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await restoreJSVMPCode({ sandbox } as any, '+[]'.repeat(50001), 'jsfuck', false);

    expect(sandbox.execute).not.toHaveBeenCalled();
    expect(result.confidence).toBe(0.1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('file too large'),
        expect.stringContaining('online JSFuck decoder'),
      ])
    );
  });

  it('returns decoded JSFuck output when the sandbox resolves to a string', async () => {
    const sandbox = {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        output: 'decoded-jsfuck',
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await restoreJSVMPCode({ sandbox } as any, '[]+[]', 'jsfuck', false);

    expect(sandbox.execute).toHaveBeenCalledWith({
      code: 'return []+[];',
      timeoutMs: 5000,
    });
    expect(result).toEqual({
      code: 'decoded-jsfuck',
      confidence: 0.9,
      warnings: ['JSFuck'],
    });
  });

  it('returns decoded JJEncode output when the sandbox invocation succeeds', async () => {
    const sandbox = {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        output: 'decoded-jjencode',
      }),
    };

    const result = await restoreJSVMPCode(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      { sandbox } as any,
      'var message = 1;\n$$$$',
      'jjencode',
      false
    );

    expect(sandbox.execute).toHaveBeenCalledWith({
      code: 'var message = 1;\n$$$$; return $$$$()',
      timeoutMs: 5000,
    });
    expect(result).toEqual({
      code: 'decoded-jjencode',
      confidence: 0.9,
      warnings: ['JJEncode'],
    });
  });

  it('falls back to basic custom VM restoration when no llm is available', async () => {
    const sandbox = {
      execute: vi.fn(),
    };

    const result = await restoreJSVMPCode(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      { sandbox } as any,
      'debugger; "" + value; if (a) {}',
      'custom',
      true
    );

    expect(result.code).not.toContain('debugger');
    expect(result.code).not.toContain('"" +');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'LLM service unavailable, using fallback',
        'Configure DeepSeek/OpenAI API key for AI-assisted deobfuscation',
        'Analysis incomplete, partial results may be returned',
        'For better results, configure an LLM API key',
      ])
    );
    expect(result.unresolvedParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: 'Custom VM',
        }),
      ])
    );
  });

  it('uses llm analysis when a structured JSON payload is returned', async () => {
    const sandbox = {
      execute: vi.fn(),
    };
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          vmType: 'stack-vm',
          warnings: ['extra warning'],
          restorationSteps: ['recover dispatch table'],
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await restoreJSVMPCode({ llm, sandbox } as any, 'vm();', 'custom', false);

    expect(promptState.generateVMAnalysisMessages).toHaveBeenCalledWith('vm();');
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(result.confidence).toBe(0.6);
    expect(result.warnings).toEqual(expect.arrayContaining(['LLMVM: stack-vm', 'extra warning']));
    expect(result.unresolvedParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: 'VM Restoration',
          suggestion: 'recover dispatch table',
        }),
      ])
    );
  });

  it('falls back when llm analysis cannot be parsed', async () => {
    const sandbox = {
      execute: vi.fn(),
    };
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content: 'not-json',
      }),
    };

    const result = await restoreJSVMPCode(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      { llm, sandbox } as any,
      'debugger; "" + value;',
      'custom',
      true
    );

    expect(result.code).not.toContain('debugger');
    expect(result.warnings).toEqual(
      expect.arrayContaining(['Analysis incomplete, partial results may be returned'])
    );
  });

  it('applies the direct custom VM fallback heuristics', () => {
    const warnings: string[] = [];
    const unresolvedParts: Array<Record<string, unknown>> = [];

    const result = restoreCustomVMBasic(
      'debugger; if (flag) {} "" + value; cond ? same : same;',
      true,
      warnings,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      unresolvedParts as any
    );

    expect(result.code).not.toContain('debugger');
    expect(result.code).not.toContain('"" +');
    expect(result.warnings).toHaveLength(2);
    expect(result.unresolvedParts).toHaveLength(1);
  });
});

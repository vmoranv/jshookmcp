import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateDeobfuscationPrompt: vi.fn(() => [{ role: 'user', content: 'analyze' }]),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/services/prompts/deobfuscation.js', () => ({
  generateDeobfuscationPrompt: promptState.generateDeobfuscationPrompt,
}));

import { Deobfuscator } from '../../../src/modules/deobfuscator/Deobfuscator.js';

describe('Deobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
    loggerState.success.mockReset();
    promptState.generateDeobfuscationPrompt.mockReset();
    promptState.generateDeobfuscationPrompt.mockReturnValue([{ role: 'user', content: 'analyze' }]);
  });

  it('applies basic AST transforms for constants and dead branches', async () => {
    const code = 'function sample(){ const x = 1 + 2; if (true) { return x; } else { return 0; } }';
    const deobfuscator = new Deobfuscator();

    const result = await deobfuscator.deobfuscate({ code });

    expect(result.code).toContain('3');
    expect(result.code).not.toContain('if (true)');
    expect(result.transformations.some((t) => t.type === 'basic-ast-transform' && t.success)).toBe(
      true
    );
  });

  it('decodes escaped hex and unicode string literals', async () => {
    const code = 'const a = "\\\\x41"; const b = "\\\\u0042";';
    const deobfuscator = new Deobfuscator();

    const result = await deobfuscator.deobfuscate({ code });

    expect(result.code).toMatch(/['"]A['"]/);
    expect(result.code).toMatch(/['"]B['"]/);
    expect(result.transformations.some((t) => t.type === 'string-decode')).toBe(true);
  });

  it('extracts obfuscated string arrays and replaces indexed access', async () => {
    const code = 'var _0xabc = ["alpha","beta"]; console.log(_0xabc[1]);';
    const deobfuscator = new Deobfuscator();

    const result = await deobfuscator.deobfuscate({ code });

    expect(result.code).toContain('"beta"');
    expect(result.transformations.some((t) => t.type === 'extract-string-arrays' && t.success)).toBe(
      true
    );
    expect(result.transformations.some((t) => t.type === 'decrypt-arrays' && t.success)).toBe(true);
  });

  it('renames _0x-style variables when renameVariables is enabled', async () => {
    const code = 'var _0xfeed = 1; console.log(_0xfeed);';
    const deobfuscator = new Deobfuscator();

    const result = await deobfuscator.deobfuscate({
      code,
      renameVariables: true,
    });

    expect(result.code).toContain('var_0');
    expect(result.code).not.toContain('_0xfeed');
    expect(result.transformations.some((t) => t.type === 'rename-variables' && t.success)).toBe(
      true
    );
  });

  it('detects control-flow flattening hints in aggressive mode', async () => {
    const code = 'while (true) { switch (state) { case 1: break; default: break; } }';
    const deobfuscator = new Deobfuscator();

    const result = await deobfuscator.deobfuscate({
      code,
      aggressive: true,
    });

    expect(
      result.transformations.some((t) => t.type === 'unflatten-control-flow' && t.success)
    ).toBe(true);
  });

  it('caches deobfuscation results and avoids repeated LLM calls', async () => {
    const chat = vi.fn(async () => ({ content: 'LLM summary' }));
    const deobfuscator = new Deobfuscator({ chat } as any);

    const options = { code: 'var v = 5;', llm: 'claude' as const };
    const first = await deobfuscator.deobfuscate(options);
    const second = await deobfuscator.deobfuscate(options);

    expect(first.analysis).toBe('LLM summary');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});

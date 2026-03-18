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

const webcrackState = vi.hoisted(() => ({
  runWebcrack: vi.fn<(...args: any[]) => Promise<any>>(async (code: string) => ({
    applied: true,
    code: `decoded:${code}`,
    optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
  })),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@services/prompts/deobfuscation', () => ({
  generateDeobfuscationPrompt: promptState.generateDeobfuscationPrompt,
}));

vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: webcrackState.runWebcrack,
}));

import { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';

describe('Deobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    promptState.generateDeobfuscationPrompt.mockReset();
    promptState.generateDeobfuscationPrompt.mockReturnValue([{ role: 'user', content: 'analyze' }]);
    webcrackState.runWebcrack.mockReset();
    webcrackState.runWebcrack.mockImplementation(async (code: string) => ({
      applied: true,
      code: `decoded:${code}`,
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
    }));
  });

  it('uses webcrack as the only deobfuscation engine', async () => {
    webcrackState.runWebcrack.mockResolvedValue({
      applied: true,
      code: 'const answer = 42;',
      bundle: {
        type: 'webpack',
        entryId: '0',
        moduleCount: 2,
        truncated: false,
        modules: [{ id: '0', path: './index.js', isEntry: true, size: 19 }],
      },
      savedTo: 'D:/tmp/webcrack-out',
      savedArtifacts: [{ kind: 'code', path: 'D:/tmp/webcrack-out/deobfuscated.js' }],
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
    });

    const result = await new Deobfuscator().deobfuscate({ code: 'obfuscated()' });

    expect(webcrackState.runWebcrack).toHaveBeenCalledWith('obfuscated()', {
      unpack: undefined,
      unminify: undefined,
      jsx: undefined,
      mangle: undefined,
      mappings: undefined,
      includeModuleCode: undefined,
      maxBundleModules: undefined,
      outputDir: undefined,
      forceOutput: undefined,
    });
    expect(result.code).toBe('const answer = 42;');
    expect(result.bundle?.type).toBe('webpack');
    expect(result.savedTo).toBe('D:/tmp/webcrack-out');
    expect(result.engine).toBe('webcrack');
    expect(result.webcrackApplied).toBe(true);
    expect(result.transformations.some((t) => t.type === 'webcrack' && t.success)).toBe(true);
  });

  it('caches deobfuscation results and avoids repeated webcrack and LLM calls', async () => {
    const chat = vi.fn(async () => ({ content: 'LLM summary' }));
    const deobfuscator = new Deobfuscator({ chat } as any);

    const options = { code: 'var v = 5;', llm: 'provider-a' as any };
    const first = await deobfuscator.deobfuscate(options);
    const second = await deobfuscator.deobfuscate(options);

    expect(first.analysis).toBe('LLM summary');
    expect(webcrackState.runWebcrack).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('passes webcrack options through and maps renameVariables to mangle', async () => {
    await new Deobfuscator().deobfuscate({
      code: 'bundle',
      renameVariables: true,
      unpack: false,
      unminify: false,
      jsx: false,
      outputDir: 'artifacts/deobf',
      forceOutput: true,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [
        { path: './main.js', pattern: 'bootstrap', matchType: 'includes', target: 'code' },
      ],
    });

    expect(webcrackState.runWebcrack).toHaveBeenCalledWith('bundle', {
      unpack: false,
      unminify: false,
      jsx: false,
      mangle: true,
      mappings: [
        { path: './main.js', pattern: 'bootstrap', matchType: 'includes', target: 'code' },
      ],
      includeModuleCode: true,
      maxBundleModules: 10,
      outputDir: 'artifacts/deobf',
      forceOutput: true,
    });
  });

  it('surfaces deprecated legacy flags as warnings instead of running old logic', async () => {
    const result = await new Deobfuscator().deobfuscate({
      code: 'legacy()',
      aggressive: true,
      preserveLogic: true,
      inlineFunctions: true,
    });

    expect(result.warnings).toEqual([
      'aggressive is deprecated and ignored; webcrack is now the only deobfuscation engine.',
      'preserveLogic is deprecated and ignored.',
      'inlineFunctions is deprecated and ignored.',
    ]);
  });

  it('throws immediately when webcrack does not produce a result', async () => {
    webcrackState.runWebcrack.mockResolvedValue({
      applied: false,
      code: 'raw',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
      reason: 'mocked failure',
    });

    await expect(new Deobfuscator().deobfuscate({ code: 'broken()' })).rejects.toThrow(
      'mocked failure'
    );
  });
});

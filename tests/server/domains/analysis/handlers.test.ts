import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreAnalysisHandlers } from '../../../../src/server/domains/analysis/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('CoreAnalysisHandlers', () => {
  const deps = {
    collector: { collect: vi.fn(), getActivePage: vi.fn() },
    scriptManager: { init: vi.fn(), searchInScripts: vi.fn(), extractFunctionTree: vi.fn() },
    deobfuscator: { deobfuscate: vi.fn() },
    advancedDeobfuscator: { deobfuscate: vi.fn() },
    astOptimizer: { optimize: vi.fn((code: string) => `OPT:${code}`) },
    obfuscationDetector: { detect: vi.fn(), generateReport: vi.fn() },
    analyzer: { understand: vi.fn() },
    cryptoDetector: { detect: vi.fn() },
    hookManager: {
      createHook: vi.fn(),
      getAllHooks: vi.fn(),
      getHookRecords: vi.fn(),
      clearHookRecords: vi.fn(),
    },
  } as any;

  let handlers: CoreAnalysisHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new CoreAnalysisHandlers(deps);
  });

  it('rejects deobfuscate when code is missing', async () => {
    const body = parseJson(await handlers.handleDeobfuscate({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('code is required');
  });

  it('delegates deobfuscate to deobfuscator', async () => {
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'x' });
    const body = parseJson(
      await handlers.handleDeobfuscate({ code: 'a()', llm: 'claude', aggressive: true })
    );
    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'a()',
      llm: 'claude',
      aggressive: true,
    });
    expect(body.success).toBe(true);
  });

  it('creates hook with default action in manage hooks', async () => {
    deps.hookManager.createHook.mockResolvedValue({ success: true, id: 'h1' });
    const body = parseJson(
      await handlers.handleManageHooks({
        action: 'create',
        target: 'fetch',
        type: 'fetch',
      })
    );
    expect(deps.hookManager.createHook).toHaveBeenCalledWith({
      target: 'fetch',
      type: 'fetch',
      action: 'log',
      customCode: undefined,
    });
    expect(body.id).toBe('h1');
  });

  it('throws for unknown hook action', async () => {
    await expect(handlers.handleManageHooks({ action: 'nope' })).rejects.toThrow(
      /Unknown hook action/
    );
  });

  it('applies AST optimization in advanced deobfuscate', async () => {
    deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({ code: 'raw', success: true });
    const body = parseJson(
      await handlers.handleAdvancedDeobfuscate({
        code: 'obf',
        detectOnly: false,
        useASTOptimization: true,
      })
    );
    expect(deps.astOptimizer.optimize).toHaveBeenCalledWith('raw');
    expect(body.code).toBe('OPT:raw');
    expect(body.astOptimized).toBe(true);
  });

  it('skips AST optimization when detectOnly is true', async () => {
    deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({ code: 'raw2', success: true });
    const body = parseJson(
      await handlers.handleAdvancedDeobfuscate({
        code: 'obf',
        detectOnly: true,
        useASTOptimization: true,
      })
    );
    expect(deps.astOptimizer.optimize).not.toHaveBeenCalled();
    expect(body.code).toBe('raw2');
    expect(body.astOptimized).toBe(false);
  });
});


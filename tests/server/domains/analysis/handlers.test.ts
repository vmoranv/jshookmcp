import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';

const webcrackState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  runWebcrack: vi.fn<(...args: any[]) => Promise<Record<string, unknown>>>(async () => ({
    applied: true,
    code: 'decoded-bundle',
    bundle: {
      type: 'webpack',
      entryId: '0',
      moduleCount: 1,
      truncated: false,
      modules: [{ id: '0', path: './index.js', isEntry: true, size: 12, code: 'decoded-bundle' }],
    },
    savedTo: 'artifacts/webcrack',
    optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: webcrackState.runWebcrack,
}));

interface BaseResponse {
  success?: boolean;
  error?: string;
  message?: string;
  engine?: string;
  optionsUsed?: Record<string, unknown>;
}

interface DeobfuscateResponse extends BaseResponse {
  code?: string;
}

interface ManageHooksResponse extends BaseResponse {
  id?: string;
}

interface AdvancedDeobfuscateResponse extends BaseResponse {
  code?: string;
  astOptimized?: boolean;
}

interface WebcrackUnpackResponse extends BaseResponse {
  bundle?: Record<string, unknown>;
}

describe('CoreAnalysisHandlers', () => {
  const deps = {
    collector: { collect: vi.fn(), getActivePage: vi.fn() },
    scriptManager: { init: vi.fn(), searchInScripts: vi.fn(), extractFunctionTree: vi.fn() },
    deobfuscator: { deobfuscate: vi.fn() },
    advancedDeobfuscator: { deobfuscate: vi.fn() },
    obfuscationDetector: { detect: vi.fn(), generateReport: vi.fn() },
    analyzer: { understand: vi.fn() },
    cryptoDetector: { detect: vi.fn() },
    hookManager: {
      createHook: vi.fn(),
      getAllHooks: vi.fn(),
      getHookRecords: vi.fn(),
      clearHookRecords: vi.fn(),
    },
  };

  let handlers: CoreAnalysisHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    webcrackState.runWebcrack.mockClear();
    handlers = new CoreAnalysisHandlers(
      deps as unknown as ConstructorParameters<typeof CoreAnalysisHandlers>[0],
    );
  });

  it('rejects deobfuscate when code is missing', async () => {
    const body = parseJson<BaseResponse>(await handlers.handleDeobfuscate({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('code is required');
  });

  it('delegates deobfuscate to deobfuscator', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'x' });
    const body = parseJson<DeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'a()',
        llm: 'provider-a' as unknown as string,
        aggressive: true,
      }),
    );
    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'a()',
      llm: 'provider-a',
      aggressive: true,
    });
    expect(body.success).toBe(true);
  });

  it('passes webcrack-specific options through deobfuscate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'decoded' });

    await handlers.handleDeobfuscate({
      code: 'bundle',
      unpack: false,
      unminify: false,
      jsx: false,
      mangle: true,
      outputDir: 'artifacts/deobf',
      forceOutput: true,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [
        { path: './main.js', pattern: 'bootstrap', matchType: 'includes', target: 'code' },
      ],
    });

    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'bundle',
      unpack: false,
      unminify: false,
      jsx: false,
      mangle: true,
      outputDir: 'artifacts/deobf',
      forceOutput: true,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [
        { path: './main.js', pattern: 'bootstrap', matchType: 'includes', target: 'code' },
      ],
    });
  });

  it('creates hook with default action in manage hooks', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    deps.hookManager.createHook.mockResolvedValue({ success: true, id: 'h1' });
    const body = parseJson<ManageHooksResponse>(
      await handlers.handleManageHooks({
        action: 'create',
        target: 'fetch',
        type: 'fetch',
      }),
    );
    expect(deps.hookManager.createHook).toHaveBeenCalledWith({
      target: 'fetch',
      type: 'fetch',
      action: 'log',
      customCode: undefined,
    });
    expect(body.id).toBe('h1');
  });

  it('returns graceful error for unknown hook action', async () => {
    const result = await handlers.handleManageHooks({ action: 'nope' });
    const body = parseJson<BaseResponse>(result);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Unknown hook action/);
  });

  it('delegates advanced deobfuscate directly to webcrack-backed implementation', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({
      code: 'raw',
      success: true,
      astOptimized: false,
      warnings: [
        'useASTOptimization is deprecated and ignored; legacy AST post-processing has been removed.',
      ],
    });

    const body = parseJson<AdvancedDeobfuscateResponse>(
      await handlers.handleAdvancedDeobfuscate({
        code: 'obf',
        useASTOptimization: true,
        aggressiveVM: true,
        timeout: 3210,
        unpack: false,
      }),
    );

    expect(deps.advancedDeobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'obf',
      useASTOptimization: true,
      aggressiveVM: true,
      timeout: 3210,
      unpack: false,
    });
    expect(body.code).toBe('raw');
    expect(body.astOptimized).toBe(false);
  });

  it('does not inject deprecated defaults when advanced args are omitted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({ code: 'raw2', success: true });

    await handlers.handleAdvancedDeobfuscate({ code: 'obf' });

    expect(deps.advancedDeobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'obf',
    });
  });

  it('runs webcrack_unpack directly and returns bundle details', async () => {
    const response = parseJson<WebcrackUnpackResponse>(
      await handlers.handleWebcrackUnpack({
        code: 'bundle',
        includeModuleCode: true,
        maxBundleModules: 5,
      }),
    );

    expect(response.success).toBe(true);
    expect(response.engine).toBe('webcrack');
    expect(response.optionsUsed).toBeDefined();
    expect(webcrackState.runWebcrack).toHaveBeenCalledWith('bundle', {
      unpack: true,
      unminify: true,
      jsx: true,
      mangle: false,
      includeModuleCode: true,
      maxBundleModules: 5,
    });
  });

  it('returns structured error when webcrack_unpack fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    webcrackState.runWebcrack.mockResolvedValueOnce({
      applied: false,
      code: 'original-code',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
      reason: 'webcrack requires Node.js 22+; current runtime is 20.0.0',
    });

    const response = parseJson<BaseResponse>(
      await handlers.handleWebcrackUnpack({ code: 'original-code' }),
    );

    expect(response.success).toBe(false);
    expect(response.error).toBe('webcrack requires Node.js 22+; current runtime is 20.0.0');
    expect(response.optionsUsed).toEqual({
      jsx: true,
      mangle: false,
      unminify: true,
      unpack: true,
    });
    expect(response.engine).toBe('webcrack');
  });

  it('returns structured error when webcrack_unpack fails without reason', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    webcrackState.runWebcrack.mockResolvedValueOnce({
      applied: false,
      code: 'original-code',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    const response = parseJson<BaseResponse>(
      await handlers.handleWebcrackUnpack({ code: 'original-code' }),
    );

    expect(response.success).toBe(false);
    expect(response.error).toBe('webcrack execution failed');
    expect(response.engine).toBe('webcrack');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const webcrackState = vi.hoisted(() => ({
  runWebcrack: vi.fn(async (code: string) => ({
    applied: true,
    code: `decoded:${code}`,
    optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
  })),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: webcrackState.runWebcrack,
}));

import { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';

describe('AdvancedDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    webcrackState.runWebcrack.mockReset();
    webcrackState.runWebcrack.mockImplementation(async (code: string) => ({
      applied: true,
      code: `decoded:${code}`,
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
    }));
  });

  it('returns static technique detection in detectOnly mode', async () => {
    const result = await new AdvancedDeobfuscator().deobfuscate({
      code: 'while(true){switch(state){case 1: break;}}',
      detectOnly: true,
    });

    expect(webcrackState.runWebcrack).not.toHaveBeenCalled();
    expect(result.webcrackApplied).toBe(false);
    expect(result.engine).toBe('webcrack');
    expect(result.astOptimized).toBe(false);
    expect(result.detectedTechniques.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes('detectOnly'))).toBe(true);
  });

  it('passes options straight through to webcrack and returns bundle metadata', async () => {
    webcrackState.runWebcrack.mockResolvedValue({
      applied: true,
      code: 'const view = <App />;',
      bundle: {
        type: 'browserify',
        entryId: 'main',
        moduleCount: 1,
        truncated: false,
        modules: [{ id: 'main', path: './main.js', isEntry: true, size: 21 }],
      },
      savedTo: 'D:/tmp/advanced-webcrack',
      savedArtifacts: [{ kind: 'bundle', path: 'D:/tmp/advanced-webcrack/bundle.json' }],
      optionsUsed: { jsx: true, mangle: true, unminify: false, unpack: true },
    });

    const result = await new AdvancedDeobfuscator().deobfuscate({
      code: 'packed',
      unpack: true,
      unminify: false,
      jsx: true,
      mangle: true,
      outputDir: 'artifacts/advanced',
      forceOutput: true,
      includeModuleCode: true,
      maxBundleModules: 5,
      mappings: [{ path: './main.js', pattern: 'App', matchType: 'includes', target: 'code' }],
    });

    expect(webcrackState.runWebcrack).toHaveBeenCalledWith('packed', {
      unpack: true,
      unminify: false,
      jsx: true,
      mangle: true,
      mappings: [{ path: './main.js', pattern: 'App', matchType: 'includes', target: 'code' }],
      includeModuleCode: true,
      maxBundleModules: 5,
      outputDir: 'artifacts/advanced',
      forceOutput: true,
    });
    expect(result.webcrackApplied).toBe(true);
    expect(result.bundle?.type).toBe('browserify');
    expect(result.savedTo).toBe('D:/tmp/advanced-webcrack');
    expect(result.engine).toBe('webcrack');
    expect(result.detectedTechniques).toContain('bundle-unpack');
    expect(result.detectedTechniques).toContain('jsx-decompile');
    expect(result.detectedTechniques).toContain('mangle');
    expect(result.detectedTechniques).toContain('webcrack');
  });

  it('reports deprecated legacy flags as warnings without enabling old logic', async () => {
    const result = await new AdvancedDeobfuscator().deobfuscate({
      code: 'legacy()',
      aggressiveVM: true,
      useASTOptimization: true,
      timeout: 1234,
    });

    expect(result.warnings).toEqual([
      'aggressiveVM is deprecated and ignored; VM-specific legacy logic has been removed.',
      'useASTOptimization is deprecated and ignored; legacy AST post-processing has been removed.',
      'timeout is currently ignored; webcrack controls its own execution flow.',
    ]);
    expect(result.vmDetected).toBeUndefined();
    expect(result.astOptimized).toBe(false);
  });

  it('throws when webcrack does not produce a result', async () => {
    webcrackState.runWebcrack.mockResolvedValue({
      applied: false,
      code: 'raw',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
      reason: 'mocked failure',
    });

    await expect(new AdvancedDeobfuscator().deobfuscate({ code: 'broken()' })).rejects.toThrow(
      'mocked failure'
    );
  });
});

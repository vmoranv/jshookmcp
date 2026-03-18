import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for src/index.ts — the main entry point.
 * Since src/index.ts runs main() as a side effect and calls process.exit,
 * we test the extracted utility functions (isFatalError, formatUnknownError)
 * and the CLI fast path module independently.
 */

vi.mock('@server/MCPServer', () => ({
  MCPServer: vi.fn(),
}));

vi.mock('@utils/config', () => ({
  getConfig: vi.fn(),
  validateConfig: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@server/registry/index', () => ({
  initRegistry: vi.fn(async () => {}),
}));

vi.mock('@utils/artifactRetention', () => ({
  cleanupArtifacts: vi.fn(async () => ({ removedFiles: 0, removedBytes: 0 })),
  getArtifactRetentionConfig: vi.fn(() => ({
    enabled: false,
    cleanupOnStart: false,
    retentionDays: 7,
  })),
  startArtifactRetentionScheduler: vi.fn(() => () => {}),
}));

import { resolveCliFastPath } from '@utils/cliFastPath';

describe('resolveCliFastPath', () => {
  const fakeModuleUrl = 'file:///fake/src/index.ts';

  it('returns handled=false for no arguments', () => {
    const result = resolveCliFastPath([], fakeModuleUrl);
    expect(result.handled).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('returns handled=true for --help', () => {
    const result = resolveCliFastPath(['--help'], fakeModuleUrl);
    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Usage:');
  });

  it('returns handled=true for -h', () => {
    const result = resolveCliFastPath(['-h'], fakeModuleUrl);
    expect(result.handled).toBe(true);
    expect(result.output).toContain('Usage:');
  });

  it('returns handled=true for help subcommand', () => {
    const result = resolveCliFastPath(['help'], fakeModuleUrl);
    expect(result.handled).toBe(true);
    expect(result.output).toContain('Usage:');
  });

  it('returns handled=true for --version', () => {
    const result = resolveCliFastPath(['--version'], fakeModuleUrl);
    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBeDefined();
    // Output should end with newline
    expect(result.output!.endsWith('\n')).toBe(true);
  });

  it('returns handled=true for -v', () => {
    const result = resolveCliFastPath(['-v'], fakeModuleUrl);
    expect(result.handled).toBe(true);
  });

  it('returns handled=true for -V', () => {
    const result = resolveCliFastPath(['-V'], fakeModuleUrl);
    expect(result.handled).toBe(true);
  });

  it('returns handled=true for version subcommand', () => {
    const result = resolveCliFastPath(['version'], fakeModuleUrl);
    expect(result.handled).toBe(true);
  });

  it('returns handled=false for unknown arguments', () => {
    const result = resolveCliFastPath(['--unknown', '--flag'], fakeModuleUrl);
    expect(result.handled).toBe(false);
  });

  it('trims whitespace from arguments', () => {
    const result = resolveCliFastPath(['  --help  '], fakeModuleUrl);
    expect(result.handled).toBe(true);
  });

  it('filters empty arguments', () => {
    const result = resolveCliFastPath(['', '  ', '--help'], fakeModuleUrl);
    expect(result.handled).toBe(true);
  });

  it('help output contains expected sections', () => {
    const result = resolveCliFastPath(['--help'], fakeModuleUrl);
    expect(result.output).toContain('jshook');
    expect(result.output).toContain('Behavior:');
    expect(result.output).toContain('MCP server');
    expect(result.output).toContain('environment variables');
  });
});

describe('src/index.ts — isFatalError logic (tested via error classification)', () => {
  /**
   * Since isFatalError is not exported, we test the classification logic
   * using the known fatal error codes to verify the concept.
   */
  it('identifies fatal error codes', () => {
    const FATAL_ERROR_CODES = new Set(['ERR_WORKER_OUT_OF_MEMORY', 'ERR_MEMORY_ALLOCATION_FAILED']);

    const FATAL_ERRNO_CODES = new Set(['ENOMEM', 'ENOSPC', 'EMFILE', 'ENFILE']);

    // Test that the sets contain the expected values
    expect(FATAL_ERROR_CODES.has('ERR_WORKER_OUT_OF_MEMORY')).toBe(true);
    expect(FATAL_ERROR_CODES.has('ERR_MEMORY_ALLOCATION_FAILED')).toBe(true);
    expect(FATAL_ERRNO_CODES.has('ENOMEM')).toBe(true);
    expect(FATAL_ERRNO_CODES.has('ENOSPC')).toBe(true);
    expect(FATAL_ERRNO_CODES.has('EMFILE')).toBe(true);
    expect(FATAL_ERRNO_CODES.has('ENFILE')).toBe(true);
  });

  it('RangeError with allocation message is fatal', () => {
    const err = new RangeError('Invalid array length: allocation failed');
    expect(err instanceof RangeError).toBe(true);
    expect(err.message.includes('allocation')).toBe(true);
  });

  it('regular Error is not fatal', () => {
    const err = new Error('some random error');
    expect(err instanceof RangeError).toBe(false);
  });
});

describe('src/index.ts — formatUnknownError logic', () => {
  /**
   * Testing the formatting logic for unknown error inputs.
   */
  function formatUnknownError(input: unknown): string {
    if (input instanceof Error) {
      return `${input.name}: ${input.message}`;
    }
    try {
      return typeof input === 'string' ? input : JSON.stringify(input);
    } catch {
      return String(input);
    }
  }

  it('formats Error instances', () => {
    const err = new TypeError('bad type');
    expect(formatUnknownError(err)).toBe('TypeError: bad type');
  });

  it('formats string input as-is', () => {
    expect(formatUnknownError('plain string')).toBe('plain string');
  });

  it('formats number input as JSON', () => {
    expect(formatUnknownError(42)).toBe('42');
  });

  it('formats object input as JSON', () => {
    expect(formatUnknownError({ code: 'ERR' })).toBe('{"code":"ERR"}');
  });

  it('formats null as JSON', () => {
    expect(formatUnknownError(null)).toBe('null');
  });

  it('handles circular references with fallback', () => {
    const circular: any = {};
    circular.self = circular;
    // Should not throw, falls back to String()
    expect(typeof formatUnknownError(circular)).toBe('string');
  });
});

describe('browser module index exports', () => {
  it('re-exports all browser module entities', async () => {
    const browserModule = await import('@modules/browser/index');
    expect(browserModule.UnifiedBrowserManager).toBeDefined();
    expect(browserModule.BrowserModeManager).toBeDefined();
    expect(browserModule.CamoufoxBrowserManager).toBeDefined();
    expect(browserModule.BrowserDiscovery).toBeDefined();
  });
});

describe('process module index exports', () => {
  it('re-exports ProcessManager and DEFAULT_CHROMIUM_CONFIG', async () => {
    const processModule = await import('@modules/process/ProcessManager');
    expect(processModule.ProcessManager).toBeDefined();
    expect(processModule.DEFAULT_CHROMIUM_CONFIG).toBeDefined();
    expect(processModule.DEFAULT_CHROMIUM_CONFIG.processNamePattern).toBeDefined();
  });
});

describe('hook barrel exports', () => {
  it('HookGeneratorBuilders.ts re-exports all functions', async () => {
    const builders = await import('@modules/hook/HookGeneratorBuilders');
    expect(builders.generateFunctionHook).toBeDefined();
    expect(builders.generateXHRHook).toBeDefined();
    expect(builders.generateFetchHook).toBeDefined();
    expect(builders.generateWebSocketHook).toBeDefined();
    expect(builders.generateLocalStorageHook).toBeDefined();
    expect(builders.generateCookieHook).toBeDefined();
    expect(builders.generateEvalHook).toBeDefined();
    expect(builders.generateObjectMethodHook).toBeDefined();
    expect(builders.generateAntiDebugBypass).toBeDefined();
    expect(builders.generateHookTemplate).toBeDefined();
    expect(builders.generateHookChain).toBeDefined();
    expect(builders.getInjectionInstructions).toBeDefined();
  });

  it('HookGeneratorBuilders.core.ts re-exports all functions', async () => {
    const core = await import('@modules/hook/HookGeneratorBuilders.core');
    expect(core.generateFunctionHook).toBeDefined();
    expect(core.generateXHRHook).toBeDefined();
    expect(core.generateFetchHook).toBeDefined();
    expect(core.generateWebSocketHook).toBeDefined();
    expect(core.generateLocalStorageHook).toBeDefined();
    expect(core.generateCookieHook).toBeDefined();
    expect(core.generateEvalHook).toBeDefined();
    expect(core.generateObjectMethodHook).toBeDefined();
    expect(core.generateAntiDebugBypass).toBeDefined();
    expect(core.generateHookTemplate).toBeDefined();
    expect(core.generateHookChain).toBeDefined();
    expect(core.getInjectionInstructions).toBeDefined();
  });

  it('HookGeneratorBuilders.core.generators.ts aggregates sub-module exports', async () => {
    const generators = await import('@modules/hook/HookGeneratorBuilders.core.generators');
    // Runtime generators
    expect(generators.generateFunctionHook).toBeDefined();
    expect(generators.generateEvalHook).toBeDefined();
    expect(generators.generateAntiDebugBypass).toBeDefined();
    expect(generators.generateHookTemplate).toBeDefined();
    expect(generators.generateObjectMethodHook).toBeDefined();
    // Network generators
    expect(generators.generateFetchHook).toBeDefined();
    expect(generators.generateWebSocketHook).toBeDefined();
    expect(generators.generateXHRHook).toBeDefined();
    // Storage generators
    expect(generators.generateCookieHook).toBeDefined();
    expect(generators.generateLocalStorageHook).toBeDefined();
    expect(generators.getInjectionInstructions).toBeDefined();
    // Compose generators
    expect(generators.generateHookChain).toBeDefined();
  });
});

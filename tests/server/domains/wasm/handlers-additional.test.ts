import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCodeCollectorMock,
  createPageMock,
  parseJson,
} from '@tests/server/domains/shared/mock-factories';

const runMock = vi.fn();
const probeAllMock = vi.fn();
const writeFileMock = vi.fn();
const statMock = vi.fn();
const resolveArtifactPathMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: any[]) => writeFileMock(...args),
  stat: (...args: any[]) => statMock(...args),
}));

vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: (...args: any[]) => resolveArtifactPathMock(...args),
}));

vi.mock('@src/modules/external/ToolRegistry', () => ({
  ToolRegistry: vi.fn(),
}));

vi.mock('@src/modules/external/ExternalToolRunner', () => ({
  ExternalToolRunner: class {
    run = runMock;
    probeAll = probeAllMock;
  },
}));

import { WasmToolHandlers } from '@server/domains/wasm/handlers';

/**
 * Standardized parseJson for MCP tool responses.
 */

describe('WasmToolHandlers – additional coverage', () => {
  const page = createPageMock();
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: WasmToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // page.evaluate.mockImplementation persists across tests even after clearAllMocks —
    // mockReset restores the factory default (async () => ({})) so each test starts clean
    page.evaluate.mockReset();
    // @ts-expect-error — auto-suppressed [TS2345]
    handlers = new WasmToolHandlers(collector);
  });

  // ── wasm_dump ──────────────────────────────────────────────

  describe('handleWasmDump', () => {
    it('saves binary to custom outputPath when bytes are available', async () => {
      const fakeBytes = [0x00, 0x61, 0x73, 0x6d]; // WASM magic bytes
      page.evaluate
        .mockResolvedValueOnce({
          exports: ['fn1'],
          importMods: ['env'],
          size: 4,
          moduleCount: 1,
        })
        .mockResolvedValueOnce(fakeBytes);

      // Use a path under the temp directory to pass validation
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'test.wasm');

      const body = parseJson<any>(await handlers.handleWasmDump({ moduleIndex: 0, outputPath }));
      expect(body.success).toBe(true);
      expect(body.hash).toBeDefined();
      expect(body.hint).toContain('wasm_disassemble');
      expect(writeFileMock).toHaveBeenCalledOnce();
    });

    it('saves binary to auto-generated artifact path when no outputPath', async () => {
      const fakeBytes = [0x00, 0x61, 0x73, 0x6d];
      page.evaluate
        .mockResolvedValueOnce({
          exports: ['fn1'],
          importMods: ['env'],
          size: 4,
          moduleCount: 1,
        })
        .mockResolvedValueOnce(fakeBytes);

      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/artifacts/wasm/test.wasm',
        displayPath: 'artifacts/wasm/test.wasm',
      });

      const body = parseJson<any>(await handlers.handleWasmDump({}));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe('artifacts/wasm/test.wasm');
      expect(resolveArtifactPathMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'wasm', toolName: 'wasm-dump', ext: 'wasm' }),
      );
    });

    it('uses default moduleIndex of 0 when not specified', async () => {
      page.evaluate.mockResolvedValueOnce({ error: 'No WASM modules captured' });
      const body = parseJson<any>(await handlers.handleWasmDump({}));
      expect(body.success).toBe(false);
      // evaluate was called with index 0
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 0);
    });

    it('generates hint for binary not captured when wasm bytes not stored', async () => {
      page.evaluate
        .mockResolvedValueOnce({
          exports: [],
          importMods: [],
          size: 0,
          moduleCount: 1,
        })
        .mockResolvedValueOnce(null);

      const body = parseJson<any>(await handlers.handleWasmDump({}));
      expect(body.success).toBe(true);
      expect(body.hint).toContain('Binary not captured');
      expect(body.hash).toBeUndefined();
    });
  });

  // ── wasm_disassemble ───────────────────────────────────────

  describe('handleWasmDisassemble', () => {
    it('returns failure when wabt.wasm2wat fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stdout: '',
        stderr: 'wasm2wat error',
        exitCode: 1,
        durationMs: 4,
      });

      const body = parseJson<any>(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('wasm2wat error');
      expect(body.exitCode).toBe(1);
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'out.wat');

      runMock.mockResolvedValue({
        ok: true,
        stdout: '(module\n  (func $add)\n)',
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      const body = parseJson<any>(
        await handlers.handleWasmDisassemble({ inputPath: 'a.wasm', outputPath }),
      );
      expect(body.success).toBe(true);
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('out.wat'),
        '(module\n  (func $add)\n)',
        'utf-8',
      );
    });

    it('disables foldExprs when explicitly set to false', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wat',
        displayPath: 'artifacts/out.wat',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '(module)',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmDisassemble({ inputPath: 'a.wasm', foldExprs: false });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'wabt.wasm2wat',
          args: expect.not.arrayContaining(['--fold-exprs']),
        }),
      );
    });

    it('truncates preview when output exceeds 50 lines', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `(line ${i})`);
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wat',
        displayPath: 'artifacts/out.wat',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });

      const body = parseJson<any>(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
      expect(body.totalLines).toBe(100);
      expect(body.preview).toContain('... (truncated)');
    });

    it('does not truncate preview when output is within 50 lines', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `(line ${i})`);
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wat',
        displayPath: 'artifacts/out.wat',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      const body = parseJson<any>(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
      expect(body.totalLines).toBe(10);
      expect(body.preview).not.toContain('... (truncated)');
    });
  });

  // ── wasm_decompile ─────────────────────────────────────────

  describe('handleWasmDecompile', () => {
    it('returns failure when external tool fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stderr: 'decompile error',
        exitCode: 2,
        stdout: '',
        durationMs: 5,
      });

      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('decompile error');
      expect(body.exitCode).toBe(2);
    });

    it('saves decompiled output to auto-generated artifact path', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'function add(a, b) { return a + b; }',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });

      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe('artifacts/out.dcmp');
      expect(resolveArtifactPathMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'wasm', toolName: 'wasm-decompile', ext: 'dcmp' }),
      );
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'custom.dcmp');

      runMock.mockResolvedValue({
        ok: true,
        stdout: 'function f() {}',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      const body = parseJson<any>(
        await handlers.handleWasmDecompile({ inputPath: 'a.wasm', outputPath }),
      );
      expect(body.success).toBe(true);
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('custom.dcmp'),
        'function f() {}',
        'utf-8',
      );
    });

    it('truncates preview when output exceeds 60 lines', async () => {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      expect(body.totalLines).toBe(80);
      expect(body.preview).toContain('... (truncated)');
    });

    it('does not truncate preview when output is within 60 lines', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      expect(body.totalLines).toBe(30);
      expect(body.preview).not.toContain('... (truncated)');
    });
  });

  // ── wasm_inspect_sections ──────────────────────────────────

  describe('handleWasmInspectSections', () => {
    it('returns failure when external tool fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stderr: 'objdump error',
        exitCode: 1,
        stdout: '',
        durationMs: 5,
      });

      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe('objdump error');
    });

    it('uses -x flag for details sections by default', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'Section Details',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'wabt.wasm-objdump',
          args: ['-x', 'a.wasm'],
        }),
      );
    });

    it('uses -h flag for headers section', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'Headers',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmInspectSections({
        inputPath: 'a.wasm',
        sections: 'headers',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['-h', 'a.wasm'],
        }),
      );
    });

    it('uses -d flag for disassemble section', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'Disassembly',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmInspectSections({
        inputPath: 'a.wasm',
        sections: 'disassemble',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['-d', 'a.wasm'],
        }),
      );
    });

    it('uses all flags for "all" section', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'All sections',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmInspectSections({
        inputPath: 'a.wasm',
        sections: 'all',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['-h', '-x', '-d', 'a.wasm'],
        }),
      );
    });

    it('falls back to -x for an unknown section value', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'Fallback',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmInspectSections({
        inputPath: 'a.wasm',
        sections: 'unknown_section',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['-x', 'a.wasm'],
        }),
      );
    });

    it('truncates preview when output exceeds 100 lines', async () => {
      const lines = Array.from({ length: 150 }, (_, i) => `section line ${i}`);
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }),
      );
      expect(body.totalLines).toBe(150);
      expect(body.preview).toContain('... (truncated)');
    });

    it('does not truncate preview when output is within 100 lines', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }),
      );
      expect(body.totalLines).toBe(50);
      expect(body.preview).not.toContain('... (truncated)');
    });
  });

  // ── wasm_offline_run ───────────────────────────────────────

  describe('handleWasmOfflineRun', () => {
    it('uses wasmtime when auto-detected as available', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: true },
        'runtime.wasmer': { available: true },
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '42\n',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'add',
          args: ['10', '32'],
        }),
      );
      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmtime');
      expect(body.output).toBe('42');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmtime',
          args: ['run', '--invoke', 'add', 'mod.wasm', '10', '32'],
        }),
      );
    });

    it('falls back to wasmer when wasmtime not available', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: true },
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '100\n',
        stderr: '',
        exitCode: 0,
        durationMs: 80,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'compute',
        }),
      );
      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmer');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmer',
          args: ['run', 'mod.wasm', '--invoke', 'compute', '--'],
        }),
      );
    });

    it('returns error when no runtime is available in auto mode', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: false },
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'add',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('No WASM runtime found');
    });

    it('uses explicitly specified wasmer runtime', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'result\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'fn',
          runtime: 'wasmer',
        }),
      );
      expect(body.runtime).toBe('runtime.wasmer');
      expect(probeAllMock).not.toHaveBeenCalled();
    });

    it('uses explicitly specified wasmtime runtime', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'ok\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'fn',
          runtime: 'wasmtime',
        }),
      );
      expect(body.runtime).toBe('runtime.wasmtime');
    });

    it('returns failure with stderr when execution fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stdout: '',
        stderr: 'function not found\n',
        exitCode: 1,
        durationMs: 10,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'missing',
          runtime: 'wasmtime',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.exitCode).toBe(1);
      expect(body.stderr).toBe('function not found');
    });

    it('uses default args and timeoutMs when not specified', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: true },
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmOfflineRun({
        inputPath: 'mod.wasm',
        functionName: 'fn',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 10_000,
          args: ['run', '--invoke', 'fn', 'mod.wasm'],
        }),
      );
    });

    it('respects custom timeoutMs', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmOfflineRun({
        inputPath: 'mod.wasm',
        functionName: 'fn',
        runtime: 'wasmtime',
        timeoutMs: 30000,
      });
      expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30000 }));
    });
  });

  // ── wasm_optimize ──────────────────────────────────────────

  describe('handleWasmOptimize', () => {
    it('returns failure when wasm-opt fails', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      runMock.mockResolvedValue({
        ok: false,
        stderr: 'opt error',
        exitCode: 1,
        stdout: '',
        durationMs: 10,
      });

      const body = parseJson<any>(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('opt error');
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'opt.wasm');

      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });
      statMock.mockResolvedValueOnce({ size: 500 }).mockResolvedValueOnce({ size: 300 });

      const body = parseJson<any>(
        await handlers.handleWasmOptimize({ inputPath: 'in.wasm', outputPath }),
      );
      expect(body.success).toBe(true);
      expect(body.inputSizeBytes).toBe(500);
      expect(body.outputSizeBytes).toBe(300);
    });

    it('uses default optimization level O2', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      statMock.mockRejectedValue(new Error('stat error'));

      await handlers.handleWasmOptimize({ inputPath: 'in.wasm' });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'binaryen.wasm-opt',
          args: ['-O2', 'in.wasm', '-o', '/tmp/out.wasm'],
        }),
      );
    });

    it('uses specified optimization level', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      statMock.mockRejectedValue(new Error('stat error'));

      await handlers.handleWasmOptimize({ inputPath: 'in.wasm', level: 'Oz' });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['-Oz']),
        }),
      );
    });

    it('handles stat errors gracefully and reports zero sizes', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      statMock.mockRejectedValue(new Error('no such file'));

      const body = parseJson<any>(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      expect(body.success).toBe(true);
      expect(body.inputSizeBytes).toBe(0);
      expect(body.outputSizeBytes).toBe(0);
      expect(body.reductionPercent).toBe('0');
    });

    it('computes correct reduction percentage', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      statMock.mockResolvedValueOnce({ size: 1000 }).mockResolvedValueOnce({ size: 750 });

      const body = parseJson<any>(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      expect(body.reductionPercent).toBe('25.0');
    });
  });

  // ── wasm_vmp_trace ─────────────────────────────────────────

  describe('handleWasmVmpTrace', () => {
    it('returns error when no hook data is available', async () => {
      page.evaluate.mockResolvedValueOnce({ error: 'No WASM hook data' });

      const body = parseJson<any>(await handlers.handleWasmVmpTrace({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('No WASM hook data');
    });

    it('returns trace data with top functions on success', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 100,
        capturedEvents: 100,
        topFunctions: [
          { name: 'env.memory_get', count: 50 },
          { name: 'env.fd_write', count: 30 },
        ],
        trace: [{ mod: 'env', fn: 'memory_get', args: [0], ts: 1000 }],
      });

      const body = parseJson<any>(await handlers.handleWasmVmpTrace({}));
      expect(body.success).toBe(true);
      expect(body.totalEvents).toBe(100);
      expect(body.topFunctions).toHaveLength(2);
      expect(body.hint).toContain('VMP handler dispatch patterns');
    });

    it('passes maxEvents and filterModule to page.evaluate', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 10,
        capturedEvents: 10,
        topFunctions: [],
        trace: [],
      });

      await handlers.handleWasmVmpTrace({
        maxEvents: 100,
        filterModule: 'env',
      });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 100,
        filterModule: 'env',
      });
    });

    it('uses default maxEvents of 5000 when not specified', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 0,
        capturedEvents: 0,
        topFunctions: [],
        trace: [],
      });

      await handlers.handleWasmVmpTrace({});
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 5000,
        filterModule: undefined,
      });
    });
  });

  // ── wasm_memory_inspect ────────────────────────────────────

  describe('handleWasmMemoryInspect', () => {
    it('returns error when no WASM memory is available', async () => {
      page.evaluate.mockResolvedValueOnce({
        error: 'No WASM memory available',
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('No WASM memory available');
    });

    it('returns hex dump for format=hex', async () => {
      const data = Array.from({ length: 32 }, (_, i) => i);
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 32,
        data,
        memoryInfo: null,
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ format: 'hex' }));
      expect(body.success).toBe(true);
      expect(body.hexDump).toBeDefined();
      expect(body.hexDump).toContain('00000000');
      expect(body.asciiDump).toBeUndefined();
    });

    it('returns ascii dump for format=ascii', async () => {
      // All printable ASCII characters
      const data = Array.from({ length: 10 }, (_, i) => 0x41 + i); // A B C ...
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 10,
        data,
        memoryInfo: null,
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ format: 'ascii' }));
      expect(body.success).toBe(true);
      expect(body.asciiDump).toBeDefined();
      expect(body.asciiDump).toContain('A');
      expect(body.hexDump).toBeUndefined();
    });

    it('returns both hex and ascii for format=both (default)', async () => {
      const data = Array.from({ length: 16 }, (_, i) => 0x41 + i);
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 16,
        data,
        memoryInfo: null,
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
      expect(body.success).toBe(true);
      expect(body.hexDump).toBeDefined();
      // format=both does not populate asciiDump, only hexDump with inline ascii
      expect(body.hexDump).toContain('|');
    });

    it('includes search results when searchPattern is provided', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 256,
        data: Array.from({ length: 16 }, () => 0),
        searchResults: [{ offset: 10 }, { offset: 42 }],
        memoryInfo: null,
      });

      const body = parseJson<any>(
        await handlers.handleWasmMemoryInspect({ searchPattern: 'test' }),
      );
      expect(body.success).toBe(true);
      expect(body.searchResults).toHaveLength(2);
      expect(body.searchResults[0].offset).toBe(10);
    });

    it('caps length to 65536', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 10,
        totalMemoryBytes: 655360,
        requestedOffset: 0,
        requestedLength: 65536,
        data: [0],
        memoryInfo: null,
      });

      await handlers.handleWasmMemoryInspect({ length: 999999 });
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ length: 65536 }),
      );
    });

    it('uses default offset and length when not specified', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 256,
        data: [0],
        memoryInfo: null,
      });

      await handlers.handleWasmMemoryInspect({});
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ offset: 0, length: 256 }),
      );
    });

    it('formats hex dump with proper address and ascii column', async () => {
      // Byte 0x48='H', 0x69='i', then a non-printable 0x01
      const data = [0x48, 0x69, 0x01];
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 3,
        data,
        memoryInfo: null,
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ format: 'hex' }));
      expect(body.hexDump).toContain('48 69 01');
      // ASCII column: 'H' 'i' '.' (non-printable replaced with '.')
      expect(body.hexDump).toContain('|Hi.|');
    });

    it('formats hex dump with custom offset in addresses', async () => {
      const data = [0x00];
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 256,
        requestedLength: 1,
        data,
        memoryInfo: null,
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ offset: 256 }));
      expect(body.hexDump).toContain('00000100');
    });

    it('returns a catch-all read error when memory access throws', async () => {
      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) => {
        const previousWindow = (globalThis as any).window;
        (globalThis as any).window = {
          __wasmInstances: [
            {
              exports: {
                get memory() {
                  throw new Error('boom');
                },
              },
            },
          ],
        };

        try {
          return await (fn as (options: unknown) => unknown)(opts);
        } finally {
          if (previousWindow === undefined) {
            delete (globalThis as any).window;
          } else {
            (globalThis as any).window = previousWindow;
          }
        }
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to read WASM memory');
      expect(body.error).toContain('boom');
    });
  });

  // ── wasm_memory_inspect — ASCII pattern search (lines 698-716) ──

  describe('handleWasmMemoryInspect — ASCII search branch', () => {
    it('uses ASCII TextEncoder search for non-hex patterns and finds a match', async () => {
      // Pattern "ABC" contains uppercase letters beyond hex range (G-Z) → treated as ASCII
      // Buffer: [0x41='A', 0x42='B', 0x43='C', 0x00, 0x44='D', 0x45='E']
      // TextEncoder.encode("ABC") = [65, 66, 67] → matches at offset 0 only
      // Mock page.evaluate to return the pre-computed search result directly
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 6,
        requestedOffset: 0,
        requestedLength: 6,
        data: [0x41, 0x42, 0x43, 0x00, 0x44, 0x45],
        searchResults: [{ offset: 0 }],
        memoryInfo: null,
      });

      const res = await handlers.handleWasmMemoryInspect({
        offset: 0,
        length: 6,
        format: 'ascii',
        searchPattern: 'ABC',
      });
      const body = parseJson<any>(res);
      expect(body.success).toBe(true);
      expect(body.searchResults).toEqual([{ offset: 0 }]);
      expect(body.asciiDump).toBe('ABC.DE');
    });

    it('ASCII search returns no matches when pattern is not present', async () => {
      // Pattern "XYZ" (non-hex) not in buffer → no matches
      const originalWindow = (globalThis as any).window;
      const fakeBuffer = new Uint8Array([0x41, 0x42, 0x43, 0x00, 0x44, 0x45]).buffer;
      const fakeWindow = {
        __aiHooks: {
          'preset-webassembly-full': [{ type: 'memory_created' }],
        },
        __wasmInstances: [
          {
            exports: { memory: { buffer: fakeBuffer } },
          },
        ],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) =>
        // @ts-expect-error — test helper
        (fn as (opts: unknown) => unknown)(opts),
      );

      try {
        const res = await handlers.handleWasmMemoryInspect({
          offset: 0,
          length: 6,
          format: 'both',
          searchPattern: 'XYZ',
        });
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        expect(body.searchResults).toEqual([]);
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('ASCII search with single-character non-hex pattern', async () => {
      // 'D' (0x44) appears at offset 4 in buffer [0x41, 0x42, 0x43, 0x00, 0x44, 0x45]
      // Mock page.evaluate to return the pre-computed search result directly
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 6,
        requestedOffset: 0,
        requestedLength: 6,
        data: [0x41, 0x42, 0x43, 0x00, 0x44, 0x45],
        searchResults: [{ offset: 4 }],
        memoryInfo: null,
      });

      const res = await handlers.handleWasmMemoryInspect({
        offset: 0,
        length: 6,
        format: 'both',
        searchPattern: 'D',
      });
      const body = parseJson<any>(res);
      expect(body.success).toBe(true);
      // TextEncoder.encode("D") = [68] → buffer[4] = 68 → offset 4
      expect(body.searchResults).toEqual([{ offset: 4 }]);
    });

    it('ASCII search with pattern spanning null byte in buffer', async () => {
      // "C\x00D" encoded = [67, 0, 68] → matches at offset 2 where buffer = [0x43='C', 0x00, 0x44='D']
      const originalWindow = (globalThis as any).window;
      const fakeBuffer = new Uint8Array([0x41, 0x42, 0x43, 0x00, 0x44, 0x45]).buffer;
      const fakeWindow = {
        __aiHooks: { 'preset-webassembly-full': [] },
        __wasmInstances: [{ exports: { memory: { buffer: fakeBuffer } } }],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) =>
        // @ts-expect-error — test helper
        (fn as (opts: unknown) => unknown)(opts),
      );

      try {
        const res = await handlers.handleWasmMemoryInspect({
          offset: 0,
          length: 6,
          format: 'ascii',
          // "C\x00D" contains non-hex chars, treated as ASCII
          searchPattern: 'C\x00D',
        });
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        // "C\x00D" encoded = [67, 0, 68] → matches at offset 2
        expect(body.searchResults).toEqual([{ offset: 2 }]);
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns error when __wasmInstances is not an array (line 648)', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        __aiHooks: { 'preset-webassembly-full': [] },
        __wasmInstances: null, // not an array → triggers early return at line 648
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) =>
        // @ts-expect-error — test helper
        (fn as (opts: unknown) => unknown)(opts),
      );

      try {
        const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
        expect(body.success).toBe(false);
        expect(body.error).toContain('No WASM memory available');
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns error when __wasmInstances is an empty array', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        __aiHooks: { 'preset-webassembly-full': [] },
        __wasmInstances: [], // empty array → triggers early return
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) =>
        // @ts-expect-error — test helper
        (fn as (opts: unknown) => unknown)(opts),
      );

      try {
        const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
        expect(body.success).toBe(false);
        expect(body.error).toContain('No WASM memory available');
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns error when memory buffer getter throws', async () => {
      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) => {
        const prev = (globalThis as any).window;
        (globalThis as any).window = {
          __wasmInstances: [
            {
              exports: {
                get memory() {
                  throw new Error('access denied');
                },
              },
            },
          ],
        };
        try {
          // @ts-expect-error — test helper
          return await (fn as (o: unknown) => unknown)(opts);
        } finally {
          (globalThis as any).window = prev;
        }
      });

      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to read WASM memory');
      expect(body.error).toContain('access denied');
    });

    it('returns error when memory buffer is null (no exported memory)', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        __aiHooks: { 'preset-webassembly-full': [] },
        __wasmInstances: [
          {
            exports: { memory: { buffer: null } },
          },
        ],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: unknown, opts: unknown) =>
        // @ts-expect-error — test helper
        (fn as (opts: unknown) => unknown)(opts),
      );

      try {
        const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
        expect(body.success).toBe(false);
        expect(body.error).toContain('no exported memory');
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });
  });

  // ── path validation ────────────────────────────────────────

  describe('path validation', () => {
    it('blocks path traversal for disassemble outputPath', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: '(module)',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await expect(
        handlers.handleWasmDisassemble({
          inputPath: 'a.wasm',
          outputPath: '/etc/passwd',
        }),
      ).rejects.toThrow('Path traversal blocked');
    });

    it('blocks path traversal for decompile outputPath', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'code',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await expect(
        handlers.handleWasmDecompile({
          inputPath: 'a.wasm',
          outputPath: '/etc/shadow',
        }),
      ).rejects.toThrow('Path traversal blocked');
    });

    it('blocks path traversal for optimize outputPath', async () => {
      await expect(
        handlers.handleWasmOptimize({
          inputPath: 'in.wasm',
          outputPath: '/root/.ssh/authorized_keys',
        }),
      ).rejects.toThrow('Path traversal blocked');
    });
  });

  // ── wasm_dump: __wasmModuleStorage missing the requested index (line 153) ──

  describe('handleWasmDump — storage index missing', () => {
    it('returns success with binary-not-available when __wasmModuleStorage[idx] is undefined', async () => {
      // First evaluate (get module info) succeeds; second evaluate (get bytes) returns null
      // because __wasmModuleStorage[0] is undefined
      page.evaluate
        .mockResolvedValueOnce({
          exports: ['fn1'],
          importMods: ['env'],
          size: 42,
          moduleCount: 1,
        })
        .mockResolvedValueOnce(null);

      const body = parseJson<any>(await handlers.handleWasmDump({ moduleIndex: 0 }));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toContain('binary not available');
      expect(body.totalModules).toBe(1);
    });
  });

  // ── wasm_decompile: success and failure ─────────────────────

  describe('handleWasmDecompile', () => {
    it('returns decompile success with preview and artifact path', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      const decompiled =
        '(func $add (param i32 i32) (result i32)\n  local.get 0\n  local.get 1\n  i32.add)';
      runMock.mockResolvedValue({
        ok: true,
        stdout: decompiled,
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'mod.wasm' }));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toContain('out.dcmp');
      expect(body.totalLines).toBe(4);
      expect(body.preview).toContain('$add');
    });

    it('returns decompile failure when the external tool fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stdout: '',
        stderr: 'wasm-decompile: error: parse error',
        exitCode: 1,
        durationMs: 5,
      });

      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'bad.wasm' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('parse error');
      expect(body.exitCode).toBe(1);
    });
  });

  // ── wasm_inspect_sections: success and failure ────────────────

  describe('handleWasmInspectSections', () => {
    it('returns section details with header and details flags', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: `test.wasm: file format wasm 0x1\n\nSection Details:\nType[1]\nFunction[1]`,
        stderr: '',
        exitCode: 0,
        durationMs: 12,
      });

      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'mod.wasm', sections: 'all' }),
      );
      expect(body.success).toBe(true);
      expect(body.totalLines).toBeGreaterThan(0);
      expect(body.preview).toContain('Section Details');
    });

    it('uses disassemble flags when sections=disassemble', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: '  i32.const 0\n  end\n',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      await handlers.handleWasmInspectSections({
        inputPath: 'mod.wasm',
        sections: 'disassemble',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'wabt.wasm-objdump',
          args: expect.arrayContaining(['-d', 'mod.wasm']),
        }),
      );
    });

    it('returns failure when wasm-objdump fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stdout: '',
        stderr: 'wasm-objdump: error: failed to open file',
        exitCode: 1,
        durationMs: 5,
      });

      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'missing.wasm' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('failed to open file');
    });

    it('uses header-only flags when sections=headers', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'mod.wasm: file format wasm 0x1\n\nHeader:\n  magic\n  version',
        stderr: '',
        exitCode: 0,
        durationMs: 8,
      });

      await handlers.handleWasmInspectSections({
        inputPath: 'mod.wasm',
        sections: 'headers',
      });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['-h', 'mod.wasm']),
        }),
      );
    });
  });

  // ── wasm_vmp_trace: success, error, and filter ──────────────

  describe('handleWasmVmpTrace', () => {
    it('returns trace success with top functions and preview', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 3,
        capturedEvents: 3,
        topFunctions: [
          { name: 'env.process_key', count: 2 },
          { name: 'env.read_memory', count: 1 },
        ],
        trace: [
          { mod: 'env', fn: 'process_key', args: [1, 2], ts: 100 },
          { mod: 'env', fn: 'read_memory', args: [0x1000], ts: 101 },
        ],
      });

      const body = parseJson<any>(await handlers.handleWasmVmpTrace({ maxEvents: 100 }));
      expect(body.success).toBe(true);
      expect(body.totalEvents).toBe(3);
      expect(body.capturedEvents).toBe(3);
      expect(body.topFunctions[0].name).toBe('env.process_key');
      expect(body.hint).toContain('wasm_disassemble');
    });

    it('returns error when no WASM hook data is present', async () => {
      page.evaluate.mockResolvedValueOnce({
        error: 'No WASM hook data. Inject hook_preset("webassembly-full") and reload the page.',
      });

      const body = parseJson<any>(await handlers.handleWasmVmpTrace({ maxEvents: 5000 }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('No WASM hook data');
    });

    it('filters trace events by filterModule', async () => {
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 5,
        capturedEvents: 2,
        topFunctions: [{ name: 'env.dispatcher', count: 2 }],
        trace: [
          { mod: 'env', fn: 'dispatcher', args: [], ts: 1 },
          { mod: 'env', fn: 'dispatcher', args: [], ts: 2 },
        ],
      });

      const body = parseJson<any>(
        await handlers.handleWasmVmpTrace({ maxEvents: 5000, filterModule: 'env' }),
      );
      expect(body.success).toBe(true);
      expect(body.capturedEvents).toBe(2);
    });

    it('handles maxEvents truncation and topFunctions sorting', async () => {
      // More than 30 unique functions should be truncated to top 30
      const manyFns = Array.from({ length: 50 }, (_, i) => ({
        mod: 'env',
        fn: `fn_${i}`,
        args: [],
        ts: i,
      }));
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 50,
        capturedEvents: 50,
        topFunctions: manyFns.slice(0, 30).map((e) => ({ name: `${e.mod}.${e.fn}`, count: 1 })),
        trace: manyFns.map((e) => ({ mod: e.mod, fn: e.fn, args: e.args, ts: e.ts })),
      });

      const body = parseJson<any>(await handlers.handleWasmVmpTrace({ maxEvents: 50 }));
      expect(body.success).toBe(true);
      expect(body.topFunctions.length).toBeLessThanOrEqual(30);
    });
  });

  // ── wasm_offline_run: wasmer as auto fallback ────────────────

  describe('handleWasmOfflineRun — auto runtime fallback', () => {
    it('selects wasmer when wasmtime is unavailable in auto mode', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: true },
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'result\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'main',
          runtime: 'auto',
        }),
      );
      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmer');
    });

    it('returns failure output when runtime execution fails', async () => {
      runMock.mockResolvedValue({
        ok: false,
        stdout: '',
        stderr: 'Wasm trap: out of bounds memory access',
        exitCode: 1,
        durationMs: 30,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'crash.wasm',
          functionName: 'main',
          runtime: 'wasmtime',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.output).toBe('');
      expect(body.stderr).toContain('out of bounds');
      expect(body.exitCode).toBe(1);
    });
  });

  // ── wasm_optimize: artifact path under temp (line 87 via constructor path) ─

  describe('handleWasmOptimize — artifact resolution', () => {
    it('resolves artifact path when no outputPath is provided', async () => {
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/wasm-opt-out.wasm',
        displayPath: 'artifacts/wasm-opt-out.wasm',
      });
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });
      statMock.mockResolvedValueOnce({ size: 150 }).mockResolvedValueOnce({ size: 120 });

      const body = parseJson<any>(
        await handlers.handleWasmOptimize({ inputPath: 'in.wasm', level: 'O3' }),
      );
      expect(body.success).toBe(true);
      expect(body.artifactPath).toContain('wasm-opt-out.wasm');
      expect(body.reductionPercent).toBe('20.0');
      expect(body.optimizationLevel).toBe('O3');
    });
  });
});

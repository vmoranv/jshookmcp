import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  ToolRegistry: class {},
}));

vi.mock('@src/modules/external/ExternalToolRunner', () => ({
  ExternalToolRunner: class {
    run = runMock;
    probeAll = probeAllMock;
  },
}));

import { WasmToolHandlers } from '@server/domains/wasm/handlers';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('WasmToolHandlers – additional coverage', () => {
  const page = {
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: WasmToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
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
      const tmpPath = require('node:os').tmpdir();
      const outputPath = require('node:path').join(tmpPath, 'test.wasm');

      const body = parseJson(await handlers.handleWasmDump({ moduleIndex: 0, outputPath }));
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

      const body = parseJson(await handlers.handleWasmDump({}));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe('artifacts/wasm/test.wasm');
      expect(resolveArtifactPathMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'wasm', toolName: 'wasm-dump', ext: 'wasm' })
      );
    });

    it('uses default moduleIndex of 0 when not specified', async () => {
      page.evaluate.mockResolvedValueOnce({ error: 'No WASM modules captured' });
      const body = parseJson(await handlers.handleWasmDump({}));
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

      const body = parseJson(await handlers.handleWasmDump({}));
      expect(body.success).toBe(true);
      expect(body.hint).toContain('Binary not captured');
      expect(body.hash).toBeUndefined();
    });
  });

  // ── wasm_disassemble ───────────────────────────────────────

  describe('handleWasmDisassemble', () => {
    it('saves to custom outputPath when specified', async () => {
      const tmpPath = require('node:os').tmpdir();
      const outputPath = require('node:path').join(tmpPath, 'out.wat');

      runMock.mockResolvedValue({
        ok: true,
        stdout: '(module\n  (func $add)\n)',
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      const body = parseJson(
        await handlers.handleWasmDisassemble({ inputPath: 'a.wasm', outputPath })
      );
      expect(body.success).toBe(true);
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('out.wat'),
        '(module\n  (func $add)\n)',
        'utf-8'
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
        })
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

      const body = parseJson(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
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

      const body = parseJson(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
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

      const body = parseJson(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
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

      const body = parseJson(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe('artifacts/out.dcmp');
      expect(resolveArtifactPathMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'wasm', toolName: 'wasm-decompile', ext: 'dcmp' })
      );
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = require('node:os').tmpdir();
      const outputPath = require('node:path').join(tmpPath, 'custom.dcmp');

      runMock.mockResolvedValue({
        ok: true,
        stdout: 'function f() {}',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      const body = parseJson(
        await handlers.handleWasmDecompile({ inputPath: 'a.wasm', outputPath })
      );
      expect(body.success).toBe(true);
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('custom.dcmp'),
        'function f() {}',
        'utf-8'
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

      const body = parseJson(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
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

      const body = parseJson(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
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

      const body = parseJson(await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }));
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
        })
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
        })
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
        })
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
        })
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
        })
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

      const body = parseJson(await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }));
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

      const body = parseJson(await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }));
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

      const body = parseJson(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'add',
          args: ['10', '32'],
        })
      );
      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmtime');
      expect(body.output).toBe('42');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmtime',
          args: ['run', '--invoke', 'add', 'mod.wasm', '10', '32'],
        })
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

      const body = parseJson(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'compute',
        })
      );
      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmer');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmer',
          args: ['run', 'mod.wasm', '--invoke', 'compute', '--'],
        })
      );
    });

    it('returns error when no runtime is available in auto mode', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: false },
      });

      const body = parseJson(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'add',
        })
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

      const body = parseJson(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'fn',
          runtime: 'wasmer',
        })
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

      const body = parseJson(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'fn',
          runtime: 'wasmtime',
        })
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

      const body = parseJson(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'missing',
          runtime: 'wasmtime',
        })
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
        })
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

      const body = parseJson(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('opt error');
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = require('node:os').tmpdir();
      const outputPath = require('node:path').join(tmpPath, 'opt.wasm');

      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });
      statMock.mockResolvedValueOnce({ size: 500 }).mockResolvedValueOnce({ size: 300 });

      const body = parseJson(
        await handlers.handleWasmOptimize({ inputPath: 'in.wasm', outputPath })
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
        })
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
        })
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

      const body = parseJson(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
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

      const body = parseJson(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      expect(body.reductionPercent).toBe('25.0');
    });
  });

  // ── wasm_vmp_trace ─────────────────────────────────────────

  describe('handleWasmVmpTrace', () => {
    it('returns error when no hook data is available', async () => {
      page.evaluate.mockResolvedValueOnce({ error: 'No WASM hook data' });

      const body = parseJson(await handlers.handleWasmVmpTrace({}));
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

      const body = parseJson(await handlers.handleWasmVmpTrace({}));
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({}));
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({ format: 'hex' }));
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({ format: 'ascii' }));
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({}));
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({ searchPattern: 'test' }));
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
        expect.objectContaining({ length: 65536 })
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
        expect.objectContaining({ offset: 0, length: 256 })
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({ format: 'hex' }));
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

      const body = parseJson(await handlers.handleWasmMemoryInspect({ offset: 256 }));
      expect(body.hexDump).toContain('00000100');
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
        })
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
        })
      ).rejects.toThrow('Path traversal blocked');
    });

    it('blocks path traversal for optimize outputPath', async () => {
      await expect(
        handlers.handleWasmOptimize({
          inputPath: 'in.wasm',
          outputPath: '/root/.ssh/authorized_keys',
        })
      ).rejects.toThrow('Path traversal blocked');
    });
  });
});

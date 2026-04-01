/**
 * Additional WASM handlers coverage tests.
 * Covers remaining uncovered branches in WasmToolHandlers:
 * - wasm_dump with custom outputPath and wasm bytes
 * - wasm_dump path traversal blocking
 * - validateOutputPath edge cases
 * - wasm_memory_inspect: ascii-only format edge, non-printable bytes in hex dump
 * - wasm_offline_run: explicit non-wasmtime runtime selection
 */
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

describe('WasmToolHandlers — remaining coverage', () => {
  const page = createPageMock();
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: WasmToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error — auto-suppressed [TS2345]
    handlers = new WasmToolHandlers(collector);
  });

  // ── wasm_dump: path traversal on custom outputPath ─────────

  describe('handleWasmDump — path traversal', () => {
    it('throws on path traversal when outputPath is unsafe', async () => {
      const fakeBytes = [0x00, 0x61, 0x73, 0x6d];
      page.evaluate
        .mockResolvedValueOnce({
          exports: ['fn1'],
          importMods: ['env'],
          size: 4,
          moduleCount: 1,
        })
        .mockResolvedValueOnce(fakeBytes);

      await expect(
        handlers.handleWasmDump({
          moduleIndex: 0,
          outputPath: '/etc/passwd',
        }),
      ).rejects.toThrow('Path traversal blocked');
    });
  });

  describe('handleWasmDump — hook execution', () => {
    it('dumps wasm bytes when the hook preset is populated', async () => {
      const originalWindow = (globalThis as any).window;
      const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer;
      const fakeWindow = {
        __aiHooks: {
          'preset-webassembly-full': [
            {
              type: 'instantiated',
              exports: { memory: { buffer: wasmBytes } },
              importMods: ['env'],
              size: 4,
            },
          ],
        },
        __wasmModuleStorage: [wasmBytes],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: (...args: any[]) => any, ...args: any[]) =>
        fn(...args),
      );

      try {
        const body = parseJson<any>(
          await handlers.handleWasmDump({
            moduleIndex: 0,
            outputPath: path.join(process.cwd(), 'test-output', 'wasm-dump-test.wasm'),
          }),
        );

        expect(body.success).toBe(true);
        expect(body.artifactPath).toContain('wasm-dump-test.wasm');
        expect(body.totalModules).toBe(1);
        expect(body.size).toBe(4);
        expect(writeFileMock).toHaveBeenCalled();
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns an error when the requested module index is out of range', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        __aiHooks: {
          'preset-webassembly-full': [
            {
              type: 'instantiated',
              exports: { memory: { buffer: new ArrayBuffer(4) } },
              importMods: ['env'],
              size: 4,
            },
          ],
        },
        __wasmModuleStorage: [new ArrayBuffer(4)],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: (...args: any[]) => any, ...args: any[]) =>
        fn(...args),
      );

      try {
        const body = parseJson<any>(await handlers.handleWasmDump({ moduleIndex: 3 }));
        expect(body.success).toBe(false);
        expect(body.error).toContain('out of range');
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns an error when no instantiated modules are present', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        __aiHooks: {
          'preset-webassembly-full': [],
        },
        __wasmModuleStorage: [],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: (...args: any[]) => any, ...args: any[]) =>
        fn(...args),
      );

      try {
        const body = parseJson<any>(await handlers.handleWasmDump({ moduleIndex: 0 }));
        expect(body.success).toBe(false);
        expect(body.error).toContain('No WASM modules captured');
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });
  });

  // ── wasm_memory_inspect: format edge cases ────────────────

  describe('handleWasmMemoryInspect — format edge cases', () => {
    it('handles non-printable ASCII bytes in hex dump ascii column', () => {
      // Include byte values at boundaries: 0x1F (non-printable), 0x20 (space, printable), 0x7E (~, printable), 0x7F (DEL, non-printable)
      const data = [0x1f, 0x20, 0x7e, 0x7f];
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 4,
        data,
        memoryInfo: null,
      });

      return handlers.handleWasmMemoryInspect({ format: 'hex' }).then((res) => {
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        // 0x1F -> '.', 0x20 -> ' ', 0x7E -> '~', 0x7F -> '.'
        expect(body.hexDump).toContain('|. ~.|');
      });
    });

    it('handles ascii format with non-printable bytes replaced by dots', () => {
      const data = [0x00, 0x41, 0x42, 0xff]; // NUL, A, B, 0xFF
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 4,
        data,
        memoryInfo: null,
      });

      return handlers.handleWasmMemoryInspect({ format: 'ascii' }).then((res) => {
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        expect(body.asciiDump).toBe('.AB.');
        expect(body.hexDump).toBeUndefined();
      });
    });

    it('returns hexDump without asciiDump for format=both with empty data', () => {
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 0,
        data: [],
        memoryInfo: null,
      });

      return handlers.handleWasmMemoryInspect({ format: 'both' }).then((res) => {
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        expect(body.hexDump).toBe('');
        expect(body.asciiDump).toBeUndefined();
      });
    });

    it('handles large offset addresses in hex dump', () => {
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 100,
        totalMemoryBytes: 6553600,
        requestedOffset: 0xfffff0,
        requestedLength: 2,
        data: [0xab, 0xcd],
        memoryInfo: null,
      });

      return handlers.handleWasmMemoryInspect({ offset: 0xfffff0, format: 'hex' }).then((res) => {
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        expect(body.hexDump).toContain('00fffff0');
        expect(body.hexDump).toContain('ab cd');
      });
    });

    it('executes the memory search branch for hex and ascii patterns', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeBuffer = new Uint8Array([0x41, 0x42, 0x43, 0x00, 0x44, 0x45]).buffer;
      const fakeWindow = {
        __aiHooks: {
          'preset-webassembly-full': [{ type: 'memory_created', id: 'mem-1' }],
        },
        __wasmInstances: [
          {
            exports: {
              memory: { buffer: fakeBuffer },
            },
          },
        ],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: (...args: any[]) => any, ...args: any[]) =>
        fn(...args),
      );

      try {
        const res = await handlers.handleWasmMemoryInspect({
          offset: 0,
          length: 6,
          format: 'ascii',
          searchPattern: '42 43',
        });
        const body = parseJson<any>(res);
        expect(body.success).toBe(true);
        expect(body.asciiDump).toBe('ABC.DE');
        expect(body.searchResults).toEqual([{ offset: 1 }]);
      } finally {
        page.evaluate.mockReset();
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns an error when the WASM module does not export memory', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        __aiHooks: {
          'preset-webassembly-full': [],
        },
        __wasmInstances: [
          {
            exports: {},
          },
        ],
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementation(async (fn: (...args: any[]) => any, ...args: any[]) =>
        fn(...args),
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

  // ── wasm_offline_run: explicit runtime selection ──────────

  describe('handleWasmOfflineRun — edge cases', () => {
    it('uses wasmer arg format with --invoke and -- separator', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: '99\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'compute',
          args: ['1', '2'],
          runtime: 'wasmer',
        }),
      );

      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmer');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmer',
          args: ['run', 'mod.wasm', '--invoke', 'compute', '--', '1', '2'],
        }),
      );
    });

    it('uses wasmtime arg format with --invoke before inputPath', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: '0\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'main',
          args: ['arg1'],
          runtime: 'wasmtime',
        }),
      );

      expect(body.success).toBe(true);
      expect(body.runtime).toBe('runtime.wasmtime');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['run', '--invoke', 'main', 'mod.wasm', 'arg1'],
        }),
      );
    });

    it('includes stderr in output when present', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'result\n',
        stderr: 'some warning\n',
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

      expect(body.stderr).toBe('some warning');
    });

    it('omits stderr when it is empty after trimming', async () => {
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'result\n',
        stderr: '  \n',
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

      // stderr is trimmed to empty, which is falsy, so it becomes undefined
      expect(body.stderr).toBeUndefined();
    });

    it('returns an error when no runtime is available in auto mode', async () => {
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: false },
      });

      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'main',
          runtime: 'auto',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('No WASM runtime found');
    });
  });

  // ── wasm_optimize: output path under cwd ──────────────────

  describe('handleWasmOptimize — cwd path validation', () => {
    it('accepts outputPath under current working directory', async () => {
      const cwdPath = path.join(process.cwd(), 'test-output.wasm');

      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      statMock.mockResolvedValueOnce({ size: 100 }).mockResolvedValueOnce({ size: 80 });

      const body = parseJson<any>(
        await handlers.handleWasmOptimize({
          inputPath: 'in.wasm',
          outputPath: cwdPath,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.artifactPath).toContain('test-output.wasm');
    });
  });

  // ── wasm_disassemble: foldExprs defaults ──────────────────

  describe('handleWasmDisassemble — foldExprs default', () => {
    it('includes --fold-exprs by default when foldExprs is not specified', async () => {
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

      await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['--fold-exprs']),
        }),
      );
    });
  });
});

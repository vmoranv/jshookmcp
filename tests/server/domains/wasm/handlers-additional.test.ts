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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:fs/promises', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  writeFile: (...args: any[]) => writeFileMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  stat: (...args: any[]) => statMock(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/artifacts', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  resolveArtifactPath: (...args: any[]) => resolveArtifactPathMock(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/external/ToolRegistry', () => ({
  ToolRegistry: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    handlers = new WasmToolHandlers(collector);
  });

  // ── wasm_dump ──────────────────────────────────────────────

  describe('handleWasmDump', () => {
    it('saves binary to custom outputPath when bytes are available', async () => {
      const fakeBytes = [0x00, 0x61, 0x73, 0x6d]; // WASM magic bytes
      page.evaluate
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce({
          exports: ['fn1'],
          importMods: ['env'],
          size: 4,
          moduleCount: 1,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce(fakeBytes);

      // Use a path under the temp directory to pass validation
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'test.wasm');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDump({ moduleIndex: 0, outputPath }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hash).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hint).toContain('wasm_disassemble');
      expect(writeFileMock).toHaveBeenCalledOnce();
    });

    it('saves binary to auto-generated artifact path when no outputPath', async () => {
      const fakeBytes = [0x00, 0x61, 0x73, 0x6d];
      page.evaluate
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce({
          exports: ['fn1'],
          importMods: ['env'],
          size: 4,
          moduleCount: 1,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce(fakeBytes);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/artifacts/wasm/test.wasm',
        displayPath: 'artifacts/wasm/test.wasm',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDump({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.artifactPath).toBe('artifacts/wasm/test.wasm');
      expect(resolveArtifactPathMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'wasm', toolName: 'wasm-dump', ext: 'wasm' }),
      );
    });

    it('uses default moduleIndex of 0 when not specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({ error: 'No WASM modules captured' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDump({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // evaluate was called with index 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 0);
    });

    it('generates hint for binary not captured when wasm bytes not stored', async () => {
      page.evaluate
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce({
          exports: [],
          importMods: [],
          size: 0,
          moduleCount: 1,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDump({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hint).toContain('Binary not captured');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hash).toBeUndefined();
    });
  });

  // ── wasm_disassemble ───────────────────────────────────────

  describe('handleWasmDisassemble', () => {
    it('saves to custom outputPath when specified', async () => {
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'out.wat');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '(module\n  (func $add)\n)',
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmDisassemble({ inputPath: 'a.wasm', outputPath }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('out.wat'),
        '(module\n  (func $add)\n)',
        'utf-8',
      );
    });

    it('disables foldExprs when explicitly set to false', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wat',
        displayPath: 'artifacts/out.wat',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wat',
        displayPath: 'artifacts/out.wat',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalLines).toBe(100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.preview).toContain('... (truncated)');
    });

    it('does not truncate preview when output is within 50 lines', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `(line ${i})`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wat',
        displayPath: 'artifacts/out.wat',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalLines).toBe(10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.preview).not.toContain('... (truncated)');
    });
  });

  // ── wasm_decompile ─────────────────────────────────────────

  describe('handleWasmDecompile', () => {
    it('returns failure when external tool fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: false,
        stderr: 'decompile error',
        exitCode: 2,
        stdout: '',
        durationMs: 5,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('decompile error');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.exitCode).toBe(2);
    });

    it('saves decompiled output to auto-generated artifact path', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'function add(a, b) { return a + b; }',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.artifactPath).toBe('artifacts/out.dcmp');
      expect(resolveArtifactPathMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'wasm', toolName: 'wasm-decompile', ext: 'dcmp' }),
      );
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'custom.dcmp');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'function f() {}',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmDecompile({ inputPath: 'a.wasm', outputPath }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('custom.dcmp'),
        'function f() {}',
        'utf-8',
      );
    });

    it('truncates preview when output exceeds 60 lines', async () => {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalLines).toBe(80);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.preview).toContain('... (truncated)');
    });

    it('does not truncate preview when output is within 60 lines', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.dcmp',
        displayPath: 'artifacts/out.dcmp',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmDecompile({ inputPath: 'a.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalLines).toBe(30);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.preview).not.toContain('... (truncated)');
    });
  });

  // ── wasm_inspect_sections ──────────────────────────────────

  describe('handleWasmInspectSections', () => {
    it('returns failure when external tool fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: false,
        stderr: 'objdump error',
        exitCode: 1,
        stdout: '',
        durationMs: 5,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('objdump error');
    });

    it('uses -x flag for details sections by default', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 15,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalLines).toBe(150);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.preview).toContain('... (truncated)');
    });

    it('does not truncate preview when output is within 100 lines', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmInspectSections({ inputPath: 'a.wasm' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalLines).toBe(50);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.preview).not.toContain('... (truncated)');
    });
  });

  // ── wasm_offline_run ───────────────────────────────────────

  describe('handleWasmOfflineRun', () => {
    it('uses wasmtime when auto-detected as available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: true },
        'runtime.wasmer': { available: true },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '42\n',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'add',
          args: ['10', '32'],
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.runtime).toBe('runtime.wasmtime');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.output).toBe('42');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmtime',
          args: ['run', '--invoke', 'add', 'mod.wasm', '10', '32'],
        }),
      );
    });

    it('falls back to wasmer when wasmtime not available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: true },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '100\n',
        stderr: '',
        exitCode: 0,
        durationMs: 80,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'compute',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.runtime).toBe('runtime.wasmer');
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'runtime.wasmer',
          args: ['run', 'mod.wasm', '--invoke', 'compute', '--'],
        }),
      );
    });

    it('returns error when no runtime is available in auto mode', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: false },
        'runtime.wasmer': { available: false },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'add',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('No WASM runtime found');
    });

    it('uses explicitly specified wasmer runtime', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'result\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'fn',
          runtime: 'wasmer',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.runtime).toBe('runtime.wasmer');
      expect(probeAllMock).not.toHaveBeenCalled();
    });

    it('uses explicitly specified wasmtime runtime', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: 'ok\n',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'fn',
          runtime: 'wasmtime',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.runtime).toBe('runtime.wasmtime');
    });

    it('returns failure with stderr when execution fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: false,
        stdout: '',
        stderr: 'function not found\n',
        exitCode: 1,
        durationMs: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOfflineRun({
          inputPath: 'mod.wasm',
          functionName: 'missing',
          runtime: 'wasmtime',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.exitCode).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stderr).toBe('function not found');
    });

    it('uses default args and timeoutMs when not specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      probeAllMock.mockResolvedValue({
        'runtime.wasmtime': { available: true },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: false,
        stderr: 'opt error',
        exitCode: 1,
        stdout: '',
        durationMs: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('opt error');
    });

    it('saves to custom outputPath when specified', async () => {
      const tmpPath = os.tmpdir();
      const outputPath = path.join(tmpPath, 'opt.wasm');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      statMock.mockResolvedValueOnce({ size: 500 }).mockResolvedValueOnce({ size: 300 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmOptimize({ inputPath: 'in.wasm', outputPath }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.inputSizeBytes).toBe(500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.outputSizeBytes).toBe(300);
    });

    it('uses default optimization level O2', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      statMock.mockRejectedValue(new Error('stat error'));

      await handlers.handleWasmOptimize({ inputPath: 'in.wasm', level: 'Oz' });
      expect(runMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['-Oz']),
        }),
      );
    });

    it('handles stat errors gracefully and reports zero sizes', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      statMock.mockRejectedValue(new Error('no such file'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.inputSizeBytes).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.outputSizeBytes).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.reductionPercent).toBe('0');
    });

    it('computes correct reduction percentage', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/out.wasm',
        displayPath: 'artifacts/out.wasm',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      runMock.mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      statMock.mockResolvedValueOnce({ size: 1000 }).mockResolvedValueOnce({ size: 750 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmOptimize({ inputPath: 'in.wasm' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.reductionPercent).toBe('25.0');
    });
  });

  // ── wasm_vmp_trace ─────────────────────────────────────────

  describe('handleWasmVmpTrace', () => {
    it('returns error when no hook data is available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({ error: 'No WASM hook data' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmVmpTrace({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('No WASM hook data');
    });

    it('returns trace data with top functions on success', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 100,
        capturedEvents: 100,
        topFunctions: [
          { name: 'env.memory_get', count: 50 },
          { name: 'env.fd_write', count: 30 },
        ],
        trace: [{ mod: 'env', fn: 'memory_get', args: [0], ts: 1000 }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmVmpTrace({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalEvents).toBe(100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.topFunctions).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hint).toContain('VMP handler dispatch patterns');
    });

    it('passes maxEvents and filterModule to page.evaluate', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 100,
        filterModule: 'env',
      });
    });

    it('uses default maxEvents of 5000 when not specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalEvents: 0,
        capturedEvents: 0,
        topFunctions: [],
        trace: [],
      });

      await handlers.handleWasmVmpTrace({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 5000,
        filterModule: undefined,
      });
    });
  });

  // ── wasm_memory_inspect ────────────────────────────────────

  describe('handleWasmMemoryInspect', () => {
    it('returns error when no WASM memory is available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        error: 'No WASM memory available',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('No WASM memory available');
    });

    it('returns hex dump for format=hex', async () => {
      const data = Array.from({ length: 32 }, (_, i) => i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 32,
        data,
        memoryInfo: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ format: 'hex' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toContain('00000000');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.asciiDump).toBeUndefined();
    });

    it('returns ascii dump for format=ascii', async () => {
      // All printable ASCII characters
      const data = Array.from({ length: 10 }, (_, i) => 0x41 + i); // A B C ...
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 10,
        data,
        memoryInfo: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ format: 'ascii' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.asciiDump).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.asciiDump).toContain('A');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toBeUndefined();
    });

    it('returns both hex and ascii for format=both (default)', async () => {
      const data = Array.from({ length: 16 }, (_, i) => 0x41 + i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 16,
        data,
        memoryInfo: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toBeDefined();
      // format=both does not populate asciiDump, only hexDump with inline ascii
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toContain('|');
    });

    it('includes search results when searchPattern is provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 256,
        data: Array.from({ length: 16 }, () => 0),
        searchResults: [{ offset: 10 }, { offset: 42 }],
        memoryInfo: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleWasmMemoryInspect({ searchPattern: 'test' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.searchResults).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.searchResults[0].offset).toBe(10);
    });

    it('caps length to 65536', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        expect.any(Function),
        expect.objectContaining({ length: 65536 }),
      );
    });

    it('uses default offset and length when not specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        expect.any(Function),
        expect.objectContaining({ offset: 0, length: 256 }),
      );
    });

    it('formats hex dump with proper address and ascii column', async () => {
      // Byte 0x48='H', 0x69='i', then a non-printable 0x01
      const data = [0x48, 0x69, 0x01];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 0,
        requestedLength: 3,
        data,
        memoryInfo: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ format: 'hex' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toContain('48 69 01');
      // ASCII column: 'H' 'i' '.' (non-printable replaced with '.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toContain('|Hi.|');
    });

    it('formats hex dump with custom offset in addresses', async () => {
      const data = [0x00];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        totalMemoryPages: 1,
        totalMemoryBytes: 65536,
        requestedOffset: 256,
        requestedLength: 1,
        data,
        memoryInfo: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleWasmMemoryInspect({ offset: 256 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hexDump).toContain('00000100');
    });
  });

  // ── path validation ────────────────────────────────────────

  describe('path validation', () => {
    it('blocks path traversal for disassemble outputPath', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
});

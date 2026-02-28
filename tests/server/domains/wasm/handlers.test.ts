import { beforeEach, describe, expect, it, vi } from 'vitest';

const runMock = vi.fn();
const writeFileMock = vi.fn();
const statMock = vi.fn();
const resolveArtifactPathMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: any[]) => writeFileMock(...args),
  stat: (...args: any[]) => statMock(...args),
}));

vi.mock('../../../../src/utils/artifacts.js', () => ({
  resolveArtifactPath: (...args: any[]) => resolveArtifactPathMock(...args),
}));

vi.mock('../../../../src/modules/external/ToolRegistry.js', () => ({
  ToolRegistry: class {},
}));

vi.mock('../../../../src/modules/external/ExternalToolRunner.js', () => ({
  ExternalToolRunner: class {
    run = runMock;
  },
}));

import { WasmToolHandlers } from '../../../../src/server/domains/wasm/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('WasmToolHandlers', () => {
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

  it('returns wasm_dump error when no module is captured', async () => {
    page.evaluate.mockResolvedValueOnce({ error: 'No WASM modules captured' });
    const body = parseJson(await handlers.handleWasmDump({ moduleIndex: 0 }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('No WASM modules captured');
  });

  it('returns wasm_dump success with fallback message when bytes are unavailable', async () => {
    page.evaluate
      .mockResolvedValueOnce({
        exports: ['a'],
        importMods: ['env'],
        size: 123,
        moduleCount: 1,
      })
      .mockResolvedValueOnce(null);

    const body = parseJson(await handlers.handleWasmDump({ moduleIndex: 0 }));
    expect(body.success).toBe(true);
    expect(body.artifactPath).toContain('binary not available');
    expect(body.totalModules).toBe(1);
  });

  it('returns disassemble failure when external tool fails', async () => {
    runMock.mockResolvedValue({
      ok: false,
      stderr: 'tool missing',
      exitCode: 1,
      stdout: '',
      durationMs: 10,
    });
    const body = parseJson(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('tool missing');
  });

  it('writes disassembled output to artifact path on success', async () => {
    resolveArtifactPathMock.mockResolvedValue({
      absolutePath: '/tmp/out.wat',
      displayPath: 'artifacts/out.wat',
    });
    runMock.mockResolvedValue({
      ok: true,
      stdout: '(module)\n(func)',
      stderr: '',
      exitCode: 0,
      durationMs: 25,
    });

    const body = parseJson(await handlers.handleWasmDisassemble({ inputPath: 'a.wasm' }));
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/out.wat', '(module)\n(func)', 'utf-8');
    expect(body.success).toBe(true);
    expect(body.artifactPath).toBe('artifacts/out.wat');
  });

  it('computes wasm optimize size metrics', async () => {
    resolveArtifactPathMock.mockResolvedValue({
      absolutePath: '/tmp/out.wasm',
      displayPath: 'artifacts/out.wasm',
    });
    runMock.mockResolvedValue({
      ok: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 30,
    });
    statMock
      .mockResolvedValueOnce({ size: 200 })
      .mockResolvedValueOnce({ size: 100 });

    const body = parseJson(await handlers.handleWasmOptimize({ inputPath: 'in.wasm', level: 'O2' }));
    expect(body.success).toBe(true);
    expect(body.inputSizeBytes).toBe(200);
    expect(body.outputSizeBytes).toBe(100);
  });
});


import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { WasmSharedState } from '@server/domains/wasm/handlers/shared';
import { ExternalToolHandlers } from '@server/domains/wasm/handlers/external-tool-handlers';

const MOCK_RUN_RESULT = {
  ok: true as const,
  stdout: '',
  stderr: '',
  exitCode: 0,
  durationMs: 100,
  signal: null,
  truncated: false,
};

function createMockState(): WasmSharedState {
  return {
    runner: {
      run: vi.fn(async () => ({ ...MOCK_RUN_RESULT })),
      probeAll: vi.fn(async () => ({ 'runtime.wasmtime': { available: false } })),
    },
  } as unknown as WasmSharedState;
}

const WAT_WITH_EXPORTS = `(module
  (type (func (result i32)))
  (func $add (export "add") (result i32) i32.const 42)
  (memory (export "memory") 1)
  (table (export "table") 1 funcref)
  (global (export "counter") (mut i32) (i32.const 0))
)`;

const WAT_WITH_CALL_INDIRECT = `(module
  (type $t0 (func))
  (table (export "table") 1 funcref)
  (func (export "run")
    i32.const 0
    call_indirect (type $t0)
  )
)`;

describe('ExternalToolHandlers — WASM instrumentation wrapper behavioral tests', () => {
  describe('handleWasmInstrumentTrace — wrapper generation', () => {
    it('generates wrapper with all hook types', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'test.wasm',
        allHooks: true,
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.success).toBe(true);
      expect(json.hookTypes).toEqual(['call', 'memory', 'branch', 'loop', 'local']);
      expect(json.functionCount).toBeGreaterThan(0);
      expect(json.wrapperSizeBytes).toBeGreaterThan(100);
      expect(json.exportCount).toBeGreaterThan(0);
    });

    it('generates wrapper with specific hook types', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: '(module (func))',
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'test.wasm',
        allHooks: false,
        hooks: ['call', 'memory'],
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.hookTypes).toEqual(['call', 'memory']);
    });

    it('includes branch hook code via Object.defineProperty when hooks contain branch', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'test.wasm',
        hooks: ['branch'],
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.success).toBe(true);
      expect(json.hookTypes).toContain('branch');
      expect(json.wrapperSizeBytes).toBeGreaterThan(0);
    });

    it('warns when branch mode cannot observe internal call_indirect dispatch', async () => {
      const outputDir = await mkdtemp(join(tmpdir(), 'jshookmcp-branch-hook-'));
      const outputPath = join(outputDir, 'branch-wrapper.js');
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_CALL_INDIRECT,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);

      try {
        const res = await handlers.handleWasmInstrumentTrace({
          inputPath: 'https://example.test/module.wasm',
          outputPath,
          hooks: ['branch'],
        });
        const json = JSON.parse(res.content[0]!.text);
        const wrapper = await readFile(outputPath, 'utf8');

        expect(json.warning).toContain('call_indirect');
        expect(json.metadata).toMatchObject({
          branchHookMode: 'js-table-access-only',
          callIndirectSites: 1,
        });
        expect(wrapper).toContain('JS-visible WebAssembly.Table access only');
        expect(wrapper).toContain("type: 'table_get'");
        expect(wrapper).not.toContain("type: 'indirect_call'");
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    });

    it('includes memory hook code when hooks contain memory', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'test.wasm',
        hooks: ['memory'],
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.success).toBe(true);
      expect(json.hookTypes).toContain('memory');
    });

    it('includes local hook code when hooks contain local', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'test.wasm',
        hooks: ['local'],
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.success).toBe(true);
      expect(json.hookTypes).toContain('local');
    });

    it('handles disassembly failure gracefully', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ok: false,
        stdout: '',
        stderr: 'error',
        exitCode: 1,
        durationMs: 10,
        signal: null,
        truncated: false,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({ inputPath: 'bad.wasm' });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.success).toBe(false);
    });

    it('defaults to all hooks when none specified', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: '(module (func))',
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({ inputPath: 'test.wasm' });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.hookTypes).toEqual(['call', 'memory', 'branch', 'loop', 'local']);
    });

    it('warns when wrapper fetch source is a local filesystem path', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'C:/artifacts/sample.wasm',
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.warning).toContain('browser-side fetch()');
      expect(json.warning).toContain('wasm_dump');
      expect(json.metadata).toMatchObject({
        inputPathKind: 'local-path',
        wrapperFetchesBrowserUrl: true,
      });
    });

    it('does not warn when inputPath is already an http(s) URL', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'https://example.test/sample.wasm',
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.warning).toBeUndefined();
      expect(json.metadata).toMatchObject({
        inputPathKind: 'url',
        wrapperFetchesBrowserUrl: true,
      });
    });

    it('does not warn when inputPath is a data URL', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'data:application/wasm;base64,AGFzbQEAAA==',
      });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.warning).toBeUndefined();
    });

    it('does not warn when inputPath is a relative browser path', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({ inputPath: './sample.wasm' });
      const json = JSON.parse(res.content[0]!.text);
      expect(json.warning).toBeUndefined();
    });

    it('filters invalid hook names out of generated wrapper metadata', async () => {
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: WAT_WITH_EXPORTS,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);
      const res = await handlers.handleWasmInstrumentTrace({
        inputPath: 'test.wasm',
        allHooks: false,
        hooks: ['call', 'bogus-hook', 'memory'],
      });
      const json = JSON.parse(res.content[0]!.text);

      expect(json.success).toBe(true);
      expect(json.hookTypes).toEqual(['call', 'memory']);
    });

    it('preserves non-env import namespaces in the generated wrapper', async () => {
      const wat = `(module
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "js" "log" (func $log (param i32)))
  (func (export "run"))
)`;
      const outputDir = await mkdtemp(join(tmpdir(), 'jshookmcp-instrument-trace-'));
      const outputPath = join(outputDir, 'wrapper.js');
      const mockState = createMockState();
      mockState.runner.run = vi.fn(async () => ({
        ...MOCK_RUN_RESULT,
        stdout: wat,
        durationMs: 50,
      }));
      const handlers = new ExternalToolHandlers(mockState);

      try {
        const res = await handlers.handleWasmInstrumentTrace({
          inputPath: 'test.wasm',
          outputPath,
          hooks: ['call'],
        });
        const json = JSON.parse(res.content[0]!.text);
        const wrapper = await readFile(outputPath, 'utf8');

        expect(json.success).toBe(true);
        expect(wrapper).toContain('wasi_snapshot_preview1');
        expect(wrapper).toContain('js');
        expect(wrapper).not.toContain('imports.env["fd_write"]');
        expect(wrapper).not.toContain('imports.env["log"]');
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    });
  });
});

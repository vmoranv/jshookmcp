import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import type { MCPServerContext } from '@server/MCPServer.context';
import { probeCommand } from '@modules/external/ToolProbe';
import * as fsPromises from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

const { openZipMock } = vi.hoisted(() => ({
  openZipMock: vi.fn(),
}));

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

vi.mock('yauzl', () => ({
  open: openZipMock,
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
  };
});

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('BinaryInstrumentHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openZipMock.mockReset();
    vi.mocked(probeCommand).mockResolvedValue({
      available: false,
      reason: 'tool not found',
      path: undefined,
      version: undefined,
    } as Awaited<ReturnType<typeof probeCommand>>);
  });

  function createMockContext(): MCPServerContext {
    return {
      extensionPluginsById: new Map(),
      extensionPluginRuntimeById: new Map(),
    } as unknown as MCPServerContext;
  }

  function createHandlers(): BinaryInstrumentHandlers {
    return new BinaryInstrumentHandlers(createMockContext());
  }

  function mockZipEntries(entries: Array<{ fileName: string; content?: string | Buffer }>): void {
    openZipMock.mockImplementationOnce(
      (
        _apkPath: string,
        _options: unknown,
        callback: (
          error: Error | null,
          zipFile?: {
            on: (event: string, listener: (...args: unknown[]) => void) => unknown;
            removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown;
            readEntry: () => void;
            openReadStream: (
              entry: { fileName: string },
              callback: (error: Error | null, stream?: Readable) => void,
            ) => void;
            close: () => void;
          },
        ) => void,
      ) => {
        const normalizedEntries = entries.map((entry) => ({
          fileName: entry.fileName,
          content:
            typeof entry.content === 'string'
              ? Buffer.from(entry.content, 'utf8')
              : (entry.content ?? Buffer.alloc(0)),
        }));
        const emitter = new EventEmitter();
        let index = 0;

        const zipFile = {
          on: emitter.on.bind(emitter),
          removeListener: emitter.removeListener.bind(emitter),
          readEntry: () => {
            const nextEntry = normalizedEntries[index++];
            queueMicrotask(() => {
              if (nextEntry) {
                emitter.emit('entry', { fileName: nextEntry.fileName });
              } else {
                emitter.emit('end');
              }
            });
          },
          openReadStream: (
            entry: { fileName: string },
            streamCallback: (error: Error | null, stream?: Readable) => void,
          ) => {
            const match = normalizedEntries.find(
              (candidate) => candidate.fileName === entry.fileName,
            );
            if (!match) {
              streamCallback(new Error(`entry not found: ${entry.fileName}`));
              return;
            }
            streamCallback(null, Readable.from([match.content]));
          },
          close: () => undefined,
        };

        callback(null, zipFile);
      },
    );
  }

  describe('Frida proxy handlers', () => {
    it('handleBinaryInstrumentCapabilities reports backend states', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleBinaryInstrumentCapabilities();

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.tool).toBe('binary_instrument_capabilities');
      expect(Array.isArray(parsed.capabilities)).toBe(true);
      expect(
        parsed.capabilities.some(
          (entry: { capability: string }) => entry.capability === 'frida_cli',
        ),
      ).toBe(true);
      expect(
        parsed.capabilities.some(
          (entry: { capability: string }) => entry.capability === 'plugin_ghidra_bridge',
        ),
      ).toBe(true);
    });

    it('handleFridaAttach returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaAttach({ pid: '1234' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleFridaRunScript returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaRunScript({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleFridaDetach returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaDetach({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleFridaListSessions returns an empty local session list when no plugin is installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaListSessions({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.sessions).toEqual([]);
      expect(parsed.count).toBe(0);
    });

    it('handleFridaGenerateScript generates a script without requiring the legacy plugin', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaGenerateScript({
        template: 'trace',
        functionName: 'CreateFileW',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.script).toContain('CreateFileW');
    });

    it('handleGetAvailablePlugins returns empty list when no plugins', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGetAvailablePlugins({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.plugins).toEqual([]);
      expect(parsed.count).toBe(0);
    });
  });

  describe('Static analysis handlers', () => {
    it('handleGhidraAnalyze returns structured fallback when Ghidra is unavailable', async () => {
      const binaryPath = join(
        tmpdir(),
        `jshook-ghidra-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`,
      );
      await fsPromises.writeFile(binaryPath, Buffer.from('mock-binary-content'));

      const handlers = createHandlers();
      const result = await handlers.handleGhidraAnalyze({ binaryPath });

      try {
        expect(result).toMatchObject({
          available: false,
          capability: 'ghidra_headless',
          binaryPath,
        });
      } finally {
        await fsPromises.rm(binaryPath, { force: true });
      }
    });

    it('handleGhidraDecompile returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGhidraDecompile({ functionName: 'main' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleIdaDecompile returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleIdaDecompile({
        binaryPath: '/path/to/binary',
        functionName: 'main',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleJadxDecompile returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleJadxDecompile({
        apkPath: '/path/to/app.apk',
        className: 'com.example.MainActivity',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleApktoolDecode reports unavailable when apktool is missing', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: false,
        reason: 'apktool not found',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const handlers = createHandlers();
      const result = await handlers.handleApktoolDecode({ apkPath: '/tmp/app.apk' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(false);
      expect(parsed.capability).toBe('apktool_cli');
    });

    it('handleApktoolDecode runs apktool when available', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'apktool',
      } as Awaited<ReturnType<typeof probeCommand>>);

      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, 'decoded', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleApktoolDecode({
        apkPath: '/tmp/app.apk',
        outputDir: '/tmp/out',
        force: true,
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.outputDir).toBe('/tmp/out');
      expect(fsPromises.mkdir).toHaveBeenCalled();
    });

    it('handleApkManifestDump extracts AndroidManifest.xml from apk', async () => {
      mockZipEntries([
        {
          fileName: 'AndroidManifest.xml',
          content: '<manifest package="com.example.app" />',
        },
      ]);

      const handlers = createHandlers();
      const result = await handlers.handleApkManifestDump({ apkPath: '/tmp/app.apk' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.format).toBe('xml');
      expect(parsed.manifest).toContain('com.example.app');
    });

    it('handleApkManifestDump returns base64 when manifest payload is binary AXML', async () => {
      const binaryManifest = Buffer.from([0x03, 0x00, 0x08, 0x00, 0x24, 0x00, 0x00, 0x00]);
      mockZipEntries([{ fileName: 'AndroidManifest.xml', content: binaryManifest }]);

      const handlers = createHandlers();
      const result = await handlers.handleApkManifestDump({ apkPath: '/tmp/app.apk' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.format).toBe('binary-axml');
      expect(parsed.manifestBase64).toBe(binaryManifest.toString('base64'));
    });

    it('handleApkNativeLibsList returns native libraries from apk entries', async () => {
      mockZipEntries([
        { fileName: 'AndroidManifest.xml' },
        { fileName: 'classes.dex' },
        { fileName: 'lib/arm64-v8a/libapp.so' },
        { fileName: 'lib/arm64-v8a/libflutter.so' },
        { fileName: 'lib/armeabi-v7a/libfoo.so' },
      ]);

      const handlers = createHandlers();
      const result = await handlers.handleApkNativeLibsList({ apkPath: '/tmp/app.apk' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.count).toBe(3);
      expect(parsed.libraries.some((entry: { name: string }) => entry.name === 'libapp.so')).toBe(
        true,
      );
    });
  });

  describe('Unidbg handlers', () => {
    it('handleUnidbgLaunch returns error when soPath missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgLaunch({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleUnidbgCall returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgCall({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleUnidbgCall returns error when session not found', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgCall({
        sessionId: 'nonexistent',
        functionName: 'test',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not found');
    });

    it('handleUnidbgTrace returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgTrace({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleUnidbgTrace returns error when session not found', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgTrace({ sessionId: 'nonexistent' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not found');
    });
  });

  describe('Hook generation handlers', () => {
    it('handleGenerateHooks returns error when ghidraOutput missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGenerateHooks({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('ghidraOutput is required');
    });

    it('handleGenerateHooks returns error for invalid JSON', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGenerateHooks({ ghidraOutput: 'not-json' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Invalid JSON');
    });

    it('handleGenerateHooks processes valid Ghidra output', async () => {
      const handlers = createHandlers();
      const ghidraOutput = JSON.stringify({
        functions: [
          {
            name: 'Java_com_example_test',
            address: '0x1000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        callGraph: [],
        strings: [],
        imports: [],
        decompilations: [],
      });

      const result = await handlers.handleGenerateHooks({ ghidraOutput });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.count).toBe(1);
      expect(parsed.hooks[0].functionName).toBe('Java_com_example_test');
    });

    it('handleExportHookScript returns default script when no templates', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleExportHookScript({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.script).toContain('Java.perform');
      expect(parsed.format).toBe('frida');
    });

    it('handleExportHookScript exports provided templates', async () => {
      const handlers = createHandlers();
      const templates = JSON.stringify([
        {
          functionName: 'test_func',
          hookCode: 'console.log("test");',
          description: 'Test hook',
          parameters: [],
        },
      ]);

      const result = await handlers.handleExportHookScript({ hookTemplates: templates });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.script).toContain('console.log("test")');
      expect(parsed.hookCount).toBe(1);
    });

    it('handleExportHookScript returns error for invalid JSON', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleExportHookScript({ hookTemplates: 'not-json' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Invalid JSON');
    });
  });
});

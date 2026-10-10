import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import type { MCPServerContext } from '@server/MCPServer.context';
import { probeCommand } from '@modules/external/ToolProbe';
import { GhidraAnalyzer } from '@modules/binary-instrument/GhidraAnalyzer';
import * as fsPromises from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import { mkdirSync } from 'node:fs';
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
      eventBus: { emit: vi.fn() },
    } as unknown as MCPServerContext;
  }

  function createHandlers(ghidra?: GhidraAnalyzer): BinaryInstrumentHandlers {
    return new BinaryInstrumentHandlers(createMockContext(), ghidra);
  }

  function metadataDexBuffer(): Buffer {
    const buffer = Buffer.alloc(0x180, 0);
    buffer.write('dex\n035\0', 0, 'ascii');
    buffer.writeUInt32LE(buffer.length, 32);
    buffer.writeUInt32LE(0x70, 36);
    buffer.writeUInt32LE(0x12345678, 40);
    buffer.writeUInt32LE(0x70, 52);
    buffer.writeUInt32LE(3, 56);
    buffer.writeUInt32LE(0xb0, 60);
    buffer.writeUInt32LE(1, 64);
    buffer.writeUInt32LE(0xbc, 68);
    buffer.writeUInt32LE(1, 96);
    buffer.writeUInt32LE(0xc0, 100);
    buffer.writeUInt32LE(0x70, 108);
    buffer.writeUInt32LE(3, 0x70);
    buffer.writeUInt16LE(0x0001, 0x74);
    buffer.writeUInt32LE(3, 0x78);
    buffer.writeUInt32LE(0xb0, 0x7c);
    buffer.writeUInt16LE(0x0002, 0x80);
    buffer.writeUInt32LE(1, 0x84);
    buffer.writeUInt32LE(0xbc, 0x88);
    buffer.writeUInt16LE(0x2000, 0x8c);
    buffer.writeUInt32LE(1, 0x90);
    buffer.writeUInt32LE(0xc0, 0x94);
    buffer.writeUInt32LE(0xd8, 0xb0);
    buffer.writeUInt32LE(0xe7, 0xb4);
    buffer.writeUInt32LE(0xef, 0xb8);
    buffer.writeUInt32LE(0, 0xbc);
    buffer.writeUInt32LE(0, 0xc0);
    buffer.writeUInt32LE(0, 0xc4);
    buffer.writeUInt32LE(0xffffffff, 0xc8);
    buffer.writeUInt32LE(0, 0xcc);
    buffer.writeUInt32LE(0, 0xd0);
    buffer.writeUInt32LE(0, 0xd4);
    writeDexString(buffer, 0xd8, 'Lx/A;');
    writeDexString(buffer, 0xe7, 'value');
    writeDexString(buffer, 0xef, 'unused');
    return buffer;
  }

  function writeDexString(buffer: Buffer, offset: number, value: string): void {
    buffer[offset] = value.length;
    buffer.write(value, offset + 1, 'utf8');
    buffer[offset + 1 + value.length] = 0;
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
                emitter.emit('entry', {
                  fileName: nextEntry.fileName,
                  uncompressedSize: nextEntry.content.length,
                });
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
          (entry: { capability: string }) => entry.capability === 'ghidra_headless',
        ),
      ).toBe(true);
      // The plugin_ghidra_bridge capability is gone: ghidra_decompile moved to
      // the stateless headless path (kimi-cu report P2-6) and no longer
      // depends on an HTTP bridge server.
      expect(
        parsed.capabilities.some(
          (entry: { capability: string }) => entry.capability === 'plugin_ghidra_bridge',
        ),
      ).toBe(false);
    });

    it('handleFridaAttach pid-only attaches natively via -p when the CLI is available', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'frida',
        version: '16.0.0',
        reason: undefined,
      } as Awaited<ReturnType<typeof probeCommand>>);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, '__frida_attach_ok__', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleFridaAttach({ pid: 2695 });
      const body = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );

      expect(body.success).toBe(true);
      expect(body.target).toBe('2695');
      expect(body.device).toEqual({ type: 'local' });
      const args = (vi.mocked(childProcess.execFile).mock.calls.at(-1)?.[1] ?? []) as string[];
      expect(args.slice(0, 2)).toEqual(['-p', '2695']);
    });

    it('handleFridaAttach reports an unavailable CLI honestly for pid-only attach', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaAttach({ pid: 1234 });

      const body = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );
      expect(body.success).toBe(false);
      expect(body.available).toBe(false);
      expect(body.reason).toContain('tool not found');
    });

    it('handleFridaAttach with a remote device passes -H before the target and reports the device', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'frida',
        version: '17.12.0',
        reason: undefined,
      } as Awaited<ReturnType<typeof probeCommand>>);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, '__frida_attach_ok__', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleFridaAttach({
        target: 'HyperCeiler',
        device: 'remote',
        host: '192.168.1.11:27042',
      });
      const body = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );

      expect(body.success).toBe(true);
      expect(body.device).toEqual({ type: 'remote', host: '192.168.1.11:27042' });
      const args = (vi.mocked(childProcess.execFile).mock.calls.at(-1)?.[1] ?? []) as string[];
      expect(args.slice(0, 4)).toEqual(['-H', '192.168.1.11:27042', '-n', 'HyperCeiler']);
    });

    it('handleFridaAttach validates target/pid presence and remote host', async () => {
      const handlers = createHandlers();

      const neither = await handlers.handleFridaAttach({ device: 'remote', host: 'h:1' });
      const neitherText = (neither as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(neitherText).toContain('Either target or pid is required');

      const noHost = await handlers.handleFridaAttach({ target: 'x', device: 'remote' });
      const noHostBody = JSON.parse(
        (noHost as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );
      expect(noHostBody.success).toBe(false);
      expect(noHostBody.reason).toContain('host is required');
    });

    it('handleFridaListDevices parses frida-ls-devices output', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'frida-ls-devices',
        version: '17.12.0',
        reason: undefined,
      } as Awaited<ReturnType<typeof probeCommand>>);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(
          null,
          [
            '  Id     Type    Name',
            '  local  local   Local System (local)',
            '  usb    usb     Pixel 7',
          ].join('\r\n'),
          '',
        );
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleFridaListDevices({});
      const body = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );

      expect(body.success).toBe(true);
      expect(body.devices).toEqual([
        { id: 'local', type: 'local', name: 'Local System (local)' },
        { id: 'usb', type: 'usb', name: 'Pixel 7' },
      ]);
      expect(body.count).toBe(2);
    });

    it('handleFridaListDevices reports an install fix when the CLI is missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaListDevices({});
      const body = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );

      expect(body.success).toBe(false);
      expect(body.available).toBe(false);
      expect(body.capability).toBe('frida-ls-devices');
      expect(body.fix).toContain('frida-tools');
    });

    it('handleFridaListProcesses passes device args and parses frida-ps rows', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'frida-ps',
        version: '17.12.0',
        reason: undefined,
      } as Awaited<ReturnType<typeof probeCommand>>);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(
          null,
          ['  PID  Name', '-----  ----', '  2695  HyperCeiler', '  31000  systemui'].join('\r\n'),
          '',
        );
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleFridaListProcesses({
        device: 'remote',
        host: '192.168.1.11:27042',
      });
      const body = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );

      expect(body.success).toBe(true);
      expect(body.processes).toEqual([
        { pid: 2695, name: 'HyperCeiler' },
        { pid: 31000, name: 'systemui' },
      ]);
      const args = (vi.mocked(childProcess.execFile).mock.calls.at(-1)?.[1] ?? []) as string[];
      expect(args.slice(0, 2)).toEqual(['-H', '192.168.1.11:27042']);
    });

    it('handleFridaDexDump device matrix: default keeps -U, device wins, usb:false is local', async () => {
      vi.mocked(probeCommand).mockResolvedValue({
        available: true,
        path: 'frida-dexdump',
        version: '1.0.0',
        reason: undefined,
      } as Awaited<ReturnType<typeof probeCommand>>);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, 'no artifacts', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const lastArgs = async (): Promise<string[]> =>
        (vi.mocked(childProcess.execFile).mock.calls.at(-1)?.[1] ?? []) as string[];

      // Default (usb boolean omitted → true): back-compat -U.
      await handlers.handleFridaDexDump({
        outputDir: join(tmpdir(), `jshook-dx-a-${Date.now()}`),
        target: 'com.example.app',
      });
      expect((await lastArgs())[0]).toBe('-U');

      // Explicit device wins over the legacy usb boolean.
      await handlers.handleFridaDexDump({
        outputDir: join(tmpdir(), `jshook-dx-b-${Date.now()}`),
        pid: 2695,
        device: 'remote',
        host: '192.168.1.11:27042',
        usb: true,
      });
      expect((await lastArgs()).slice(0, 4)).toEqual(['-H', '192.168.1.11:27042', '-p', '2695']);
      expect(await lastArgs()).not.toContain('-U');

      // usb:false without a device → local, no device flag at all.
      await handlers.handleFridaDexDump({
        outputDir: join(tmpdir(), `jshook-dx-c-${Date.now()}`),
        pid: 2695,
        usb: false,
      });
      expect((await lastArgs())[0]).not.toBe('-U');
      expect((await lastArgs())[0]).toBe('-p');
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
        moduleName: 'kernel32.dll',
        argSpec: [{ index: 0, name: 'path', type: 'pointer' }],
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.script).toContain('CreateFileW');
      expect(parsed.script).toContain('Interceptor.attach');
      expect(parsed.script).toContain('Module.findExportByName("kernel32.dll", "CreateFileW")');
      expect(parsed.script).toContain('__jshookReadArg(args, 0, "pointer")');
    });

    it('handleFridaAttachInterceptor generates a parameter-aware Interceptor.attach script', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaAttachInterceptor({
        moduleName: 'libc.so',
        symbol: 'malloc',
        argSpec: [{ index: 0, name: 'size', type: 'uint' }],
        onLeaveBody: 'console.log("retval=" + retval);',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed).toMatchObject({
        success: true,
        installed: false,
        moduleName: 'libc.so',
        symbol: 'malloc',
      });
      expect(parsed.script).toContain('Interceptor.attach');
      expect(parsed.script).toContain('Module.findExportByName("libc.so", "malloc")');
      expect(parsed.script).toContain('__jshookReadArg(args, 0, "uint")');
      expect(parsed.script).toContain('console.log("retval=" + retval);');
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

      const handlers = createHandlers(
        new StubGhidraAnalyzer({ available: false, reason: 'mock unavailable' }),
      );
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

    it('handleGhidraAnalyze delegates to the local Ghidra analyzer when available', async () => {
      const binaryPath = join(
        tmpdir(),
        `jshook-ghidra-ok-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`,
      );
      await fsPromises.writeFile(binaryPath, Buffer.from('mock-binary-content'));

      const ghidra = new StubGhidraAnalyzer({
        available: true,
        analysis: {
          functions: [
            {
              name: 'main',
              address: '0x1000',
              signature: 'int main(void)',
              decompiled: 'return 0;',
            },
          ],
          imports: ['KERNEL32.dll'],
          exports: ['main'],
          strings: ['mock-binary-content'],
        },
      });
      const handlers = createHandlers(ghidra);

      try {
        const result = await handlers.handleGhidraAnalyze({ binaryPath, timeout: 1234 });
        expect(result).toMatchObject({
          available: true,
          binaryPath,
          analysis: {
            functions: [{ name: 'main', address: '0x1000' }],
            imports: ['KERNEL32.dll'],
          },
        });
        expect(ghidra.analyzeCalls).toEqual([{ binaryPath, options: { timeout: 1234 } }]);
      } finally {
        await fsPromises.rm(binaryPath, { force: true });
      }
    });

    it('handleGhidraDecompile reports the headless capability when Ghidra is unavailable', async () => {
      const ghidra = new StubGhidraAnalyzer({ available: false, reason: 'not on PATH' });
      const handlers = createHandlers(ghidra);

      const result = (await handlers.handleGhidraDecompile({
        binaryPath: 'D:/bin/target.exe',
        functionName: 'main',
      })) as Record<string, unknown>;

      expect(result.available).toBe(false);
      expect(result.capability).toBe('ghidra_headless');
      expect(result.fix).toContain('Install Ghidra');
      expect(ghidra.decompileCalls).toEqual([]);
    });

    it('handleGhidraDecompile returns found:false with an actionable hint on name miss', async () => {
      const ghidra = new StubGhidraAnalyzer({
        available: true,
        decompile: { found: false, functions: [], rawOutput: 'some ghidra noise' },
      });
      const handlers = createHandlers(ghidra);

      const result = (await handlers.handleGhidraDecompile({
        binaryPath: 'D:/bin/target.exe',
        functionName: 'definitely_missing',
      })) as Record<string, unknown>;

      expect(result.found).toBe(false);
      expect(String(result.reason)).toContain('definitely_missing');
      expect(String(result.reason)).toContain('ghidra_analyze');
      expect(result.ghidraOutputTail).toBe('some ghidra noise');
    });

    it('handleGhidraDecompile delegates to the stateless headless analyzer with timeout passthrough', async () => {
      const functions = [
        {
          name: 'main',
          address: '0x401000',
          signature: 'int main(void)',
          decompiled: 'int main() {}',
        },
      ] as unknown as [];
      const ghidra = new StubGhidraAnalyzer({
        available: true,
        decompile: { found: true, functions },
      });
      const handlers = createHandlers(ghidra);

      const result = (await handlers.handleGhidraDecompile({
        binaryPath: 'D:/bin/target.exe',
        functionName: 'main',
        timeout: 600_000,
      })) as Record<string, unknown>;

      expect(result.available).toBe(true);
      expect(result.found).toBe(true);
      expect(result.count).toBe(1);
      expect(result.functions).toEqual(functions);
      expect(ghidra.decompileCalls).toEqual([
        { binaryPath: 'D:/bin/target.exe', functionName: 'main', options: { timeout: 600_000 } },
      ]);
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

    it('handleApktoolBuild runs apktool b with source/output/force flags', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'apktool',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const execCalls: string[][] = [];
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        if (args) execCalls.push([...args]);
        cb?.(null, 'built', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleApktoolBuild({
        sourceDir: '/tmp/src',
        outputPath: '/tmp/out.apk',
        force: true,
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.sourceDir).toBe('/tmp/src');
      expect(parsed.outputPath).toBe('/tmp/out.apk');
      expect(execCalls[0]).toEqual(['b', '/tmp/src', '-o', '/tmp/out.apk', '-f']);
    });

    it('handleApktoolBuild reports unavailable when apktool missing', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: false,
        reason: 'apktool not found',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const handlers = createHandlers();
      const result = await handlers.handleApktoolBuild({ sourceDir: '/tmp/src' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(false);
      expect(parsed.capability).toBe('apktool_cli');
    });

    it('handleApktoolSign honestly refuses without a keystore', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'apksigner',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const handlers = createHandlers();
      const result = await handlers.handleApktoolSign({ apkPath: '/tmp/app.apk' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.signed).toBe(false);
      expect(parsed.fix).toContain('keystore');
    });

    it('handleApktoolSign signs with apksigner when keystore provided', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'apksigner',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const execCalls: string[][] = [];
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        if (args) execCalls.push([...args]);
        cb?.(null, 'signed', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const result = await handlers.handleApktoolSign({
        apkPath: '/tmp/app.apk',
        keystore: '/tmp/debug.keystore',
        keystorePassword: 'android',
        keyAlias: 'androiddebugkey',
        outputPath: '/tmp/signed.apk',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.available).toBe(true);
      expect(parsed.signed).toBe(true);
      expect(parsed.outputPath).toBe('/tmp/signed.apk');
      expect(execCalls[0]).toEqual([
        'sign',
        '--ks',
        '/tmp/debug.keystore',
        '--ks-pass',
        'pass:android',
        '--ks-key-alias',
        'androiddebugkey',
        '--out',
        '/tmp/signed.apk',
        '/tmp/app.apk',
      ]);
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

    it('handleApkManifestDump returns base64 when manifest body is binary AXML', async () => {
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

    it.skip('handleApkManifestDump decodes binary AXML via JADX when available', async () => {
      const binaryManifest = Buffer.from([0x03, 0x00, 0x08, 0x00, 0x24, 0x00, 0x00, 0x00]);
      mockZipEntries([{ fileName: 'AndroidManifest.xml', content: binaryManifest }]);

      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'jadx',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const tempRoot = join(
        tmpdir(),
        `jadx-manifest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      const resourcesDir = join(tempRoot, 'resources');
      mkdirSync(resourcesDir, { recursive: true });
      await fsPromises.writeFile(
        join(resourcesDir, 'AndroidManifest.xml'),
        '<?xml version="1.0" encoding="utf-8"?><manifest package="com.example.decoded" />',
      );

      const mkdtempSpy = vi.spyOn(fsPromises, 'mkdtemp').mockResolvedValueOnce(tempRoot);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, '', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      try {
        const result = await handlers.handleApkManifestDump({ apkPath: '/tmp/app.apk' });
        const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
        const parsed = JSON.parse(text);
        expect(parsed.available).toBe(true);
        expect(parsed.format).toBe('xml');
        expect(parsed.decodedBy).toBe('jadx_cli');
        expect(parsed.manifest).toContain('com.example.decoded');
      } finally {
        mkdtempSpy.mockRestore();
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
      }
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

    it('handleApkDexIntake returns a cohesive APK/DEX evidence packet', async () => {
      mockZipEntries([
        {
          fileName: 'AndroidManifest.xml',
          content:
            '<manifest package="com.example.app">' +
            '<uses-sdk android:minSdkVersion="23" android:targetSdkVersion="35"/>' +
            '<uses-permission android:name="android.permission.INTERNET"/>' +
            '<application android:name=".App" android:debuggable="false">' +
            '<activity android:name=".MainActivity">' +
            '<intent-filter><action android:name="android.intent.action.MAIN"/>' +
            '<category android:name="android.intent.category.LAUNCHER"/></intent-filter>' +
            '</activity></application></manifest>',
        },
        { fileName: 'classes.dex', content: metadataDexBuffer() },
        { fileName: 'classes2.cdex', content: Buffer.from('cdex001\0blob', 'ascii') },
        { fileName: 'lib/arm64-v8a/libloader.so' },
        { fileName: 'lib/armeabi-v7a/libfoo.so' },
        { fileName: 'assets/blob.dat' },
      ]);

      const handlers = createHandlers();
      const result = await handlers.handleApkDexIntake({
        apkPath: '/tmp/app.apk',
        maxEntries: 10,
        customSurfaceHints: [
          {
            name: 'caller-supplied-surface',
            kind: 'sdk',
            patterns: ['assets/blob.dat'],
          },
        ],
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.artifact.kind).toBe('apk-dex-intake');
      expect(parsed.artifact.manifest.summary.packageName).toBe('com.example.app');
      expect(parsed.artifact.manifest.summary.launcherActivity).toBe('.MainActivity');
      expect(parsed.artifact.dex.files).toMatchObject([
        {
          path: 'classes.dex',
          kind: 'dex',
          header: { version: '035', fileSize: 0x180, stringIdsSize: 3, classDefsSize: 1 },
          stringsPreview: ['Lx/A;', 'value', 'unused'],
          typeDescriptorsPreview: ['Lx/A;'],
          classDefsPreview: [{ classType: 'Lx/A;' }],
        },
        { path: 'classes2.cdex', kind: 'cdex' },
      ]);
      expect(parsed.artifact.nativeLibs.abis).toEqual(['arm64-v8a', 'armeabi-v7a']);
      expect(parsed.artifact.protectorHints).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'native-loader-surface' })]),
      );
      expect(parsed.artifact.sdkHints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'caller-supplied-surface',
            evidence: ['assets/blob.dat'],
          }),
        ]),
      );
      for (const hint of [...parsed.artifact.protectorHints, ...parsed.artifact.sdkHints] as Array<{
        name: string;
      }>) {
        expect(hint.name).toMatch(/^[a-z0-9-]+-surface$|^[a-z0-9-]+-container$/);
      }
      expect(parsed.artifact.recommendedNextSteps).toEqual(
        expect.arrayContaining([expect.stringContaining('runtime dumping')]),
      );
    });

    it('handleApkDexIntake caps DEX bytes and marks partial summaries', async () => {
      const largeDex = Buffer.concat([metadataDexBuffer(), Buffer.alloc(1024, 0x41)]);
      mockZipEntries([
        { fileName: 'AndroidManifest.xml', content: '<manifest package="com.example.app"/>' },
        { fileName: 'classes.dex', content: largeDex },
      ]);

      const handlers = createHandlers();
      const result = await handlers.handleApkDexIntake({
        apkPath: '/tmp/app.apk',
        maxDexBytes: 128,
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.artifact.dex.files).toMatchObject([
        {
          path: 'classes.dex',
          kind: 'dex',
          size: 128,
          sourceSize: largeDex.length,
          truncated: true,
          header: { fileSize: 0x180 },
        },
      ]);
    });

    it('handleFridaDexDump does not report success when no DEX artifacts are produced', async () => {
      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'frida-dexdump',
        version: '1.0.0',
        reason: undefined,
      } as Awaited<ReturnType<typeof probeCommand>>);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, 'finished without files', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      const response = await handlers.handleFridaDexDump({
        outputDir: join(tmpdir(), `jshook-empty-frida-dump-${Date.now()}`),
        target: 'com.example.app',
      });
      const body = JSON.parse(
        (response as { content: Array<{ text: string }> }).content[0]?.text ?? '{}',
      );

      expect(body).toMatchObject({
        available: true,
        success: false,
        count: 0,
        reason: expect.stringContaining('No DEX/CDEX artifacts'),
      });
    });

    it.skip('handleJadxDecompile resolves a uniquely matched class when requested package is wrong', async () => {
      const tempRoot = join(
        tmpdir(),
        `jadx-class-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      const classDir = join(tempRoot, 'sources', 'com', 'example', 'flutter3_frame');
      mkdirSync(classDir, { recursive: true });
      await fsPromises.writeFile(
        join(classDir, 'MainActivity.java'),
        'package com.example.flutter3_frame;\npublic class MainActivity {\n  public void test() {}\n}\n',
      );

      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'jadx',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const mkdtempSpy = vi.spyOn(fsPromises, 'mkdtemp').mockResolvedValueOnce(tempRoot);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, '', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      try {
        const result = await handlers.handleJadxDecompile({
          apkPath: '/tmp/app.apk',
          className: 'com.tangxin.MainActivity',
        });

        const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
        const parsed = JSON.parse(text);
        expect(parsed.available).toBe(true);
        expect(parsed.resolvedClassName).toBe('com.example.flutter3_frame.MainActivity');
        expect(parsed.source).toContain('class MainActivity');
      } finally {
        mkdtempSpy.mockRestore();
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
      }
    });

    it.skip('handleJadxDecompile returns suggestions when multiple class matches exist', async () => {
      const tempRoot = join(
        tmpdir(),
        `jadx-multi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      const firstDir = join(tempRoot, 'sources', 'com', 'example', 'first');
      const secondDir = join(tempRoot, 'sources', 'org', 'demo', 'second');
      mkdirSync(firstDir, { recursive: true });
      mkdirSync(secondDir, { recursive: true });
      await fsPromises.writeFile(
        join(firstDir, 'MainActivity.java'),
        'package com.example.first;\npublic class MainActivity {}\n',
      );
      await fsPromises.writeFile(
        join(secondDir, 'MainActivity.java'),
        'package org.demo.second;\npublic class MainActivity {}\n',
      );

      vi.mocked(probeCommand).mockResolvedValueOnce({
        available: true,
        path: 'jadx',
      } as Awaited<ReturnType<typeof probeCommand>>);

      const mkdtempSpy = vi.spyOn(fsPromises, 'mkdtemp').mockResolvedValueOnce(tempRoot);
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, '', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      const handlers = createHandlers();
      try {
        const result = await handlers.handleJadxDecompile({
          apkPath: '/tmp/app.apk',
          className: 'wrong.package.MainActivity',
        });

        const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
        const parsed = JSON.parse(text);
        expect(parsed.available).toBe(true);
        expect(parsed.error).toContain('Class file not found');
        expect(parsed.suggestions).toEqual([
          'com.example.first.MainActivity',
          'org.demo.second.MainActivity',
        ]);
      } finally {
        mkdtempSpy.mockRestore();
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
      }
    });
  });

  describe('Unidbg handlers', () => {
    it('handleUnidbgEmulate parses return values from subprocess stdout', async () => {
      const originalUnidbgJar = process.env['UNIDBG_JAR'];
      const jarPath = join(
        tmpdir(),
        `jshook-unidbg-${Date.now()}-${Math.random().toString(16).slice(2)}.jar`,
      );
      await fsPromises.writeFile(jarPath, 'jar');
      process.env['UNIDBG_JAR'] = jarPath;

      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null, stdout: string, stderr: string) => void) | null,
      ) => {
        cb?.(null, 'booted\nreturn=0x2a\n', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile);

      try {
        const handlers = createHandlers();
        const result = (await handlers.handleUnidbgEmulate({
          binaryPath: '/tmp/libtarget.so',
          functionName: 'JNI_OnLoad',
          args: ['env'],
        })) as { result?: { returnValue?: string; stdout?: string } };

        expect(result.result?.returnValue).toBe('0x2a');
        expect(result.result?.stdout).toContain('return=0x2a');
      } finally {
        if (originalUnidbgJar === undefined) {
          delete process.env['UNIDBG_JAR'];
        } else {
          process.env['UNIDBG_JAR'] = originalUnidbgJar;
        }
        await fsPromises.rm(jarPath, { force: true });
      }
    });

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

class StubGhidraAnalyzer extends GhidraAnalyzer {
  private readonly stub: {
    available: boolean;
    reason?: string;
    analysis?: Awaited<ReturnType<GhidraAnalyzer['analyze']>>;
    decompile?: { found: boolean; functions: []; rawOutput?: string };
  };
  analyzeCalls: Array<{ binaryPath: string; options: { timeout?: number } | undefined }> = [];
  decompileCalls: Array<{
    binaryPath: string;
    functionName: string;
    options: { timeout?: number } | undefined;
  }> = [];

  constructor(stub: {
    available: boolean;
    reason?: string;
    analysis?: Awaited<ReturnType<GhidraAnalyzer['analyze']>>;
    decompile?: { found: boolean; functions: []; rawOutput?: string };
  }) {
    super({ discoveryPaths: [] });
    this.stub = stub;
  }

  override async getAvailability() {
    return this.stub.available
      ? { available: true, path: 'mock-analyzeHeadless', version: 'mock' }
      : { available: false, reason: this.stub.reason ?? 'mock unavailable' };
  }

  override async decompileFunction(
    binaryPath: string,
    functionName: string,
    options?: { timeout?: number },
  ) {
    this.decompileCalls.push({ binaryPath, functionName, options });
    return this.stub.decompile ?? { found: true, functions: [], rawOutput: undefined };
  }

  override async analyze(binaryPath: string, options?: { timeout?: number }) {
    this.analyzeCalls.push({ binaryPath, options });
    return (
      this.stub.analysis ?? {
        functions: [],
        imports: [],
        exports: [],
        strings: [],
      }
    );
  }
}

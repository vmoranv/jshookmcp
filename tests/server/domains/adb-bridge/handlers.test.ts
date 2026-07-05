import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers.impl';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
import { probeCommand } from '@modules/external/ToolProbe';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

function mockExecFile(responses: Array<{ stdout?: string; stderr?: string; error?: Error }>) {
  let callIndex = 0;
  (execFile as any).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const resp = responses[callIndex++];
      if (!resp) {
        cb(new Error('unexpected execFile call'));
        return;
      }
      if (_args.includes('pull')) {
        const dest = _args[_args.length - 1];
        if (typeof dest === 'string' && dest.endsWith('.apk')) {
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
        }
      }
      if (resp.error) cb(resp.error);
      else cb(null, resp.stdout ?? '', resp.stderr ?? '');
    },
  );
}

function parseResult(result: unknown) {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0]?.text ?? '{}');
}

describe('ADBBridgeHandlers', () => {
  let handlers: ADBBridgeHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ADBBridgeHandlers();
    (probeCommand as any).mockResolvedValue({
      available: true,
      path: 'adb',
    });
  });

  it('lists devices from adb devices -l output', async () => {
    mockExecFile([
      {
        stdout: [
          'List of devices attached',
          'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a',
          '',
        ].join('\n'),
      },
    ]);

    const result = await handlers.handleDeviceList({});
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.devices[0].serial).toBe('emulator-5554');
    expect(parsed.devices[0].state).toBe('device');
  });

  it('keeps wrapper responses un-nested for successful device listing', async () => {
    mockExecFile([
      {
        stdout: [
          'List of devices attached',
          'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a',
          '',
        ].join('\n'),
      },
    ]);

    const result = await handlers.handleDeviceListTool({});
    const parsed = ResponseBuilder.parse<Record<string, unknown>>(result);
    expect(parsed).toMatchObject({ success: true, count: 1 });
    expect(parsed.content).toBeUndefined();
  });

  it('runs shell command and returns output', async () => {
    mockExecFile([{ stdout: 'Linux version 5.10' }]);

    const result = await handlers.handleShell({
      serial: 'emulator-5554',
      command: 'uname -a',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toContain('Linux');
  });

  it('pulls APK from device', async () => {
    mockExecFile([
      {
        stdout:
          'package:/data/app/~~hash==/com.example.app-AbC==/base.apk\n' +
          'package:/data/app/~~hash==/com.example.app-AbC==/split_config.arm64_v8a.apk\n',
      },
      { stdout: 'pulled successfully' },
    ]);

    const result = await handlers.handleApkPull({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
      outputPath: '/tmp',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.packageName).toBe('com.example.app');
    expect(parsed.localPath).toContain('com.example.app.apk');
    expect(parsed.remotePath).toContain('~~hash==');
    expect(parsed.files[0].zipLike).toBe(true);
  });

  it('analyzes apk metadata from dumpsys output', async () => {
    mockExecFile([
      {
        stdout: [
          'versionName=1.0.0',
          'versionCode=42',
          'minSdk=24',
          'targetSdk=34',
          'requested permissions:',
          '  android.permission.INTERNET granted=true',
        ].join('\n'),
      },
      { stdout: 'com.example.app/.MainActivity' },
    ]);

    const result = await handlers.handleAnalyzeApk({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.versionName).toBe('1.0.0');
    expect(parsed.versionCode).toBe('42');
  });

  it('pulls native libraries from package native library directories', async () => {
    mockExecFile([
      {
        stdout: [
          'nativeLibraryDir=/data/app/~~hash/com.example.app-abc/lib/arm64',
          'secondaryNativeLibraryDir=/data/app/~~hash/com.example.app-abc/lib/armeabi-v7a',
        ].join('\n'),
      },
      { stdout: 'pulled arm64' },
      { stdout: 'pulled armeabi-v7a' },
    ]);

    const result = await handlers.handlePullNativeLibs({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
      outputPath: '/tmp',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(2);
    expect(parsed.libraries[0].remoteDir).toContain('com.example.app');
  });

  it('throws prerequisite error when adb not found', async () => {
    (probeCommand as any).mockResolvedValueOnce({
      available: false,
      reason: 'adb not found in PATH',
    });

    await expect(handlers.handleDeviceList({})).rejects.toThrow('adb not found');
  });

  it('turns wrapper prerequisite failures into structured tool responses', async () => {
    (probeCommand as any).mockResolvedValueOnce({
      available: false,
      reason: 'adb not found in PATH',
    });

    const result = await handlers.handleDeviceListTool({});
    const parsed = ResponseBuilder.parse<Record<string, unknown>>(result);
    expect(parsed).toMatchObject({
      success: false,
      error: 'adb not found in PATH',
      message: 'adb not found in PATH',
    });
    expect(result.isError).toBeUndefined();
  });
});

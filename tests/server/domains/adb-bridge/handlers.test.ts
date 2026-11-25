import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers.impl';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
import { probeCommand } from '@modules/external/ToolProbe';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

function mockExecFile(
  responses: Array<{ stdout?: string | Buffer; stderr?: string; error?: Error }>,
) {
  let callIndex = 0;
  (execFile as any).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const resp = responses[callIndex++];
      if (!resp) {
        cb(new Error('unexpected execFile call'));
        return;
      }
      if (resp.error) {
        // A failed pull/timeout never delivers the file.
        cb(resp.error);
        return;
      }
      if (_args.includes('pull')) {
        const dest = _args[_args.length - 1];
        if (typeof dest === 'string' && dest.endsWith('.apk')) {
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
        } else if (typeof dest === 'string' && dest.endsWith('.mp4')) {
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
        } else if (typeof dest === 'string' && dest.endsWith('.xml')) {
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, '<hierarchy><node/><node/></hierarchy>');
        }
      }
      cb(null, resp.stdout ?? '', resp.stderr ?? '');
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

  it('emits adb:device_connected for attached devices and skips offline ones', async () => {
    mockExecFile([
      {
        stdout: [
          'List of devices attached',
          'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a',
          'R58M12345XY            offline',
          '',
        ].join('\n'),
      },
    ]);

    const emit = vi.fn();
    handlers.setEventBus({ emit } as never);

    await handlers.handleDeviceList({});

    // The activation layer boosts this domain off `adb:device_connected`, and
    // nothing else emits it. A subscription-only test cannot detect a missing
    // emitter — which is exactly how this event went unemitted, leaving the
    // boost rule inert, without a single test failing.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toBe('adb:device_connected');
    expect(emit.mock.calls[0]![1]).toMatchObject({
      serial: 'emulator-5554',
      model: 'sdk_gphone64_arm64',
    });
  });

  it('falls back to the serial as model when adb reports none', async () => {
    mockExecFile([
      {
        stdout: ['List of devices attached', 'R58M12345XY            device', ''].join('\n'),
      },
    ]);

    const emit = vi.fn();
    handlers.setEventBus({ emit } as never);

    await handlers.handleDeviceList({});

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1]).toMatchObject({
      serial: 'R58M12345XY',
      model: 'R58M12345XY',
    });
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

  it('installs a single APK with reinstall and test-only flags', async () => {
    mockExecFile([{ stdout: 'Success\n' }]);

    const result = await handlers.handleInstall({
      serial: 'emulator-5554',
      apkPath: '/tmp/app.apk',
      grantPermissions: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.apkPaths).toEqual(['/tmp/app.apk']);
    expect((execFile as any).mock.calls[0][1]).toEqual(
      expect.arrayContaining(['-s', 'emulator-5554', 'install', '-r', '-g', '-t', '/tmp/app.apk']),
    );
  });

  it('uninstalls a package while keeping data when requested', async () => {
    mockExecFile([{ stdout: 'Success\n' }]);

    const result = await handlers.handleUninstall({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
      keepData: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.keepData).toBe(true);
    expect((execFile as any).mock.calls[0][1]).toEqual(
      expect.arrayContaining(['uninstall', '-k', 'com.example.app']),
    );
  });

  it('sends input tap and encoded text events', async () => {
    mockExecFile([{ stdout: '' }, { stdout: '' }]);

    const tap = parseResult(
      await handlers.handleInputTap({
        serial: 'emulator-5554',
        x: 120,
        y: 340,
      }),
    );
    const text = parseResult(
      await handlers.handleInputText({
        serial: 'emulator-5554',
        text: 'hello world',
      }),
    );

    expect(tap.success).toBe(true);
    expect(text.encodedText).toBe('hello%sworld');
    expect((execFile as any).mock.calls[0][1]).toEqual(
      expect.arrayContaining(['shell', 'input', 'tap', '120', '340']),
    );
    expect((execFile as any).mock.calls[1][1]).toEqual(
      expect.arrayContaining(['shell', 'input', 'text', 'hello%sworld']),
    );
  });

  it('reads and parses proc maps after resolving a package pid', async () => {
    mockExecFile([
      { stdout: '4321\n' },
      {
        stdout: [
          '70000000-70012000 r-xp 00000000 fd:01 7 /data/app/lib/arm64/libfoo.so',
          '71000000-71001000 r--p 00000000 fd:01 8 /data/app/base.apk',
        ].join('\n'),
      },
    ]);

    const result = await handlers.handleProcMaps({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.pid).toBe('4321');
    expect(parsed.count).toBe(2);
    expect(parsed.modules[0]).toMatchObject({
      start: '0x70000000',
      end: '0x70012000',
      perms: 'r-xp',
      pathname: '/data/app/lib/arm64/libfoo.so',
    });
  });

  it('reports structured root indicators', async () => {
    mockExecFile([
      { stdout: '/system/xbin/su\n' },
      { stdout: 'package:com.topjohnwu.magisk\n' },
      { stdout: 'release-keys\n' },
      { stdout: 'Enforcing\n' },
      { stdout: 'uid=2000(shell) gid=2000(shell)\n' },
    ]);

    const result = await handlers.handleRootCheck({ serial: 'emulator-5554' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.rooted).toBe(true);
    expect(parsed.indicators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'su-binary' }),
        expect.objectContaining({ name: 'magisk-package' }),
      ]),
    );
  });

  it('captures screenshots through exec-out screencap', async () => {
    const outputPath = join(tmpdir(), `jshook-adb-test-${Date.now()}.png`);
    mockExecFile([{ stdout: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]);

    try {
      const result = await handlers.handleScreenshot({
        serial: 'emulator-5554',
        localPath: outputPath,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.size).toBe(4);
      expect((execFile as any).mock.calls[0][1]).toEqual(
        expect.arrayContaining(['exec-out', 'screencap', '-p']),
      );
    } finally {
      rmSync(outputPath, { force: true });
    }
  });

  it('records a short screen capture and pulls the MP4 locally', async () => {
    const outputPath = join(tmpdir(), `jshook-adb-test-${Date.now()}.mp4`);
    mockExecFile([{ stdout: '' }, { stdout: 'pulled' }, { stdout: '' }]);

    try {
      const result = await handlers.handleScreenrecord({
        serial: 'emulator-5554',
        localPath: outputPath,
        remotePath: '/sdcard/Download/test-record.mp4',
        durationSec: 2,
        bitRateMbps: 3,
        size: '1280x720',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.size).toBe(8);
      expect(parsed.durationSec).toBe(2);
      expect((execFile as any).mock.calls[0][1]).toEqual([
        '-s',
        'emulator-5554',
        'shell',
        'screenrecord',
        '--time-limit',
        '2',
        '--bit-rate',
        '3000000',
        '--size',
        '1280x720',
        '/sdcard/Download/test-record.mp4',
      ]);
      expect((execFile as any).mock.calls[1][1]).toEqual([
        '-s',
        'emulator-5554',
        'pull',
        '/sdcard/Download/test-record.mp4',
        outputPath,
      ]);
      expect((execFile as any).mock.calls[2][1]).toEqual([
        '-s',
        'emulator-5554',
        'shell',
        'rm',
        '-f',
        '/sdcard/Download/test-record.mp4',
      ]);
    } finally {
      rmSync(outputPath, { force: true });
    }
  });

  it('cleans up the remote recording even when the pull fails', async () => {
    const outputPath = join(tmpdir(), `jshook-adb-test-${Date.now()}-fail.mp4`);
    // Pull "fails" with a timeout-style error: the file never lands locally,
    // so the subsequent stat() throws — the rm -f cleanup must still run.
    mockExecFile([{ stdout: '' }, { error: new Error('pull timeout') }, { stdout: '' }]);

    try {
      const result = await handlers.handleScreenrecordTool({
        serial: 'emulator-5554',
        localPath: outputPath,
        remotePath: '/sdcard/Download/test-record.mp4',
        durationSec: 2,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
    } finally {
      rmSync(outputPath, { force: true });
    }

    const calls = (execFile as any).mock.calls as Array<Array<unknown>>;
    const rmCall = calls.find((call) => {
      const args = call[1] as string[];
      return args.includes('rm') && args.includes('-f');
    });
    // The remote temp file must be removed even on the failure path.
    expect(rmCall).toBeDefined();
    expect((rmCall![1] as string[]).at(-1)).toBe('/sdcard/Download/test-record.mp4');
  });

  it('reuses the generated UI dump path for pull, read, and response', async () => {
    mockExecFile([
      { stdout: 'UI hierarchy dumped to: /sdcard/window_dump.xml\n' },
      { stdout: '', stderr: '1 file pulled\n' },
      { stdout: '' },
    ]);

    const result = await handlers.handleUiDumpTool({
      serial: 'emulator-5554',
      includeRawXml: true,
    });
    const parsed = parseResult(result);
    const pullArgs = (execFile as any).mock.calls[1][1] as string[];
    const generatedPath = pullArgs.at(-1)!;

    try {
      expect(parsed.success).toBe(true);
      expect(parsed.localPath).toBe(generatedPath);
      expect(parsed.elementCount).toBe(2);
      expect(parsed.rawXml).toBe('<hierarchy><node/><node/></hierarchy>');
      expect(generatedPath).toMatch(/ui_dump_emulator-5554_\d+\.xml$/);
    } finally {
      rmSync(generatedPath, { force: true });
    }
  });

  it('adds an adb forward port mapping', async () => {
    mockExecFile([{ stdout: '' }]);

    const result = await handlers.handlePortForward({
      serial: 'emulator-5554',
      action: 'add',
      direction: 'forward',
      local: 'tcp:9222',
      remote: 'localabstract:webview_devtools_remote_123',
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.direction).toBe('forward');
    expect((execFile as any).mock.calls[0][1]).toEqual([
      '-s',
      'emulator-5554',
      'forward',
      'tcp:9222',
      'localabstract:webview_devtools_remote_123',
    ]);
  });

  it('rejects port mapping requests without an action before resolving adb', async () => {
    const result = await handlers.handlePortForwardTool({
      serial: 'emulator-5554',
      direction: 'forward',
    });
    const parsed = ResponseBuilder.parse<Record<string, unknown>>(result);

    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain('Missing required port mapping action');
    expect(probeCommand).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects port mapping requests without a direction before resolving adb', async () => {
    const result = await handlers.handlePortForwardTool({
      serial: 'emulator-5554',
      action: 'list',
    });
    const parsed = ResponseBuilder.parse<Record<string, unknown>>(result);

    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain('Missing required port mapping direction');
    expect(probeCommand).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('lists adb reverse mappings with normalized local and remote endpoints', async () => {
    mockExecFile([{ stdout: 'emulator-5554 tcp:9000 tcp:7000\n' }]);

    const result = await handlers.handlePortForward({
      serial: 'emulator-5554',
      action: 'list',
      direction: 'reverse',
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.mappings[0]).toEqual({
      serial: 'emulator-5554',
      remote: 'tcp:9000',
      local: 'tcp:7000',
    });
    expect((execFile as any).mock.calls[0][1]).toEqual([
      '-s',
      'emulator-5554',
      'reverse',
      '--list',
    ]);
  });

  it('removes an adb reverse mapping by remote endpoint', async () => {
    mockExecFile([{ stdout: '' }]);

    const result = await handlers.handlePortForward({
      serial: 'emulator-5554',
      action: 'remove',
      direction: 'reverse',
      remote: 'tcp:9000',
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.remote).toBe('tcp:9000');
    expect((execFile as any).mock.calls[0][1]).toEqual([
      '-s',
      'emulator-5554',
      'reverse',
      '--remove',
      'tcp:9000',
    ]);
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
      outputPath: join(tmpdir(), 'jshook-adb-output-test'),
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.packageName).toBe('com.example.app');
    expect(parsed.localPath).toContain('com.example.app.apk');
    expect(parsed.remotePath).toContain('~~hash==');
    expect(parsed.files[0].zipLike).toBe(true);
  });

  it('rejects packageName path traversal before invoking adb', async () => {
    mockExecFile([]);

    const result = await handlers.handleApkPull({
      serial: 'emulator-5554',
      packageName: '../../../../tmp/jshook-victim; pm path com.example.app',
      outputPath: join(tmpdir(), 'jshook-adb-output-test'),
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(String(parsed.error)).toContain('valid Android package name');
    expect(execFile).not.toHaveBeenCalled();
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
      outputPath: join(tmpdir(), 'jshook-adb-output-test'),
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(2);
    expect(parsed.libraries[0].remoteDir).toContain('com.example.app');
  });

  it('rejects packageName path traversal for native library pulls', async () => {
    mockExecFile([]);

    const result = await handlers.handlePullNativeLibs({
      serial: 'emulator-5554',
      packageName: 'com.example.app/../../evil',
      outputPath: join(tmpdir(), 'jshook-adb-output-test'),
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(String(parsed.error)).toContain('valid Android package name');
    expect(execFile).not.toHaveBeenCalled();
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
    // SEP-1303: the model must see the failure to self-correct.
    expect(result.isError).toBe(true);
  });
});

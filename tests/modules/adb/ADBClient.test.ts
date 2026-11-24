import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ADBClient } from '@modules/adb/ADBClient';
import { ToolError } from '@errors/ToolError';
import {
  ADB_DEFAULT_TIMEOUT_MS,
  ADB_FILE_TRANSFER_TIMEOUT_MS,
  ADB_MAX_BUFFER_BYTES,
  ADB_SHELL_TIMEOUT_MS,
} from '@src/constants';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, _options, callback) => {
    callback(null, { stdout: 'mock_stdout', stderr: 'mock_stderr' });
  }),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

describe('ADBClient', () => {
  let client: ADBClient;
  let originalAdbPath: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // ADBClient resolves its binary via readEnvString('ADB_PATH', 'adb', ...),
    // so an ADB_PATH set in the host environment (e.g. a local Android SDK
    // install) would silently override the 'adb' command asserted throughout
    // this file. Clear it so these tests observe the documented default
    // regardless of the machine they run on.
    originalAdbPath = process.env.ADB_PATH;
    delete process.env.ADB_PATH;
    client = new ADBClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAdbPath === undefined) {
      delete process.env.ADB_PATH;
    } else {
      process.env.ADB_PATH = originalAdbPath;
    }
  });

  it('connects to host and port', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'connected to 127.0.0.1:5555', stderr: '' });
    });
    await client.connect('127.0.0.1', 5555);
    expect(execFile).toHaveBeenCalled();
  });

  it('throws CONNECTION error when connect fails', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'failed to connect to 127.0.0.1:5555', stderr: '' });
    });
    await expect(client.connect('127.0.0.1', 5555)).rejects.toThrow(ToolError);
  });

  it('throws CONNECTION error for "cannot connect" output and does not record a target', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      // Real `adb connect` failure: exit code 0, reason on stdout.
      cb(null, {
        stdout: 'cannot connect to 127.0.0.1:1: Connection refused\n',
        stderr: '',
      });
    });

    await expect(client.connect('127.0.0.1', 1)).rejects.toThrow(ToolError);

    // `connectedTarget` must stay unset: disconnect() should fall back to the
    // global `adb disconnect` instead of targeting the unreachable host.
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
    await client.disconnect();
    expect(execFile).toHaveBeenLastCalledWith(
      'adb',
      ['disconnect'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('throws CONNECTION error for "error:" output', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'error: no such device', stderr: '' });
    });
    await expect(client.connect('127.0.0.1', 1)).rejects.toThrow(ToolError);
  });

  it('lists devices correctly', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      const stdout = `List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emulator64_x86_64_arm64 transport_id:1
my_device              offline
`;
      cb(null, { stdout, stderr: '' });
    });

    const devices = await client.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'emulator-5554',
      type: 'emulator',
      product: 'sdk_gphone64_x86_64',
      model: 'sdk_gphone64_x86_64',
      transport: '1',
    });
  });

  it('executes shell commands', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'shell output\n', stderr: '' });
    });
    const output = await client.shell('device_id', 'ls');
    expect(output).toBe('shell output');
  });

  it('disconnects', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
    await client.connect('127.0.0.1', 5555); // Sets connectedTarget
    await client.disconnect();
    expect(execFile).toHaveBeenCalledWith(
      'adb',
      ['disconnect', '127.0.0.1:5555'],
      expect.any(Object),
      expect.any(Function),
    );

    await client.disconnect(); // without target
    expect(execFile).toHaveBeenCalledWith(
      'adb',
      ['disconnect'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('installs apk', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'Success', stderr: '' });
    });
    await client.install('device_id', '/fake/path.apk');
    expect(execFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'device_id', 'install', '-r', '/fake/path.apk'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('pushes and pulls files', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'Success', stderr: '' });
    });
    await client.push('device_id', '/local', '/remote');
    await client.pull('device_id', '/remote', '/local');
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('reverses and forwards ports', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'Success', stderr: '' });
    });
    await client.reverse('device_id', 'tcp:8080', 'tcp:8080');
    await client.forward('device_id', 'tcp:8080', 'tcp:8080');
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('removes a single forward with --remove', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    await client.removeForward('c3c3ff6b', 'tcp:12345');

    expect(execFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'c3c3ff6b', 'forward', '--remove', 'tcp:12345'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('rejects an empty forward endpoint', async () => {
    await expect(client.removeForward('device_id', '')).rejects.toThrow(ToolError);
  });

  it('passes ADB_FILE_TRANSFER_TIMEOUT_MS to install/pull/push', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: 'Success', stderr: '' });
    });
    await client.install('device_id', '/fake/path.apk');
    await client.pull('device_id', '/remote', '/local');
    await client.push('device_id', '/local', '/remote');

    const calls = execFile.mock.calls as unknown[][];
    expect(calls).toHaveLength(3);
    for (const [, , options] of calls) {
      expect((options as { timeout: number }).timeout).toBe(ADB_FILE_TRANSFER_TIMEOUT_MS);
    }
  });

  it('uses ADB_SHELL_TIMEOUT_MS for shell and ADB_DEFAULT_TIMEOUT_MS for generic calls', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
    await client.shell('device_id', 'ls');
    await client.listDevices();

    const calls = execFile.mock.calls as unknown[][];
    expect((calls[0]![2] as { timeout: number }).timeout).toBe(ADB_SHELL_TIMEOUT_MS);
    expect((calls[1]![2] as { timeout: number }).timeout).toBe(ADB_DEFAULT_TIMEOUT_MS);
  });

  it('caps exec maxBuffer with ADB_MAX_BUFFER_BYTES', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
    await client.listDevices();
    const [, , options] = execFile.mock.calls[0] as unknown[];
    expect((options as { maxBuffer: number }).maxBuffer).toBe(ADB_MAX_BUFFER_BYTES);
  });

  it('respects ADB_FILE_TRANSFER_TIMEOUT_MS env override', async () => {
    const original = process.env.ADB_FILE_TRANSFER_TIMEOUT_MS;
    process.env.ADB_FILE_TRANSFER_TIMEOUT_MS = '12345';
    // Re-import so the env-backed constant re-evaluates.
    vi.resetModules();
    const { ADBClient: ReloadedADBClient } = await import('@modules/adb/ADBClient');
    const reloadedClient = new ReloadedADBClient();
    try {
      const execFile = await import('node:child_process').then((m) => m.execFile as any);
      execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
        cb(null, { stdout: 'Success', stderr: '' });
      });
      await reloadedClient.install('device_id', '/fake/path.apk');
      const [, , options] = execFile.mock.calls[0] as unknown[];
      expect((options as { timeout: number }).timeout).toBe(12345);
    } finally {
      if (original === undefined) {
        delete process.env.ADB_FILE_TRANSFER_TIMEOUT_MS;
      } else {
        process.env.ADB_FILE_TRANSFER_TIMEOUT_MS = original;
      }
    }
  });

  it('gets webview version', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, args: any, _options: any, cb: any) => {
      if (args.some((arg: string) => arg.includes('getCurrentWebViewPackage'))) {
        cb(null, { stdout: 'Current WebView package (114.0.0.0)', stderr: '' });
      } else {
        cb(new Error('not found'));
      }
    });
    const version = await client.getWebViewVersion('device_id');
    expect(version).toBe('114.0.0.0');
  });

  it('handles errors properly', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb({ code: 'ENOENT', stdout: '', stderr: '' });
    });
    await expect(client.shell('device_id', 'ls')).rejects.toThrow('ADB binary not found');

    execFile.mockImplementation((_cmd: any, _args: any, _options: any, cb: any) => {
      cb({ stdout: '', stderr: 'device offline' });
    });
    await expect(client.shell('device_id', 'ls')).rejects.toThrow('device offline');
  });
});

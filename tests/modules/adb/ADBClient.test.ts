import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADBClient } from '@modules/adb/ADBClient';
import { ToolError } from '@errors/ToolError';

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

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ADBClient();
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

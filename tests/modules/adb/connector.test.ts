import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADB_FILE_TRANSFER_TIMEOUT_MS } from '@src/constants';

/** Helper to create a mock async iterable stream from a string or Buffer. */
function mockStream(data: string | Buffer): AsyncIterable<Buffer> {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

const mocks = vi.hoisted(() => {
  function createEmitter() {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const add = (event: string, cb: (...args: unknown[]) => void) => {
      const bucket = listeners.get(event) ?? [];
      bucket.push(cb);
      listeners.set(event, bucket);
    };
    return {
      pipe: vi.fn(),
      unpipe: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
      on: vi.fn(add),
      once: vi.fn(add),
      emit: (event: string, ...args: unknown[]) => {
        for (const cb of listeners.get(event) ?? []) cb(...args);
      },
      reset: () => listeners.clear(),
    };
  }

  const pullTransfer = createEmitter();
  const writeStream = createEmitter();

  const deviceClient = {
    shell: vi.fn(async () => mockStream('')),
    pull: vi.fn(async () => pullTransfer),
    forward: vi.fn(async () => {}),
    listForwards: vi.fn(async (): Promise<any[]> => []),
    getProperties: vi.fn(async () => ({})),
  };

  const clientInstance = {
    listDevices: vi.fn(async () => [
      { id: 'emulator-5554', type: 'device' },
      { id: 'device-serial-123', type: 'device' },
    ]),
    getDevice: vi.fn(() => deviceClient),
  };

  // Constructor function that returns the same instance
  const ClientCtor = function () {
    return clientInstance;
  };

  // execFile mock: callback-style (Node's child_process.execFile API).
  // ensureAdbAvailable() uses promisify(execFile), so we honour the callback signature.
  const execFileMock = vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, 'Android Debug Bridge version 1.0.41', '');
    },
  );

  return {
    clientInstance,
    deviceClient,
    ClientCtor,
    checkADBBinary: vi.fn(() => true),
    execFileMock,
    pullTransfer,
    writeStream,
    // Expose reset for the internal module cache
    resetClientCache: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execSync: mocks.checkADBBinary,
  execFile: mocks.execFileMock,
  execFileSync: vi.fn(),
}));

vi.mock('@devicefarmer/adbkit', () => {
  return {
    Client: mocks.ClientCtor,
    Adb: mocks.ClientCtor,
  };
});

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(() => mocks.writeStream),
}));

import { ADBConnector, resetAdbAvailabilityCache } from '@modules/adb/ADBConnector';
import type { ADBDevice } from '@modules/adb/types';
import { TEST_URLS } from '@tests/shared/test-urls';

describe('ADBConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pullTransfer.reset();
    mocks.writeStream.reset();
    mocks.checkADBBinary.mockReturnValue(true);
    mocks.execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(null, 'Android Debug Bridge version 1.0.41', '');
      },
    );
    resetAdbAvailabilityCache();
    // Reset the internal client cache so each test gets a fresh connector
    void import('@modules/adb/ADBConnector').then((_mod) => {
      // Access the module's internal cache via a new instance
    });
  });

  describe('checkADBAvailable', () => {
    it('returns true when ADB binary is in PATH', async () => {
      const connector = new ADBConnector();
      expect(await connector.checkADBAvailable()).toBe(true);
    });

    it('returns false when ADB binary is not in PATH', async () => {
      mocks.execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error('command not found'), '', '');
        },
      );
      resetAdbAvailabilityCache();
      const connector = new ADBConnector();
      expect(await connector.checkADBAvailable()).toBe(false);
    });
  });

  describe('listDevices', () => {
    it('returns array of ADBDevice when devices are connected', async () => {
      const connector = new ADBConnector();
      const devices = await connector.listDevices();
      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBe(2);
      expect(devices[0]).toHaveProperty('serial', 'emulator-5554');
      expect(devices[0]).toHaveProperty('state', 'device');
    });

    it('includes expected ADBDevice properties', async () => {
      const connector = new ADBConnector();
      const devices = await connector.listDevices();
      const device = devices[0] as ADBDevice;
      expect(device).toHaveProperty('serial');
      expect(device).toHaveProperty('name');
      expect(device).toHaveProperty('state');
      expect(device).toHaveProperty('model');
      expect(device).toHaveProperty('product');
      expect(device).toHaveProperty('device');
    });

    it('throws when ADB binary is unavailable', async () => {
      mocks.execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error('command not found'), '', '');
        },
      );
      resetAdbAvailabilityCache();
      const connector = new ADBConnector();
      await expect(connector.listDevices()).rejects.toThrow('ADB server binary not found');
    });
  });

  describe('shellCommand', () => {
    it('executes shell command and returns result', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(
        mockStream('result data\n__JSHOOK_ADB_EXIT__:0\n'),
      );
      const connector = new ADBConnector();
      const result = await connector.shellCommand('emulator-5554', 'getprop ro.product.model');
      expect(result).toHaveProperty('stdout', 'result data');
      expect(result).toHaveProperty('command', 'getprop ro.product.model');
      expect(result.exitCode).toBe(0);
    });

    it('reports the real device-side exit code instead of always success', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('\n__JSHOOK_ADB_EXIT__:1\n'));
      const connector = new ADBConnector();
      const result = await connector.shellCommand('emulator-5554', 'pm path no.such.package');
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
    });

    it('strips the exit-status sentinel from multi-line output', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(
        mockStream('line one\nline two\n__JSHOOK_ADB_EXIT__:42\n'),
      );
      const connector = new ADBConnector();
      const result = await connector.shellCommand('emulator-5554', 'multiline');
      expect(result.stdout).toBe('line one\nline two');
      expect(result.exitCode).toBe(42);
    });

    it('wraps the command so a missing sentinel is not treated as success', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('partial output'));
      const connector = new ADBConnector();
      const result = await connector.shellCommand('emulator-5554', 'cat /proc/net/unix');
      expect(result.stdout).toBe('partial output');
      expect(result.exitCode).toBe(1);
      expect(mocks.deviceClient.shell).toHaveBeenCalledWith(
        expect.stringContaining('cat /proc/net/unix'),
      );
      expect(mocks.deviceClient.shell).toHaveBeenCalledWith(
        expect.stringContaining('__JSHOOK_ADB_EXIT__'),
      );
    });

    it('rejects an invalid device serial before reaching adbkit', async () => {
      const connector = new ADBConnector();
      await expect(connector.shellCommand('bad;reboot', 'ls')).rejects.toThrow(
        'Invalid device serial',
      );
      expect(mocks.deviceClient.shell).not.toHaveBeenCalled();
    });

    it('throws when ADB binary is unavailable', async () => {
      mocks.execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error('command not found'), '', '');
        },
      );
      resetAdbAvailabilityCache();
      const connector = new ADBConnector();
      await expect(connector.shellCommand('emulator-5554', 'ls')).rejects.toThrow(
        'ADB server binary not found',
      );
    });
  });

  describe('forwardPort', () => {
    it('forwards local port to remote port', async () => {
      const connector = new ADBConnector();
      const result = await connector.forwardPort('emulator-5554', 9222, 9222);
      expect(result).toBe('tcp:9222 -> tcp:9222');
    });

    it('throws when ADB binary is unavailable', async () => {
      mocks.execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error('command not found'), '', '');
        },
      );
      resetAdbAvailabilityCache();
      const connector = new ADBConnector();
      await expect(connector.forwardPort('emulator-5554', 9222, 9222)).rejects.toThrow(
        'ADB server binary not found',
      );
    });
  });

  describe('listForwards', () => {
    it('returns list of forward entries', async () => {
      mocks.deviceClient.listForwards.mockResolvedValueOnce([
        { serial: 'emulator-5554', local: 'tcp:9222', remote: 'tcp:9222' },
      ]);
      const connector = new ADBConnector();
      const forwards = await connector.listForwards('emulator-5554');
      expect(forwards).toHaveLength(1);
      expect(forwards[0]).toHaveProperty('serial', 'emulator-5554');
      expect(forwards[0]).toHaveProperty('local', 'tcp:9222');
      expect(forwards[0]).toHaveProperty('remote', 'tcp:9222');
    });
  });

  describe('removeForward', () => {
    it('removes port forward without error', async () => {
      const connector = new ADBConnector();
      await expect(connector.removeForward('emulator-5554', 9222)).resolves.toBeUndefined();
    });
  });

  describe('pullApk', () => {
    it('pulls APK from device to output path', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('package:/data/app/base.apk'));
      mocks.pullTransfer.pipe.mockImplementationOnce(() => {
        mocks.writeStream.emit('finish');
      });
      const connector = new ADBConnector();
      const result = await connector.pullApk('emulator-5554', 'com.example.app', '/tmp/test.apk');
      expect(result).toBe('/tmp/test.apk');
      expect(mocks.deviceClient.pull).toHaveBeenCalledWith('/data/app/base.apk');
    });

    it('rejects when the transfer closes before finish', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('package:/data/app/base.apk'));
      const connector = new ADBConnector();
      const promise = connector.pullApk('emulator-5554', 'com.example.app', '/tmp/closes.apk');
      promise.catch(() => {});
      await vi.waitFor(() => expect(mocks.pullTransfer.pipe).toHaveBeenCalled());
      mocks.pullTransfer.emit('close');
      await expect(promise).rejects.toThrow('closed before the transfer finished');
      expect(mocks.writeStream.destroy).toHaveBeenCalled();
    });

    it('times out a stalled pull, destroys both streams and removes the partial file', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('package:/data/app/base.apk'));
      const connector = new ADBConnector();
      vi.useFakeTimers();
      try {
        const promise = connector.pullApk(
          'emulator-5554',
          'com.example.app',
          join(tmpdir(), 'jshook-adb-stalled.apk'),
        );
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(ADB_FILE_TRANSFER_TIMEOUT_MS + 1);
        await expect(promise).rejects.toThrow('Timed out');
        expect(mocks.pullTransfer.destroy).toHaveBeenCalled();
        expect(mocks.writeStream.destroy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws when package not found', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('\n__JSHOOK_ADB_EXIT__:1\n'));
      const connector = new ADBConnector();
      await expect(
        connector.pullApk('emulator-5554', 'com.nonexistent.app', '/tmp/test.apk'),
      ).rejects.toThrow('Package "com.nonexistent.app" not found');
    });

    it('rejects a package name with shell metacharacters before invoking the device', async () => {
      const connector = new ADBConnector();
      await expect(
        connector.pullApk('emulator-5554', 'com.example.app; reboot', '/tmp/injected.apk'),
      ).rejects.toThrow('Invalid Android package name');
      expect(mocks.deviceClient.shell).not.toHaveBeenCalled();
    });
  });

  describe('parseApkInfo', () => {
    it('parses dumpsys output into APKInfo', async () => {
      const dumpsysOutput = `
        versionName=1.0.0
        versionCode=100
        minSdk=21
        targetSdk=33
        requested permissions:
          android.permission.INTERNET
          android.permission.ACCESS_NETWORK_STATE
        Activity Resolver Table:
          com.example.app.MainActivity
        Service Resolver Table:
          com.example.app.BackgroundService
        Receiver Resolver Table:
          com.example.app.BootReceiver
      `;
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream(dumpsysOutput));
      const connector = new ADBConnector();
      const apkInfo = await connector.parseApkInfo('emulator-5554', 'com.example.app');
      expect(apkInfo).toHaveProperty('packageName', 'com.example.app');
      expect(apkInfo).toHaveProperty('versionName', '1.0.0');
      expect(apkInfo).toHaveProperty('versionCode', '100');
      expect(apkInfo).toHaveProperty('minSdk', '21');
      expect(apkInfo).toHaveProperty('targetSdk', '33');
      expect(apkInfo.permissions).toContain('android.permission.INTERNET');
    });

    it('handles minimal dumpsys output', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream(''));
      const connector = new ADBConnector();
      const apkInfo = await connector.parseApkInfo('emulator-5554', 'com.example.app');
      expect(apkInfo).toHaveProperty('packageName', 'com.example.app');
      expect(apkInfo.versionName).toBe('');
      expect(apkInfo.permissions).toEqual([]);
    });

    it('throws NOT_FOUND when dumpsys reports an unknown package', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(
        mockStream('Unable to find package: com.nonexistent.app\n__JSHOOK_ADB_EXIT__:0\n'),
      );
      const connector = new ADBConnector();
      await expect(connector.parseApkInfo('emulator-5554', 'com.nonexistent.app')).rejects.toThrow(
        'not found on device',
      );
    });

    it('rejects a package name with shell metacharacters before invoking the device', async () => {
      const connector = new ADBConnector();
      await expect(connector.parseApkInfo('emulator-5554', 'com.example.app$(id)')).rejects.toThrow(
        'Invalid Android package name',
      );
      expect(mocks.deviceClient.shell).not.toHaveBeenCalled();
    });
  });

  describe('listWebViewTargets', () => {
    it('forwards port and returns WebView targets', async () => {
      const mockTargets = [
        {
          id: 'target-1',
          title: 'Test WebView',
          url: TEST_URLS.root,
          type: 'page',
          webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
        },
      ];

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => mockTargets,
      });

      const connector = new ADBConnector();
      const targets = await connector.listWebViewTargets('emulator-5554', 9222);
      expect(targets).toHaveLength(1);
      expect(targets[0]).toHaveProperty('id', 'target-1');
      expect(targets[0]).toHaveProperty('webSocketDebuggerUrl');

      globalThis.fetch = originalFetch;
    });

    it('cleans up forward on fetch failure', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const connector = new ADBConnector();
      await expect(connector.listWebViewTargets('emulator-5554', 9222)).rejects.toThrow(
        'Failed to fetch WebView targets',
      );

      globalThis.fetch = originalFetch;
    });
  });
});

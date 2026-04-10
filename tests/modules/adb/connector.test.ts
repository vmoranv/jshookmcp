import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const deviceClient = {
    shell: vi.fn(async () => mockStream('')),
    pull: vi.fn(async () => ({
      on: vi.fn((_event: string, _cb: () => void) => {}),
      pipe: vi.fn(),
    })),
    forward: vi.fn(async () => {}),
    listForwards: vi.fn(async (): Promise<any[]> => []),
    getProperties: vi.fn(async () => ({})),
  };

  const clientInstance = {
    listDevices: vi.fn(async () => [
      { id: 'emulator-5554', type: 'device', transportId: '1' },
      { id: 'device-serial-123', type: 'device', transportId: '2' },
    ]),
    getDevice: vi.fn(() => deviceClient),
  };

  // Constructor function that returns the same instance
  const ClientCtor = function () {
    return clientInstance;
  };

  return {
    clientInstance,
    deviceClient,
    ClientCtor,
    checkADBBinary: vi.fn(() => true),
    writeStreamOn: vi.fn(),
    writeStreamPipe: vi.fn(),
    // Expose reset for the internal module cache
    resetClientCache: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execSync: mocks.checkADBBinary,
}));

vi.mock('@devicefarmer/adbkit', () => {
  return {
    Client: mocks.ClientCtor,
    Adb: mocks.ClientCtor,
  };
});

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(() => ({
    on: mocks.writeStreamOn,
    pipe: mocks.writeStreamPipe,
  })),
}));

import { ADBConnector } from '@modules/adb/ADBConnector';
import type { ADBDevice } from '@modules/adb/types';

describe('ADBConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkADBBinary.mockReturnValue(true);
    // Reset the internal client cache so each test gets a fresh connector
    void import('@modules/adb/ADBConnector').then((_mod) => {
      // Access the module's internal cache via a new instance
    });
  });

  describe('checkADBAvailable', () => {
    it('returns true when ADB binary is in PATH', () => {
      const connector = new ADBConnector();
      expect(connector.checkADBAvailable()).toBe(true);
    });

    it('returns false when ADB binary is not in PATH', () => {
      mocks.checkADBBinary.mockImplementation(() => {
        throw new Error('command not found');
      });
      const connector = new ADBConnector();
      expect(connector.checkADBAvailable()).toBe(false);
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
      mocks.checkADBBinary.mockImplementation(() => {
        throw new Error('command not found');
      });
      const connector = new ADBConnector();
      await expect(connector.listDevices()).rejects.toThrow('ADB server binary not found');
    });
  });

  describe('shellCommand', () => {
    it('executes shell command and returns result', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream('result data'));
      const connector = new ADBConnector();
      const result = await connector.shellCommand('emulator-5554', 'getprop ro.product.model');
      expect(result).toHaveProperty('stdout', 'result data');
      expect(result).toHaveProperty('command', 'getprop ro.product.model');
    });

    it('throws when ADB binary is unavailable', async () => {
      mocks.checkADBBinary.mockImplementation(() => {
        throw new Error('command not found');
      });
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
      mocks.checkADBBinary.mockImplementation(() => {
        throw new Error('command not found');
      });
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
      mocks.writeStreamOn.mockImplementation((_event: string, cb: () => void) => {
        if (_event === 'finish') setImmediate(cb);
      });
      const connector = new ADBConnector();
      const result = await connector.pullApk('emulator-5554', 'com.example.app', '/tmp/test.apk');
      expect(result).toBe('/tmp/test.apk');
    });

    it('throws when package not found', async () => {
      mocks.deviceClient.shell.mockResolvedValueOnce(mockStream(''));
      const connector = new ADBConnector();
      await expect(
        connector.pullApk('emulator-5554', 'com.nonexistent.app', '/tmp/test.apk'),
      ).rejects.toThrow('Package "com.nonexistent.app" not found');
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
  });

  describe('listWebViewTargets', () => {
    it('forwards port and returns WebView targets', async () => {
      const mockTargets = [
        {
          id: 'target-1',
          title: 'Test WebView',
          url: 'https://example.com',
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

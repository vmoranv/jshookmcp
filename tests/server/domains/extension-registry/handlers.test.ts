import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('@server/webhook/WebhookServer', () => ({
  WebhookServer: vi.fn().mockImplementation(() => ({
    registerEndpoint: vi.fn().mockReturnValue('ep-123'),
    removeEndpoint: vi.fn(),
    listEndpoints: vi.fn().mockReturnValue([]),
    getPort: vi.fn().mockReturnValue(18789),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@server/webhook/CommandQueue', () => ({
  CommandQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue('cmd-1'),
    dequeue: vi.fn().mockResolvedValue([]),
    process: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    exportState: vi.fn().mockReturnValue([]),
    importState: vi.fn(),
  })),
}));

vi.mock('@server/extensions/PluginRegistry', () => ({
  PluginRegistry: vi.fn().mockImplementation(() => ({
    listPlugins: vi.fn().mockReturnValue([]),
    searchPlugins: vi.fn().mockReturnValue([]),
    installPlugin: vi
      .fn()
      .mockResolvedValue({
        id: 'plugin-1',
        name: 'test-plugin',
        version: '1.0.0',
        description: '',
      }),
    uninstallPlugin: vi.fn().mockResolvedValue(undefined),
    getPluginInfo: vi
      .fn()
      .mockReturnValue({ id: 'plugin-1', name: 'test-plugin', version: '1.0.0', description: '' }),
    getPluginDependencies: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@errors/ToolError', () => ({
  ToolError: class ToolError extends Error {
    constructor(
      public code: string,
      message: string,
      public options?: { toolName?: string },
    ) {
      super(message);
      this.name = 'ToolError';
    }
  },
}));

vi.mock('@server/domains/shared/parse-args', () => ({
  argString: vi.fn((args: Record<string, unknown>, key: string, fallback?: string) => {
    const v = args[key];
    return typeof v === 'string' ? v : fallback;
  }),
  argNumber: vi.fn((args: Record<string, unknown>, key: string, fallback?: number) => {
    const v = args[key];
    return typeof v === 'number' ? v : fallback;
  }),
  argEnum: vi.fn(
    (args: Record<string, unknown>, key: string, allowed: Set<string>, fallback?: string) => {
      const v = args[key];
      if (v === undefined || v === null) return fallback;
      if (typeof v !== 'string') return fallback;
      if (!allowed.has(v)) throw new Error(`Invalid ${key}`);
      return v;
    },
  ),
}));

// Mock hardware modules
vi.mock('@modules/hardware/BLEHIDInjector', () => ({
  BLEHIDInjector: vi.fn().mockImplementation(() => ({
    scanBLEDevices: vi.fn().mockResolvedValue([]),
    connectHID: vi.fn().mockResolvedValue(undefined),
    sendHIDReport: vi.fn().mockResolvedValue(undefined),
    checkEnvironment: vi.fn().mockReturnValue({ supported: true, issues: [], platform: 'win32' }),
    isConnected: vi.fn().mockReturnValue(false),
    disconnect: vi.fn(),
  })),
}));

vi.mock('@modules/hardware/SerialBridge', () => ({
  SerialBridge: vi.fn().mockImplementation(() => ({
    listPorts: vi.fn().mockResolvedValue([]),
    openPort: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue('OK'),
    closePort: vi.fn().mockResolvedValue(undefined),
    flashFirmware: vi.fn().mockResolvedValue('Flash successful'),
    isESP32Port: vi.fn().mockReturnValue(false),
    isOpenPort: vi.fn().mockReturnValue(false),
  })),
}));

import { ExtensionRegistryHandlers } from '@src/server/domains/extension-registry/handlers';

describe('ExtensionRegistryHandlers', () => {
  let handlers: ExtensionRegistryHandlers;

  beforeEach(() => {
    const mockCtx = {} as Record<string, unknown>;
    handlers = new ExtensionRegistryHandlers(mockCtx as any);
  });

  describe('extension_list', () => {
    it('should return empty plugin list', async () => {
      const result = await handlers.handleExtensionList({});
      expect(result).toHaveProperty('plugins');
      expect(result).toHaveProperty('total');
    });

    it('should filter plugins', async () => {
      const result = await handlers.handleExtensionList({ filter: 'test' });
      expect(result).toHaveProperty('plugins');
    });
  });

  describe('extension_install', () => {
    it('should install plugin from source', async () => {
      const result = await handlers.handleExtensionInstall({
        source: 'https://github.com/test/plugin.git',
      });
      expect(result).toHaveProperty('pluginId');
      expect(result).toHaveProperty('name');
    });
  });

  describe('extension_uninstall', () => {
    it('should uninstall plugin', async () => {
      const result = await handlers.handleExtensionUninstall({ pluginId: 'plugin-1' });
      expect(result).toHaveProperty('status', 'ok');
    });
  });

  describe('extension_info', () => {
    it('should return plugin info', async () => {
      const result = await handlers.handleExtensionInfo({ pluginId: 'plugin-1' });
      expect(result).toHaveProperty('id', 'plugin-1');
    });
  });

  describe('webhook_create', () => {
    it('should create webhook endpoint', async () => {
      const result = await handlers.handleWebhookCreate({ path: '/callback' });
      expect(result).toHaveProperty('endpointId');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('path', '/callback');
    });
  });

  describe('webhook_list', () => {
    it('should return webhook list', async () => {
      const result = await handlers.handleWebhookList();
      expect(result).toHaveProperty('endpoints');
      expect(result).toHaveProperty('total');
    });
  });

  describe('webhook_delete', () => {
    it('should delete webhook endpoint', async () => {
      const result = await handlers.handleWebhookDelete({ endpointId: 'ep-123' });
      expect(result).toHaveProperty('status', 'ok');
    });
  });

  describe('webhook_commands', () => {
    it('should return command list', async () => {
      const result = await handlers.handleWebhookCommands({});
      expect(result).toHaveProperty('commands');
      expect(result).toHaveProperty('total');
    });

    it('should filter commands by status', async () => {
      const result = await handlers.handleWebhookCommands({ status: 'pending' });
      expect(result).toHaveProperty('commands');
    });
  });

  describe('ble_scan', () => {
    it('should return scan results', async () => {
      const result = await handlers.handleBLEScan();
      expect(result).toHaveProperty('devices');
    });
  });

  describe('ble_hid_check', () => {
    it('should return environment check', async () => {
      const result = await handlers.handleBLEHIDCheck();
      expect(result).toHaveProperty('supported');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('platform');
    });
  });

  describe('ble_hid_send', () => {
    it('should throw without deviceId', async () => {
      await expect(handlers.handleBLEHIDSend({})).rejects.toThrow(
        'Missing required argument: deviceId',
      );
    });

    it('should throw with invalid reportType', async () => {
      await expect(
        handlers.handleBLEHIDSend({ deviceId: 'dev-1', reportType: 'invalid' }),
      ).rejects.toThrow('Invalid reportType');
    });

    it('should throw without data', async () => {
      await expect(
        handlers.handleBLEHIDSend({ deviceId: 'dev-1', reportType: 'keyboard' }),
      ).rejects.toThrow('Missing required argument: data');
    });
  });

  describe('serial_list_ports', () => {
    it('should return port list', async () => {
      const result = await handlers.handleSerialListPorts();
      expect(result).toHaveProperty('ports');
      expect(result).toHaveProperty('total');
    });
  });

  describe('serial_send', () => {
    it('should throw without port', async () => {
      await expect(handlers.handleSerialSend({})).rejects.toThrow(
        'Missing required argument: port',
      );
    });

    it('should throw without command', async () => {
      await expect(handlers.handleSerialSend({ port: '/dev/ttyUSB0' })).rejects.toThrow(
        'Missing required argument: command',
      );
    });
  });

  describe('serial_flash', () => {
    it('should throw without port', async () => {
      await expect(handlers.handleSerialFlash({})).rejects.toThrow(
        'Missing required argument: port',
      );
    });

    it('should throw without firmwarePath', async () => {
      await expect(handlers.handleSerialFlash({ port: '/dev/ttyUSB0' })).rejects.toThrow(
        'Missing required argument: firmwarePath',
      );
    });
  });

  describe('shutdown', () => {
    it('should stop webhook server', async () => {
      await handlers.shutdown();
    });
  });
});

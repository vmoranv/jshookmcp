import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListInstalled = vi.fn().mockReturnValue([]);
const mockLoadPlugin = vi.fn().mockResolvedValue({
  manifest: { name: 'test-plugin', version: '1.0' },
  exports: { run: (x: unknown) => x },
});
const mockUnloadPlugin = vi.fn().mockResolvedValue(undefined);
const mockUnregister = vi.fn().mockResolvedValue(undefined);

const mockRegisterEndpoint = vi.fn((_config: any) => `ep-${Date.now()}`);
const mockRemoveEndpoint = vi.fn();
const mockListEndpoints = vi.fn(() => []);
const mockGetPort = vi.fn(() => 18789);
const mockIsRunning = vi.fn(() => false);
const mockStart = vi.fn();
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockEnqueue = vi.fn((_input: any) => `cmd-${Date.now()}`);
const mockDequeue = vi.fn(() => []);
const mockRegisterCallback = vi.fn();
const mockSendEvent = vi.fn().mockReturnValue(Promise.resolve(undefined));

vi.mock('@modules/extension-registry', () => ({
  PluginRegistry: vi.fn(function (this: any) {
    this.listInstalled = mockListInstalled;
    this.loadPlugin = mockLoadPlugin;
    this.unloadPlugin = mockUnloadPlugin;
    this.unregister = mockUnregister;
  }),
  WebhookBridge: vi.fn(function (this: any) {
    this.registerExternalCallback = mockRegisterCallback;
    this.sendEvent = mockSendEvent;
  }),
}));

vi.mock('@server/webhook', () => ({
  WebhookServer: vi.fn(function (this: any) {
    this.registerEndpoint = mockRegisterEndpoint;
    this.removeEndpoint = mockRemoveEndpoint;
    this.listEndpoints = mockListEndpoints;
    this.getPort = mockGetPort;
    this.isRunning = mockIsRunning;
    this.start = mockStart;
    this.stop = mockStop;
  }),
  CommandQueue: vi.fn(function (this: any) {
    this.enqueue = mockEnqueue;
    this.dequeue = mockDequeue;
  }),
}));

function parseBody(result: any) {
  return JSON.parse(result.content[0].text);
}

describe('ExtensionRegistryHandlers', () => {
  let mod: typeof import('@server/domains/extension-registry/handlers.impl');
  let handlers: InstanceType<typeof mod.ExtensionRegistryHandlers>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSendEvent.mockReturnValue(Promise.resolve(undefined));
    mod = await import('@server/domains/extension-registry/handlers.impl');
    handlers = new mod.ExtensionRegistryHandlers();
  });

  describe('handleListInstalled', () => {
    it('returns installed plugins list', async () => {
      mockListInstalled.mockReturnValueOnce([{ name: 'plugin1' }]);
      const result = await handlers.handleListInstalled();
      expect(parseBody(result).success).toBe(true);
      expect(parseBody(result).plugins).toHaveLength(1);
    });
  });

  describe('handleExecuteInContext', () => {
    it('throws on missing pluginId', async () => {
      await expect(handlers.handleExecuteInContext({ contextName: 'run' })).rejects.toThrow();
    });

    it('executes context from plugin exports', async () => {
      mockLoadPlugin.mockResolvedValueOnce({
        manifest: { name: 'test' },
        exports: { run: (x: unknown) => `result: ${JSON.stringify(x)}` },
      });
      const result = await handlers.handleExecuteInContext({
        pluginId: 'test',
        contextName: 'run',
        args: { key: 'val' },
      });
      expect(parseBody(result).success).toBe(true);
    });

    it('throws when context not found in plugin', async () => {
      mockLoadPlugin.mockResolvedValueOnce({ manifest: { name: 'test' }, exports: {} });
      await expect(
        handlers.handleExecuteInContext({ pluginId: 'test', contextName: 'missing' }),
      ).rejects.toThrow('was not found');
    });

    it('resolves default export function', async () => {
      mockLoadPlugin.mockResolvedValueOnce({
        manifest: { name: 'test' },
        exports: { default: (x: unknown) => x },
      });
      const result = await handlers.handleExecuteInContext({
        pluginId: 'test',
        contextName: 'default',
      });
      expect(parseBody(result).success).toBe(true);
    });

    it('resolves nested context from default export object', async () => {
      mockLoadPlugin.mockResolvedValueOnce({
        manifest: { name: 'test' },
        exports: { default: { myFunc: (x: unknown) => x } },
      });
      const result = await handlers.handleExecuteInContext({
        pluginId: 'test',
        contextName: 'myFunc',
      });
      expect(parseBody(result).success).toBe(true);
    });
  });

  describe('handleReload', () => {
    it('reloads a plugin', async () => {
      mockLoadPlugin.mockResolvedValueOnce({
        manifest: { name: 'test', version: '2.0' },
        exports: { run: vi.fn() },
      });
      const result = await handlers.handleReload({ pluginId: 'test' });
      expect(parseBody(result).success).toBe(true);
      expect(mockUnloadPlugin).toHaveBeenCalledWith('test');
    });

    it('throws on missing pluginId', async () => {
      await expect(handlers.handleReload({})).rejects.toThrow();
    });
  });

  describe('handleUninstall', () => {
    it('uninstalls a plugin', async () => {
      const result = await handlers.handleUninstall({ pluginId: 'test' });
      expect(parseBody(result).success).toBe(true);
    });
  });

  describe('handleWebhookCreate', () => {
    it('creates webhook endpoint', async () => {
      mockRegisterEndpoint.mockReturnValueOnce('ep-1');
      const result = await handlers.handleWebhookCreate({ name: 'hook', path: '/w' });
      expect(parseBody(result).success).toBe(true);
      expect(parseBody(result).url).toContain('/w');
    });

    it('handles events array', async () => {
      mockRegisterEndpoint.mockReturnValueOnce('ep-2');
      const result = await handlers.handleWebhookCreate({
        name: 'hook',
        path: '/w',
        events: ['tool_called'],
      });
      expect(parseBody(result).events).toEqual(['tool_called']);
    });
  });

  describe('handleWebhookList', () => {
    it('lists webhook endpoints', async () => {
      mockListEndpoints.mockReturnValueOnce([]);
      const result = await handlers.handleWebhookList();
      expect(parseBody(result).success).toBe(true);
    });
  });

  describe('handleWebhookDelete', () => {
    it('throws when endpoint not found', async () => {
      mockRemoveEndpoint.mockImplementationOnce(() => {
        throw new Error('Endpoint missing not found');
      });
      await expect(handlers.handleWebhookDelete({ endpointId: 'missing' })).rejects.toThrow();
    });
  });

  describe('handleWebhookCommands', () => {
    it('dequeues commands', async () => {
      mockDequeue.mockReturnValueOnce([]);
      const result = await handlers.handleWebhookCommands({ endpointId: 'ep-1' });
      expect(parseBody(result).success).toBe(true);
    });

    it('enqueues a command', async () => {
      mockEnqueue.mockReturnValueOnce('cmd-1');
      const result = await handlers.handleWebhookCommands({
        endpointId: 'ep-1',
        command: { action: 'test' },
      });
      expect(parseBody(result).status).toBe('pending');
    });

    it('filters by status', async () => {
      mockDequeue.mockReturnValueOnce([]);
      const result = await handlers.handleWebhookCommands({
        endpointId: 'ep-1',
        status: 'pending',
      });
      expect(parseBody(result).success).toBe(true);
    });
  });

  describe('handleWebhookDispatch', () => {
    it('dispatches to create', async () => {
      mockRegisterEndpoint.mockReturnValueOnce('ep-3');
      const result = await handlers.handleWebhookDispatch({
        action: 'create',
        name: 'h',
        path: '/w',
      });
      expect(parseBody(result).success).toBe(true);
    });

    it('dispatches to list', async () => {
      mockListEndpoints.mockReturnValueOnce([]);
      const result = await handlers.handleWebhookDispatch({ action: 'list' });
      expect(parseBody(result).success).toBe(true);
    });

    it('returns error for invalid action', async () => {
      const result = await handlers.handleWebhookDispatch({ action: 'invalid' });
      expect(parseBody(result).error).toContain('Invalid action');
    });
  });

  describe('webhook server lifecycle', () => {
    it('startWebhookServer starts server', async () => {
      mockIsRunning.mockReturnValueOnce(false);
      await handlers.startWebhookServer();
      expect(mockStart).toHaveBeenCalled();
    });

    it('stopWebhookServer is no-op when no server', async () => {
      await handlers.stopWebhookServer();
    });
  });
});

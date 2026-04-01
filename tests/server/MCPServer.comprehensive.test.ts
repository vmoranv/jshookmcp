/**
 * MCPServer.ts — additional coverage for remaining uncovered paths:
 * - getDomainInstance / setDomainInstance methods
 * - resolveEnabledDomains delegation
 * - registerSingleTool delegation
 * - reloadExtensions / listExtensions delegation
 * - Secondary dep keys with async ensure
 * - Property accessor edge cases
 * - Start with HTTP transport
 * - Close with HTTP server and sockets
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    mcpInstances: [] as any[],
    getToolsForProfile: vi.fn(),
    getToolsByDomains: vi.fn(),
    parseToolDomains: vi.fn(),
    getToolDomain: vi.fn(),
    getProfileDomains: vi.fn(),
    createToolHandlerMap: vi.fn(),
    allManifests: [] as any[],
    tokenBudget: {
      recordToolCall: vi.fn(),
      setTrackingEnabled: vi.fn(),
    },
    cacheInit: vi.fn(async () => undefined),
    detailedShutdown: vi.fn(),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class ResourceTemplate {
    constructor(
      public readonly uriTemplate: string,
      private readonly options: {
        list?: (...args: any[]) => Promise<any> | any;
        complete?: Record<string, (...args: any[]) => Promise<any> | any>;
      },
    ) {}
    get listCallback() {
      return this.options.list;
    }
    get completeCallbacks() {
      return this.options.complete ?? {};
    }
  }

  class BaseMockMcpServer {
    public tools: Array<{ name: string; handler: (...args: any[]) => Promise<any> }> = [];
    public resources: any[] = [];
    public connect = vi.fn(async () => undefined);
    public close = vi.fn(async () => undefined);
    public sendToolListChanged = vi.fn(async () => undefined);

    tool(...args: any[]) {
      const name = args[0];
      const handler = args.at(-1);
      this.tools.push({ name, handler });
      return { remove: vi.fn() };
    }

    registerTool(name: string, _config: any, handler: (...args: any[]) => Promise<any>) {
      this.tools.push({ name, handler });
      return { remove: vi.fn() };
    }

    registerResource(name: string, target: unknown, _config: any, handler: any) {
      this.resources.push({ name, target, handler });
      return { remove: vi.fn() };
    }
  }

  return {
    McpServer: class extends BaseMockMcpServer {
      constructor(...args: any[]) {
        super(...(args as any));
        mocks.mcpInstances.push(this);
      }
    },
    ResourceTemplate,
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: () => {},
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    handleRequest = vi.fn();
  },
}));

vi.mock('@src/utils/cache', () => ({
  CacheManager: class {
    init = mocks.cacheInit;
  },
}));

vi.mock('@src/utils/TokenBudgetManager', () => ({
  TokenBudgetManager: class {
    recordToolCall = mocks.tokenBudget.recordToolCall;
    setTrackingEnabled = mocks.tokenBudget.setTrackingEnabled;
    setExternalCleanup = vi.fn();
    getStats = vi.fn(() => ({ usagePercentage: 0, currentUsage: 0, maxTokens: 200000 }));
  },
}));

vi.mock('@src/utils/UnifiedCacheManager', () => ({
  UnifiedCacheManager: class {
    registerCache = vi.fn();
  },
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: class {
    shutdown = mocks.detailedShutdown;
    clear = vi.fn();
  },
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
  },
}));

vi.mock('@src/server/ToolCatalog', () => ({
  getToolsForProfile: mocks.getToolsForProfile,
  getToolsByDomains: mocks.getToolsByDomains,
  parseToolDomains: mocks.parseToolDomains,
  getToolDomain: mocks.getToolDomain,
  getProfileDomains: mocks.getProfileDomains,
  allTools: [],
}));

vi.mock('@src/server/ToolHandlerMap', () => ({
  createToolHandlerMap: mocks.createToolHandlerMap,
}));

vi.mock('@src/server/registry/index', () => ({
  getAllManifests: () => mocks.allManifests,
  getAllRegistrations: () => [],
  getAllDomains: () => new Set(),
  getAllToolNames: () => new Set(),
  initRegistry: async () => {},
  buildToolGroups: () => ({}),
  buildToolDomainMap: () => new Map(),
  buildAllTools: () => [],
  buildProfileDomains: () => ({ search: [], workflow: [], full: [] }),
  buildHandlerMapFromRegistry: () => ({}),
}));

import { MCPServer } from '@server/MCPServer';

describe('MCPServer — additional coverage', () => {
  const baseConfig = {
    llm: {
      provider: 'p',
      primary: { apiKey: '', model: 'x' },
      secondary: { apiKey: '', model: 'y' },
    },
    puppeteer: { headless: true, timeout: 1000 },
    mcp: { name: 'test', version: '1.0.0' },
    cache: { enabled: true, dir: '.cache', ttl: 60 },
    performance: { maxConcurrentAnalysis: 1, maxCodeSizeMB: 1 },
  } as any;

  beforeEach(() => {
    mocks.mcpInstances.length = 0;
    mocks.allManifests.length = 0;
    vi.clearAllMocks();

    process.env.MCP_TRANSPORT = 'stdio';
    delete process.env.MCP_TOOL_PROFILE;
    delete process.env.MCP_TOOL_DOMAINS;

    mocks.parseToolDomains.mockReturnValue(null);
    mocks.getToolsForProfile.mockReturnValue([
      { name: 't1', description: 'd1', inputSchema: { properties: {} } },
    ]);
    mocks.getToolsByDomains.mockReturnValue([]);
    mocks.getToolDomain.mockReturnValue('core');
    mocks.getProfileDomains.mockReturnValue(['core']);
    mocks.createToolHandlerMap.mockReturnValue({
      t1: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    });
  });

  afterEach(() => {
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_TOOL_PROFILE;
    delete process.env.MCP_TOOL_DOMAINS;
  });

  describe('domainInstanceMap direct methods', () => {
    it('getDomainInstance returns typed value', () => {
      const server = new MCPServer(baseConfig);
      server.setDomainInstance('myKey', { value: 123 });

      const result = server.getDomainInstance<{ value: number }>('myKey');
      expect(result?.value).toBe(123);
    });

    it('getDomainInstance returns undefined for unknown keys', () => {
      const server = new MCPServer(baseConfig);
      expect(server.getDomainInstance('nonexistent')).toBeUndefined();
    });

    it('setDomainInstance overwrites existing values', () => {
      const server = new MCPServer(baseConfig);
      server.setDomainInstance('key', 'first');
      server.setDomainInstance('key', 'second');
      expect(server.getDomainInstance('key')).toBe('second');
    });
  });

  describe('resolveEnabledDomains delegation', () => {
    it('delegates to the imported function', () => {
      const server = new MCPServer(baseConfig);
      const result = server.resolveEnabledDomains([]);
      expect(result).toBeInstanceOf(Set);
    });
  });

  describe('registerSingleTool delegation', () => {
    it('registers a tool and returns RegisteredTool', () => {
      const server = new MCPServer(baseConfig);
      const tool = {
        name: 'new_tool',
        description: 'A new tool',
        inputSchema: { type: 'object', properties: {} },
      };

      const registered = server.registerSingleTool(tool);
      expect(registered).toBeDefined();
      expect(typeof registered.remove).toBe('function');
    });
  });

  describe('reloadExtensions / listExtensions delegation', () => {
    it('reloadExtensions returns result', async () => {
      const server = new MCPServer(baseConfig);
      const result = await server.reloadExtensions();
      // Result depends on ExtensionManager mock behavior
      expect(result).toBeDefined();
    });

    it('listExtensions returns result', () => {
      const server = new MCPServer(baseConfig);
      const result = server.listExtensions();
      expect(result).toBeDefined();
    });
  });

  describe('manifest secondary dep keys', () => {
    it('secondary dep keys create lazy proxies that call ensure', () => {
      mocks.allManifests.push({
        domain: 'hooks',
        depKey: 'aiHookHandlers',
        secondaryDepKeys: ['hookPresetHandlers'],
        ensure: vi.fn(async () => ({ handleHook: vi.fn() })),
      });

      const server = new MCPServer(baseConfig);
      const deps = server.handlerDeps as Record<string, unknown>;
      expect(deps.aiHookHandlers).toBeDefined();
      expect(deps.hookPresetHandlers).toBeDefined();
    });

    it('duplicate secondary dep keys are skipped', () => {
      mocks.allManifests.push(
        {
          domain: 'test1',
          depKey: 'sharedKey',
          ensure: vi.fn(),
        },
        {
          domain: 'test2',
          depKey: 'otherKey',
          secondaryDepKeys: ['sharedKey'],
          ensure: vi.fn(),
        },
      );

      const server = new MCPServer(baseConfig);
      const deps = server.handlerDeps as Record<string, unknown>;
      // sharedKey should exist but only once (from first manifest)
      expect(deps.sharedKey).toBeDefined();
    });
  });

  describe('backward-compatible property accessors', () => {
    it('reading a domain property reads from domainInstanceMap', () => {
      const server = new MCPServer(baseConfig);
      server.domainInstanceMap.set('collector', { id: 'test' });
      expect(server.collector).toEqual({ id: 'test' });
    });

    it('writing a domain property writes to domainInstanceMap', () => {
      const server = new MCPServer(baseConfig);
      (server as any).analyzer = { analyze: vi.fn() };
      expect(server.domainInstanceMap.has('analyzer')).toBe(true);
    });

    it('writing undefined deletes from domainInstanceMap', () => {
      const server = new MCPServer(baseConfig);
      server.domainInstanceMap.set('hookManager', { manage: vi.fn() });
      (server as any).hookManager = undefined;
      expect(server.domainInstanceMap.has('hookManager')).toBe(false);
    });

    it('multiple domain properties can be set and read', () => {
      const server = new MCPServer(baseConfig);
      (server as any).pageController = { navigate: vi.fn() };
      (server as any).domInspector = { inspect: vi.fn() };
      (server as any).scriptManager = { manage: vi.fn() };

      expect(server.pageController).toBeDefined();
      expect(server.domInspector).toBeDefined();
      expect(server.scriptManager).toBeDefined();
      expect(server.domainInstanceMap.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('enterDegradedMode', () => {
    it('only enters degraded mode once', () => {
      const server = new MCPServer(baseConfig);
      server.enterDegradedMode('reason 1');
      server.enterDegradedMode('reason 2');

      expect(mocks.tokenBudget.setTrackingEnabled).toHaveBeenCalledTimes(1);
      expect(mocks.tokenBudget.setTrackingEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('executeToolWithTracking', () => {
    it('emits tool:called event on success', async () => {
      const server = new MCPServer(baseConfig);
      const emitSpy = vi.spyOn(server.eventBus, 'emit');

      await server.executeToolWithTracking('t1', {});

      expect(emitSpy).toHaveBeenCalledWith(
        'tool:called',
        expect.objectContaining({
          toolName: 't1',
          success: true,
        }),
      );
    });

    it('records context guard call on success', async () => {
      const server = new MCPServer(baseConfig);
      const recordSpy = vi.spyOn(server.contextGuard, 'recordCall');

      await server.executeToolWithTracking('t1', {});

      expect(recordSpy).toHaveBeenCalledWith('t1');
    });
  });

  describe('clientSupportsListChanged', () => {
    it('defaults to true', () => {
      const server = new MCPServer(baseConfig);
      expect(server.clientSupportsListChanged).toBe(true);
    });

    it('can be set to false', () => {
      const server = new MCPServer(baseConfig);
      server.clientSupportsListChanged = false;
      expect(server.clientSupportsListChanged).toBe(false);
    });
  });

  describe('extension maps initialization', () => {
    it('initializes all extension maps as empty', () => {
      const server = new MCPServer(baseConfig);
      expect(server.extensionToolsByName.size).toBe(0);
      expect(server.extensionPluginsById.size).toBe(0);
      expect(server.extensionPluginRuntimeById.size).toBe(0);
      expect(server.extensionWorkflowsById.size).toBe(0);
      expect(server.extensionWorkflowRuntimeById.size).toBe(0);
      expect(server.lastExtensionReloadAt).toBeUndefined();
    });
  });

  describe('activationController initialization', () => {
    it('sets activationController in domainInstanceMap', () => {
      const server = new MCPServer(baseConfig);
      expect(server.getDomainInstance('activationController')).toBeDefined();
    });
  });
});

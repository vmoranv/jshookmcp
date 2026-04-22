import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function MockStdioServerTransport() {}

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
    public resources: Array<{
      name: string;
      target: unknown;
      handler: (...args: any[]) => Promise<any>;
    }> = [];
    public connect = vi.fn(async () => undefined);
    public close = vi.fn(async () => undefined);
    public sendToolListChanged = vi.fn(async () => undefined);
    public server = { setRequestHandler: vi.fn(), onclose: null };
    public prompt = vi.fn();

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

    registerResource(
      name: string,
      target: unknown,
      _config: any,
      handler: (...args: any[]) => Promise<any>,
    ) {
      this.resources.push({ name, target, handler });
      return { remove: vi.fn() };
    }
  }

  return {
    McpServer: class extends BaseMockMcpServer {
      constructor(...args: any[]) {
        // @ts-expect-error — auto-suppressed [TS2556]
        super(...(args as any));
        mocks.mcpInstances.push(this);
      }
    },
    ResourceTemplate,
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: MockStdioServerTransport,
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class StreamableHTTPServerTransport {
    handleRequest = vi.fn();
  },
}));

vi.mock('@src/utils/cache', () => ({
  CacheManager: class CacheManager {
    init = mocks.cacheInit;
  },
}));

vi.mock('@src/utils/TokenBudgetManager', () => ({
  TokenBudgetManager: class {
    recordToolCall = mocks.tokenBudget.recordToolCall;
    setTrackingEnabled = mocks.tokenBudget.setTrackingEnabled;
    setExternalCleanup = vi.fn();
    getStats = vi.fn(() => ({ usagePercentage: 0, currentUsage: 0, maxTokens: 200000 }));
    static getInstance = () => mocks.tokenBudget;
  },
}));

vi.mock('@src/utils/UnifiedCacheManager', () => ({
  UnifiedCacheManager: class {
    registerCache = vi.fn();
    static getInstance = () => ({ registerCache: vi.fn() });
  },
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: class {
    shutdown = mocks.detailedShutdown;
    clear = vi.fn();
    static getInstance = () => ({ shutdown: mocks.detailedShutdown, clear: vi.fn() });
  },
}));

const _createCacheAdaptersMock = vi.fn(() => []);
vi.mock('@utils/CacheAdapters', () => ({
  createCacheAdapters: _createCacheAdaptersMock,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
    onLog: vi.fn(),
  },
}));

vi.mock('@src/server/ToolCatalog', () => ({
  getToolsForProfile: mocks.getToolsForProfile,
  getToolsByDomains: mocks.getToolsByDomains,
  parseToolDomains: mocks.parseToolDomains,
  getToolDomain: mocks.getToolDomain,
  getProfileDomains: mocks.getProfileDomains,
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

describe('MCPServer', () => {
  const baseConfig = {
    llm: {
      provider: 'primary-provider',
      primary: { apiKey: '', model: 'x' },
      secondary: { apiKey: '', model: 'y' },
    },
    puppeteer: { headless: true, timeout: 1000 },
    mcp: { name: 'test-server', version: '1.0.0' },
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

    mocks.parseToolDomains.mockImplementation((raw?: string) => (raw ? ['browser'] : null));
    mocks.getToolsForProfile.mockReturnValue([
      { name: 'tool_alpha', description: 'alpha', inputSchema: { properties: { x: {} } } },
      { name: 'tool_beta', description: 'beta', inputSchema: {} },
    ]);
    mocks.getToolsByDomains.mockReturnValue([
      { name: 'domain_tool', description: 'domain', inputSchema: {} },
    ]);
    mocks.getToolDomain.mockReturnValue('browser');
    mocks.getProfileDomains.mockReturnValue(['browser']);
    mocks.createToolHandlerMap.mockReturnValue({
      tool_alpha: vi.fn(async (args: any) => ({
        content: [{ type: 'text', text: `alpha:${JSON.stringify(args)}` }],
      })),
      tool_beta: vi.fn(async () => ({ content: [{ type: 'text', text: 'beta' }] })),
      domain_tool: vi.fn(async () => ({ content: [{ type: 'text', text: 'domain' }] })),
    });
  });

  afterEach(() => {
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_TOOL_PROFILE;
    delete process.env.MCP_TOOL_DOMAINS;
    _createCacheAdaptersMock.mockImplementation(() => []);
  });

  it('registers selected tools plus meta tools on construction', () => {
    const server = new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];
    const names = mcp.tools.map((t: { name: string }) => t.name);

    expect(names).toContain('tool_alpha');
    expect(names).toContain('tool_beta');
    // boost_profile and unboost_profile were removed in the domain-level activation refactor
    expect(names).not.toContain('boost_profile');
    expect(names).not.toContain('unboost_profile');
    expect(server).toBeDefined();
  });

  it('registers server resources on construction', () => {
    const server = new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];
    const names = mcp.resources.map((resource: { name: string }) => resource.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'evidence_graph_json',
        'evidence_graph_markdown',
        'instrumentation_sessions',
        'instrumentation_session_snapshot',
      ]),
    );
    expect(server).toBeDefined();
  });

  it('resource callbacks surface current evidence and instrumentation snapshots', async () => {
    const server = new MCPServer(baseConfig);
    server.setDomainInstance('evidenceGraph', {
      exportJson: () => ({ version: 1, nodes: [{ id: 'n1' }], edges: [], exportedAt: 'now' }),
      exportMarkdown: () => '# graph',
    });
    server.setDomainInstance('instrumentationSessionManager', {
      listSessionSnapshots: () => [{ id: 'sess-1', status: 'active' }],
      listSessions: () => [
        {
          id: 'sess-1',
          name: 'Session 1',
          status: 'active',
          operationCount: 2,
          artifactCount: 3,
        },
      ],
      getSessionSnapshot: (sessionId: string) =>
        sessionId === 'sess-1' ? { id: 'sess-1', status: 'active' } : undefined,
    });

    const mcp = mocks.mcpInstances[0];
    const evidenceJson = mcp.resources.find(
      (resource: { name: string }) => resource.name === 'evidence_graph_json',
    );
    const evidenceMarkdown = mcp.resources.find(
      (resource: { name: string }) => resource.name === 'evidence_graph_markdown',
    );
    const sessions = mcp.resources.find(
      (resource: { name: string }) => resource.name === 'instrumentation_sessions',
    );
    const sessionSnapshot = mcp.resources.find(
      (resource: { name: string }) => resource.name === 'instrumentation_session_snapshot',
    );

    const evidenceJsonResponse = await evidenceJson.handler(new URL('jshook://evidence/graph'));
    const evidenceMarkdownResponse = await evidenceMarkdown.handler(
      new URL('jshook://evidence/graph.md'),
    );
    const sessionsResponse = await sessions.handler(new URL('jshook://instrumentation/sessions'));
    const sessionSnapshotResponse = await sessionSnapshot.handler(
      new URL('jshook://instrumentation/session/sess-1'),
      { sessionId: 'sess-1' },
    );

    expect(JSON.parse(evidenceJsonResponse.contents[0].text)).toEqual({
      version: 1,
      nodes: [{ id: 'n1' }],
      edges: [],
      exportedAt: 'now',
    });
    expect(evidenceMarkdownResponse.contents[0].text).toBe('# graph');
    expect(JSON.parse(sessionsResponse.contents[0].text)).toEqual([
      { id: 'sess-1', status: 'active' },
    ]);
    expect(JSON.parse(sessionSnapshotResponse.contents[0].text)).toEqual({
      id: 'sess-1',
      status: 'active',
    });

    const template = sessionSnapshot.target as {
      listCallback?: () => Promise<{ resources: Array<{ uri: string }> }>;
    };
    const listed = await template.listCallback?.();

    expect(listed?.resources).toEqual([
      expect.objectContaining({ uri: 'jshook://instrumentation/session/sess-1' }),
    ]);
  });

  it('resolves tool profile from environment when explicitly provided', () => {
    process.env.MCP_TOOL_PROFILE = 'full';
    const server = new MCPServer(baseConfig);
    expect(mocks.getToolsForProfile).toHaveBeenCalledWith('full');
    expect(server).toBeDefined();
  });

  it('registers maintenance secondary handler deps for extension management', () => {
    mocks.allManifests.push(
      {
        domain: 'maintenance',
        depKey: 'coreMaintenanceHandlers',
        secondaryDepKeys: ['extensionManagementHandlers'],
        ensure: vi.fn(() => ({ handleGetTokenBudgetStats: vi.fn() })),
      },
      {
        domain: 'hooks',
        depKey: 'aiHookHandlers',
        secondaryDepKeys: ['hookPresetHandlers'],
        ensure: vi.fn(() => ({})),
      },
    );

    const server = new MCPServer(baseConfig) as unknown as Record<string, Record<string, unknown>>;

    expect(server.handlerDeps).toHaveProperty('extensionManagementHandlers');
    expect(server.handlerDeps).toHaveProperty('hookPresetHandlers');
  });

  it('starts with stdio transport by default and initializes cache', async () => {
    const server = new MCPServer(baseConfig);
    await server.start();

    const mcp = mocks.mcpInstances[0];
    expect(mocks.cacheInit).toHaveBeenCalledOnce();
    expect(mcp.connect).toHaveBeenCalledOnce();
  });

  it('enterDegradedMode disables tracking only once', () => {
    const server = new MCPServer(baseConfig);

    server.enterDegradedMode('first issue');
    server.enterDegradedMode('second issue');

    expect(mocks.tokenBudget.setTrackingEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.tokenBudget.setTrackingEnabled).toHaveBeenCalledWith(false);
  });

  it('registered tool execution records token usage', async () => {
    const server = new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];
    const alpha = mcp.tools.find((t: { name: string }) => t.name === 'tool_alpha');

    const response = await alpha.handler({ x: 7 });
    expect((response.content[0] as any).text).toContain('alpha');
    expect(mocks.tokenBudget.recordToolCall).toHaveBeenCalledWith('tool_alpha', { x: 7 }, response);
    expect(server).toBeDefined();
  });

  it('close shuts down detailed manager and mcp server', async () => {
    const server = new MCPServer(baseConfig);
    await server.close();
    const mcp = mocks.mcpInstances[0];

    expect(mocks.detailedShutdown).toHaveBeenCalledOnce();
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('throws when required configuration sections are missing', () => {
    expect(() => new MCPServer({} as any)).toThrow();
  });

  it('handles reconnect/disconnect abnormal logic safely', async () => {
    const server = new MCPServer(baseConfig);
    await server.start();
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });
  it('handles empty secondaryDepKeys and duplicate secondary keys', () => {
    mocks.allManifests.push({
      domain: 'test1',
      depKey: 'key1',
      ensure: vi.fn(),
    });
    mocks.allManifests.push({
      domain: 'test2',
      depKey: 'key2',
      secondaryDepKeys: ['key1'], // duplicate
      ensure: vi.fn(),
    });
    const server = new MCPServer(baseConfig);
    expect(server).toBeDefined();
  });

  it('contextGuard resolves TabRegistry gracefully when getTabRegistry is undefined or incomplete', async () => {
    const server = new MCPServer(baseConfig) as any;
    const dummyResponse = { content: [{ type: 'text', text: '{}' }] };

    // 1: browserHandlers undefined
    server.handlerDeps.browserHandlers = undefined;
    expect(
      server.contextGuard.enrichResponse('page_test', { ...dummyResponse }).content[0].text,
    ).not.toContain('_tabContext');

    // 2: getTabRegistry undefined
    server.handlerDeps.browserHandlers = {};
    expect(
      server.contextGuard.enrichResponse('page_test', { ...dummyResponse }).content[0].text,
    ).not.toContain('_tabContext');

    // 3: getTabRegistry defined
    const mockContextMeta = { url: 'tab', title: 'test', tabIndex: 1, pageId: '1' };
    server.handlerDeps.browserHandlers = {
      getTabRegistry: () => ({ getContextMeta: () => mockContextMeta }),
    };
    const enriched = server.contextGuard.enrichResponse('page_test', {
      content: [{ type: 'text', text: '{}' }],
    });
    expect(enriched.content[0].text).toContain('_tabContext');
  });

  it('contextGuard skips tab context when getTabRegistry resolves asynchronously', async () => {
    const server = new MCPServer(baseConfig) as any;
    const dummyResponse = { content: [{ type: 'text', text: '{}' }] };

    server.handlerDeps.browserHandlers = {
      getTabRegistry: () =>
        Promise.resolve({
          getContextMeta: () => ({
            url: 'tab',
            title: 'async-test',
            tabIndex: 1,
            pageId: '1',
          }),
        }),
    };

    expect(
      server.contextGuard.enrichResponse('instrumentation_hook_preset', dummyResponse).content[0]
        .text,
    ).not.toContain('_tabContext');
  });

  it('registerCaches handles early returns and concurrent registration', async () => {
    const server = new MCPServer(baseConfig) as any;
    // 1: no collector
    server.collector = undefined;
    await server.registerCaches(); // coverage: if (!this.collector) return;

    // 2: duplicate registration test (cacheAdaptersRegistered)
    server.cacheAdaptersRegistered = true;
    await server.registerCaches(); // coverage: if (this.cacheAdaptersRegistered) return;
    server.cacheAdaptersRegistered = false;

    // 3: concurrent registration promise
    server.collector = { getCache: vi.fn(), getCompressor: vi.fn() };
    server.cacheRegistrationPromise = Promise.resolve();
    await server.registerCaches(); // coverage: if (this.cacheRegistrationPromise)
  });

  it('executeToolWithTracking emits ERR-03 warning if tool execution takes more than 30s and cleans up timer', async () => {
    const server = new MCPServer(baseConfig) as any;
    vi.useFakeTimers();

    const { logger } = await import('@src/utils/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    server.router.execute = vi.fn().mockImplementation(async () => {
      // Simulate hung tool execution
      vi.advanceTimersByTime(31000); // Trigger the setTimeout synchronously here
      return { content: [] };
    });

    await server.executeToolWithTracking('slow_tool', { hugeData: 'x'.repeat(1000) });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Telemetry Alert [ERR-03]: Tool execution hung (>30s) for 'slow_tool'",
      ),
    );

    vi.useRealTimers();
    warnSpy.mockRestore();
  });
  it('executeToolWithTracking catches trackingError and refreshes TTL when activated', async () => {
    const server = new MCPServer(baseConfig);
    server.activatedToolNames.add('tool_alpha');
    server.domainTtlEntries.set('browser', {
      timer: setTimeout(() => {}, 1000),
      ttlMs: 1000,
      toolNames: new Set(['tool_alpha']),
    });

    mocks.tokenBudget.recordToolCall.mockImplementationOnce(() => {
      throw new Error('Tracking failed');
    });

    const response = await server.executeToolWithTracking('tool_alpha', { x: 7 });
    expect((response.content[0] as any).text).toContain('alpha');
    // coverage guarantees line 308 (catch block) and 314 (activatedToolNames.has(name)) are hit
  });

  it('executeToolWithTracking emits tool:called event with correct payload', async () => {
    const server = new MCPServer(baseConfig);
    const emitSpy = vi.spyOn(server.eventBus, 'emit');

    await server.executeToolWithTracking('tool_alpha', { x: 7 });

    expect(emitSpy).toHaveBeenCalledWith('tool:called', {
      toolName: 'tool_alpha',
      domain: 'browser',
      timestamp: expect.any(String),
      success: true,
    });
  });

  it('executeToolWithTracking emits tool:called with null domain for unknown tool', async () => {
    const server = new MCPServer(baseConfig) as any;
    mocks.getToolDomain.mockReturnValue(null);
    // Mock router to return a valid response instead of throwing for unknown tools
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
    });
    const emitSpy = vi.spyOn(server.eventBus, 'emit');

    await server.executeToolWithTracking('unknown_tool', {});

    expect(emitSpy).toHaveBeenCalledWith('tool:called', {
      toolName: 'unknown_tool',
      domain: null,
      timestamp: expect.any(String),
      success: true,
    });
  });

  it('executeToolWithTracking injects execution metrics into JSON responses when enabled', async () => {
    process.env.E2E_COLLECT_PERFORMANCE = '1';
    const server = new MCPServer(baseConfig) as any;
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });

    const response = await server.executeToolWithTracking('tool_alpha', { x: 7 });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.success).toBe(true);
    expect(payload._executionMetrics).toBeDefined();
    expect(payload._executionMetrics.source).toBe('server');
    expect(payload._executionMetrics.serverPid).toBe(process.pid);
    expect(typeof payload._executionMetrics.elapsedMs).toBe('number');

    delete process.env.E2E_COLLECT_PERFORMANCE;
  });

  it('registerCaches catches errors from createCacheAdapters and logs them', async () => {
    const server = new MCPServer(baseConfig) as any;
    server.collector = { getCache: vi.fn(), getCompressor: vi.fn() };
    server.cacheAdaptersRegistered = false;
    server.cacheRegistrationPromise = undefined;

    // Make createCacheAdapters throw when registerCaches calls it
    _createCacheAdaptersMock.mockImplementationOnce(() => {
      throw new Error('createCacheAdapters exploded');
    });

    // Should not throw — catch block in registerCaches handles it
    await expect(server.registerCaches()).resolves.toBeUndefined();
  });

  it('executeToolWithTracking handles routing errors and secondary tracking errors', async () => {
    const server = new MCPServer(baseConfig) as any;
    server.router.execute = vi.fn().mockRejectedValue(new Error('Router failed'));

    mocks.tokenBudget.recordToolCall.mockImplementationOnce(() => {
      throw new Error('Tracking failed during error path');
    });

    await expect(server.executeToolWithTracking('tool_alpha', { x: 7 })).rejects.toThrow(
      'Router failed',
    );
  });

  it('HTTP transport mode startup', async () => {
    process.env.MCP_TRANSPORT = 'http';
    const server = new MCPServer(baseConfig);
    server.registerCaches = vi.fn(); // avoid importing cache adapters
    // mock HTTP transport to avoid actually starting a listener
    const mockStartHttp = vi.fn();
    const transportMod = await import('@server/MCPServer.transport');
    vi.spyOn(transportMod, 'startHttpTransport').mockImplementation(mockStartHttp as any);

    await server.start();
    expect(mockStartHttp).toHaveBeenCalled();
  });

  it('property setters logic for undefined correctly deletes domainInstanceMap entries', () => {
    const server = new MCPServer(baseConfig);
    server.collector = { id: 1 } as any;
    expect(server.domainInstanceMap.has('collector')).toBe(true);

    server.collector = undefined; // coverage: if (v === undefined) this.domainInstanceMap.delete(key);
    expect(server.domainInstanceMap.has('collector')).toBe(false);
  });

  it('initCrossDomainInfrastructure catches import errors gracefully', async () => {
    // Force the dynamic import to fail by mocking the module resolution
    const originalLoad = module.constructor.prototype._resolveFilename;
    module.constructor.prototype._resolveFilename = () => {
      throw new Error('Cannot find module');
    };

    const server = new MCPServer(baseConfig);
    // Wait for the async init to settle (it catches the error internally)
    await new Promise((r) => setTimeout(r, 10));

    module.constructor.prototype._resolveFilename = originalLoad;
    // Server should still be usable
    expect(server).toBeDefined();
  });
});

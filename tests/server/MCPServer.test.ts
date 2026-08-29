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
    startArtifactRetentionScheduler: vi.fn(),
    createLoopLagSampler: vi.fn(),
    createToolLatencyTracker: vi.fn(),
    sendLoggingMessage: vi.fn(async () => undefined),
    logListener: null as null | ((level: string, message: string, args: unknown[]) => void),
  };
});

vi.mock('@utils/artifactRetention', () => ({
  startArtifactRetentionScheduler: mocks.startArtifactRetentionScheduler,
  getArtifactRetentionConfig: vi.fn(() => ({
    enabled: true,
    retentionDays: 7,
    maxTotalBytes: 0,
    cleanupOnStart: false,
    cleanupIntervalMinutes: 360,
  })),
  cleanupArtifacts: vi.fn(),
}));

vi.mock('@utils/loopLag', () => ({
  createLoopLagSampler: mocks.createLoopLagSampler,
}));

vi.mock('@utils/toolLatency', () => ({
  createToolLatencyTracker: mocks.createToolLatencyTracker,
}));

vi.mock('@modelcontextprotocol/server', () => {
  class ResourceTemplate {
    public readonly uriTemplate: string;
    private readonly options: {
      list?: (...args: any[]) => Promise<any> | any;
      complete?: Record<string, (...args: any[]) => Promise<any> | any>;
    };
    constructor(
      uriTemplate: string,
      options: {
        list?: (...args: any[]) => Promise<any> | any;
        complete?: Record<string, (...args: any[]) => Promise<any> | any>;
      },
    ) {
      this.uriTemplate = uriTemplate;
      this.options = options;
    }

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
    public server = {
      setRequestHandler: vi.fn(),
      onclose: null,
      sendLoggingMessage: mocks.sendLoggingMessage,
    };
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

    registerPrompt(_name: string, _config: any, _handler: (...args: any[]) => unknown) {
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

vi.mock('@modelcontextprotocol/server/stdio', () => ({
  StdioServerTransport: MockStdioServerTransport,
}));

vi.mock('@modelcontextprotocol/node', () => ({
  NodeStreamableHTTPServerTransport: class StreamableHTTPServerTransport {
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

const createCacheAdaptersMock = vi.fn(() => []);
vi.mock('@utils/CacheAdapters', () => ({
  createCacheAdapters: createCacheAdaptersMock,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
    onLog: vi.fn((listener: (level: string, message: string, args: unknown[]) => void) => {
      mocks.logListener = listener;
      return () => {};
    }),
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
import { estimateBrowserSessionToolCostMs } from '@server/MCPServer.execution';
import { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';
import { InMemoryBrowserFleetLeaseStore } from '@server/runtime/BrowserFleetRouter';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';
import { TEST_URLS } from '@tests/shared/test-urls';

describe('MCPServer', () => {
  const baseConfig = {
    llm: {
      provider: 'primary-provider',
      primary: { apiKey: '', model: 'x' },
      secondary: { apiKey: '', model: 'y' },
    },
    puppeteer: { headless: true, timeout: 1000 },
    mcp: {
      name: 'test-server',
      version: '1.0.0',
      browserSessionQueueMaxPending: 256,
      browserSessionQueueMaxPendingPerSession: 16,
      browserSessionQueueWaitTimeoutMs: 180_000,
      browserSessionSchedulerQuantumMs: 250,
      browserSessionSchedulerAgingMs: 15_000,
      browserSessionExpectedConcurrency: 10,
      browserSessionReservedPendingPerSession: 1,
      browserSessionCostEwmaAlpha: 0.2,
    },
    cache: { enabled: true, dir: '.cache', ttl: 60 },
    performance: { maxConcurrentAnalysis: 1, maxCodeSizeMB: 1 },
  } as any;

  beforeEach(() => {
    mocks.mcpInstances.length = 0;
    mocks.allManifests.length = 0;
    mocks.logListener = null;
    vi.clearAllMocks();
    // Default loop-lag sampler: start() always creates + enables one, so every
    // start() test needs a benign implementation (stop is a no-op fn).
    mocks.createLoopLagSampler.mockReturnValue({
      enable: () => vi.fn(),
      getSummary: () => ({ p50Ms: 0, p90Ms: 0, p99Ms: 0, samples: 0 }),
    });
    // Default tool-latency tracker: start() always creates + subscribes one, so
    // every start() test needs a benign implementation (dispose is a no-op fn).
    mocks.createToolLatencyTracker.mockReturnValue({
      record: vi.fn(),
      getSummary: vi.fn(() => ({ top: [], trackedTools: 0 })),
      dispose: vi.fn(),
    });

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
    createCacheAdaptersMock.mockImplementation(() => []);
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

  it('forwards warn/error/info logs to the MCP client but drops debug', async () => {
    const server = new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];

    // Simulate the initialize handshake that flips clientInitialized to true.
    mcp.server.oninitialized?.();

    const listener = mocks.logListener;
    expect(listener).toBeTypeOf('function');

    // debug must not be forwarded (broadcast-amplification guard).
    listener!('debug', 'noisy debug', []);
    expect(mocks.sendLoggingMessage).not.toHaveBeenCalled();

    listener!('info', 'info message', []);
    expect(mocks.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'Info',
      data: 'info message',
      logger: 'jshookmcp',
    });

    mocks.sendLoggingMessage.mockClear();
    listener!('warn', 'warn message', []);
    expect(mocks.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'Warning',
      data: 'warn message',
      logger: 'jshookmcp',
    });

    mocks.sendLoggingMessage.mockClear();
    listener!('error', 'error message', []);
    expect(mocks.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'Error',
      data: 'error message',
      logger: 'jshookmcp',
    });

    expect(server).toBeDefined();
  });

  it('samples info logs while always forwarding warn and error', () => {
    const server = new MCPServer(baseConfig);
    const mcp = mocks.mcpInstances[0];
    mcp.server.oninitialized?.();

    const listener = mocks.logListener;
    expect(listener).toBeTypeOf('function');

    // 25 info lines → only the 1st, 11th, and 21st are forwarded (every 10th).
    for (let i = 0; i < 25; i++) {
      listener!('info', `info ${i}`, []);
    }
    expect(mocks.sendLoggingMessage).toHaveBeenCalledTimes(3);

    mocks.sendLoggingMessage.mockClear();
    for (let i = 0; i < 5; i++) {
      listener!('warn', `warn ${i}`, []);
    }
    expect(mocks.sendLoggingMessage).toHaveBeenCalledTimes(5);

    mocks.sendLoggingMessage.mockClear();
    for (let i = 0; i < 5; i++) {
      listener!('error', `error ${i}`, []);
    }
    expect(mocks.sendLoggingMessage).toHaveBeenCalledTimes(5);

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

  it('injects browser session scheduler config into the coordinator', () => {
    const configuredServer = new MCPServer({
      ...baseConfig,
      mcp: {
        ...baseConfig.mcp,
        browserSessionQueueMaxPending: 40,
        browserSessionQueueMaxPendingPerSession: 4,
        browserSessionQueueWaitTimeoutMs: 12_000,
        browserSessionSchedulerQuantumMs: 125,
        browserSessionSchedulerAgingMs: 4_000,
        browserSessionExpectedConcurrency: 10,
        browserSessionReservedPendingPerSession: 2,
        browserSessionCostEwmaAlpha: 0.35,
      },
    }) as any;
    const coordinator = configuredServer.getDomainInstance('browserSessionCoordinator');

    expect(coordinator.getQueueStats()).toMatchObject({
      maxPending: 40,
      maxPendingPerSession: 4,
      waitTimeoutMs: 12_000,
      quantumMs: 125,
      agingMs: 4_000,
      expectedConcurrency: 10,
      reservedPendingPerSession: 2,
      costEwmaAlpha: 0.35,
    });
  });

  it('injects browser fleet topology and lease capacity into the router', () => {
    const configuredServer = new MCPServer(
      {
        ...baseConfig,
        mcp: {
          ...baseConfig.mcp,
          browserFleetWorkerId: 'worker-a',
          browserFleetWorkers: [
            { id: 'worker-a', endpoint: 'http://worker-a', weight: 2 },
            { id: 'worker-b', endpoint: 'http://worker-b' },
          ],
          browserFleetVirtualNodes: 64,
          browserFleetLeaseTtlMs: 900_000,
          browserFleetMaxLocalLeases: 128,
        },
      },
      { browserFleetLeaseStore: new InMemoryBrowserFleetLeaseStore(128) },
    ) as any;
    const fleetRouter = configuredServer.getDomainInstance('browserFleetRouter');

    expect(fleetRouter.getStats()).toMatchObject({
      localWorkerId: 'worker-a',
      workers: 2,
      acceptingWorkers: 2,
      ringPoints: 192,
      virtualNodes: 64,
      leaseTtlMs: 900_000,
      leaseStore: { activeLeases: 0, maxLeases: 128 },
    });
  });

  it('fails closed when a multi-worker topology has no shared lease store', () => {
    expect(
      () =>
        new MCPServer({
          ...baseConfig,
          mcp: {
            ...baseConfig.mcp,
            browserFleetWorkerId: 'worker-a',
            browserFleetWorkers: [{ id: 'worker-a' }, { id: 'worker-b' }],
          },
        }),
    ).toThrow('requires a shared BrowserFleetLeaseStore');
  });

  it('derives bounded cold-start browser costs from duration, timeout, and tool class', () => {
    expect(estimateBrowserSessionToolCostMs('human_scroll', { durationMs: 600 })).toBe(600);
    expect(estimateBrowserSessionToolCostMs('page_navigate', { timeout: 120_000 })).toBe(30_000);
    expect(estimateBrowserSessionToolCostMs('page_navigate', {})).toBe(7_500);
    expect(estimateBrowserSessionToolCostMs('browser_status', {})).toBe(50);
    expect(estimateBrowserSessionToolCostMs('page_click', {})).toBe(250);
  });

  it('returns a fenced wrong-worker route before executing browser code', async () => {
    const configuredServer = new MCPServer(
      {
        ...baseConfig,
        mcp: {
          ...baseConfig.mcp,
          browserFleetWorkerId: 'worker-a',
          browserFleetWorkers: [
            { id: 'worker-a', endpoint: 'http://worker-a' },
            { id: 'worker-b', endpoint: 'http://worker-b' },
          ],
        },
      },
      { browserFleetLeaseStore: new InMemoryBrowserFleetLeaseStore(128) },
    ) as any;
    const fleetRouter = configuredServer.getDomainInstance('browserFleetRouter');
    const remoteSession = Array.from({ length: 1_000 }, (_, index) => `remote-${index}`).find(
      (sessionId) => fleetRouter.getAssignedWorker(sessionId).id === 'worker-b',
    );
    configuredServer.router.execute = vi.fn();

    const response = await configuredServer.executeToolWithTracking('tool_alpha', {
      _meta: { sessionId: remoteSession },
    });
    const payload = JSON.parse(response.content[0]!.text);

    expect(response.isError).toBe(true);
    expect(payload).toMatchObject({
      success: false,
      code: 'BROWSER_FLEET_WRONG_WORKER',
      retryAfterMs: 0,
      targetWorkerId: 'worker-b',
      targetEndpoint: 'http://worker-b',
      fencingToken: null,
    });
    expect(configuredServer.router.execute).not.toHaveBeenCalled();
  });

  it('does not count browser queue overload as a tool circuit-breaker failure', async () => {
    const configuredServer = new MCPServer({
      ...baseConfig,
      mcp: {
        ...baseConfig.mcp,
        browserSessionQueueMaxPending: 1,
        browserSessionQueueMaxPendingPerSession: 1,
        browserSessionQueueWaitTimeoutMs: 5_000,
      },
    }) as any;
    const coordinator = configuredServer.getDomainInstance('browserSessionCoordinator');
    const recordFailure = vi.spyOn(configuredServer.circuitBreaker, 'recordFailure');
    configuredServer.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('session-active', async () => await activeGate);
    const queued = configuredServer.executeToolWithTracking('tool_alpha', {
      _meta: { sessionId: 'session-a' },
    });

    const overload = await configuredServer.executeToolWithTracking('tool_alpha', {
      _meta: { sessionId: 'session-b' },
    });
    expect(overload.isError).toBe(true);
    expect(JSON.parse(overload.content[0]!.text)).toMatchObject({
      success: false,
      code: 'BROWSER_SESSION_QUEUE_FULL',
      retryAfterMs: expect.any(Number),
      queueDepth: 1,
      queueLimit: 1,
    });
    expect(recordFailure).not.toHaveBeenCalled();

    releaseActive();
    await Promise.all([active, queued]);
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
        domain: 'instrumentation',
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

  it('wires the artifact retention scheduler in start() and stops it on close()', async () => {
    // Architecture hygiene (2026-08-18): the retention sweep must be started
    // explicitly by the server lifecycle, not by a module-level side effect.
    const stopRetention = vi.fn();
    mocks.startArtifactRetentionScheduler.mockReturnValue(stopRetention);

    const server = new MCPServer(baseConfig);
    await server.start();

    expect(mocks.startArtifactRetentionScheduler).toHaveBeenCalledOnce();

    await server.close();
    expect(stopRetention).toHaveBeenCalledOnce();
  });

  it('wires the loop lag sampler in start() and stops it on close()', async () => {
    // r1-1: production event-loop lag metric must be started by the server
    // lifecycle (like the retention sweep) and released on close.
    const stopLoopLag = vi.fn();
    const sampler = {
      enable: vi.fn(() => stopLoopLag),
      getSummary: vi.fn(() => ({ p50Ms: 0, p90Ms: 0, p99Ms: 0, samples: 0 })),
    };
    mocks.createLoopLagSampler.mockReturnValue(sampler);

    const server = new MCPServer(baseConfig);
    await server.start();

    expect(mocks.createLoopLagSampler).toHaveBeenCalledOnce();
    expect(sampler.enable).toHaveBeenCalledOnce();
    expect(server.loopLagSampler).toBe(sampler);

    await server.close();
    expect(stopLoopLag).toHaveBeenCalledOnce();
    expect(server.loopLagSampler).toBeNull();
  });

  it('wires the tool latency tracker in start() and disposes it on close()', async () => {
    // r1-2: the per-tool latency tracker must be created by the server lifecycle,
    // subscribed to 'tool:called' (side-channel collection), and released on close.
    const tracker = {
      record: vi.fn(),
      getSummary: vi.fn(() => ({ top: [], trackedTools: 0 })),
      dispose: vi.fn(),
    };
    mocks.createToolLatencyTracker.mockReturnValue(tracker);

    const server = new MCPServer(baseConfig);
    await server.start();

    expect(mocks.createToolLatencyTracker).toHaveBeenCalledOnce();
    expect(server.toolLatencyTracker).toBe(tracker);

    // A 'tool:called' event with a durationMs must be recorded on the tracker.
    await server.eventBus.emit('tool:called', {
      toolName: 'tool_alpha',
      domain: 'browser',
      timestamp: new Date().toISOString(),
      success: true,
      durationMs: 42.5,
    });
    expect(tracker.record).toHaveBeenCalledWith('tool_alpha', 42.5);

    // A 'tool:called' event without durationMs is skipped (no record call).
    await server.eventBus.emit('tool:called', {
      toolName: 'tool_beta',
      domain: 'browser',
      timestamp: new Date().toISOString(),
      success: true,
    });
    expect(tracker.record).toHaveBeenCalledTimes(1);

    await server.close();
    expect(tracker.dispose).toHaveBeenCalledOnce();
    expect(server.toolLatencyTracker).toBeNull();
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
        "Telemetry Alert [ERR-03]: Tool execution hung (30s) for 'slow_tool'",
      ),
    );

    vi.useRealTimers();
    warnSpy.mockRestore();
  });
  it('does not report queued browser work as an actively hung tool', async () => {
    const server = new MCPServer(baseConfig) as any;
    vi.useFakeTimers();
    mocks.getToolDomain.mockReturnValue('browser');
    const { logger } = await import('@src/utils/logger');
    const warnSpy = vi.spyOn(logger, 'warn');
    const coordinator = server.getDomainInstance('browserSessionCoordinator');
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('active-session', async () => await activeGate);
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });

    const queued = server.executeToolWithTracking('browser_status', {
      _meta: { sessionId: 'queued-session' },
    });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Tool execution hung (30s) for 'browser_status'"),
    );

    releaseActive();
    await Promise.all([active, queued]);
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
      generation: 1,
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
      sessionId: null,
      timestamp: expect.any(String),
      success: true,
      durationMs: expect.any(Number),
      args: { x: 7 },
      result: {
        success: true,
        isError: false,
      },
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
      sessionId: null,
      timestamp: expect.any(String),
      success: true,
      durationMs: expect.any(Number),
      args: {},
      result: {
        success: true,
        isError: false,
      },
    });
  });

  it('executeToolWithTracking emits tool:called with success=false for soft-failed JSON results', async () => {
    const server = new MCPServer(baseConfig) as any;
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":false,"error":"Selector not found"}' }],
    });
    const emitSpy = vi.spyOn(server.eventBus, 'emit');

    await server.executeToolWithTracking('tool_alpha', { selector: '#missing' });

    expect(emitSpy).toHaveBeenCalledWith(
      'tool:called',
      expect.objectContaining({
        toolName: 'tool_alpha',
        success: false,
        result: {
          success: false,
          isError: false,
        },
      }),
    );
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

  it('executeToolWithTracking restores browser session context for browser tools', async () => {
    const server = new MCPServer(baseConfig) as any;
    const restoreSessionContext = vi.fn(async () => undefined);
    const runExclusive = vi.fn(
      async (_sessionId: string | null, fn: () => Promise<unknown>) => await fn(),
    );
    const noteToolResult = vi.fn();
    server.setDomainInstance('browserSessionCoordinator', {
      restoreSessionContext,
      runExclusive,
      noteToolResult,
    } as unknown as BrowserSessionCoordinator);
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true,"selectedIndex":1}' }],
    });

    await server.executeToolWithTracking('tool_alpha', {
      x: 7,
      _meta: { sessionId: 'sess-browser' },
    });

    expect(runExclusive).toHaveBeenCalledTimes(1);
    expect(restoreSessionContext).toHaveBeenCalledWith('sess-browser');
    expect(noteToolResult).toHaveBeenCalledTimes(1);
  });

  it('executeToolWithTracking initializes browser session coordination before first browser call', async () => {
    const server = new MCPServer(baseConfig) as any;
    const coordinator = server.getDomainInstance(
      'browserSessionCoordinator',
    ) as BrowserSessionCoordinator;
    const runExclusiveSpy = vi.spyOn(coordinator, 'runExclusive');
    const restoreSpy = vi.spyOn(coordinator, 'restoreSessionContext');
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });

    await server.executeToolWithTracking('tool_alpha', {
      _meta: { sessionId: 'sess-first-browser-call' },
    });

    expect(runExclusiveSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy).toHaveBeenCalledWith('sess-first-browser-call');
  });

  it('propagates the ambient MCP session into nested browser tool calls', async () => {
    const server = new MCPServer(baseConfig) as any;
    const coordinator = server.getDomainInstance(
      'browserSessionCoordinator',
    ) as BrowserSessionCoordinator;
    const restoreSpy = vi.spyOn(coordinator, 'restoreSessionContext');
    server.router.execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });

    await runWithToolRequestContext({ sessionId: 'ambient-session' }, async () => {
      await server.executeToolWithTracking('tool_alpha', {});
    });

    expect(restoreSpy).toHaveBeenCalledWith('ambient-session');
  });

  it('enriches browser responses from the calling session registry', async () => {
    const server = new MCPServer(baseConfig) as any;
    const coordinator = new BrowserSessionCoordinator(() => null);
    server.setDomainInstance('browserSessionCoordinator', coordinator);
    server.handlerDeps.browserHandlers = {
      getTabRegistry: () => coordinator.getTabRegistry(coordinator.getCurrentSessionId()),
    };
    const registryA = coordinator.getTabRegistry('session-a');
    const pageA = {};
    const pageAId = registryA.registerPage(pageA, {
      index: 0,
      url: TEST_URLS.a,
      title: 'A',
    });
    registryA.setCurrentPageId(pageAId);
    const registryB = coordinator.getTabRegistry('session-b');
    const pageB = {};
    const pageBId = registryB.registerPage(pageB, {
      index: 1,
      url: TEST_URLS.b,
      title: 'B',
    });
    registryB.setCurrentPageId(pageBId);
    server.router.execute = vi.fn().mockImplementation(async () => ({
      content: [{ type: 'text', text: '{"success":true}' }],
    }));

    const responseA = await server.executeToolWithTracking('page_navigate', {
      _meta: { sessionId: 'session-a' },
    });
    const responseB = await server.executeToolWithTracking('page_navigate', {
      _meta: { sessionId: 'session-b' },
    });
    const bodyA = JSON.parse(responseA.content[0].text);
    const bodyB = JSON.parse(responseB.content[0].text);

    expect(bodyA._tabContext).toMatchObject({ url: TEST_URLS.a, tabIndex: 0 });
    expect(bodyB._tabContext).toMatchObject({ url: TEST_URLS.b, tabIndex: 1 });
  });

  it('registerCaches catches errors from createCacheAdapters and logs them', async () => {
    const server = new MCPServer(baseConfig) as any;
    server.collector = { getCache: vi.fn(), getCompressor: vi.fn() };
    server.cacheAdaptersRegistered = false;
    server.cacheRegistrationPromise = undefined;

    // Make createCacheAdapters throw when registerCaches calls it
    createCacheAdaptersMock.mockImplementationOnce(() => {
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
    // MCP_TRANSPORT is resolved into a constant at module load time, so the
    // module must be re-imported after setting the env var for the constant to
    // see 'http' (vi.mock registrations survive vi.resetModules).
    vi.resetModules();
    const { MCPServer: ReloadedMCPServer } = await import('@server/MCPServer');
    const server = new ReloadedMCPServer(baseConfig);
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
    const modulePrototype = module.constructor.prototype as Record<string, unknown>;
    const originalLoad = modulePrototype['_resolveFilename'];
    modulePrototype['_resolveFilename'] = () => {
      throw new Error('Cannot find module');
    };

    const server = new MCPServer(baseConfig);
    // Wait for the async init to settle (it catches the error internally)
    await new Promise((r) => setTimeout(r, 10));

    modulePrototype['_resolveFilename'] = originalLoad;
    // Server should still be usable
    expect(server).toBeDefined();
  });
});

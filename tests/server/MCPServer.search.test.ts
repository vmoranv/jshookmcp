import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { DeepPartial } from './domains/shared/mock-factories';

function tool(name: string, description = `desc_${name}`): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const state = vi.hoisted(() => ({
  constructors: [] as Array<{ args: any[] }>,
  searches: [] as Array<{ query: string; topK: number; active: string[] }>,
  searchImpl: undefined as
    | ((query: string, topK: number, activeNames?: Set<string>) => unknown[])
    | undefined,
}));

vi.mock('@server/ToolCatalog', () => {
  const builtinTools = [
    tool('browser_launch', 'Launch a browser'),
    tool('page_navigate', 'Navigate a page'),
    tool('network_enable', 'Enable network monitoring'),
    tool('network_get_requests', 'Inspect network requests'),
    tool('get_token_budget_stats', 'Inspect token budget state'),
  ];
  return {
    allTools: builtinTools,
    getToolDomain: (name: string) => {
      if (name === 'get_token_budget_stats') return 'maintenance';
      if (name === 'network_enable' || name === 'network_get_requests') return 'network';
      if (name === 'browser_launch' || name === 'page_navigate') return 'browser';
      return undefined;
    },
    getToolsByDomains: (domains: string[]) =>
      builtinTools.filter((candidate) => {
        const domain =
          candidate.name === 'get_token_budget_stats'
            ? 'maintenance'
            : candidate.name.startsWith('network_')
              ? 'network'
              : 'browser';
        return domains.includes(domain);
      }),
    getToolMinimalTier: (name: string) => {
      if (name === 'browser_launch' || name === 'page_navigate') return 'workflow';
      if (name === 'network_enable' || name === 'network_get_requests') return 'workflow';
      if (name === 'get_token_budget_stats') return 'search';
      return null;
    },
    getTierIndex: (tier: string) => {
      if (tier === 'search') return 0;
      if (tier === 'workflow') return 1;
      if (tier === 'full') return 2;
      return -1;
    },
    TIER_ORDER: ['search', 'workflow', 'full'],
  };
});

vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: vi.fn(() => ({})),
}));

vi.mock('@server/registry/index', () => ({
  getAllDomains: () => new Set(['browser', 'network', 'workflow']),
  getAllRegistrations: () => [
    { domain: 'browser', tool: tool('browser_launch') },
    { domain: 'browser', tool: tool('page_navigate') },
    { domain: 'network', tool: tool('network_enable') },
    { domain: 'network', tool: tool('network_get_requests') },
  ],
  getAllManifests: () => [
    {
      domain: 'browser',
      workflowRule: {
        patterns: [/(browser|page|navigate|screenshot|click|type|scrape)/i],
        priority: 90,
        tools: ['page_navigate', 'page_screenshot', 'page_click', 'page_type', 'page_evaluate'],
        hint: 'Browser automation workflow',
      },
      prerequisites: {
        page_navigate: [
          {
            condition: 'Browser must be launched',
            fix: 'Call browser_launch or browser_attach first',
          },
        ],
      },
    },
    {
      domain: 'network',
      workflowRule: {
        patterns: [/(capture|intercept|monitor|hook).*(network|request|response|api|traffic)/i],
        priority: 100,
        tools: [
          'web_api_capture_session',
          'network_enable',
          'page_navigate',
          'network_get_requests',
        ],
        hint: 'Network capture workflow',
      },
      prerequisites: {
        network_get_requests: [
          {
            condition: 'Browser must be launched',
            fix: 'Call browser_launch or browser_attach first',
          },
          { condition: 'Network monitoring must be enabled', fix: 'Call network_enable first' },
        ],
      },
    },
  ],
}));

vi.mock('@server/ToolSearch', () => ({
  ToolSearchEngine: class MockToolSearchEngine {
    constructor(...args: any[]) {
      state.constructors.push({ args });
    }

    search(query: string, topK: number, activeNames?: Set<string>) {
      state.searches.push({
        query,
        topK,
        active: [...(activeNames ?? new Set<string>())].toSorted(),
      });
      if (state.searchImpl) {
        return state.searchImpl(query, topK, activeNames);
      }
      return [
        {
          name: `engine_${state.constructors.length}`,
          description: 'mock result',
          shortDescription: 'mock result',
          score: 1,
          domain: 'browser',
          isActive: activeNames?.has('page_navigate') ?? false,
        },
      ];
    }
  },
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@src/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/constants')>()),
  SEARCH_AUTO_ACTIVATE_DOMAINS: true,
  ACTIVATION_TTL_MINUTES: 30,
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 1.5,
  SEARCH_VECTOR_ENABLED: false,
}));

vi.mock('@server/extensions/ExtensionManager', () => ({
  ensureWorkflowsLoaded: vi.fn(async () => undefined),
}));

type RegisterSearchMetaTools = typeof import('@server/MCPServer.search').registerSearchMetaTools;
let registerSearchMetaTools: RegisterSearchMetaTools;

interface RegisteredToolInfo {
  options: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (args: Record<string, any>) => Promise<any>;
}

interface MockContext extends MCPServerContext {
  __registered: Map<string, RegisteredToolInfo>;
}

function createCtx(overrides: DeepPartial<MCPServerContext> = {}): MockContext {
  const registered = new Map<string, RegisteredToolInfo>();
  const ctx = {
    baseTier: 'search',
    selectedTools: [tool('browser_launch')],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map<
      string,
      { name: string; domain: string; tool: Tool; handler?: Function; registeredTool?: any }
    >(),
    extensionPluginsById: new Map<string, unknown>(),
    extensionWorkflowsById: new Map<string, unknown>(),
    extensionWorkflowRuntimeById: new Map<string, unknown>(),
    enabledDomains: new Set<string>(['browser']),
    activatedRegisteredTools: new Map<string, unknown>(),
    domainTtlEntries: new Map<string, unknown>(),
    metaToolsByName: new Map(),
    config: { search: structuredClone(DEFAULT_SEARCH_CONFIG) },
    router: { addHandlers: vi.fn(), removeHandler: vi.fn() },
    handlerDeps: {},
    server: {
      registerTool: vi.fn(
        (name: string, options: any, handler: (args: Record<string, unknown>) => Promise<any>) => {
          registered.set(name, { options, handler } as RegisteredToolInfo);
        },
      ),
      sendToolListChanged: vi.fn(async () => undefined),
    },
    registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    reloadExtensions: vi.fn(async () => ({ success: true })),
    listExtensions: vi.fn(() => ({ success: true })),
    __registered: registered,
    ...overrides,
  } as unknown as MockContext;
  return ctx;
}

interface McpResponse {
  content: { type: string; text: string }[];
  isError?: boolean;
}

interface SearchToolsResponse {
  results: Array<{
    name: string;
    description: string;
    score: number;
    domain: string;
    isActive: boolean;
  }>;
  resultCount: number;
  hint: string;
  nextActions: any[];
  autoActivatedDomains?: string[];
}

interface RouteToolResponse {
  autoActivated: boolean;
  activatedNames: string[];
  recommendations: Array<{ name: string; domain: string; isActive: boolean }>;
  nextActions: any[];
}

interface CommonSuccessResponse {
  success: boolean;
  activated?: string[];
  deactivated?: string[];
  alreadyActive?: string[];
  notActivated?: string[];
  notFound?: string[];
  totalActive?: number;
  hint?: string;
  tool?: Tool;
  domain?: string;
  activatedTools?: string[];
  totalDomainTools?: number;
  ttlMinutes?: number | string;
}

function parseResponse<T>(response: McpResponse): T {
  // @ts-expect-error — auto-suppressed [TS2532]
  const text = response.content[0].text;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Expected JSON response, got: ${text}`, { cause: error });
  }
}

describe('MCPServer.search', () => {
  beforeEach(async () => {
    state.constructors.length = 0;
    state.searches.length = 0;
    state.searchImpl = undefined;
    vi.clearAllMocks();
    vi.resetModules();
    ({ registerSearchMetaTools } = await import('@server/MCPServer.search'));
  });

  it('builds a description that includes loaded extension counts', () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow tool'),
          },
        ],
      ]),
      extensionWorkflowRuntimeById: new Map([['wf-1', {}]]),
    });

    registerSearchMetaTools(ctx);
    const searchToolsRegistration = ctx.__registered.get('search_tools')!;

    // Extension tool counted in total (4 built-in + 1 extension = 5)
    expect(searchToolsRegistration.options.description).toContain('Search 5 tools');
    // Extension tool's workflow domain appears
    expect(searchToolsRegistration.options.description).toContain('workflow (1)');
    expect(searchToolsRegistration.options.description).toContain(
      'activate_tools for exact matches',
    );
  });

  it('reuses the cached search engine when the signature is unchanged', async () => {
    const ctx = createCtx();
    ctx.activatedToolNames.add('page_navigate');

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    const first = parseResponse<SearchToolsResponse>(
      await searchHandler({ query: 'page', top_k: 5 }),
    );
    const second = parseResponse<SearchToolsResponse>(
      await searchHandler({ query: 'page', top_k: 5 }),
    );

    // @ts-expect-error — auto-suppressed [TS2532]
    expect(first.results[0].name).toBe('engine_1');
    // @ts-expect-error — auto-suppressed [TS2532]
    expect(second.results[0].name).toBe('engine_1');
    expect(state.constructors).toHaveLength(1);
    expect(state.searches).toHaveLength(2);
    expect(state.searches[0]?.active).toEqual(['browser_launch', 'page_navigate']);
  });

  it('defaults search_tools top_k to 10 when omitted', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    const response = parseResponse<SearchToolsResponse>(await searchHandler({ query: 'page' }));

    expect(response.resultCount).toBe(1);
    expect(state.searches).toHaveLength(1);
    expect(state.searches[0]?.topK).toBe(10);
  });

  it('returns a hint that explains tool usage', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    const response = parseResponse<SearchToolsResponse>(await searchHandler({ query: 'page' }));

    expect(response.hint).toContain(
      'For guided tool discovery with workflow detection, use route_tool instead',
    );
    expect(response.hint).toContain('activate_tools to enable specific tools');
  });

  it('returns direct-call nextActions with exampleArgs instead of forcing describe_tool', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    state.searchImpl = () => [
      {
        name: 'page_navigate',
        description: 'Navigate a page',
        shortDescription: 'Navigate a page',
        score: 1,
        domain: 'browser',
        isActive: false,
      },
    ];

    const response = parseResponse<SearchToolsResponse>(await searchHandler({ query: 'navigate' }));

    expect(response.nextActions).toEqual([
      {
        step: 1,
        action: 'activate_tools',
        command: 'activate_tools with names: ["page_navigate"]',
        description: 'Activate top 1 result(s)',
      },
      {
        step: 2,
        action: 'call',
        command: 'page_navigate',
        exampleArgs: {},
        description:
          'Call page_navigate. Use describe_tool("page_navigate") only if you need the full schema.',
      },
    ]);
  });

  it('auto-activates domains when search finds inactive tools in non-enabled domains', async () => {
    const ctx = createCtx({ enabledDomains: new Set<string>() });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    // Return inactive browser-domain tool from search
    state.searchImpl = () => [
      {
        name: 'page_navigate',
        description: 'Navigate to a page',
        shortDescription: 'Navigate to a page',
        score: 1,
        domain: 'browser',
        isActive: false,
      },
    ];

    const response = parseResponse<SearchToolsResponse>(
      await searchHandler({ query: 'page', top_k: 5 }),
    );

    // Should auto-activate the browser domain
    expect(response.autoActivatedDomains).toBeDefined();
  });

  it('does not auto-activate when all search results are already active', async () => {
    const ctx = createCtx();
    ctx.activatedToolNames.add('page_navigate');
    ctx.enabledDomains.add('browser');

    state.searchImpl = () => [
      {
        name: 'page_navigate',
        description: 'Navigate to a page',
        shortDescription: 'Navigate to a page',
        score: 1,
        domain: 'browser',
        isActive: true,
      },
    ];

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    const response = parseResponse<SearchToolsResponse>(
      await searchHandler({ query: 'page', top_k: 5 }),
    );

    expect(response.autoActivatedDomains).toBeUndefined();
  });

  it('does not auto-activate domains that are already enabled', async () => {
    const ctx = createCtx();
    ctx.enabledDomains.add('browser');

    state.searchImpl = () => [
      {
        name: 'page_navigate',
        description: 'Navigate to a page',
        shortDescription: 'Navigate to a page',
        score: 1,
        domain: 'browser',
        isActive: false,
      },
    ];

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    const response = parseResponse<SearchToolsResponse>(
      await searchHandler({ query: 'page', top_k: 5 }),
    );

    // Domain already enabled, should not auto-activate
    expect(response.autoActivatedDomains).toBeUndefined();
  });

  it('invalidates the cached search engine when extension signature changes', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    parseResponse<SearchToolsResponse>(await searchHandler({ query: 'page', top_k: 5 }));
    // @ts-expect-error — auto-suppressed [TS2345]
    ctx.extensionToolsByName.set('custom_tool', {
      name: 'custom_tool',
      domain: 'workflow',
      tool: tool('custom_tool', 'Custom workflow tool'),
    });
    const second = parseResponse<SearchToolsResponse>(
      await searchHandler({ query: 'page', top_k: 5 }),
    );

    expect(state.constructors).toHaveLength(2);
    // @ts-expect-error — auto-suppressed [TS2532]
    expect(second.results[0].name).toBe('engine_2');
  });

  it('invalidates the cached search engine when workflow runtime count changes', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    parseResponse<SearchToolsResponse>(await searchHandler({ query: 'network', top_k: 5 }));
    // @ts-expect-error — auto-suppressed [TS2345]
    ctx.extensionWorkflowRuntimeById.set('wf-1', {});
    parseResponse<SearchToolsResponse>(await searchHandler({ query: 'network', top_k: 5 }));

    expect(state.constructors).toHaveLength(2);
  });

  it('normalizes namespaced tool names for describe_tool and activate/deactivate_tools', async () => {
    const extensionHandler = vi.fn();
    const registeredTool = { remove: vi.fn() };
    const ctx = createCtx({
      extensionToolsByName: new Map<string, any>([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow tool'),
            handler: extensionHandler,
          },
        ],
      ]),
      registerSingleTool: vi.fn(() => registeredTool),
    });
    registerSearchMetaTools(ctx);

    const describeHandler = ctx.__registered.get('describe_tool')!.handler;
    const activateHandler = ctx.__registered.get('activate_tools')!.handler;
    const deactivateHandler = ctx.__registered.get('deactivate_tools')!.handler;

    expect(
      parseResponse<CommonSuccessResponse>(
        await describeHandler({ name: 'mcp__jshook__page_navigate' }),
      ),
    ).toEqual({
      success: true,
      tool: {
        name: 'page_navigate',
        description: 'Navigate a page',
        inputSchema: { type: 'object', properties: {} },
      },
    });

    expect(
      parseResponse<CommonSuccessResponse>(
        await activateHandler({
          names: ['mcp__jshook__network_get_requests', 'mcp__jshook__custom_tool'],
        }),
      ),
    ).toEqual({
      success: true,
      activated: ['network_get_requests', 'custom_tool'],
      alreadyActive: [],
      notFound: [],
      totalActive: 3,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
    expect(ctx.activatedToolNames.has('network_get_requests')).toBe(true);
    expect(ctx.activatedToolNames.has('custom_tool')).toBe(true);

    expect(
      parseResponse<CommonSuccessResponse>(
        await deactivateHandler({
          names: ['mcp__jshook__custom_tool'],
        }),
      ),
    ).toEqual({
      success: true,
      deactivated: ['custom_tool'],
      notActivated: [],
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    });
  });

  it('auto-activates route_tool recommendations and returns canonical activated names', async () => {
    const ctx = createCtx({
      selectedTools: [],
      registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    });
    registerSearchMetaTools(ctx);
    const routeHandler = ctx.__registered.get('route_tool')!.handler;

    state.searchImpl = () => [
      {
        name: 'page_navigate',
        description: 'Navigate a page',
        shortDescription: 'Navigate a page',
        score: 1,
        domain: 'browser',
        isActive: false,
      },
    ];

    const response = parseResponse<RouteToolResponse>(
      await routeHandler({ task: 'inspect page state' }),
    );

    expect(response.autoActivated).toBe(true);
    expect(response.activatedNames).toEqual(['browser_launch', 'page_navigate']);
    expect(response.recommendations[0]).toMatchObject({
      name: 'browser_launch',
      isActive: true,
    });
    expect(response.recommendations[1]).toMatchObject({
      name: 'page_navigate',
      isActive: true,
    });
    expect(response.nextActions[0]).toEqual({
      step: 1,
      action: 'call',
      toolName: 'browser_launch',
      command: 'browser_launch',
      exampleArgs: {},
      description:
        'Call browser_launch. Use describe_tool("browser_launch") only if you need the full schema.',
    });
  });

  it('route_tool prioritizes browser bootstrap and downranks maintenance noise when no active page exists', async () => {
    const ctx = createCtx({
      selectedTools: [],
      pageController: {
        getPage: vi.fn(async () => {
          throw new Error('no page');
        }),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: false })),
        getNetworkRequests: vi.fn(() => []),
      },
    });
    registerSearchMetaTools(ctx);
    const routeHandler = ctx.__registered.get('route_tool')!.handler;

    state.searchImpl = () => [
      {
        name: 'get_token_budget_stats',
        description: 'Inspect token budget state',
        shortDescription: 'Inspect token budget state',
        score: 50,
        domain: 'maintenance',
        isActive: false,
      },
      {
        name: 'network_get_requests',
        description: 'Inspect network requests',
        shortDescription: 'Inspect network requests',
        score: 20,
        domain: 'network',
        isActive: false,
      },
    ];

    const response = parseResponse<RouteToolResponse>(
      await routeHandler({
        task: 'capture network traffic for this page',
        context: { autoActivate: false },
      }),
    );

    // @ts-expect-error — auto-suppressed [TS2532]
    expect(response.recommendations[0].name).toBe('browser_launch');
    expect(response.recommendations.slice(0, 2).map((item) => item.name)).not.toContain(
      'get_token_budget_stats',
    );
    expect(response.nextActions[0]).toEqual({
      step: 1,
      action: 'activate',
      toolName: undefined,
      command:
        'activate_tools with names: ["browser_launch", "network_enable", "page_navigate", "network_get_requests"]',
      description: 'Activate 4 recommended tools',
    });
  });

  it('route_tool prioritizes network_enable when a page exists but monitoring is still off', async () => {
    const ctx = createCtx({
      selectedTools: [],
      pageController: {
        getPage: vi.fn(async () => ({})),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: false })),
        getNetworkRequests: vi.fn(() => []),
      },
    });
    registerSearchMetaTools(ctx);
    const routeHandler = ctx.__registered.get('route_tool')!.handler;

    state.searchImpl = () => [
      {
        name: 'network_get_requests',
        description: 'Inspect network requests',
        shortDescription: 'Inspect network requests',
        score: 10,
        domain: 'network',
        isActive: false,
      },
      {
        name: 'get_token_budget_stats',
        description: 'Inspect token budget state',
        shortDescription: 'Inspect token budget state',
        score: 9,
        domain: 'maintenance',
        isActive: false,
      },
    ];

    const response = parseResponse<RouteToolResponse>(
      await routeHandler({
        task: 'capture network traffic for this page',
        context: { autoActivate: false },
      }),
    );

    // @ts-expect-error — auto-suppressed [TS2532]
    expect(response.recommendations[0].name).toBe('network_enable');
  });

  it('route_tool prioritizes network_get_requests when requests are already available', async () => {
    const ctx = createCtx({
      selectedTools: [],
      pageController: {
        getPage: vi.fn(async () => ({})),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: true })),
        getNetworkRequests: vi.fn(() => [{ id: '1' }]),
      },
    });
    registerSearchMetaTools(ctx);
    const routeHandler = ctx.__registered.get('route_tool')!.handler;

    state.searchImpl = () => [
      {
        name: 'get_token_budget_stats',
        description: 'Inspect token budget state',
        shortDescription: 'Inspect token budget state',
        score: 20,
        domain: 'maintenance',
        isActive: false,
      },
      {
        name: 'page_navigate',
        description: 'Navigate a page',
        shortDescription: 'Navigate a page',
        score: 10,
        domain: 'browser',
        isActive: false,
      },
    ];

    const response = parseResponse<RouteToolResponse>(
      await routeHandler({
        task: 'capture network traffic for this page',
        context: { autoActivate: false },
      }),
    );

    // @ts-expect-error — auto-suppressed [TS2532]
    expect(response.recommendations[0].name).toBe('network_get_requests');
  });

  it('rejects invalid activate_tools and deactivate_tools payloads', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);

    const activateHandler = ctx.__registered.get('activate_tools')!.handler;
    const deactivateHandler = ctx.__registered.get('deactivate_tools')!.handler;

    expect(
      parseResponse<CommonSuccessResponse>(await activateHandler({ names: 'not an array' })),
    ).toEqual({
      success: false,
      error: 'names must be an array',
    } as any);
    expect(
      parseResponse<CommonSuccessResponse>(
        await deactivateHandler({ names: ['browser_launch', ''] }),
      ),
    ).toEqual({
      success: false,
      error: 'invalid tool name: expected non-empty string',
    } as any);
  });

  it('activates built-in and extension tools and reports already active or missing names', async () => {
    const extensionHandler = vi.fn();
    const registeredTool = { remove: vi.fn() };
    const ctx = createCtx({
      activatedToolNames: new Set(['page_navigate']),
      extensionToolsByName: new Map<string, any>([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow tool'),
            handler: extensionHandler,
          },
        ],
      ]),
      registerSingleTool: vi.fn(() => registeredTool),
    });
    // @ts-expect-error — auto-suppressed [TS2339]
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('notify failed'));

    registerSearchMetaTools(ctx);
    const activateHandler = ctx.__registered.get('activate_tools')!.handler;
    const response = parseResponse<CommonSuccessResponse>(
      await activateHandler({
        names: ['page_navigate', 'network_get_requests', 'custom_tool', 'missing_tool'],
      }),
    );

    expect(response).toEqual({
      success: true,
      activated: ['network_get_requests', 'custom_tool'],
      alreadyActive: ['page_navigate'],
      notFound: ['missing_tool'],
      totalActive: 4,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
    expect(ctx.enabledDomains).toEqual(new Set(['browser', 'network', 'workflow']));
    expect(vi.mocked(createToolHandlerMap)).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['network_get_requests']),
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({});
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
    expect(ctx.extensionToolsByName.get('custom_tool')!.registeredTool).toBe(registeredTool);
  });

  it('deactivates tools, tolerates removal failures, and clears extension state', async () => {
    const remove = vi.fn(() => {
      throw new Error('remove failed');
    });
    const ctx = createCtx({
      activatedToolNames: new Set(['custom_tool']),
      activatedRegisteredTools: new Map([['custom_tool', { remove }]]),
      extensionToolsByName: new Map<string, any>([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow tool'),
            registeredTool: { remove },
          },
        ],
      ]),
    });
    // @ts-expect-error — auto-suppressed [TS2339]
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('notify failed'));

    registerSearchMetaTools(ctx);
    const deactivateHandler = ctx.__registered.get('deactivate_tools')!.handler;
    const response = parseResponse<CommonSuccessResponse>(
      await deactivateHandler({ names: ['custom_tool', 'missing_tool'] }),
    );

    expect(response).toEqual({
      success: true,
      deactivated: ['custom_tool'],
      notActivated: ['missing_tool'],
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    });
    expect(remove).toHaveBeenCalled();
    expect(ctx.router.removeHandler).toHaveBeenCalledWith('custom_tool');
    expect(ctx.activatedToolNames.has('custom_tool')).toBe(false);
    expect(ctx.activatedRegisteredTools.has('custom_tool')).toBe(false);
    expect(ctx.extensionToolsByName.get('custom_tool')!.registeredTool).toBeUndefined();
  });

  it('validates activate_domain input and reports unknown domains', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);

    const activateDomainHandler = ctx.__registered.get('activate_domain')!.handler;

    expect(parseResponse<CommonSuccessResponse>(await activateDomainHandler({}))).toEqual({
      success: false,
      error: 'domain must be a non-empty string',
    } as any);
    expect(
      parseResponse<CommonSuccessResponse>(await activateDomainHandler({ domain: 'missing' })),
    ).toEqual({
      success: false,
      error: 'Unknown domain "missing". Valid: browser, network, workflow',
    } as any);
  });

  it('activates a mixed builtin and extension domain and no-ops when already active', async () => {
    const extensionHandler = vi.fn();
    const registeredTool = { remove: vi.fn() };
    const ctx = createCtx({
      extensionToolsByName: new Map<string, any>([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'browser',
            tool: tool('custom_tool', 'Custom browser tool'),
            handler: extensionHandler,
          },
        ],
      ]),
      registerSingleTool: vi.fn(() => registeredTool),
    });
    // @ts-expect-error — auto-suppressed [TS2339]
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('notify failed'));

    registerSearchMetaTools(ctx);
    const activateDomainHandler = ctx.__registered.get('activate_domain')!.handler;

    const first = parseResponse<CommonSuccessResponse>(
      await activateDomainHandler({ domain: 'browser' }),
    );
    const second = parseResponse<CommonSuccessResponse>(
      await activateDomainHandler({ domain: 'browser' }),
    );

    expect(first).toEqual({
      success: true,
      domain: 'browser',
      activated: 2,
      activatedTools: ['page_navigate', 'custom_tool'],
      totalDomainTools: 3,
      ttlMinutes: 30,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
    expect(second).toEqual({
      success: true,
      domain: 'browser',
      activated: 0,
      activatedTools: [],
      totalDomainTools: 3,
      ttlMinutes: 30,
    });
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(vi.mocked(createToolHandlerMap)).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['page_navigate']),
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({});
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
    expect(ctx.extensionToolsByName.get('custom_tool')!.registeredTool).toBe(registeredTool);
  });

  it('activates an extension-only domain without creating builtin handlers', async () => {
    const extensionHandler = vi.fn();
    const registeredTool = { remove: vi.fn() };
    const ctx = createCtx({
      extensionToolsByName: new Map<string, any>([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'custom',
            tool: tool('custom_tool', 'Custom extension tool'),
            handler: extensionHandler,
          },
        ],
      ]),
      registerSingleTool: vi.fn(() => registeredTool),
    });

    registerSearchMetaTools(ctx);
    const activateDomainHandler = ctx.__registered.get('activate_domain')!.handler;
    const response = parseResponse<CommonSuccessResponse>(
      await activateDomainHandler({ domain: 'custom' }),
    );

    expect(response).toEqual({
      success: true,
      domain: 'custom',
      activated: 1,
      activatedTools: ['custom_tool'],
      totalDomainTools: 1,
      ttlMinutes: 30,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
    expect(vi.mocked(createToolHandlerMap)).not.toHaveBeenCalled();
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
  });

  it('activate_domain with ttlMinutes=0 passes no-expiry', async () => {
    const ctx = createCtx({
      registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    });

    registerSearchMetaTools(ctx);
    const activateDomainHandler = ctx.__registered.get('activate_domain')!.handler;
    const response = parseResponse<CommonSuccessResponse>(
      await activateDomainHandler({ domain: 'browser', ttlMinutes: 0 }),
    );

    expect(response.ttlMinutes).toBe('no expiry');
    expect(response.activated).toBeGreaterThan(0);
  });

  it('does not register extensions_list or extensions_reload as search meta-tools', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);

    // These tools are only in the maintenance domain now, not duplicated as search meta-tools
    expect(ctx.__registered.has('extensions_list')).toBe(false);
    expect(ctx.__registered.has('extensions_reload')).toBe(false);
  });

  it('wraps search_tools failures as error responses', async () => {
    const ctx = createCtx();
    state.searchImpl = () => {
      throw new Error('search exploded');
    };
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools')!.handler;

    const response = await searchHandler({ query: 'page' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: search exploded');
  });

  it('wraps activate_tools failures as error responses', async () => {
    const ctx = createCtx({
      registerSingleTool: vi.fn(() => {
        throw new Error('activate exploded');
      }),
    });
    registerSearchMetaTools(ctx);
    const activateHandler = ctx.__registered.get('activate_tools')!.handler;

    const response = await activateHandler({ names: ['network_get_requests'] });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: activate exploded');
  });

  it('wraps deactivate_tools failures as error responses', async () => {
    const ctx = createCtx({
      activatedToolNames: new Set(['custom_tool']),
      router: {
        addHandlers: vi.fn(),
        removeHandler: vi.fn(() => {
          throw new Error('deactivate exploded');
        }),
      },
    });
    registerSearchMetaTools(ctx);
    const deactivateHandler = ctx.__registered.get('deactivate_tools')!.handler;

    const response = await deactivateHandler({ names: ['custom_tool'] });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: deactivate exploded');
  });

  it('wraps activate_domain failures as error responses', async () => {
    const ctx = createCtx({
      registerSingleTool: vi.fn(() => {
        throw new Error('domain exploded');
      }),
    });
    registerSearchMetaTools(ctx);
    const activateDomainHandler = ctx.__registered.get('activate_domain')!.handler;

    const response = await activateDomainHandler({ domain: 'browser' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: domain exploded');
  });
});

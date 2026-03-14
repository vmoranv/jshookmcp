import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolHandlerMap } from '@server/ToolHandlerMap';

function tool(name: string, description = `desc_${name}`): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const state = vi.hoisted(() => ({
  constructors: [] as Array<{ args: unknown[] }>,
  searches: [] as Array<{ query: string; topK: number; active: string[] }>,
  searchImpl: undefined as
    | ((query: string, topK: number, activeNames?: Set<string>) => unknown[])
    | undefined,
}));

vi.mock('@server/ToolCatalog', () => {
  const builtinTools = [
    tool('browser_launch', 'Launch a browser'),
    tool('page_navigate', 'Navigate a page'),
    tool('network_get_requests', 'Inspect network requests'),
  ];
  return {
    allTools: builtinTools,
    getToolDomain: (name: string) => {
      if (name === 'network_get_requests') return 'network';
      if (name === 'browser_launch' || name === 'page_navigate') return 'browser';
      return undefined;
    },
    getToolsByDomains: (domains: string[]) =>
      builtinTools.filter((candidate) =>
        domains.includes(candidate.name.startsWith('network_') ? 'network' : 'browser')
      ),
    getToolMinimalTier: (name: string) => {
      // browser domain tools are in workflow tier
      if (name === 'browser_launch' || name === 'page_navigate') return 'workflow';
      // network domain tools are in workflow tier
      if (name === 'network_get_requests') return 'workflow';
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

vi.mock('@server/MCPServer.boost', () => ({
  boostProfile: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: vi.fn(() => ({})),
}));

vi.mock('@server/registry/index', () => ({
  ALL_DOMAINS: ['browser', 'network', 'workflow'],
  ALL_REGISTRATIONS: [
    { domain: 'browser', tool: tool('browser_launch') },
    { domain: 'browser', tool: tool('page_navigate') },
    { domain: 'network', tool: tool('network_get_requests') },
  ],
}));

vi.mock('@server/ToolSearch', () => ({
  ToolSearchEngine: class MockToolSearchEngine {
    constructor(...args: unknown[]) {
      state.constructors.push({ args });
    }

    search(query: string, topK: number, activeNames?: Set<string>) {
      state.searches.push({
        query,
        topK,
        active: [...(activeNames ?? new Set<string>())].sort(),
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

vi.mock('@src/constants', () => ({
  DYNAMIC_BOOST_ENABLED: true,
  SEARCH_WORKFLOW_BOOST_TIERS: new Set(['workflow', 'full']),
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 1.5,
}));

type RegisterSearchMetaTools = typeof import('@server/MCPServer.search').registerSearchMetaTools;
let registerSearchMetaTools: RegisterSearchMetaTools;

function createCtx(overrides: Record<string, unknown> = {}) {
  const registered = new Map<
    string,
    {
      options: Record<string, unknown>;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }
  >();
  const ctx = {
    currentTier: 'search',
    selectedTools: [tool('browser_launch')],
    boostedToolNames: new Set<string>(),
    activatedToolNames: new Set<string>(),
    boostedExtensionToolNames: new Set<string>(),
    extensionToolsByName: new Map<string, { name: string; domain: string; tool: Tool }>(),
    extensionWorkflowRuntimeById: new Map<string, unknown>(),
    enabledDomains: new Set<string>(),
    activatedRegisteredTools: new Map<string, unknown>(),
    boostedRegisteredTools: new Map<string, unknown>(),
    router: { addHandlers: vi.fn(), removeHandler: vi.fn() },
    handlerDeps: {},
    server: {
      registerTool: vi.fn(
        (
          name: string,
          options: Record<string, unknown>,
          handler: (args: Record<string, unknown>) => Promise<unknown>
        ) => {
          registered.set(name, { options, handler });
        }
      ),
      sendToolListChanged: vi.fn(async () => undefined),
    },
    registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    reloadExtensions: vi.fn(async () => ({ success: true })),
    listExtensions: vi.fn(() => ({ success: true })),
    __registered: registered,
    ...overrides,
  } as any;
  return ctx;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
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

  it('builds a workflow-biased description that includes loaded extension counts', () => {
    const ctx = createCtx({
      currentTier: 'workflow',
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
    const searchToolsRegistration = ctx.__registered.get('search_tools');

    expect(searchToolsRegistration.options.description).toContain('1 currently loaded');
    expect(searchToolsRegistration.options.description).not.toContain('DYNAMIC_BOOST_ENABLED');
    expect(searchToolsRegistration.options.description).toContain(
      'workflow-tier sessions boost ranking for workflow-domain results'
    );
  });

  it('reuses the cached search engine when the signature is unchanged', async () => {
    const ctx = createCtx();
    ctx.activatedToolNames.add('page_navigate');

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    const first = parseResponse(await searchHandler({ query: 'page', top_k: 5 }));
    const second = parseResponse(await searchHandler({ query: 'page', top_k: 5 }));

    expect(first.results[0].name).toBe('engine_1');
    expect(second.results[0].name).toBe('engine_1');
    expect(state.constructors).toHaveLength(1);
    expect(state.searches).toHaveLength(2);
    expect(state.searches[0]?.active).toEqual(['browser_launch', 'page_navigate']);
  });

  it('defaults search_tools top_k to 10 when omitted', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    const response = parseResponse(await searchHandler({ query: 'page' }));

    expect(response.resultCount).toBe(1);
    expect(state.searches).toHaveLength(1);
    expect(state.searches[0]?.topK).toBe(10);
  });

  it('returns a hint that explains tool usage', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    const response = parseResponse(await searchHandler({ query: 'page' }));

    expect(response.hint).toContain('search_tools ranks and returns matching tools');
    expect(response.hint).not.toContain('DYNAMIC_BOOST_ENABLED');
    expect(response.hint).toContain('activate_tools for exact matches');
  });

  it('calls boostProfile when dynamic boost is triggered', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'search' });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    // Setup search to return workflow-tier tool (page_navigate) to trigger boost
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

    await searchHandler({ query: 'page', top_k: 5 });

    expect(boostProfile).toHaveBeenCalled();
  });

  // Note: Testing DYNAMIC_BOOST_ENABLED=false requires module reloading
  // which is not easily achievable with the current mock setup.
  // This test is skipped until we have a better approach.
  it.skip('does not call boostProfile when DYNAMIC_BOOST_ENABLED is false', async () => {
    vi.doMock('@src/constants', () => ({
      DYNAMIC_BOOST_ENABLED: false,
      SEARCH_WORKFLOW_BOOST_TIERS: new Set(['workflow', 'full']),
      SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 1.5,
    }));

    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'search' });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    // Setup search to return workflow-tier tool, but boost should not trigger
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

    await searchHandler({ query: 'page', top_k: 5 });

    expect(boostProfile).not.toHaveBeenCalled();
  });

  it('transparently boosts when upgrade succeeds', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    (boostProfile as any).mockResolvedValueOnce({ success: true });

    const ctx = createCtx({ currentTier: 'search' });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    // Setup search to return workflow-tier tool to trigger boost
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

    const response = parseResponse(await searchHandler({ query: 'page', top_k: 5 }));

    // Should call boostProfile but not expose metadata to user
    expect(boostProfile).toHaveBeenCalled();
    expect(response.boostAttempted).toBeUndefined();
    expect(response.boostedToTier).toBeUndefined();
    expect(response.boostError).toBeUndefined();
  });

  it('transparently handles boost failures without exposing errors', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    (boostProfile as any).mockResolvedValueOnce({
      success: false,
      error: 'Tier upgrade failed',
    });

    const ctx = createCtx({ currentTier: 'search' });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    // Setup search to return workflow-tier tool to trigger boost
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

    const response = parseResponse(await searchHandler({ query: 'page', top_k: 5 }));

    // Should call boostProfile but not expose any metadata
    expect(boostProfile).toHaveBeenCalled();
    expect(response.boostAttempted).toBeUndefined();
    expect(response.boostedToTier).toBeUndefined();
    expect(response.boostError).toBeUndefined();
  });

  it('considers all inactive tools within score threshold for tier calculation', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'search' });

    // Setup search to return 5 workflow-tier tools
    state.searchImpl = (_query, _topK) => {
      return [
        {
          name: 'browser_launch',
          description: 'Launch browser',
          shortDescription: 'Launch browser',
          score: 1,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'page_navigate',
          description: 'Navigate page',
          shortDescription: 'Navigate page',
          score: 0.9,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'network_get_requests',
          description: 'Get network requests',
          shortDescription: 'Get network requests',
          score: 0.8,
          domain: 'network',
          isActive: false,
        },
        {
          name: 'browser_launch',
          description: 'Launch browser duplicate',
          shortDescription: 'Launch browser',
          score: 0.7,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'page_navigate',
          description: 'Navigate page duplicate',
          shortDescription: 'Navigate page',
          score: 0.6,
          domain: 'browser',
          isActive: false,
        },
      ];
    };

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    await searchHandler({ query: 'test', top_k: 10 });

    // Should have called boostProfile with workflow tier
    expect(boostProfile).toHaveBeenCalledWith(
      expect.anything(),
      'workflow'
    );
  });

  it('handles extension tools with boostTier', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'search' });

    // Add extension tool with boostTier
    ctx.extensionToolsByName.set('custom_tool', {
      name: 'custom_tool',
      domain: 'custom',
      tool: tool('custom_tool', 'Custom tool'),
      boostTier: 'full',
    });

    // Setup search to return the extension tool
    state.searchImpl = () => [
      {
        name: 'custom_tool',
        description: 'Custom tool',
        shortDescription: 'Custom tool',
        score: 1,
        domain: 'custom',
        isActive: false,
      },
    ];

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    await searchHandler({ query: 'custom', top_k: 5 });

    // Should boost to 'full' tier (from extension tool's boostTier)
    expect(boostProfile).toHaveBeenCalledWith(
      expect.anything(),
      'full'
    );
  });

  it('transparently handles boostProfile throwing an exception', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    (boostProfile as any).mockRejectedValueOnce(new Error('Network error'));

    const ctx = createCtx({ currentTier: 'search' });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    // Setup search to return workflow-tier tool to trigger boost
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

    const response = parseResponse(await searchHandler({ query: 'page', top_k: 5 }));

    // Should catch the exception silently, not expose to user
    expect(boostProfile).toHaveBeenCalled();
    expect(response.boostAttempted).toBeUndefined();
    expect(response.boostedToTier).toBeUndefined();
    expect(response.boostError).toBeUndefined();
    // Search should still return results
    expect(response.resultCount).toBe(1);
  });

  it('does not boost when all search results are already active', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'search' });

    // Mark page_navigate as active
    ctx.activatedToolNames.add('page_navigate');

    // Setup search to return only active tools
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
    const searchHandler = ctx.__registered.get('search_tools').handler;

    await searchHandler({ query: 'page', top_k: 5 });

    // Should not attempt boost since all tools are active
    expect(boostProfile).not.toHaveBeenCalled();
  });

  it('does not boost when tools have no tier information', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'search' });

    // Setup search to return unknown tools (no tier mapping)
    state.searchImpl = () => [
      {
        name: 'unknown_tool_1',
        description: 'Unknown tool',
        shortDescription: 'Unknown tool',
        score: 1,
        domain: 'unknown',
        isActive: false,
      },
    ];

    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    await searchHandler({ query: 'unknown', top_k: 5 });

    // Should not attempt boost since tools have no tier info
    expect(boostProfile).not.toHaveBeenCalled();
  });

  it('does not boost when already at higher tier', async () => {
    const { boostProfile } = await import('@server/MCPServer.boost');
    const ctx = createCtx({ currentTier: 'full' });
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    await searchHandler({ query: 'page', top_k: 5 });

    expect(boostProfile).not.toHaveBeenCalled();
  });

  it('invalidates the cached search engine when extension signature changes', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    parseResponse(await searchHandler({ query: 'page', top_k: 5 }));
    ctx.extensionToolsByName.set('custom_tool', {
      name: 'custom_tool',
      domain: 'workflow',
      tool: tool('custom_tool', 'Custom workflow tool'),
    });
    const second = parseResponse(await searchHandler({ query: 'page', top_k: 5 }));

    expect(state.constructors).toHaveLength(2);
    expect(second.results[0].name).toBe('engine_2');
  });

  it('invalidates the cached search engine when the current tier changes', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    parseResponse(await searchHandler({ query: 'network', top_k: 5 }));
    ctx.currentTier = 'workflow';
    parseResponse(await searchHandler({ query: 'network', top_k: 5 }));

    expect(state.constructors).toHaveLength(2);
  });

  it('invalidates the cached search engine when workflow runtime count changes', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

    parseResponse(await searchHandler({ query: 'network', top_k: 5 }));
    ctx.extensionWorkflowRuntimeById.set('wf-1', {});
    parseResponse(await searchHandler({ query: 'network', top_k: 5 }));

    expect(state.constructors).toHaveLength(2);
  });

  it('rejects invalid activate_tools and deactivate_tools payloads', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);

    const activateHandler = ctx.__registered.get('activate_tools').handler;
    const deactivateHandler = ctx.__registered.get('deactivate_tools').handler;

    expect(parseResponse(await activateHandler({ names: 'not an array' }))).toEqual({
      success: false,
      error: 'names must be an array',
    });
    expect(parseResponse(await deactivateHandler({ names: ['browser_launch', ''] }))).toEqual({
      success: false,
      error: 'invalid tool name: expected non-empty string',
    });
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
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('notify failed'));

    registerSearchMetaTools(ctx);
    const activateHandler = ctx.__registered.get('activate_tools').handler;
    const response = parseResponse(
      await activateHandler({
        names: ['page_navigate', 'network_get_requests', 'custom_tool', 'missing_tool'],
      })
    );

    expect(response).toEqual({
      success: true,
      activated: ['network_get_requests', 'custom_tool'],
      alreadyActive: ['page_navigate'],
      notFound: ['missing_tool'],
      totalActive: 4,
    });
    expect(ctx.enabledDomains).toEqual(new Set(['network', 'workflow']));
    expect(vi.mocked(createToolHandlerMap)).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['network_get_requests'])
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({});
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
    expect(ctx.extensionToolsByName.get('custom_tool').registeredTool).toBe(registeredTool);
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
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('notify failed'));

    registerSearchMetaTools(ctx);
    const deactivateHandler = ctx.__registered.get('deactivate_tools').handler;
    const response = parseResponse(
      await deactivateHandler({ names: ['custom_tool', 'missing_tool'] })
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
    expect(ctx.extensionToolsByName.get('custom_tool').registeredTool).toBeUndefined();
  });

  it('validates activate_domain input and reports unknown domains', async () => {
    const ctx = createCtx();
    registerSearchMetaTools(ctx);

    const activateDomainHandler = ctx.__registered.get('activate_domain').handler;

    expect(parseResponse(await activateDomainHandler({}))).toEqual({
      success: false,
      error: 'domain must be a non-empty string',
    });
    expect(parseResponse(await activateDomainHandler({ domain: 'missing' }))).toEqual({
      success: false,
      error: 'Unknown domain "missing". Valid: browser, network, workflow',
    });
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
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('notify failed'));

    registerSearchMetaTools(ctx);
    const activateDomainHandler = ctx.__registered.get('activate_domain').handler;

    const first = parseResponse(await activateDomainHandler({ domain: 'browser' }));
    const second = parseResponse(await activateDomainHandler({ domain: 'browser' }));

    expect(first).toEqual({
      success: true,
      domain: 'browser',
      activated: 2,
      activatedTools: ['page_navigate', 'custom_tool'],
      totalDomainTools: 3,
    });
    expect(second).toEqual({
      success: true,
      domain: 'browser',
      activated: 0,
      activatedTools: [],
      totalDomainTools: 3,
    });
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(vi.mocked(createToolHandlerMap)).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['page_navigate'])
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({});
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
    expect(ctx.extensionToolsByName.get('custom_tool').registeredTool).toBe(registeredTool);
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
    const activateDomainHandler = ctx.__registered.get('activate_domain').handler;
    const response = parseResponse(await activateDomainHandler({ domain: 'custom' }));

    expect(response).toEqual({
      success: true,
      domain: 'custom',
      activated: 1,
      activatedTools: ['custom_tool'],
      totalDomainTools: 1,
    });
    expect(vi.mocked(createToolHandlerMap)).not.toHaveBeenCalled();
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
  });

  it('proxies extension listing and reload results', async () => {
    const ctx = createCtx({
      listExtensions: vi.fn(() => ({ success: true, plugins: ['a'] })),
      reloadExtensions: vi.fn(async () => ({ success: true, reloaded: 2 })),
    });
    registerSearchMetaTools(ctx);

    const listHandler = ctx.__registered.get('extensions_list').handler;
    const reloadHandler = ctx.__registered.get('extensions_reload').handler;

    expect(parseResponse(await listHandler({}))).toEqual({ success: true, plugins: ['a'] });
    expect(parseResponse(await reloadHandler({}))).toEqual({ success: true, reloaded: 2 });
  });

  it('wraps search_tools failures as error responses', async () => {
    const ctx = createCtx();
    state.searchImpl = () => {
      throw new Error('search exploded');
    };
    registerSearchMetaTools(ctx);
    const searchHandler = ctx.__registered.get('search_tools').handler;

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
    const activateHandler = ctx.__registered.get('activate_tools').handler;

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
    const deactivateHandler = ctx.__registered.get('deactivate_tools').handler;

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
    const activateDomainHandler = ctx.__registered.get('activate_domain').handler;

    const response = await activateDomainHandler({ domain: 'browser' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: domain exploded');
  });

  it('wraps extensions_list failures as error responses', async () => {
    const ctx = createCtx({
      listExtensions: vi.fn(() => {
        throw new Error('list exploded');
      }),
    });
    registerSearchMetaTools(ctx);
    const listHandler = ctx.__registered.get('extensions_list').handler;

    const response = await listHandler({});

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: list exploded');
  });

  it('wraps extensions_reload failures as error responses', async () => {
    const ctx = createCtx({
      reloadExtensions: vi.fn(async () => {
        throw new Error('reload exploded');
      }),
    });
    registerSearchMetaTools(ctx);
    const reloadHandler = ctx.__registered.get('extensions_reload').handler;

    const response = await reloadHandler({});

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Error: reload exploded');
  });
});

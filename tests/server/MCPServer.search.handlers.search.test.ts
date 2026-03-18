import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  engine: {
    search: vi.fn(),
  },
  activeNames: new Set<string>(),
  getSearchEngine: vi.fn(),
  getActiveToolNames: vi.fn(),
  handleActivateDomain: vi.fn(),
  describeTool: vi.fn(),
  generateExampleArgs: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({
    content: [{ type: 'text', text }],
  }),
}));

vi.mock('@server/MCPServer.search.helpers', () => ({
  getSearchEngine: state.getSearchEngine,
  getActiveToolNames: state.getActiveToolNames,
}));

vi.mock('@server/MCPServer.search.handlers.domain', () => ({
  handleActivateDomain: state.handleActivateDomain,
}));

vi.mock('@server/ToolRouter', () => ({
  describeTool: state.describeTool,
  generateExampleArgs: state.generateExampleArgs,
}));

vi.mock('@src/constants', () => ({
  SEARCH_AUTO_ACTIVATE_DOMAINS: true,
  ACTIVATION_TTL_MINUTES: 30,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

import { handleSearchTools } from '@server/MCPServer.search.handlers.search';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    enabledDomains: new Set<string>(),
    ...overrides,
  } as any;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('MCPServer.search.handlers.search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.activeNames = new Set<string>();
    state.getSearchEngine.mockReturnValue(state.engine);
    state.getActiveToolNames.mockImplementation(() => new Set(state.activeNames));
    state.handleActivateDomain.mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });
    state.describeTool.mockReturnValue({
      name: 'page_navigate',
      inputSchema: { type: 'object', properties: {} },
    });
    state.generateExampleArgs.mockReturnValue({});
  });

  it('uses the default top_k and returns direct call guidance for active top results', async () => {
    const ctx = createCtx({
      enabledDomains: new Set(['browser']),
    });
    state.activeNames = new Set(['page_navigate']);
    state.engine.search.mockReturnValue([
      {
        name: 'page_navigate',
        description: 'Navigate page',
        shortDescription: 'Navigate page',
        score: 10,
        domain: 'browser',
        isActive: true,
      },
    ]);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'navigate' }));

    expect(state.engine.search).toHaveBeenCalledWith('navigate', 10, new Set(['page_navigate']));
    expect(response.nextActions).toEqual([
      {
        step: 1,
        action: 'call',
        command: 'page_navigate',
        exampleArgs: {},
        description:
          'Call page_navigate directly. Use describe_tool("page_navigate") only if you need the full schema.',
      },
    ]);
  });

  it('builds activate_tools guidance from the top three inactive results', async () => {
    const ctx = createCtx({
      enabledDomains: new Set(['browser', 'network', 'workflow', 'core']),
    });
    state.engine.search.mockReturnValue([
      {
        name: 'page_navigate',
        description: 'Navigate page',
        shortDescription: 'Navigate page',
        score: 10,
        domain: 'browser',
        isActive: false,
      },
      {
        name: 'network_enable',
        description: 'Enable network',
        shortDescription: 'Enable network',
        score: 9,
        domain: 'network',
        isActive: false,
      },
      {
        name: 'network_get_requests',
        description: 'Get requests',
        shortDescription: 'Get requests',
        score: 8,
        domain: 'network',
        isActive: false,
      },
      {
        name: 'run_extension_workflow',
        description: 'Run workflow',
        shortDescription: 'Run workflow',
        score: 7,
        domain: 'workflow',
        isActive: false,
      },
    ]);
    state.describeTool.mockReturnValue({
      name: 'page_navigate',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    });
    state.generateExampleArgs.mockReturnValue({ url: 'https://example.com' });

    const response = parseResponse(await handleSearchTools(ctx, { query: 'inspect' }));

    expect(response.nextActions).toEqual([
      {
        step: 1,
        action: 'activate_tools',
        command:
          'activate_tools with names: ["page_navigate", "network_enable", "network_get_requests"]',
        description: 'Activate top 3 result(s)',
      },
      {
        step: 2,
        action: 'call',
        command: 'page_navigate',
        exampleArgs: { url: 'https://example.com' },
        description:
          'Call page_navigate. Use describe_tool("page_navigate") only if you need the full schema.',
      },
    ]);
  });

  it('auto-activates inactive result domains and re-runs the search with refreshed active names', async () => {
    const ctx = createCtx();
    state.activeNames = new Set(['browser_launch']);
    state.engine.search
      .mockReturnValueOnce([
        {
          name: 'page_navigate',
          description: 'Navigate page',
          shortDescription: 'Navigate page',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'network_get_requests',
          description: 'Get requests',
          shortDescription: 'Get requests',
          score: 9,
          domain: 'network',
          isActive: false,
        },
      ])
      .mockReturnValueOnce([
        {
          name: 'page_navigate',
          description: 'Navigate page',
          shortDescription: 'Navigate page',
          score: 10,
          domain: 'browser',
          isActive: true,
        },
      ]);
    state.handleActivateDomain.mockImplementation(async (innerCtx: any, args: any) => {
      innerCtx.enabledDomains.add(args.domain);
      if (args.domain === 'browser') state.activeNames.add('page_navigate');
      if (args.domain === 'network') state.activeNames.add('network_get_requests');
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    });

    const response = parseResponse(await handleSearchTools(ctx, { query: 'inspect', top_k: 5 }));

    expect(state.handleActivateDomain).toHaveBeenNthCalledWith(1, ctx, {
      domain: 'browser',
      ttlMinutes: 30,
    });
    expect(state.handleActivateDomain).toHaveBeenNthCalledWith(2, ctx, {
      domain: 'network',
      ttlMinutes: 30,
    });
    expect(state.engine.search).toHaveBeenNthCalledWith(
      1,
      'inspect',
      5,
      new Set(['browser_launch'])
    );
    expect(state.engine.search).toHaveBeenNthCalledWith(
      2,
      'inspect',
      5,
      new Set(['browser_launch', 'network_get_requests', 'page_navigate'])
    );
    expect(response.autoActivatedDomains).toEqual(['browser', 'network']);
  });

  it('warns on activation failures and still keeps successful auto-activations', async () => {
    const ctx = createCtx();
    state.engine.search
      .mockReturnValueOnce([
        {
          name: 'page_navigate',
          description: 'Navigate page',
          shortDescription: 'Navigate page',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'network_get_requests',
          description: 'Get requests',
          shortDescription: 'Get requests',
          score: 9,
          domain: 'network',
          isActive: false,
        },
      ])
      .mockReturnValueOnce([
        {
          name: 'network_get_requests',
          description: 'Get requests',
          shortDescription: 'Get requests',
          score: 9,
          domain: 'network',
          isActive: true,
        },
      ]);
    state.handleActivateDomain.mockImplementation(async (innerCtx: any, args: any) => {
      if (args.domain === 'browser') {
        throw new Error('browser failed');
      }
      innerCtx.enabledDomains.add('network');
      state.activeNames.add('network_get_requests');
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    });

    const response = parseResponse(await handleSearchTools(ctx, { query: 'inspect' }));

    expect(response.autoActivatedDomains).toEqual(['network']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      '[search-auto-activate] Failed to activate domain "browser":',
      expect.any(Error)
    );
    expect(state.logger.info).toHaveBeenCalledWith(
      '[search-auto-activate] Activated domain "network" with TTL=30min'
    );
  });

  it('skips auto-activation for domains that are already enabled', async () => {
    const ctx = createCtx({
      enabledDomains: new Set(['browser']),
    });
    state.engine.search.mockReturnValue([
      {
        name: 'page_navigate',
        description: 'Navigate page',
        shortDescription: 'Navigate page',
        score: 10,
        domain: 'browser',
        isActive: false,
      },
    ]);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'navigate' }));

    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(response.autoActivatedDomains).toBeUndefined();
    expect(state.engine.search).toHaveBeenCalledOnce();
  });

  it('returns empty nextActions when no results are found', async () => {
    const ctx = createCtx();
    state.engine.search.mockReturnValue([]);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'missing' }));

    expect(response).toEqual({
      query: 'missing',
      resultCount: 0,
      results: [],
      nextActions: [],
      hint:
        'For guided tool discovery with workflow detection, use route_tool instead. ' +
        'Use activate_tools to enable specific tools, activate_domain for entire domains.',
    });
    expect(state.describeTool).not.toHaveBeenCalled();
    expect(state.generateExampleArgs).not.toHaveBeenCalled();
  });
});

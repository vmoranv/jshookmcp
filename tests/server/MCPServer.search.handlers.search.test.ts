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
  getVisibleDomainsForTier: () => new Set<string>(),
  getBaseTier: () => 'search',
}));

vi.mock('@server/MCPServer.search.handlers.domain', () => ({
  handleActivateDomain: state.handleActivateDomain,
}));

vi.mock('@server/ToolRouter', () => ({
  describeTool: state.describeTool,
  generateExampleArgs: state.generateExampleArgs,
}));

vi.mock('@src/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/constants')>()),
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

    expect(state.engine.search).toHaveBeenCalledWith(
      'navigate',
      10,
      new Set(['page_navigate']),
      new Set(),
      'search',
    );
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

  it('does not auto-activate inactive result domains (auto-activation disabled)', async () => {
    const ctx = createCtx();
    state.activeNames = new Set(['browser_launch']);
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
        name: 'network_get_requests',
        description: 'Get requests',
        shortDescription: 'Get requests',
        score: 9,
        domain: 'network',
        isActive: false,
      },
    ]);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'inspect', top_k: 5 }));

    // Auto-activation disabled for security — no domains should be activated
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    // Search should only run once (no re-run with refreshed names)
    expect(state.engine.search).toHaveBeenCalledOnce();
    expect(response.resultCount).toBe(2);
  });

  it('returns results without autoActivatedDomains metadata', async () => {
    const ctx = createCtx();
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

    // Since auto-activation is disabled, this metadata should never appear
    expect(response.autoActivatedDomains).toBeUndefined();
    expect(response.callToolHint).toBeUndefined();
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

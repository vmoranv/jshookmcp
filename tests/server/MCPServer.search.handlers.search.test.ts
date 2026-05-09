import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  engine: {
    search: vi.fn(),
  },
  activeNames: new Set<string>(),
  getSearchEngine: vi.fn(),
  getActiveToolNames: vi.fn(),
  handleActivateDomain: vi.fn(),
  activateToolNames: vi.fn(),
  notifyToolListChanged: vi.fn(),
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

vi.mock('@server/MCPServer.search.handlers.activate', () => ({
  activateToolNames: state.activateToolNames,
  notifyToolListChanged: state.notifyToolListChanged,
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
import { TEST_URLS } from '@tests/shared/test-urls';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    enabledDomains: new Set<string>(),
    server: {
      sendToolListChanged: vi.fn(async () => undefined),
    },
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
    state.activateToolNames.mockImplementation(async (ctx: any) => {
      // Simulate real notifyToolListChanged: call sendToolListChanged on the server
      if (ctx.server?.sendToolListChanged) {
        await ctx.server.sendToolListChanged();
      }
      return { activated: [], alreadyActive: [], notFound: [], totalActive: 0 };
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

  it('auto-activates top results and returns direct call guidance', async () => {
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
    state.generateExampleArgs.mockReturnValue({ url: TEST_URLS.root });
    // Simulate activation of page_navigate and others
    state.activateToolNames.mockImplementation(async (c: any) => {
      if (c.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return {
        activated: [
          'page_navigate',
          'network_enable',
          'network_get_requests',
          'run_extension_workflow',
        ],
        alreadyActive: [],
        notFound: [],
        totalActive: 4,
      };
    });
    state.activeNames = new Set([
      'page_navigate',
      'network_enable',
      'network_get_requests',
      'run_extension_workflow',
    ]);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'inspect' }));

    // After auto-activation, top result is active → direct call
    expect(response.nextActions).toEqual([
      {
        step: 1,
        action: 'call',
        command: 'page_navigate',
        exampleArgs: { url: TEST_URLS.root },
        description:
          'Call page_navigate directly. Use describe_tool("page_navigate") only if you need the full schema.',
      },
    ]);
    expect(response.autoActivated).toBe(true);
  });

  it('respects auto_activate=false to skip auto-activation', async () => {
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

    const response = parseResponse(
      await handleSearchTools(ctx, { query: 'inspect', top_k: 5, auto_activate: false }),
    );

    // With auto_activate=false, no domains or tools should be activated
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).not.toHaveBeenCalled();
    expect(response.autoActivated).toBeFalsy();
    expect(response.resultCount).toBe(2);
  });

  it('returns autoActivated=false when no tools were activated', async () => {
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
    // Simulate activation
    state.activateToolNames.mockImplementation(async (c: any) => {
      if (c.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return {
        activated: ['page_navigate'],
        alreadyActive: [],
        notFound: [],
        totalActive: 1,
      };
    });
    state.activeNames = new Set(['page_navigate']);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'navigate' }));

    // autoActivated is true because page_navigate was inactive and now is active
    expect(response.autoActivated).toBe(true);
  });

  it('uses activateToolNames for tools in already-enabled domains', async () => {
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
    state.activateToolNames.mockImplementation(async (c: any) => {
      if (c.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return {
        activated: ['page_navigate'],
        alreadyActive: [],
        notFound: [],
        totalActive: 1,
      };
    });
    state.activeNames = new Set(['page_navigate']);

    const response = parseResponse(await handleSearchTools(ctx, { query: 'navigate' }));

    // Domain already enabled → activate tool individually, not the domain
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).toHaveBeenCalledWith(ctx, ['page_navigate']);
    expect(response.autoActivated).toBe(true);
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
      autoActivated: false,
      hint:
        'For guided tool discovery with workflow detection, use route_tool instead. ' +
        'Tools are auto-activated. If a tool does not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke it directly.' +
        ' Few results — try distilling your query to key concepts (e.g. "hook fetch" instead of "how to intercept fetch requests").',
    });
    expect(state.describeTool).not.toHaveBeenCalled();
    expect(state.generateExampleArgs).not.toHaveBeenCalled();
  });

  it('calls handleActivateDomain for domains not yet enabled', async () => {
    const ctx = createCtx({
      enabledDomains: new Set<string>(),
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
    state.handleActivateDomain.mockImplementation(async (c: any) => {
      // Simulate real behavior: call sendToolListChanged
      if (c.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    });
    state.activeNames = new Set(['page_navigate']);

    await handleSearchTools(ctx, { query: 'navigate' });

    expect(state.handleActivateDomain).toHaveBeenCalledWith(ctx, {
      domain: 'browser',
      ttlMinutes: 30,
    });
    // verify sendToolListChanged was triggered via the mock implementation
    expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
  });

  it('does not call handleActivateDomain when domain is already enabled', async () => {
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
    state.activeNames = new Set(['page_navigate']);

    await handleSearchTools(ctx, { query: 'navigate' });

    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).toHaveBeenCalledWith(ctx, ['page_navigate']);
  });

  it('refreshes tool list via sendToolListChanged after domain activation', async () => {
    const ctx = createCtx({
      enabledDomains: new Set<string>(),
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
    state.handleActivateDomain.mockImplementation(async (c: any) => {
      if (c.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    });
    state.activeNames = new Set(['page_navigate']);

    await handleSearchTools(ctx, { query: 'navigate' });

    // handleActivateDomain calls notifyToolListChanged which calls sendToolListChanged
    expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
  });

  it('refreshes tool list via sendToolListChanged after tool activation', async () => {
    const ctx = createCtx({
      enabledDomains: new Set(['browser']),
      server: {
        sendToolListChanged: vi.fn(async () => undefined),
      },
    });
    // Override mock AFTER createCtx so we use this ctx's sendToolListChanged
    state.activateToolNames.mockImplementation(async (c: any) => {
      if (c?.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return { activated: ['page_navigate'], alreadyActive: [], notFound: [], totalActive: 1 };
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
    state.activeNames = new Set(['page_navigate']);

    await handleSearchTools(ctx, { query: 'navigate' });

    expect(state.activateToolNames).toHaveBeenCalled();
    expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
  });

  it('does not call sendToolListChanged when auto_activate=false', async () => {
    const ctx = createCtx({
      enabledDomains: new Set<string>(),
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

    await handleSearchTools(ctx, { query: 'navigate', auto_activate: false });

    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).not.toHaveBeenCalled();
  });

  it('activates multiple domains from search results', async () => {
    const ctx = createCtx({
      enabledDomains: new Set<string>(),
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
    ]);
    state.handleActivateDomain.mockImplementation(async (c: any) => {
      if (c.server?.sendToolListChanged) await c.server.sendToolListChanged();
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    });
    state.activeNames = new Set(['page_navigate', 'network_enable']);

    await handleSearchTools(ctx, { query: 'both' });

    expect(state.handleActivateDomain).toHaveBeenCalledTimes(2);
    const activatedDomains = state.handleActivateDomain.mock.calls.map((c: any[]) => c[1].domain);
    expect(activatedDomains).toContain('browser');
    expect(activatedDomains).toContain('network');
    // Both domains trigger sendToolListChanged
    expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
  });
});

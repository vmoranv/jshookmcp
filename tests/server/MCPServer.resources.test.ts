import { describe, expect, it, vi } from 'vitest';

// getCoverageSummary's callers resolve catalog tool names from ToolCatalog,
// which requires an initialised registry; these tests run without one and the
// mocked getCoverageSummary ignores the argument anyway.
vi.mock('@server/ToolCatalog', () => ({ allTools: [] }));

import { registerServerResources } from '@server/MCPServer.resources';

type ResourceHandler = (
  uri: URL,
  variables?: Record<string, unknown>,
) => Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}>;

describe('MCPServer.resources', () => {
  function createContext(overrides: Record<string, unknown> = {}) {
    const handlers = new Map<string, ResourceHandler>();

    const activatedToolNames = (overrides.activatedToolNames ?? []) as string[];
    const domainTtlEntries = (overrides.domainTtlEntries ?? []) as [string, unknown][];
    const enabledDomains = (overrides.enabledDomains ?? ['browser']) as string[];
    const extensionToolsByName = (overrides.extensionToolsByName ?? []) as [string, unknown][];

    const customGetDomainInstance =
      typeof overrides.getDomainInstance === 'function' ? overrides.getDomainInstance : null;

    const ctx = {
      server: {
        registerResource: vi.fn(
          (name: string, _template: unknown, _meta: unknown, handler: ResourceHandler) => {
            handlers.set(name, handler);
          },
        ),
      },
      getDomainInstance: vi.fn((key: string) => {
        if (customGetDomainInstance) {
          const custom = customGetDomainInstance(key);
          if (custom !== undefined) {
            return custom;
          }
        }
        if (key === 'evidenceGraph') {
          return overrides.evidenceGraph;
        }
        if (key === 'instrumentationSessionManager') {
          return overrides.instrumentationSessionManager;
        }
        if (key === 'browserHandlers') {
          return overrides.browserHandlers;
        }
        return undefined;
      }),
      tokenBudget: overrides.tokenBudget ?? {
        getStats: vi.fn(() => ({
          currentUsage: 5000,
          maxTokens: 100000,
          usagePercentage: 5,
          toolCallCount: 10,
          topTools: [],
          warnings: [],
          recentCalls: [],
          suggestions: ['Token usage is healthy.'],
          sessionStartTime: Date.now(),
        })),
      },
      unifiedCache: overrides.unifiedCache ?? {
        getGlobalStats: vi.fn(async () => ({
          totalEntries: 42,
          totalSize: 1024000,
          totalSizeMB: '0.98',
          hitRate: 0.75,
          caches: [],
          recommendations: [],
        })),
      },
      activatedToolNames: new Set<string>(activatedToolNames),
      domainTtlEntries: new Map<string, unknown>(domainTtlEntries),
      enabledDomains: new Set<string>(enabledDomains),
      baseTier: overrides.baseTier ?? 'full',
      clientSupportsListChanged: true,
      extensionToolsByName: new Map<string, unknown>(extensionToolsByName),
      selectedTools: [],
      metaToolsByName: new Map<string, unknown>(),
      config: {
        search: {},
      },
      ...(overrides.mcpLog ? { mcpLog: overrides.mcpLog } : {}),
    };

    return { ctx, handlers };
  }

  it('registers all 10 resources', () => {
    const { ctx } = createContext();
    registerServerResources(ctx as never);
    expect(ctx.server.registerResource).toHaveBeenCalledTimes(11);
  });

  it('serves fallback payloads when no domain instances exist', async () => {
    const { ctx, handlers } = createContext();
    registerServerResources(ctx as never);

    const graphJson = await handlers.get('evidence_graph_json')!(
      new URL('jshook://evidence/graph'),
    );
    expect(graphJson.contents[0]?.text).toContain('"nodes"');

    const markdown = await handlers.get('evidence_graph_markdown')!(
      new URL('jshook://evidence/graph.md'),
    );
    expect(markdown.contents[0]?.text).toContain('No evidence graph is available');

    const sessions = await handlers.get('instrumentation_sessions')!(
      new URL('jshook://instrumentation/sessions'),
    );
    expect(sessions.contents[0]?.text).toBe('[]');

    const missingSnapshot = await handlers.get('instrumentation_session_snapshot')!(
      new URL('jshook://instrumentation/session/abc'),
      { sessionId: 'abc' },
    );
    expect(missingSnapshot.contents[0]?.text).toContain('not found');
  });

  it('uses live graph and session manager data when instances are available', async () => {
    const evidenceGraph = {
      exportJson: vi.fn(() => ({ version: 1, nodes: [{ id: 'n1' }] })),
      exportMarkdown: vi.fn(() => '# Evidence'),
    };
    const manager = {
      listSessionSnapshots: vi.fn(() => [{ id: 's1', status: 'active' }]),
      listSessions: vi.fn(() => [
        { id: 's1', name: 'Main Session', operationCount: 2, artifactCount: 1, status: 'active' },
      ]),
      getSessionSnapshot: vi.fn((id: string) => ({ id, status: 'active' })),
    };
    const { ctx, handlers } = createContext({
      evidenceGraph,
      instrumentationSessionManager: manager,
    });

    registerServerResources(ctx as never);

    const graphJson = await handlers.get('evidence_graph_json')!(
      new URL('jshook://evidence/graph'),
    );
    expect(graphJson.contents[0]?.text).toContain('"n1"');

    const graphMarkdown = await handlers.get('evidence_graph_markdown')!(
      new URL('jshook://evidence/graph.md'),
    );
    expect(graphMarkdown.contents[0]?.text).toBe('# Evidence');

    const sessionList = await handlers.get('instrumentation_sessions')!(
      new URL('jshook://instrumentation/sessions'),
    );
    expect(sessionList.contents[0]?.text).toContain('"s1"');

    const snapshot = await handlers.get('instrumentation_session_snapshot')!(
      new URL('jshook://instrumentation/session/s1'),
      { sessionId: 's1' },
    );
    expect(snapshot.contents[0]?.text).toContain('"active"');
    expect(manager.getSessionSnapshot).toHaveBeenCalledWith('s1');
  });

  // ── New resources ──

  it('serves search engine status', async () => {
    const { ctx, handlers } = createContext();
    registerServerResources(ctx as never);

    const result = await handlers.get('search_engine_status')!(new URL('jshook://search/status'));
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload).toHaveProperty('totalTools');
    expect(payload).toHaveProperty('indexedTools');
    expect(payload).toHaveProperty('bm25Available');
    expect(payload).toHaveProperty('trigramAvailable');
    expect(payload).not.toHaveProperty('embeddingAvailable');
    expect(payload).not.toHaveProperty('embeddingDimension');
  });

  it('serves token budget stats', async () => {
    const { ctx, handlers } = createContext();
    registerServerResources(ctx as never);

    const result = await handlers.get('token_budget_stats')!(
      new URL('jshook://token-budget/stats'),
    );
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.currentUsage).toBe(5000);
    expect(payload.maxTokens).toBe(100000);
    expect(payload).toHaveProperty('topTools');
    expect(payload).toHaveProperty('suggestions');
  });

  it('serves activation state', async () => {
    const { ctx, handlers } = createContext({
      activatedToolNames: ['tool_a', 'tool_b'],
      enabledDomains: ['browser', 'debugger'],
    });
    registerServerResources(ctx as never);

    const result = await handlers.get('activation_state')!(new URL('jshook://activation/state'));
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.baseTier).toBe('full');
    expect(payload.activatedTools).toEqual(['tool_a', 'tool_b']);
    expect(payload.activatedToolCount).toBe(2);
    expect(payload.enabledDomains).toContain('browser');
    expect(payload).toHaveProperty('domainTtls');
  });

  it('serves cache stats', async () => {
    const { ctx, handlers } = createContext();
    registerServerResources(ctx as never);

    const result = await handlers.get('cache_stats')!(new URL('jshook://cache/stats'));
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.totalEntries).toBe(42);
    expect(payload.hitRate).toBe(0.75);
  });

  it('serves tool coverage summary', async () => {
    const runtimeState = {
      getCoverageSummary: vi.fn(() => ({
        called: {
          browser_attach: {
            count: 2,
            lastCalledAt: '2026-05-23T00:00:00.000Z',
            lastArgsKeys: ['browserURL'],
          },
        },
        calledCount: 1,
        uncataloguedCalls: [],
        uncataloguedCallCount: 0,
        totalKnownTools: 3,
        uncalled: ['memory_read', 'page_navigate'],
        uncalledCount: 2,
      })),
    };
    const { ctx, handlers } = createContext({
      getDomainInstance: vi.fn((key: string) => {
        if (key === 'serverRuntimeState') {
          return runtimeState;
        }
        return undefined;
      }),
    });
    registerServerResources(ctx as never);

    const result = await handlers.get('tool_coverage')!(new URL('jshook://tools/coverage'));
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.called.browser_attach.count).toBe(2);
    expect(payload.uncalled).toEqual(['memory_read', 'page_navigate']);
    expect(payload.totalKnownTools).toBe(3);
  });

  it('serves browser tabs with fallback when domain is not initialized', async () => {
    const { ctx, handlers } = createContext();
    registerServerResources(ctx as never);

    const result = await handlers.get('browser_tabs')!(new URL('jshook://browser/tabs'));
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.tabs).toEqual([]);
    expect(payload.currentTabId).toBeNull();
    expect(payload.message).toContain('not initialized');
  });

  it('serves browser tabs with live data', async () => {
    const tabRegistry = {
      listTabs: vi.fn(() => [
        {
          pageId: 'p1',
          index: 0,
          url: 'https://example.com',
          title: 'Example',
          page: {},
          aliases: [],
          stale: false,
        },
        {
          pageId: 'p2',
          index: 1,
          url: 'https://test.com',
          title: 'Test',
          page: {},
          aliases: ['alt'],
          stale: false,
        },
      ]),
      getContextMeta: vi.fn(() => ({
        url: 'https://example.com',
        title: 'Example',
        tabIndex: 0,
        pageId: 'p1',
      })),
    };
    const browserHandlers = {
      getTabRegistry: vi.fn(() => tabRegistry),
    };
    const { ctx, handlers } = createContext({ browserHandlers });
    registerServerResources(ctx as never);

    const result = await handlers.get('browser_tabs')!(new URL('jshook://browser/tabs'));
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.totalTabs).toBe(2);
    expect(payload.currentTabId).toBe('p1');
    expect(payload.tabs[0]).toEqual({
      pageId: 'p1',
      index: 0,
      url: 'https://example.com',
      title: 'Example',
      aliases: [],
    });
    expect(payload.tabs[1]!.aliases).toEqual(['alt']);
  });

  it('serves domain status template with domain tools', async () => {
    const { ctx, handlers } = createContext({
      activatedToolNames: ['browser_navigate'],
      enabledDomains: ['browser'],
    });
    registerServerResources(ctx as never);

    const result = await handlers.get('domain_status_template')!(
      new URL('jshook://domains/browser'),
      { domainName: 'browser' },
    );
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.domain).toBe('browser');
    expect(payload).toHaveProperty('totalTools');
    expect(payload).toHaveProperty('tools');
    expect(payload.enabled).toBe(true);
    expect(payload).toHaveProperty('activatedTools');
    expect(payload).toHaveProperty('ttl');
  });

  it('returns empty tools for unknown domain', async () => {
    const { ctx, handlers } = createContext();
    registerServerResources(ctx as never);

    const result = await handlers.get('domain_status_template')!(
      new URL('jshook://domains/nonexistent'),
      { domainName: 'nonexistent' },
    );
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.domain).toBe('nonexistent');
    expect(payload.totalTools).toBe(0);
    expect(payload.tools).toEqual([]);
    expect(payload.enabled).toBe(false);
  });

  it('registers 11 resources when mcpLog has a file path', () => {
    const { ctx } = createContext({
      mcpLog: { getFilePath: () => '/tmp/jshookmcp-test.log' },
    });
    registerServerResources(ctx as never);
    expect(ctx.server.registerResource).toHaveBeenCalledTimes(12);
  });

  it('serves log file path when file logging is enabled', async () => {
    const logPath = '/tmp/jshookmcp-test.log';
    const handlers = new Map<string, ResourceHandler>();
    const ctx = {
      server: {
        registerResource: vi.fn(
          (name: string, _template: unknown, _meta: unknown, handler: ResourceHandler) => {
            handlers.set(name, handler);
          },
        ),
      },
      getDomainInstance: vi.fn(),
      tokenBudget: {
        getStats: vi.fn(() => ({
          currentUsage: 5000,
          maxTokens: 100000,
          usagePercentage: 5,
          toolCallCount: 10,
          topTools: [],
          warnings: [],
          recentCalls: [],
          suggestions: [],
          sessionStartTime: Date.now(),
        })),
      },
      unifiedCache: {
        getGlobalStats: vi.fn(async () => ({
          totalEntries: 0,
          totalSize: 0,
          totalSizeMB: '0',
          hitRate: 0,
          caches: [],
          recommendations: [],
        })),
      },
      activatedToolNames: new Set<string>(),
      domainTtlEntries: new Map<string, unknown>(),
      enabledDomains: new Set<string>(),
      baseTier: 'full',
      clientSupportsListChanged: true,
      extensionToolsByName: new Map<string, unknown>(),
      config: { search: {} },
      mcpLog: { getFilePath: () => logPath },
    };

    registerServerResources(ctx as never);

    const handler = handlers.get('mcp_log_file');
    expect(handler).toBeDefined();
    const result = await handler!(new URL('jshook://logs/file'));
    expect(result.contents[0]!.text).toBe(logPath);
  });
});

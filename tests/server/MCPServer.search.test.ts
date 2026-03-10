import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

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
      if (name.startsWith('network_')) return 'network';
      return 'browser';
    },
    getToolsByDomains: (domains: string[]) =>
      builtinTools.filter((candidate) => domains.includes(candidate.name.startsWith('network_') ? 'network' : 'browser')),
  };
});

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

import { registerSearchMetaTools } from '@server/MCPServer.search';

function createCtx(overrides: Record<string, unknown> = {}) {
  const registered = new Map<string, { options: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown> }>();
  const ctx = {
    currentTier: 'minimal',
    selectedTools: [tool('browser_launch')],
    boostedToolNames: new Set<string>(),
    activatedToolNames: new Set<string>(),
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
    registerSingleTool: vi.fn(),
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
  beforeEach(() => {
    state.constructors.length = 0;
    state.searches.length = 0;
    vi.clearAllMocks();
  });

  it('builds a workflow-biased description that includes loaded extension counts', () => {
    const ctx = createCtx({
      currentTier: 'workflow',
      extensionToolsByName: new Map([
        ['custom_tool', { name: 'custom_tool', domain: 'workflow', tool: tool('custom_tool', 'Custom workflow tool') }],
      ]),
      extensionWorkflowRuntimeById: new Map([['wf-1', {}]]),
    });

    registerSearchMetaTools(ctx);
    const searchToolsRegistration = ctx.__registered.get('search_tools');

    expect(searchToolsRegistration.options.description).toContain('1 currently loaded');
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
});

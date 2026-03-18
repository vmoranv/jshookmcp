import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  getToolDomain: vi.fn((name: string) => {
    if (name.startsWith('page_')) return 'browser';
    if (name.startsWith('debug_')) return 'debugger';
    if (name.startsWith('workflow_')) return 'workflow';
    return null;
  }),
}));

vi.mock('@server/ToolCatalog', () => ({
  get allTools() {
    return state.allTools;
  },
  getToolDomain: state.getToolDomain,
}));

vi.mock('@src/constants', () => ({
  SEARCH_TFIDF_COSINE_WEIGHT: 0.3,
  SEARCH_AFFINITY_BOOST_FACTOR: 0.2,
  SEARCH_AFFINITY_TOP_N: 3,
  SEARCH_DOMAIN_HUB_THRESHOLD: 2,
  SEARCH_QUERY_CACHE_CAPACITY: 8,
}));

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

describe('search/ToolSearchEngineImpl', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page. Opens a URL in the current tab.'),
      makeTool('page_click', 'Click an element in the current tab'),
      makeTool('debug_pause', 'Pause JavaScript execution'),
    ];
  });

  it('uses ToolCatalog tools by default and extracts short descriptions', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    const results = engine.search('navigate page', 5);

    expect(results[0]?.name).toBe('page_navigate');
    expect(results[0]?.shortDescription).toBe('Navigate a page.');
    expect(state.getToolDomain).toHaveBeenCalledWith('page_navigate');
  });

  it('promotes explicit tool mentions when the query uses invocation verbs', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
      makeTool('workflow_helper', 'Execute generic workflow helper'),
    ]);

    const results = engine.search('please use page navigate now', 5);

    expect(results[0]?.name).toBe('page_navigate');
  });

  it('updates isActive from cache hits without changing scores', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const first = engine.search('page navigate', 5, new Set());
    const second = engine.search('page navigate', 5, new Set(['page_navigate']));

    expect(first.map((item) => item.score)).toEqual(second.map((item) => item.score));
    expect(first.find((item) => item.name === 'page_navigate')?.isActive).toBe(false);
    expect(second.find((item) => item.name === 'page_navigate')?.isActive).toBe(true);
  });

  it('applies domain and tool score multipliers', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine(
      [
        makeTool('workflow_helper', 'Execute flow helper'),
        makeTool('page_click', 'Execute flow helper'),
      ],
      new Map([
        ['workflow_helper', 'workflow'],
        ['page_click', 'browser'],
      ]),
      new Map([['workflow', 1.5]]),
      new Map([['workflow_helper', 1.2]])
    );

    const results = engine.search('execute flow helper', 5);

    expect(results[0]?.name).toBe('workflow_helper');
  });

  it('returns grouped domain summaries', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page'),
      makeTool('debug_pause', 'Pause execution'),
    ]);

    expect(engine.getDomainSummary()).toEqual([
      {
        domain: 'browser',
        count: 2,
        tools: ['page_navigate', 'page_click'],
      },
      {
        domain: 'debugger',
        count: 1,
        tools: ['debug_pause'],
      },
    ]);
  });
});

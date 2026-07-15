import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  getToolDomain: vi.fn((name: string) => {
    if (name.startsWith('page_')) return 'browser';
    if (name.startsWith('debug_')) return 'debugger';
    if (name.startsWith('hook_')) return 'hooks';
    if (name.startsWith('network_')) return 'network';
    return null;
  }),
}));

vi.mock('@server/ToolCatalog', () => ({
  get allTools() {
    return state.allTools;
  },
  getToolDomain: state.getToolDomain,
}));

vi.mock('@server/search/EmbeddingEngine', () => ({
  EmbeddingEngine: class {
    async embedBatch() {
      return [];
    }
    async embed() {
      return new Float32Array(0);
    }
  },
}));

vi.mock('@src/constants', () => ({
  SEARCH_AFFINITY_BOOST_FACTOR: 0.2,
  SEARCH_AFFINITY_TOP_N: 3,
  SEARCH_DOMAIN_HUB_THRESHOLD: 2,
  SEARCH_QUERY_CACHE_CAPACITY: 8,
  SEARCH_TRIGRAM_WEIGHT: 0.15,
  SEARCH_TRIGRAM_THRESHOLD: 0.35,
  SEARCH_RRF_K: 60,
  SEARCH_RRF_RESCALE_FACTOR: 1000,
  SEARCH_RRF_BM25_BLEND: 0.5,
  SEARCH_SYNONYM_EXPANSION_LIMIT: 3,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_BM25_K1: 1.5,
  SEARCH_BM25_B: 0.75,
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE: 0.05,
  SEARCH_TIER_PENALTY: 1,
  SEARCH_RECENCY_WINDOW_MS: 0,
  SEARCH_RECENCY_MAX_BOOST: 0,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER: 2.5,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.08,
  SEARCH_AFFINITY_BASE_WEIGHT: 0.3,
  SEARCH_COVERAGE_PRECISION_FACTOR: 0.5,
  SEARCH_PREFIX_MATCH_MULTIPLIER: 0.5,
  SEARCH_VECTOR_ENABLED: false,
  SEARCH_VECTOR_BM25_SKIP_THRESHOLD: 12,
  SEARCH_VECTOR_MODEL_ID: 'Xenova/bge-micro-v2',
  SEARCH_VECTOR_COSINE_WEIGHT: 0.4,
  SEARCH_VECTOR_DYNAMIC_WEIGHT: false,
  SEARCH_VECTOR_LEARN_UP: 0.05,
  SEARCH_VECTOR_LEARN_DOWN: 0.03,
  SEARCH_VECTOR_LEARN_TOP_N: 5,
  SEARCH_VECTOR_PREWARM: false,
  SEARCH_VECTOR_WORKER_IDLE_MS: 0,
  SEARCH_VECTOR_CACHE_ENABLED: false,
  SEARCH_RECENCY_TRACKER_MAX: 200,
  SEARCH_SELF_RAG_ENABLED: true,
}));

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

describe('search/SelfRAGQuickPath', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
  });

  it('triggers quick path for exact tool name query', async () => {
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page to a URL'),
      makeTool('page_click', 'Click an element'),
      makeTool('debug_pause', 'Pause execution'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    const results = await engine.search('page_navigate', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('page_navigate');
  });

  it('triggers quick path for single token query', async () => {
    state.allTools = [
      makeTool('hook_intercept', 'Intercept function calls'),
      makeTool('page_navigate', 'Navigate to URL'),
      makeTool('debug_pause', 'Pause execution'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    const results = await engine.search('hook', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('hook_intercept');
  });

  it('does not trigger quick path for multi-word queries', async () => {
    state.allTools = [
      makeTool('page_navigate', 'Navigate to URL in browser'),
      makeTool('page_click', 'Click an element on page'),
      makeTool('debug_pause', 'Pause JavaScript execution'),
      makeTool('network_intercept', 'Intercept and capture network requests'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quickPathSpy = vi.spyOn(engine as any, 'quickPathSearch');

    const results = await engine.search('intercept network requests', 5);

    expect(quickPathSpy).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('network_intercept');
  });

  it('quick path returns isActive correctly', async () => {
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click an element'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    const results = await engine.search('page_navigate', 5, new Set(['page_navigate']));

    expect(results.find((r) => r.name === 'page_navigate')?.isActive).toBe(true);
    expect(results.find((r) => r.name === 'page_click')?.isActive).toBe(false);
  });

  it('quick path returns empty for non-matching single token', async () => {
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click an element'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    const results = await engine.search('zzzznonexistent', 5);

    expect(results).toEqual([]);
  });

  it('quick path applies exact name match multiplier', async () => {
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page to URL'),
      makeTool('navigate_helper', 'Helper for navigation'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    const results = await engine.search('page_navigate', 5);

    expect(results[0]?.name).toBe('page_navigate');
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });
});

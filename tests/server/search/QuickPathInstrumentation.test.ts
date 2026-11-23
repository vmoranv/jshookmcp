import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/server';

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
  SEARCH_NAME_TOKEN_WEIGHT: 3,
  SEARCH_DOMAIN_TOKEN_WEIGHT: 2,
  SEARCH_DESC_TOKEN_WEIGHT: 1,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_SCENE_KEYWORD_WEIGHT: 0.8,
  SEARCH_BM25_K1: 1.5,
  SEARCH_BM25_B: 0.75,
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE: 0.05,
  SEARCH_TIER_PENALTY: 1,
  SEARCH_TIER_PENALTY_SEARCH: 1,
  SEARCH_TIER_PENALTY_WORKFLOW: 1,
  SEARCH_TIER_PENALTY_FULL: 1,
  SEARCH_RECENCY_WINDOW_MS: 0,
  SEARCH_RECENCY_MAX_BOOST: 0,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER: 2.5,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.08,
  SEARCH_AFFINITY_BASE_WEIGHT: 0.3,
  SEARCH_COVERAGE_PRECISION_FACTOR: 0.5,
  SEARCH_PREFIX_MATCH_MULTIPLIER: 0.5,
  SEARCH_RECENCY_TRACKER_MAX: 200,
  SEARCH_MIN_CONTENT_TOKENS: 0,
  SEARCH_SELF_RAG_ENABLED: true,
}));

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

describe('search/QuickPathInstrumentation', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
  });

  it('records exact-name quick-path results in the quality tracker', async () => {
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page to a URL'),
      makeTool('page_click', 'Click an element'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    expect(engine.getSearchQualityMetrics().totalQueries).toBe(0);

    const results = await engine.search('page_navigate', 5);

    expect(results.length).toBeGreaterThan(0);
    // The quick path previously bypassed the quality tracker entirely, so the
    // highest-hit-rate query class (exact tool names) never showed up in
    // MRR / latency metrics.
    expect(engine.getSearchQualityMetrics().totalQueries).toBe(1);
    const recent = engine.getSearchQualityTracker().getRecentRecords(1);
    expect(recent[0]?.query).toBe('page_navigate');
    expect(recent[0]?.returnedTools).toContain('page_navigate');
    expect(recent[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records repeat exact-name quick-path queries via cache without double-counting', async () => {
    state.allTools = [
      makeTool('hook_intercept', 'Intercept function calls'),
      makeTool('page_navigate', 'Navigate to URL'),
    ];

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();

    // NOTE: a bare single-token query like "hook" does NOT stay single-token —
    // expandCjkAliasTokens (BM25Scorer.tokenise) unconditionally appends alias
    // tokens for patterns that contain English words, so such queries take the
    // full path. Exact tool names are the reliable quick-path trigger.
    const first = await engine.search('hook_intercept', 5);
    expect(first.length).toBeGreaterThan(0);
    expect(engine.getSearchQualityMetrics().totalQueries).toBe(1);

    // A cache hit must not record a second quality entry (mirrors the
    // full-path behaviour where cached queries are not re-recorded).
    const second = await engine.search('hook_intercept', 5);
    expect(second.length).toBeGreaterThan(0);
    expect(second.map((r) => r.name)).toEqual(first.map((r) => r.name));
    expect(engine.getSearchQualityMetrics().totalQueries).toBe(1);
  });
});

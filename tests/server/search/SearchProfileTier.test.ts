import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  buildSearchQualityFixture,
  resolveSearchQualityToolDomain,
} from './fixtures/search-quality.fixture';

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  getToolDomain: vi.fn((name: string) => {
    return resolveSearchQualityToolDomain(name);
  }),
}));

vi.mock('@server/ToolCatalog', () => ({
  get allTools() {
    return state.allTools;
  },
  getToolDomain: state.getToolDomain,
}));

vi.mock('@src/constants', () => ({
  SEARCH_AFFINITY_BOOST_FACTOR: 0.15,
  SEARCH_AFFINITY_TOP_N: 5,
  SEARCH_DOMAIN_HUB_THRESHOLD: 3,
  SEARCH_QUERY_CACHE_CAPACITY: 500,
  SEARCH_TRIGRAM_WEIGHT: 0.12,
  SEARCH_TRIGRAM_THRESHOLD: 0.35,
  SEARCH_RRF_K: 60,
  SEARCH_RRF_RESCALE_FACTOR: 1000,
  SEARCH_RRF_BM25_BLEND: 0.5,
  SEARCH_SYNONYM_EXPANSION_LIMIT: 3,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_BM25_K1: 1.5,
  SEARCH_BM25_B: 0.75,
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE: 0.05,
  SEARCH_TIER_PENALTY: 0.7,
  SEARCH_TIER_PENALTY_SEARCH: 0.4,
  SEARCH_TIER_PENALTY_WORKFLOW: 0.7,
  SEARCH_TIER_PENALTY_FULL: 1.0,
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
  SEARCH_RECENCY_TRACKER_MAX: 200,
}));

function topNames(results: { name: string }[], k: number): string[] {
  return results.slice(0, k).map((r) => r.name);
}

describe('search/SearchProfileTier', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
    const fixture = buildSearchQualityFixture();
    state.allTools = [...fixture.tools];
  });

  it('search tier: explicit tool name escapes penalty', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const visibleDomains = new Set(['browser']);
    const results = await engine.search(
      'call tls_keylog_enable',
      10,
      undefined,
      visibleDomains,
      'search',
    );
    // Explicit name mention should promote despite off-tier penalty
    expect(topNames(results, 3)).toContain('tls_keylog_enable');
  });

  it('search tier: browser query ranks in-tier tools higher', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const visibleDomains = new Set(['browser']);
    const results = await engine.search(
      'navigate to URL and click',
      10,
      undefined,
      visibleDomains,
      'search',
    );
    const top3 = topNames(results, 3);
    expect(top3).toContain('page_navigate');
    expect(top3).toContain('page_click');
  });

  it('workflow tier: in-tier network tools rank high', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const visibleDomains = new Set(['browser', 'network', 'debugger']);
    const results = await engine.search(
      'capture network requests',
      10,
      undefined,
      visibleDomains,
      'workflow',
    );
    expect(topNames(results, 3)).toContain('network_enable');
  });

  it('full tier: no penalty applied', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const allDomains = new Set(['browser', 'network', 'debugger', 'analysis', 'hooks', 'memory']);
    const results = await engine.search(
      'V8 heap snapshot capture',
      10,
      undefined,
      allDomains,
      'full',
    );
    expect(topNames(results, 10)).toContain('v8_heap_snapshot_capture');
  });
});

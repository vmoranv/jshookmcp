import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/server';
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
  SEARCH_NAME_TOKEN_WEIGHT: 3,
  SEARCH_DOMAIN_TOKEN_WEIGHT: 2,
  SEARCH_DESC_TOKEN_WEIGHT: 1,
  SEARCH_SCENE_KEYWORD_WEIGHT: 0.8,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_BM25_K1: 1.5,
  SEARCH_BM25_B: 0.75,
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE: 0.05,
  SEARCH_TIER_PENALTY: 0.7,
  SEARCH_RECENCY_WINDOW_MS: 0,
  SEARCH_RECENCY_MAX_BOOST: 0,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER: 2.5,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.08,
  SEARCH_AFFINITY_BASE_WEIGHT: 0.3,
  SEARCH_COVERAGE_PRECISION_FACTOR: 0.5,
  SEARCH_PREFIX_MATCH_MULTIPLIER: 0.5,
  SEARCH_RECENCY_TRACKER_MAX: 200,
  SEARCH_MIN_CONTENT_TOKENS: 0,
  SEARCH_SELF_RAG_ENABLED: false,
}));

function topNames(results: { name: string }[], k: number): string[] {
  return results.slice(0, k).map((r) => r.name);
}

describe('search/SearchQuality', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
    const fixture = buildSearchQualityFixture();
    state.allTools = [...fixture.tools];
  });

  // Auto-generate tests from fixture cases
  const fixture = buildSearchQualityFixture();
  const KNOWN_SEMANTIC_GAPS = new Set(['browser-viewport', 'evidence-fuzzy', 'tls-probe-endpoint']);

  for (const testCase of fixture.cases) {
    if (KNOWN_SEMANTIC_GAPS.has(testCase.id)) {
      it.skip(testCase.title + ' (known semantic gap)', () => {});
      continue;
    }
    it(testCase.title, async () => {
      const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
      const engine = new ToolSearchEngine();
      const results = await engine.search(testCase.query, testCase.topK);
      const relevantTools = testCase.expectations.filter((e) => e.gain >= 2).map((e) => e.tool);

      if (testCase.tags.includes('exact')) {
        // Exact match: must be top-1
        expect(results[0]!.name).toBe(testCase.idealTool);
      } else if (testCase.tags.includes('fuzzy')) {
        // Fuzzy: allow top-5
        expect(topNames(results, 5)).toContain(testCase.idealTool ?? relevantTools[0]);
      } else if (relevantTools.length > 1) {
        // Multi-relevant: at least one in top-K
        const topK = testCase.topK;
        const topN = topK <= 5 ? 5 : 10;
        const top = topNames(results, topN);
        const hasRelevant = relevantTools.some((t) => top.includes(t));
        expect(hasRelevant).toBe(true);
      } else {
        // Single-relevant: must be in top-3
        expect(topNames(results, 3)).toContain(testCase.idealTool ?? relevantTools[0]);
      }
    });
  }

  it('matches the accepted Phase 2 failAt3 set', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const failures: string[] = [];
    for (const testCase of fixture.cases) {
      const results = await engine.search(testCase.query, testCase.topK);
      const relevant = new Set(
        testCase.expectations
          .filter((expectation) => expectation.gain >= 2)
          .map((expectation) => expectation.tool),
      );
      const hit = results.slice(0, 3).some((result) => relevant.has(result.name));
      if (!hit) failures.push(testCase.id);
    }
    expect(failures.toSorted()).toEqual([...KNOWN_SEMANTIC_GAPS].toSorted());
  });
});

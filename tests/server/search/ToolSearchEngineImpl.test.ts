import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/server';
import type { SearchConfig } from '@internal-types/config';

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
  SEARCH_SCENE_KEYWORD_WEIGHT: 0.8,
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
  SEARCH_RECENCY_TRACKER_MAX: 200,
  SEARCH_MIN_CONTENT_TOKENS: 0,
  SEARCH_SELF_RAG_ENABLED: false,
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

    const results = await engine.search('navigate page', 5);

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

    const results = await engine.search('please use page navigate now', 5);

    expect(results[0]?.name).toBe('page_navigate');
  });

  it('promotes explicit snake_case tool mentions as well', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const results = await engine.search('please use page_navigate now', 5);

    expect(results[0]?.name).toBe('page_navigate');
  });

  it('returns no results when the query has no searchable tokens', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const results = await engine.search('!!!', 5);

    expect(results).toEqual([]);
  });

  it('rejects pure-stopword queries below the minimum content-token gate', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    // "a" is a stopword: filterQueryStopwords keeps the original tokens via
    // its fallback, and the SEARCH_MIN_CONTENT_TOKENS gate must reject it
    // instead of letting it rank into BM25 noise.
    const pureStopword = await engine.search('a', 5);
    const multiStopword = await engine.search('the of and', 5);
    // A single content token still passes the default minimum of 1.
    const realQuery = await engine.search('navigate', 5);

    expect(pureStopword).toEqual([]);
    expect(multiStopword).toEqual([]);
    expect(realQuery.length).toBeGreaterThan(0);
  });

  it('normalises query casing and whitespace so the cache key stays stable', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    // The same logical query phrased with different casing / surrounding
    // spaces must resolve to the same cache entry, so LLM casing fluctuations
    // don't fragment the cache and rank/score stay identical across calls.
    const capitalised = await engine.search('Page Navigate', 5);
    const padded = await engine.search('  page navigate  ', 5);

    expect(capitalised.map((r) => r.name)).toEqual(padded.map((r) => r.name));
    expect(capitalised.map((r) => r.score)).toEqual(padded.map((r) => r.score));
  });

  it('updates isActive from cache hits without changing scores', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const first = await engine.search('page navigate', 5, new Set());
    const second = await engine.search('page navigate', 5, new Set(['page_navigate']));

    expect(first.map((item) => item.score)).toEqual(second.map((item) => item.score));
    expect(first.find((item) => item.name === 'page_navigate')?.isActive).toBe(false);
    expect(second.find((item) => item.name === 'page_navigate')?.isActive).toBe(true);
  });

  it('recomputes rankings when visible domains change between identical queries', async () => {
    const constants = await import('@src/constants');
    const previousPenalty = constants.SEARCH_TIER_PENALTY;
    // @ts-expect-error test mutates mocked constant
    constants.SEARCH_TIER_PENALTY = 0.1;

    try {
      const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
      const engine = new ToolSearchEngine([
        makeTool('page_navigate', 'Shared action for rank testing'),
        makeTool('debug_pause', 'Shared action for rank testing'),
      ]);

      const browserVisible = await engine.search(
        'shared action',
        5,
        undefined,
        new Set(['browser']),
      );
      const debuggerVisible = await engine.search(
        'shared action',
        5,
        undefined,
        new Set(['debugger']),
      );

      expect(browserVisible[0]?.name).toBe('page_navigate');
      expect(debuggerVisible[0]?.name).toBe('debug_pause');
    } finally {
      // @ts-expect-error test mutates mocked constant
      constants.SEARCH_TIER_PENALTY = previousPenalty;
    }
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
      new Map([['workflow_helper', 1.2]]),
    );

    const results = await engine.search('execute flow helper', 5);

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

  it('rejects partial explicit mentions and tolerates empty tool names', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('', ''),
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const results = await engine.search('please use page navigatex now', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('page_navigate');
  });

  it('applies intent bonuses, including unknown tools that are ignored', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine(
      [makeTool('page_navigate', 'Navigate a page'), makeTool('page_click', 'Click a page')],
      undefined,
      undefined,
      undefined,
      {
        queryCategoryProfiles: [],
        cjkQueryAliases: [],
        intentToolBoostRules: [
          {
            pattern: 'boost',
            boosts: [
              { tool: 'missing_tool', bonus: 40 },
              { tool: 'page_click', bonus: 10 },
              { tool: 'page_navigate', bonus: 25 },
            ],
          },
        ],
      } satisfies SearchConfig,
    );

    const results = await engine.search('please boost', 5);

    expect(results[0]?.name).toBe('page_navigate');
    expect(results.some((item) => item.name === 'page_click')).toBe(true);
  });

  it('indexes parameter names and descriptions for scoring', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      {
        name: 'page_fetch',
        description: 'Fetch a resource by URL.',
        inputSchema: {
          type: 'object',
          properties: {
            targetUrl: {
              description: 'Target URL to fetch',
            },
            pageId: {
              description: 'Numeric page identifier',
            },
          },
        },
      } as Tool,
      makeTool('page_navigate', 'Navigate a page'),
    ]);

    const results = await engine.search('target url', 5);

    expect(results[0]?.name).toBe('page_fetch');
  });

  it('weights name tokens above description tokens for the same term', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('alpha_runner', 'Alpha runner utility'),
      makeTool('beta_tool', 'Manages alpha workflows'),
    ]);

    const results = await engine.search('alpha', 5);

    // Default field weights (SEARCH_NAME_TOKEN_WEIGHT 3 > SEARCH_DESC_TOKEN_WEIGHT 1)
    // must keep the name hit ahead of the description hit.
    expect(results[0]?.name).toBe('alpha_runner');
    expect(results[1]?.name).toBe('beta_tool');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('boosts affinity neighbors and domain hubs when prefix groups are active', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_alpha', 'Alpha action'),
      makeTool('page_beta', 'Beta action'),
      makeTool('page_gamma', 'Gamma action'),
      makeTool('debug_pause', 'Pause action'),
    ]);

    const pageResults = await engine.search('page', 10);
    const alphaResults = await engine.search('alpha', 10);

    expect(pageResults.map((item) => item.name)).toEqual(
      expect.arrayContaining(['page_alpha', 'page_beta', 'page_gamma']),
    );
    expect(pageResults.find((item) => item.name === 'page_beta')?.score).toBeGreaterThan(
      alphaResults.find((item) => item.name === 'page_beta')?.score ?? 0,
    );
    expect(alphaResults.find((item) => item.name === 'page_beta')).toBeUndefined();
  });

  it('skips affinity boosts when the winner lacks neighbors', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_alpha', 'Alpha action'),
      makeTool('page_beta', 'Beta action'),
      makeTool('loner_tool', 'Solo tool for lone operations'),
    ]);

    const results = await engine.search('lone', 5);

    expect(results[0]?.name).toBe('loner_tool');
  });

  it('exits domain hub expansion early when the threshold is non-positive', async () => {
    const constants = await import('@src/constants');
    // @ts-expect-error
    constants.SEARCH_DOMAIN_HUB_THRESHOLD = 0;

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const results = await engine.search('navigate', 5);
    expect(results[0]?.name).toBe('page_navigate');
  });

  it('fills the query cache enough to trigger eviction', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([makeTool('page_navigate', 'Navigate a page')]);

    for (let i = 0; i < 9; i++) {
      const results = await engine.search(`navigate-${i}`, 5);
      expect(results[0]?.name).toBe('page_navigate');
    }
  });

  it('clears the internal query cache directly', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([makeTool('page_navigate', 'Navigate a page')]);

    // Reach the private cache through a narrow structural view. The test's
    // subject is "a query populates the cache and clear() empties it", not the
    // exact key string (which carries etag/stem-mode suffixes by design).
    const cache = (
      engine as unknown as {
        queryCache: { size: number; clear(): void };
      }
    ).queryCache;
    await engine.search('navigate', 5);
    expect(cache.size).toBeGreaterThan(0);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('returns early when all intent bonuses are non-positive', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([makeTool('page_navigate', 'Navigate a page')]);
    const scores = new Float64Array([3]);
    const fakeBonuses = {
      size: 1,
      values() {
        return [0][Symbol.iterator]();
      },
      [Symbol.iterator]() {
        return [['page_navigate', 0] as [string, number]][Symbol.iterator]();
      },
    };

    (engine as any).applyIntentBonusBand(scores, fakeBonuses);
    expect(Array.from(scores)).toEqual([3]);
  });

  it('skips intent bonuses with non-positive values or missing tiers', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);
    const scores = new Float64Array([1, 2]);

    const fakeBonuses = {
      size: 2,
      values() {
        return [1][Symbol.iterator]();
      },
      [Symbol.iterator]() {
        return [['page_navigate', 0] as [string, number], ['page_click', 2] as [string, number]][
          Symbol.iterator
        ]();
      },
    };

    (engine as any).applyIntentBonusBand(scores, fakeBonuses);
    expect(Array.from(scores)).toEqual([1, 2]);
  });
});

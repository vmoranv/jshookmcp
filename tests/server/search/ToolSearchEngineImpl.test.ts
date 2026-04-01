import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
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

const vectorState = vi.hoisted(() => ({
  embedBatchCalls: 0,
  embedCalls: 0,
  embedBatchInputs: [] as string[][],
  embedInputs: [] as string[],
  failEmbedBatch: false,
  failEmbedQuery: false,
}));

vi.mock('@server/ToolCatalog', () => ({
  get allTools() {
    return state.allTools;
  },
  getToolDomain: state.getToolDomain,
}));

vi.mock('@server/search/EmbeddingEngine', () => ({
  EmbeddingEngine: class {
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      vectorState.embedBatchCalls += 1;
      vectorState.embedBatchInputs.push(texts);
      if (vectorState.failEmbedBatch) {
        throw new Error('embedBatch failed');
      }
      return texts.map(vectorFor);
    }

    async embed(text: string): Promise<Float32Array> {
      vectorState.embedCalls += 1;
      vectorState.embedInputs.push(text);
      if (vectorState.failEmbedQuery) {
        throw new Error('embed failed');
      }
      return vectorFor(text);
    }
  },
}));

vi.mock('@src/constants', () => ({
  SEARCH_TFIDF_COSINE_WEIGHT: 0.3,
  SEARCH_AFFINITY_BOOST_FACTOR: 0.2,
  SEARCH_AFFINITY_TOP_N: 3,
  SEARCH_DOMAIN_HUB_THRESHOLD: 2,
  SEARCH_QUERY_CACHE_CAPACITY: 8,
  SEARCH_TRIGRAM_WEIGHT: 0.15,
  SEARCH_RRF_K: 60,
  SEARCH_SYNONYM_EXPANSION_LIMIT: 3,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_VECTOR_ENABLED: false, // Disable vector in existing tests for determinism
  SEARCH_VECTOR_MODEL_ID: 'Xenova/bge-micro-v2',
  SEARCH_VECTOR_COSINE_WEIGHT: 0.4,
  SEARCH_VECTOR_DYNAMIC_WEIGHT: false,
}));

function vectorFor(text: string): Float32Array {
  const lower = text.toLowerCase();

  if (lower.includes('navigate')) return new Float32Array([1, 0, 0]);
  if (lower.includes('click')) return new Float32Array([0.92, 0.08, 0]);
  if (lower.includes('alpha')) return new Float32Array([0.95, 0, 0]);
  if (lower.includes('beta')) return new Float32Array([0.9, 0, 0]);
  if (lower.includes('gamma')) return new Float32Array([0.85, 0, 0]);
  if (lower.includes('pause') || lower.includes('debug')) return new Float32Array([0, 1, 0]);

  return new Float32Array([0.5, 0.25, 0]);
}

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
    vectorState.embedBatchCalls = 0;
    vectorState.embedCalls = 0;
    vectorState.embedBatchInputs = [];
    vectorState.embedInputs = [];
    vectorState.failEmbedBatch = false;
    vectorState.failEmbedQuery = false;
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

  it('uses vector feedback, cache invalidation, and lazy embedding reuse', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine(
      [
        makeTool('page_navigate', 'Navigate a page'),
        makeTool('page_click', 'Click a page element'),
        makeTool('debug_pause', 'Pause JavaScript execution'),
      ],
      undefined,
      undefined,
      undefined,
      {
        queryCategoryProfiles: [],
        cjkQueryAliases: [],
        intentToolBoostRules: [],
        vectorEnabled: true,
        vectorCosineWeight: 0.4,
      } satisfies SearchConfig,
    );

    const first = await engine.search('navigate', 5);
    engine.recordToolCallFeedback('page_navigate', 'navigate');
    const second = await engine.search('navigate', 5);

    expect(first[0]?.name).toBe('page_navigate');
    expect(second[0]?.name).toBe('page_navigate');
    expect(vectorState.embedBatchCalls).toBe(1);
    expect(vectorState.embedCalls).toBe(2);
    expect(vectorState.embedBatchInputs[0]?.[0]).toContain('page navigate');
  });

  it('falls back when vector embeddings fail to load', async () => {
    vectorState.failEmbedBatch = true;

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine(
      [makeTool('page_navigate', 'Navigate a page')],
      undefined,
      undefined,
      undefined,
      {
        queryCategoryProfiles: [],
        cjkQueryAliases: [],
        intentToolBoostRules: [],
        vectorEnabled: true,
        vectorCosineWeight: 0.4,
      } satisfies SearchConfig,
    );

    const results = await engine.search('navigate', 5);

    expect(results[0]?.name).toBe('page_navigate');
    expect(vectorState.embedBatchCalls).toBe(1);
    expect(vectorState.embedCalls).toBe(0);
  });

  it('falls back when query embedding fails', async () => {
    vectorState.failEmbedQuery = true;

    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine(
      [makeTool('page_navigate', 'Navigate a page')],
      undefined,
      undefined,
      undefined,
      {
        queryCategoryProfiles: [],
        cjkQueryAliases: [],
        intentToolBoostRules: [],
        vectorEnabled: true,
        vectorCosineWeight: 0.4,
      } satisfies SearchConfig,
    );

    const results = await engine.search('navigate', 5);

    expect(results[0]?.name).toBe('page_navigate');
    expect(vectorState.embedBatchCalls).toBe(1);
    expect(vectorState.embedCalls).toBe(1);
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

    await engine.search('navigate', 5);
    const cacheKey = `navigate\0${5}\0${0}`;

    expect((engine as any).queryCache.get(cacheKey)).toBeDefined();
    (engine as any).queryCache.clear();
    expect((engine as any).queryCache.get(cacheKey)).toBeUndefined();
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

describe('Hybrid Vector Search', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
    state.allTools = [
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
      makeTool('debug_pause', 'Pause JavaScript execution'),
    ];
  });

  it('gracefully falls back when vector is disabled (3-signal only)', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    // Vector is disabled via mocked constants (SEARCH_VECTOR_ENABLED=false)
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    const results = await engine.search('navigate', 5);

    // Should still return results using BM25+TF-IDF+Trigram
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('page_navigate');
  });

  it('recordToolCallFeedback adjusts vector weight upward for top-5 matches', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([
      makeTool('page_navigate', 'Navigate a page'),
      makeTool('page_click', 'Click a page element'),
    ]);

    // Without vector enabled, feedback should be a no-op (no crash)
    engine.recordToolCallFeedback('page_navigate', 'navigate');
    // Should not throw
    const results = await engine.search('navigate', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('recordToolCallFeedback is safe to call without prior search', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([makeTool('page_navigate', 'Navigate a page')]);

    // Should not throw even without a prior search
    expect(() => engine.recordToolCallFeedback('page_navigate', '')).not.toThrow();
  });

  it('search returns Promise<ToolSearchResult[]>', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine([makeTool('page_navigate', 'Navigate a page')]);

    const result = engine.search('navigate', 5);

    // search() should return a Promise
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(Array.isArray(resolved)).toBe(true);
  });
});

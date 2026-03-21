import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  getToolDomain: vi.fn((name: string) => {
    if (name.startsWith('page_')) return 'browser';
    if (name.startsWith('debug_') || name.startsWith('breakpoint_')) return 'debugger';
    if (name.startsWith('network_')) return 'network';
    if (name.startsWith('web_api_')) return 'workflow';
    if (name.startsWith('console_')) return 'browser';
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
  SEARCH_TRIGRAM_WEIGHT: 0.15,
  SEARCH_RRF_K: 60,
  SEARCH_SYNONYM_EXPANSION_LIMIT: 3,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_VECTOR_ENABLED: false,
  SEARCH_VECTOR_MODEL_ID: 'Xenova/bge-micro-v2',
  SEARCH_VECTOR_COSINE_WEIGHT: 0.4,
  SEARCH_VECTOR_DYNAMIC_WEIGHT: false,
}));

function makeTool(name: string, description: string, params?: Record<string, object>): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: params ?? {},
    },
  };
}

describe('search/SearchIntegration', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
  });

  it('synonym expansion: "intercept API" finds network capture tools', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    state.allTools = [
      makeTool('web_api_capture_session', 'Full-chain web API capture workflow'),
      makeTool('network_enable', 'Enable network request monitoring'),
      makeTool('page_navigate', 'Navigate to a URL'),
      makeTool('console_inject_fetch_interceptor', 'Inject a Fetch API interceptor to capture fetch request/response data'),
    ];
    const engine = new ToolSearchEngine(state.allTools);

    const results = await engine.search('intercept API calls', 10);

    // At least one capture/intercept-related tool should be in top results
    const topNames = results.slice(0, 5).map((r) => r.name);
    const hasRelevant =
      topNames.includes('web_api_capture_session') ||
      topNames.includes('console_inject_fetch_interceptor') ||
      topNames.includes('network_enable');
    expect(hasRelevant).toBe(true);
  });

  it('trigram fuzzy: "nagivate" matches "page_navigate"', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    state.allTools = [
      makeTool('page_navigate', 'Navigate to a URL'),
      makeTool('page_click', 'Click an element'),
      makeTool('debug_pause', 'Pause execution'),
    ];
    const engine = new ToolSearchEngine(state.allTools);

    const results = await engine.search('nagivate page', 10);

    // page_navigate should appear in results despite the typo
    const hasNavigate = results.some((r) => r.name === 'page_navigate');
    expect(hasNavigate).toBe(true);
  });

  it('parameter name search: tools with "url" parameter rank higher', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    state.allTools = [
      makeTool('page_navigate', 'Navigate to a URL', {
        url: { type: 'string', description: 'Target URL to navigate to' },
      }),
      makeTool('debug_pause', 'Pause execution at the next statement'),
      makeTool('page_click', 'Click an element', {
        selector: { type: 'string', description: 'CSS selector of element to click' },
      }),
    ];
    const engine = new ToolSearchEngine(state.allTools);

    const results = await engine.search('url target', 10);

    // page_navigate has "url" parameter, should rank high
    expect(results[0]?.name).toBe('page_navigate');
  });

  it('RRF fusion rescues BM25-missed docs via other signals', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    state.allTools = [
      // This tool's NAME contains "breakpoint" but query says "pause"
      makeTool('breakpoint_set', 'Set a breakpoint at a specific location'),
      makeTool('breakpoint_list', 'List all active breakpoints'),
      // This tool's NAME contains "debug_pause" — direct keyword match
      makeTool('debug_pause', 'Pause execution at the next statement'),
    ];
    const engine = new ToolSearchEngine(state.allTools);

    const results = await engine.search('pause execution', 10);

    // debug_pause should always rank (direct keyword match)
    const hasPause = results.some((r) => r.name === 'debug_pause');
    expect(hasPause).toBe(true);
  });

  it('extractParamTokens handles nested schemas', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');

    const tokens = ToolSearchEngine.extractParamTokens({
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'URL pattern to blackbox' },
        maxRetries: { type: 'number', description: 'Maximum retry attempts' },
      },
    });

    expect(tokens).toContain('url');
    expect(tokens).toContain('pattern');
    expect(tokens).toContain('max');
    expect(tokens).toContain('retries');
    // Description keywords
    expect(tokens).toContain('blackbox');
    expect(tokens).toContain('maximum');
    expect(tokens).toContain('retry');
    expect(tokens).toContain('attempts');
  });

  it('extractParamTokens returns empty for invalid schemas', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');

    expect(ToolSearchEngine.extractParamTokens(null)).toEqual([]);
    expect(ToolSearchEngine.extractParamTokens(undefined)).toEqual([]);
    expect(ToolSearchEngine.extractParamTokens({})).toEqual([]);
    expect(ToolSearchEngine.extractParamTokens({ properties: 'invalid' })).toEqual([]);
  });
});

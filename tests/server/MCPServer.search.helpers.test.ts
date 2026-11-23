import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';

function tool(name: string, description = `desc_${name}`) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const mocks = vi.hoisted(() => ({
  allTools: [
    tool('browser_launch', 'Launch browser'),
    tool('page_navigate', 'Navigate page'),
    tool('network_get_requests', 'Inspect requests'),
    tool('ai_hook', 'Manage runtime hooks'),
  ],
  registrations: [
    { domain: 'browser', tool: tool('browser_launch') },
    { domain: 'browser', tool: tool('page_navigate') },
    { domain: 'network', tool: tool('network_get_requests') },
  ],
  engineInstances: [] as any[],
  searchCatalog: null as any,
}));

mocks.searchCatalog = {
  tools: mocks.allTools,
  entries: mocks.allTools.map((candidate: any) => ({
    tool: candidate,
    domain: candidate.name.startsWith('network_') ? 'network' : 'browser',
  })),
  entryByName: new Map(
    mocks.allTools.map((candidate: any) => [
      candidate.name,
      {
        tool: candidate,
        domain: candidate.name.startsWith('network_') ? 'network' : 'browser',
      },
    ]),
  ),
  toolByName: new Map(mocks.allTools.map((candidate: any) => [candidate.name, candidate])),
  domainByToolName: new Map(
    mocks.allTools.map((candidate: any) => [
      candidate.name,
      candidate.name.startsWith('network_') ? 'network' : 'browser',
    ]),
  ),
  sceneKeywordsByToolName: new Map(),
};

vi.mock('@server/ToolCatalog', () => ({
  allTools: mocks.allTools,
  getProfileDomains: vi.fn((tier: string) => (tier === 'search' ? ['browser'] : [])),
  getToolDomain: vi.fn((name: string) => {
    if (name.startsWith('browser_') || name.startsWith('page_')) return 'browser';
    if (name.startsWith('network_')) return 'network';
    if (name === 'ai_hook' || name.startsWith('hook_')) return 'instrumentation';
    return null;
  }),
}));

vi.mock('@server/registry/index', () => ({
  getAllRegistrations: () => mocks.registrations,
  ensureAllDomainsLoaded: vi.fn().mockResolvedValue(undefined),
  getAllManifests: () => [],
}));

vi.mock('@server/registry/SearchCatalog', () => ({
  loadSearchCatalog: vi.fn(async () => mocks.searchCatalog),
}));

vi.mock('@server/registry/generated-domains', () => ({
  DOMAIN_TOOL_COUNT_MAP: { browser: 2, network: 1 },
}));

vi.mock('@src/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/constants')>()),
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 1.5,
  // Sentinel values (≠ src defaults 1.12/1.35/1.25) prove getSearchEngine reads
  // the shared constants instead of inlining literals.
  SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER: 3.33,
  SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER: 2.22,
  SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER: 1.11,
}));

vi.mock('@server/ToolSearch', () => ({
  ToolSearchEngine: class MockToolSearchEngine {
    public args: any[];
    public readonly qualityTrackerStub = { qualityTracker: true };

    constructor(...args: any[]) {
      this.args = args;
      mocks.engineInstances.push(this);
    }

    getSearchQualityTracker() {
      return this.qualityTrackerStub;
    }
  },
}));

import {
  buildDomainDescription,
  buildSearchSignature,
  createActivationBudgetTracker,
  estimateToolTokens,
  getActivationBudgetLimits,
  getActivationBudgetSnapshot,
  getActiveToolNames,
  getCombinedTools,
  getExtensionDomainMap,
  getSearchEngine,
  getToolByName,
  getVisibleDomainsForTier,
} from '@server/MCPServer.search.helpers';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [tool('browser_launch')],
    activatedToolNames: new Set<string>(['network_get_requests']),
    extensionToolsByName: new Map(),
    extensionWorkflowRuntimeById: new Map(),
    enabledDomains: new Set<string>(),
    baseTier: 'search',
    config: { search: structuredClone(DEFAULT_SEARCH_CONFIG) },
    ...overrides,
  } as any;
}

describe('MCPServer.search.helpers', () => {
  beforeEach(() => {
    mocks.engineInstances.length = 0;
    vi.clearAllMocks();
  });

  it('derives active tool names from selected and activated tools', () => {
    const ctx = createCtx({
      activatedToolNames: new Set(['network_get_requests', 'browser_launch']),
    });

    expect(getActiveToolNames(ctx)).toEqual(new Set(['browser_launch', 'network_get_requests']));
  });

  it('treats enabled, activated, and extension tool domains as visible', () => {
    const ctx = createCtx({
      enabledDomains: new Set(['network']),
      activatedToolNames: new Set(['ai_hook']),
      extensionToolsByName: new Map([
        [
          'run_extension_workflow',
          {
            name: 'run_extension_workflow',
            domain: 'workflow',
            tool: tool('run_extension_workflow', 'Run extension workflow'),
          },
        ],
      ]),
    });

    expect(getVisibleDomainsForTier(ctx)).toEqual(
      new Set(['browser', 'network', 'instrumentation', 'workflow']),
    );
  });

  it('builds extension-domain and tool-name lookup maps', async () => {
    const extensionTool = tool('custom_tool', 'Custom workflow tool');
    const ctx = createCtx({
      extensionToolsByName: new Map([
        ['custom_tool', { name: 'custom_tool', domain: 'workflow', tool: extensionTool }],
        ['page_navigate', { name: 'page_navigate', domain: 'workflow', tool: extensionTool }],
      ]),
    });

    expect(getExtensionDomainMap(ctx)).toEqual(
      new Map([
        ['custom_tool', 'workflow'],
        ['page_navigate', 'workflow'],
      ]),
    );

    const combined = await getCombinedTools(ctx);
    expect(combined.find((candidate) => candidate.name === 'custom_tool')).toBe(extensionTool);
    // Extension overwrites the 'page_navigate' key in the internal Map, but the tool object
    // stored there has name 'custom_tool', so no entry with name 'page_navigate' survives.
    expect(combined.find((candidate) => candidate.name === 'page_navigate')).toBeUndefined();

    const byName = await getToolByName(ctx);
    expect(byName.get('custom_tool')).toBe(extensionTool);
    expect(byName.get('page_navigate')).toBeUndefined();
  });

  it('builds a stable search signature from workflow count and sorted extension identities', () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        ['z_tool', { domain: 'workflow' }],
        ['a_tool', { domain: 'browser' }],
      ]),
      extensionWorkflowRuntimeById: new Map([
        ['wf-1', {}],
        ['wf-2', {}],
      ]),
    });

    expect(buildSearchSignature(ctx)).toMatch(
      /^2::a_tool:browser:[0-9a-f]{12}\|z_tool:workflow:[0-9a-f]{12}$/,
    );
  });

  it('changes the search signature when an extension description changes', () => {
    const base = {
      extensionToolsByName: new Map([
        [
          'a_tool',
          {
            domain: 'browser',
            tool: { name: 'a_tool', description: 'first', inputSchema: { type: 'object' } },
          },
        ],
      ]),
      extensionWorkflowRuntimeById: new Map(),
    };
    const renamed = {
      ...base,
      extensionToolsByName: new Map([
        [
          'a_tool',
          {
            domain: 'browser',
            tool: { name: 'a_tool', description: 'second', inputSchema: { type: 'object' } },
          },
        ],
      ]),
    };

    expect(buildSearchSignature(createCtx(base))).not.toBe(
      buildSearchSignature(createCtx(renamed)),
    );
  });

  it('caches the search engine by signature and applies workflow and extension boosts', async () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow tool'),
          },
        ],
      ]),
      extensionWorkflowRuntimeById: new Map([['wf-1', {}]]),
    });

    const first = await getSearchEngine(ctx);
    const second = await getSearchEngine(ctx);

    expect(first).toBe(second);
    expect((await import('@server/registry/index')).ensureAllDomainsLoaded).not.toHaveBeenCalled();
    expect(mocks.engineInstances).toHaveLength(1);
    expect(mocks.engineInstances[0].args[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'browser_launch' }),
        expect.objectContaining({ name: 'custom_tool' }),
      ]),
    );
    expect([...mocks.engineInstances[0].args[1]]).toEqual(
      expect.arrayContaining([
        ['browser_launch', 'browser'],
        ['page_navigate', 'browser'],
        ['network_get_requests', 'network'],
        ['custom_tool', 'workflow'],
      ]),
    );
    expect(mocks.engineInstances[0].args[2]).toEqual(new Map([['workflow', 1.5]]));
    // Sentinel values from the mocked @src/constants: a literal regression here
    // (back to 1.12/1.35/1.25) would fail these assertions.
    expect(mocks.engineInstances[0].args[3]).toEqual(
      new Map([
        ['custom_tool', 3.33],
        ['run_extension_workflow', 2.22],
        ['list_extension_workflows', 1.11],
      ]),
    );

    ctx.extensionWorkflowRuntimeById.set('wf-2', {});
    const third = await getSearchEngine(ctx);
    expect(third).not.toBe(first);
    expect(mocks.engineInstances).toHaveLength(2);
  });

  it('builds a domain description including extension tools and totals', () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_browser_tool',
          { name: 'custom_browser_tool', domain: 'browser', tool: tool('custom_browser_tool') },
        ],
        [
          'custom_workflow_tool',
          { name: 'custom_workflow_tool', domain: 'workflow', tool: tool('custom_workflow_tool') },
        ],
      ]),
    });

    const description = buildDomainDescription(ctx);

    expect(description).toContain('Search 5 tools across 3 capability domains.');
    expect(description).toContain('plugin/workflow tools (2 currently loaded)');
    // Domain names/counts live in activate_domain's domain param; the query tip lives in search_tools.query.
    expect(description).not.toContain('Domains:');
    expect(description).not.toContain('Query tip');
  });
});

describe('MCPServer.search.helpers — tool activation budget', () => {
  it('ceil-divides the concatenated definition length by 4', () => {
    // 'abcd' + '' + '{}' = 6 chars -> 2 tokens
    expect(estimateToolTokens({ name: 'abcd', description: '', inputSchema: {} })).toBe(2);
    // 'ab' + '' + '{}' = 4 chars -> 1 token (exact division, no rounding up)
    expect(estimateToolTokens({ name: 'ab', description: '', inputSchema: {} })).toBe(1);
  });

  it('rounds up partial token blocks', () => {
    // 'abc' + '' + '{}' = 5 chars -> 2 tokens
    expect(estimateToolTokens({ name: 'abc', description: '', inputSchema: {} })).toBe(2);
    // 'a' + '' + '{}' = 3 chars -> 1 token
    expect(estimateToolTokens({ name: 'a', description: '', inputSchema: {} })).toBe(1);
  });

  it('includes the description and the serialized input schema', () => {
    const def = { name: 'tool', description: 'abcd', inputSchema: { type: 'object' } };
    // 'tool' + 'abcd' + '{"type":"object"}' = 25 chars -> 7 tokens
    expect(estimateToolTokens(def)).toBe(7);
  });

  it('treats a missing description and schema as empty strings', () => {
    expect(estimateToolTokens({ name: 'abcd' })).toBe(1);
    expect(estimateToolTokens({ name: 'abc' })).toBe(1);
    expect(estimateToolTokens({ name: '' })).toBe(0);
  });

  it('resolves budget limits from config with constant fallback', () => {
    const configured = createCtx({
      config: { mcp: { toolActivationBudgetTokens: 1234, toolActivationMaxTools: 7 } },
    });
    expect(getActivationBudgetLimits(configured)).toEqual({ maxTokens: 1234, maxTools: 7 });

    const bare = createCtx();
    const fallback = getActivationBudgetLimits(bare);
    expect(fallback.maxTokens).toBeGreaterThan(0);
    expect(fallback.maxTools).toBeGreaterThan(0);
  });

  it('tracker measures activated tools and admits while within budget', async () => {
    // The catalog fixture uses the 'Inspect requests' description.
    const base = estimateToolTokens(tool('network_get_requests', 'Inspect requests'));
    const tinyTokens = estimateToolTokens(tool('tiny'));
    const ctx = createCtx({
      config: { mcp: { toolActivationBudgetTokens: base + tinyTokens, toolActivationMaxTools: 5 } },
    });

    const tracker = await createActivationBudgetTracker(ctx);
    expect(tracker.usedTokens).toBe(base);
    expect(tracker.activeTools).toBe(1);
    expect(tracker.admit(tool('tiny'))).toBe(true);
    expect(tracker.usedTokens).toBe(base + tinyTokens);
    // Would exceed maxTokens -> rejected and not reserved.
    expect(tracker.admit(tool('tiny2'))).toBe(false);
    expect(tracker.usedTokens).toBe(base + tinyTokens);
  });

  it('tracker rejects activations beyond maxTools', async () => {
    const ctx = createCtx({
      config: { mcp: { toolActivationBudgetTokens: 100_000, toolActivationMaxTools: 2 } },
    });

    const tracker = await createActivationBudgetTracker(ctx);
    expect(tracker.admit(tool('a'))).toBe(true);
    expect(tracker.admit(tool('b'))).toBe(false);
    expect(tracker.activeTools).toBe(2);
  });

  it('tracker never rejects outside the search profile but still accounts usage', async () => {
    const ctx = createCtx({
      baseTier: 'full',
      config: { mcp: { toolActivationBudgetTokens: 1, toolActivationMaxTools: 1 } },
    });

    const tracker = await createActivationBudgetTracker(ctx);
    expect(tracker.enforced).toBe(false);
    expect(tracker.admit(tool('a'))).toBe(true);
    expect(tracker.admit(tool('b'))).toBe(true);
    expect(tracker.activeTools).toBe(3);
  });

  it('snapshot reports coverage_report budget fields with headroom floored at zero', async () => {
    // The catalog fixture uses the 'Inspect requests' description.
    const base = estimateToolTokens(tool('network_get_requests', 'Inspect requests'));
    const ctx = createCtx({
      config: { mcp: { toolActivationBudgetTokens: base - 1, toolActivationMaxTools: 7 } },
    });

    expect(await getActivationBudgetSnapshot(ctx)).toEqual({
      activeTools: 1,
      estimatedTokens: base,
      budget: base - 1,
      maxTools: 7,
      headroom: 0,
    });
  });

  describe('searchEngine domain-instance registration', () => {
    it('registers the engine and its quality tracker as domain instances', async () => {
      const setDomainInstance = vi.fn();
      const ctx = createCtx({
        setDomainInstance,
        getDomainInstance: vi.fn(() => undefined),
      });

      const engine = await getSearchEngine(ctx);

      // Synchronous consumers (tool-call feedback + quality association in
      // MCPServer.execution) must reach the SAME instances the engine records
      // into; before this wiring they saw a tracker that never received a
      // single recordSearch, so associateLastSearch was a permanent no-op.
      expect(setDomainInstance).toHaveBeenCalledWith('searchEngine', engine);
      expect(setDomainInstance).toHaveBeenCalledWith(
        'searchQualityTracker',
        (engine as any).qualityTrackerStub,
      );
    });

    it('does not re-register on a cache hit with an unchanged signature', async () => {
      const setDomainInstance = vi.fn();
      const ctx = createCtx({
        setDomainInstance,
        getDomainInstance: vi.fn(() => undefined),
      });

      await getSearchEngine(ctx);
      const callsAfterFirst = setDomainInstance.mock.calls.length;
      await getSearchEngine(ctx);

      expect(setDomainInstance.mock.calls.length).toBe(callsAfterFirst);
    });
  });
});

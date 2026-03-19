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
  ],
  registrations: [
    { domain: 'browser', tool: tool('browser_launch') },
    { domain: 'browser', tool: tool('page_navigate') },
    { domain: 'network', tool: tool('network_get_requests') },
  ],
  engineInstances: [] as any[],
}));

vi.mock('@server/ToolCatalog', () => ({
  allTools: mocks.allTools,
}));

vi.mock('@server/registry/index', () => ({
  getAllRegistrations: () => mocks.registrations,
}));

vi.mock('@src/constants', () => ({
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 1.5,
}));

vi.mock('@server/ToolSearch', () => ({
  ToolSearchEngine: class MockToolSearchEngine {
    public args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
      mocks.engineInstances.push(this);
    }
  },
}));

import {
  buildDomainDescription,
  buildSearchSignature,
  getActiveToolNames,
  getCombinedTools,
  getExtensionDomainMap,
  getSearchEngine,
  getToolByName,
} from '@server/MCPServer.search.helpers';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [tool('browser_launch')],
    activatedToolNames: new Set<string>(['network_get_requests']),
    extensionToolsByName: new Map(),
    extensionWorkflowRuntimeById: new Map(),
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

  it('builds extension-domain and tool-name lookup maps', () => {
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
      ])
    );

    const combined = getCombinedTools(ctx);
    expect(combined.find((candidate) => candidate.name === 'custom_tool')).toBe(extensionTool);
    // Extension overwrites the 'page_navigate' key in the internal Map, but the tool object
    // stored there has name 'custom_tool', so no entry with name 'page_navigate' survives.
    expect(combined.find((candidate) => candidate.name === 'page_navigate')).toBeUndefined();

    const byName = getToolByName(ctx);
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

    expect(buildSearchSignature(ctx)).toBe('2::a_tool:browser|z_tool:workflow');
  });

  it('caches the search engine by signature and applies workflow and extension boosts', () => {
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

    const first = getSearchEngine(ctx);
    const second = getSearchEngine(ctx);

    expect(first).toBe(second);
    expect(mocks.engineInstances).toHaveLength(1);
    expect(mocks.engineInstances[0].args[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'browser_launch' }),
        expect.objectContaining({ name: 'custom_tool' }),
      ])
    );
    expect(mocks.engineInstances[0].args[1]).toEqual(new Map([['custom_tool', 'workflow']]));
    expect(mocks.engineInstances[0].args[2]).toEqual(new Map([['workflow', 1.5]]));
    expect(mocks.engineInstances[0].args[3]).toEqual(
      new Map([
        ['custom_tool', 1.12],
        ['run_extension_workflow', 1.35],
        ['list_extension_workflows', 1.25],
      ])
    );

    ctx.extensionWorkflowRuntimeById.set('wf-2', {});
    const third = getSearchEngine(ctx);
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
    expect(description).toContain('browser (3)');
    expect(description).toContain('network (1)');
    expect(description).toContain('workflow (1)');
  });
});

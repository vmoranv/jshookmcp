import { beforeEach, describe, expect, it, vi } from 'vitest';

function tool(name: string, description = `desc_${name}`) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const state = vi.hoisted(() => ({
  createToolHandlerMap: vi.fn((_: any, names?: Set<string>) =>
    Object.fromEntries(
      [...(names ?? new Set<string>())].map((name) => [name, vi.fn(async () => ({ name }))]),
    ),
  ),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  ensureDomainLoaded: vi.fn().mockResolvedValue(undefined),
  getRegistrationByName: vi.fn((name: string) => ({
    domain: name.startsWith('network_') ? 'network' : 'browser',
    tool: tool(name),
  })),
  searchCatalog: null as any,
}));

const catalogTools = ['browser_launch', 'page_navigate', 'network_get_requests'].map((name) =>
  tool(name),
);

state.searchCatalog = {
  entries: catalogTools.map((candidate) => ({
    tool: candidate,
    domain: candidate.name.startsWith('network_') ? 'network' : 'browser',
  })),
  tools: catalogTools,
  entryByName: new Map(
    catalogTools.map((candidate) => [
      candidate.name,
      { tool: candidate, domain: candidate.name.startsWith('network_') ? 'network' : 'browser' },
    ]),
  ),
  toolByName: new Map(catalogTools.map((candidate) => [candidate.name, candidate])),
  domainByToolName: new Map(),
  sceneKeywordsByToolName: new Map(),
};

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({
    content: [{ type: 'text', text }],
  }),
}));

vi.mock('@server/ToolCatalog', () => ({
  allTools: [
    tool('browser_launch', 'Launch browser'),
    tool('page_navigate', 'Navigate page'),
    tool('network_get_requests', 'Get requests'),
  ],
  getToolDomain: (name: string) => {
    if (name === 'page_navigate' || name === 'browser_launch') return 'browser';
    if (name === 'network_get_requests') return 'network';
    return undefined;
  },
}));

vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: state.createToolHandlerMap,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

vi.mock('@server/registry/index', () => ({
  ensureAllDomainsLoaded: vi.fn().mockResolvedValue(undefined),
  ensureDomainLoaded: state.ensureDomainLoaded,
  getRegistrationByName: state.getRegistrationByName,
}));

vi.mock('@server/registry/SearchCatalog', () => ({
  loadSearchCatalog: vi.fn(async () => state.searchCatalog),
}));

import {
  activateToolNames,
  handleActivateTools,
  handleDeactivateTools,
} from '@server/MCPServer.search.handlers.activate';
import { estimateToolTokens } from '@server/MCPServer.search.helpers';
import { MCP_TOOL_ACTIVATION_BUDGET_TOKENS, MCP_TOOL_MAX_ACTIVE_TOOLS } from '@src/constants';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [tool('browser_launch', 'Launch browser')],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map<string, any>(),
    enabledDomains: new Set<string>(),
    activatedRegisteredTools: new Map<string, { remove: ReturnType<typeof vi.fn> }>(),
    router: {
      addHandlers: vi.fn(),
      removeHandler: vi.fn(),
    },
    handlerDeps: {},
    server: {
      sendToolListChanged: vi.fn(async () => undefined),
    },
    registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    eventBus: { emit: vi.fn() },
    ...overrides,
  } as any;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('MCPServer.search.handlers.activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activates built-in tools, registers handlers, and tracks enabled domains', async () => {
    const ctx = createCtx();

    const result = await activateToolNames(ctx, ['page_navigate']);

    expect(result).toEqual({
      activated: ['page_navigate'],
      alreadyActive: [],
      notFound: [],
      budgetExceeded: [],
      evicted: [],
      totalActive: 2,
      budget: {
        usedTokens: estimateToolTokens(tool('page_navigate')),
        maxTokens: MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
        activeTools: 1,
        maxTools: MCP_TOOL_MAX_ACTIVE_TOOLS,
      },
    });
    expect(ctx.registerSingleTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'page_navigate' }),
    );
    expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(state.ensureDomainLoaded).toHaveBeenCalledWith('browser', ctx.eventBus);
    expect((await import('@server/registry/index')).ensureAllDomainsLoaded).not.toHaveBeenCalled();
    expect(state.createToolHandlerMap).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['page_navigate']),
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ page_navigate: expect.any(Function) }),
    );
    expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it('normalizes namespaced extension tools and uses the stored extension handler', async () => {
    const extensionHandler = vi.fn(async () => ({ ok: true }));
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow'),
            handler: extensionHandler,
          },
        ],
      ]),
    });

    const result = await activateToolNames(ctx, ['mcp__jshook__custom_tool']);

    expect(result.activated).toEqual(['custom_tool']);
    expect(result.totalActive).toBe(2);
    expect(state.createToolHandlerMap).not.toHaveBeenCalled();
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
    expect(ctx.extensionToolsByName.get('custom_tool')?.registeredTool).toBeDefined();
    expect(ctx.enabledDomains.has('workflow')).toBe(true);
  });

  it('tracks already-active and missing tool names without notifying the server when nothing changes', async () => {
    const ctx = createCtx({
      activatedToolNames: new Set(['page_navigate']),
    });

    const result = await activateToolNames(ctx, ['page_navigate', 'missing_tool']);

    expect(result).toEqual({
      activated: [],
      alreadyActive: ['page_navigate'],
      notFound: ['missing_tool'],
      budgetExceeded: [],
      evicted: [],
      totalActive: 2,
      budget: {
        usedTokens: estimateToolTokens(tool('page_navigate')),
        maxTokens: MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
        activeTools: 1,
        maxTools: MCP_TOOL_MAX_ACTIVE_TOOLS,
      },
    });
    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('reports meta tools as already active instead of notFound', async () => {
    const ctx = createCtx();

    // Meta tools are top-level tools that never appear in the domain catalog.
    const result = await activateToolNames(ctx, ['deactivate_tools', 'coverage_report']);

    expect(result).toEqual({
      activated: [],
      alreadyActive: ['deactivate_tools', 'coverage_report'],
      notFound: [],
      budgetExceeded: [],
      evicted: [],
      totalActive: 1,
      budget: {
        // browser_launch sits in selectedTools (base profile) and never counts.
        usedTokens: 0,
        maxTokens: MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
        activeTools: 0,
        maxTools: MCP_TOOL_MAX_ACTIVE_TOOLS,
      },
    });
    expect(ctx.registerSingleTool).not.toHaveBeenCalled();
    expect(ctx.router.addHandlers).not.toHaveBeenCalled();
    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('returns meta tool names as alreadyActive through handleActivateTools', async () => {
    const ctx = createCtx();

    expect(
      parseResponse(await handleActivateTools(ctx, { names: ['search_tools'] })),
    ).toMatchObject({
      success: true,
      activated: [],
      alreadyActive: ['search_tools'],
      notFound: [],
    });
  });

  it('downgrades sendToolListChanged failures to warnings during activation', async () => {
    const ctx = createCtx({
      server: {
        sendToolListChanged: vi.fn(async () => {
          throw new Error('notify failed');
        }),
      },
    });

    const result = await activateToolNames(ctx, ['network_get_requests']);

    expect(result.activated).toEqual(['network_get_requests']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      'sendToolListChanged failed:',
      expect.any(Error),
    );
  });

  it('returns validation errors from handleActivateTools', async () => {
    const ctx = createCtx();

    expect(parseResponse(await handleActivateTools(ctx, { names: 'oops' }))).toEqual({
      success: false,
      error: 'names must be an array',
    });
  });

  it('wraps activation results in a success response from handleActivateTools', async () => {
    const ctx = createCtx();

    expect(parseResponse(await handleActivateTools(ctx, { names: ['page_navigate'] }))).toEqual({
      success: true,
      activated: ['page_navigate'],
      alreadyActive: [],
      notFound: [],
      budgetExceeded: [],
      evicted: [],
      totalActive: 2,
      budget: {
        usedTokens: estimateToolTokens(tool('page_navigate')),
        maxTokens: MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
        activeTools: 1,
        maxTools: MCP_TOOL_MAX_ACTIVE_TOOLS,
      },
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
  });

  it('deactivates tools, removes handlers, and clears extension registration state', async () => {
    const remove = vi.fn();
    const ctx = createCtx({
      activatedToolNames: new Set(['custom_tool']),
      activatedRegisteredTools: new Map([['custom_tool', { remove }]]),
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow'),
            registeredTool: { remove },
          },
        ],
      ]),
    });

    expect(
      parseResponse(
        await handleDeactivateTools(ctx, {
          names: ['mcp__jshook__custom_tool', 'missing_tool'],
        }),
      ),
    ).toEqual({
      success: true,
      deactivated: ['custom_tool'],
      notActivated: ['missing_tool'],
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    });
    expect(remove).toHaveBeenCalledTimes(2); // handler remove + deactivateToolCore (MCP SDK remove is idempotent)
    expect(ctx.router.removeHandler).toHaveBeenCalledWith('custom_tool');
    expect(ctx.activatedToolNames.has('custom_tool')).toBe(false);
    expect(ctx.extensionToolsByName.get('custom_tool')?.registeredTool).toBeUndefined();
    expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it('warns when tool removal throws but still completes deactivation', async () => {
    const remove = vi.fn(() => {
      throw new Error('remove failed');
    });
    const ctx = createCtx({
      activatedToolNames: new Set(['page_navigate']),
      activatedRegisteredTools: new Map([['page_navigate', { remove }]]),
    });

    const response = parseResponse(await handleDeactivateTools(ctx, { names: ['page_navigate'] }));

    expect(response.deactivated).toEqual(['page_navigate']);
    expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_navigate');
    expect(state.logger.warn).toHaveBeenCalledWith(
      'Failed to remove activated tool "page_navigate":',
      expect.any(Error),
    );
  });

  it('does not notify the server when deactivation finds no active tools', async () => {
    const ctx = createCtx();

    const response = parseResponse(await handleDeactivateTools(ctx, { names: ['missing_tool'] }));

    expect(response).toEqual({
      success: true,
      deactivated: [],
      notActivated: ['missing_tool'],
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    });
    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
  });

  describe('accepts names as JSON stringified array', () => {
    it('accepts names as a JSON stringified array', async () => {
      const ctx = createCtx();

      const result = parseResponse(await handleActivateTools(ctx, { names: '["page_navigate"]' }));

      expect(result).toMatchObject({
        success: true,
        activated: ['page_navigate'],
      });
    });

    it('accepts names as a JSON stringified array with multiple items', async () => {
      const ctx = createCtx();

      const result = parseResponse(
        await handleActivateTools(ctx, { names: '["page_navigate","browser_launch"]' }),
      );

      // browser_launch is pre-selected in createCtx.selectedTools, so it shows as alreadyActive
      expect(result).toMatchObject({
        success: true,
        activated: expect.arrayContaining(['page_navigate']),
        alreadyActive: expect.arrayContaining(['browser_launch']),
      });
    });

    it('rejects names as a non-JSON string', async () => {
      const ctx = createCtx();

      const result = parseResponse(await handleActivateTools(ctx, { names: 'not-json-at-all' }));

      expect(result).toEqual({
        success: false,
        error: 'names must be an array',
      });
    });

    it('still accepts native array (no regression for correct callers)', async () => {
      const ctx = createCtx();

      const result = parseResponse(await handleActivateTools(ctx, { names: ['page_navigate'] }));

      expect(result).toMatchObject({
        success: true,
        activated: ['page_navigate'],
      });
    });
  });

  describe('activation budget', () => {
    function budgetCtx(overrides: Record<string, unknown> = {}) {
      return createCtx({
        baseTier: 'search',
        config: {
          mcp: {
            toolActivationBudgetTokens: MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
            toolActivationMaxTools: MCP_TOOL_MAX_ACTIVE_TOOLS,
          },
        },
        ...overrides,
      });
    }

    it('skips tools that exceed the token budget and reports them in budgetExceeded', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const ctx = budgetCtx({
        config: { mcp: { toolActivationBudgetTokens: pageTokens, toolActivationMaxTools: 50 } },
      });

      const result = await activateToolNames(ctx, ['page_navigate', 'network_get_requests']);

      expect(result.activated).toEqual(['page_navigate']);
      expect(result.budgetExceeded).toEqual(['network_get_requests']);
      expect(result.budget).toEqual({
        usedTokens: pageTokens,
        maxTokens: pageTokens,
        activeTools: 1,
        maxTools: 50,
      });
      expect(ctx.activatedToolNames.has('network_get_requests')).toBe(false);
      expect(ctx.registerSingleTool).toHaveBeenCalledTimes(1);
    });

    it('surfaces budget rejections and summary through handleActivateTools', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const ctx = budgetCtx({
        config: { mcp: { toolActivationBudgetTokens: pageTokens, toolActivationMaxTools: 50 } },
      });

      const response = parseResponse(
        await handleActivateTools(ctx, { names: ['page_navigate', 'network_get_requests'] }),
      );

      expect(response.success).toBe(true);
      expect(response.budgetExceeded).toEqual(['network_get_requests']);
      expect(response.budget).toEqual({
        usedTokens: pageTokens,
        maxTokens: pageTokens,
        activeTools: 1,
        maxTools: 50,
      });
      expect(response.hint).toContain('over the activation budget');
    });

    it('skips tools beyond maxTools', async () => {
      const ctx = budgetCtx({
        config: {
          mcp: {
            toolActivationBudgetTokens: MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
            toolActivationMaxTools: 1,
          },
        },
      });

      const result = await activateToolNames(ctx, ['page_navigate', 'network_get_requests']);

      expect(result.activated).toEqual(['page_navigate']);
      expect(result.budgetExceeded).toEqual(['network_get_requests']);
      expect(result.budget).toMatchObject({ activeTools: 1, maxTools: 1 });
    });

    it('LRU-evicts a stale pre-activated tool instead of bouncing the activation (kimi-cu P2-4)', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const networkTokens = estimateToolTokens(tool('network_get_requests'));
      const ctx = budgetCtx({
        activatedToolNames: new Set(['page_navigate']),
        config: {
          mcp: {
            toolActivationBudgetTokens: pageTokens + networkTokens - 1,
            toolActivationMaxTools: 10,
          },
        },
      });

      const result = await activateToolNames(ctx, ['network_get_requests']);

      // The pre-activated page_navigate counts toward the budget, but instead
      // of a hard budgetExceeded the LRU path deactivates it to make room.
      expect(result.budgetExceeded).toEqual([]);
      expect(result.evicted).toEqual(['page_navigate']);
      expect(result.activated).toEqual(['network_get_requests']);
      expect(ctx.activatedToolNames.has('network_get_requests')).toBe(true);
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(false);
      expect(result.budget.usedTokens).toBe(networkTokens);
    });

    it('keeps every tool armed when eviction cannot free enough room (atomicity)', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const networkTokens = estimateToolTokens(tool('network_get_requests'));
      // Hopeless: even evicting page_navigate leaves network over budget.
      const ctx = budgetCtx({
        activatedToolNames: new Set(['page_navigate']),
        config: {
          mcp: {
            toolActivationBudgetTokens: Math.min(pageTokens, networkTokens),
            toolActivationMaxTools: 10,
          },
        },
      });

      const result = await activateToolNames(ctx, ['network_get_requests']);

      expect(result.evicted).toEqual([]);
      expect(result.budgetExceeded).toEqual(['network_get_requests']);
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
    });

    it('protects tools named in the same request from LRU eviction', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const ctx = budgetCtx({
        activatedToolNames: new Set(['page_navigate']),
        config: {
          mcp: {
            toolActivationBudgetTokens: pageTokens,
            toolActivationMaxTools: 1,
          },
        },
      });

      // page_navigate is active AND part of the request — it must survive.
      const result = await activateToolNames(ctx, ['page_navigate', 'network_get_requests']);

      expect(result.alreadyActive).toEqual(['page_navigate']);
      expect(result.evicted).toEqual([]);
      expect(result.budgetExceeded).toEqual(['network_get_requests']);
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
    });

    it('precheck reports wouldEvict without touching state', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const networkTokens = estimateToolTokens(tool('network_get_requests'));
      const ctx = budgetCtx({
        activatedToolNames: new Set(['page_navigate']),
        config: {
          mcp: {
            toolActivationBudgetTokens: pageTokens + networkTokens - 1,
            toolActivationMaxTools: 10,
          },
        },
      });

      const response = parseResponse(
        await handleActivateTools(ctx, { names: ['network_get_requests'], precheck: true }),
      );

      expect(response.precheck).toBe(true);
      expect(response.wouldActivate).toEqual(['network_get_requests']);
      expect(response.alreadyActive).toEqual([]);
      expect(response.wouldEvict).toEqual(['page_navigate']);
      expect(response.fits).toBe(true);
      expect(response.afterEvict).toMatchObject({ activeTools: 1 });
      // Dry-run: nothing was activated or deactivated.
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
      expect(ctx.activatedToolNames.has('network_get_requests')).toBe(false);
      expect(ctx.registerSingleTool).not.toHaveBeenCalled();
    });

    it('does not enforce the budget outside the search profile', async () => {
      const ctx = budgetCtx({
        baseTier: 'full',
        config: { mcp: { toolActivationBudgetTokens: 1, toolActivationMaxTools: 1 } },
      });

      const result = await activateToolNames(ctx, ['page_navigate', 'network_get_requests']);

      expect(result.budgetExceeded).toEqual([]);
      expect(result.activated).toEqual(['page_navigate', 'network_get_requests']);
      expect(result.totalActive).toBe(3);
    });
  });

  describe('per-tool lifecycle events', () => {
    function emittedPayloads(bus: { emit: ReturnType<typeof vi.fn> }, event: string): any[] {
      return bus.emit.mock.calls
        .filter((call: any[]) => call[0] === event)
        .map((call: any[]) => call[1]);
    }

    it('emits exactly one tool:activated per newly activated tool, carrying its domain', async () => {
      const ctx = createCtx();

      const result = await activateToolNames(ctx, ['page_navigate', 'network_get_requests']);

      expect(result.activated).toEqual(['page_navigate', 'network_get_requests']);
      // The batch event is still emitted once, unchanged in shape.
      expect(emittedPayloads(ctx.eventBus, 'tool.activation.changed')).toEqual([
        {
          action: 'activated',
          toolNames: ['page_navigate', 'network_get_requests'],
          timestamp: expect.any(String),
        },
      ]);
      // ...and one per-tool event per transition, each with its own domain.
      const events = emittedPayloads(ctx.eventBus, 'tool:activated');
      expect(events).toHaveLength(2);
      expect(events).toEqual([
        { toolName: 'page_navigate', domain: 'browser', timestamp: expect.any(String) },
        { toolName: 'network_get_requests', domain: 'network', timestamp: expect.any(String) },
      ]);
    });

    it('emits no tool:activated for already-active, missing, or budget-rejected tools', async () => {
      const pageTokens = estimateToolTokens(tool('page_navigate'));
      const ctx = createCtx({
        baseTier: 'search',
        activatedToolNames: new Set(['page_navigate']),
        config: { mcp: { toolActivationBudgetTokens: pageTokens, toolActivationMaxTools: 50 } },
      });

      const result = await activateToolNames(ctx, [
        'page_navigate',
        'missing_tool',
        'network_get_requests',
      ]);

      expect(result.activated).toEqual([]);
      expect(result.alreadyActive).toEqual(['page_navigate']);
      expect(result.notFound).toEqual(['missing_tool']);
      expect(result.budgetExceeded).toEqual(['network_get_requests']);
      // Only the batch budget-rejected event may fire — no per-tool transition.
      expect(emittedPayloads(ctx.eventBus, 'tool:activated')).toHaveLength(0);
      expect(emittedPayloads(ctx.eventBus, 'tool.activation.changed')).toEqual([
        {
          action: 'budget-rejected',
          toolNames: ['network_get_requests'],
          timestamp: expect.any(String),
        },
      ]);
    });

    it('emits tool:activated with the extension domain for extension tools', async () => {
      const ctx = createCtx({
        extensionToolsByName: new Map([
          [
            'custom_tool',
            {
              name: 'custom_tool',
              domain: 'workflow',
              tool: tool('custom_tool', 'Custom workflow'),
              handler: vi.fn(async () => ({ ok: true })),
            },
          ],
        ]),
      });

      await activateToolNames(ctx, ['mcp__jshook__custom_tool']);

      expect(emittedPayloads(ctx.eventBus, 'tool:activated')).toEqual([
        { toolName: 'custom_tool', domain: 'workflow', timestamp: expect.any(String) },
      ]);
    });

    it('emits exactly one tool:deactivated per newly deactivated tool, carrying its domain', async () => {
      const ctx = createCtx({
        activatedToolNames: new Set(['page_navigate', 'network_get_requests']),
        activatedRegisteredTools: new Map([
          ['page_navigate', { remove: vi.fn() }],
          ['network_get_requests', { remove: vi.fn() }],
        ]),
      });

      const response = parseResponse(
        await handleDeactivateTools(ctx, {
          names: ['page_navigate', 'network_get_requests', 'missing_tool'],
        }),
      );

      expect(response.deactivated).toEqual(['page_navigate', 'network_get_requests']);
      expect(response.notActivated).toEqual(['missing_tool']);
      expect(emittedPayloads(ctx.eventBus, 'tool.activation.changed')).toEqual([
        {
          action: 'deactivated',
          toolNames: ['page_navigate', 'network_get_requests'],
          timestamp: expect.any(String),
        },
      ]);
      const events = emittedPayloads(ctx.eventBus, 'tool:deactivated');
      expect(events).toHaveLength(2);
      expect(events).toEqual([
        { toolName: 'page_navigate', domain: 'browser', timestamp: expect.any(String) },
        { toolName: 'network_get_requests', domain: 'network', timestamp: expect.any(String) },
      ]);
    });

    it('emits tool:deactivated with the extension domain for extension tools', async () => {
      const remove = vi.fn();
      const ctx = createCtx({
        activatedToolNames: new Set(['custom_tool']),
        activatedRegisteredTools: new Map([['custom_tool', { remove }]]),
        extensionToolsByName: new Map([
          [
            'custom_tool',
            {
              name: 'custom_tool',
              domain: 'workflow',
              tool: tool('custom_tool', 'Custom workflow'),
              registeredTool: { remove },
            },
          ],
        ]),
      });

      await handleDeactivateTools(ctx, { names: ['custom_tool'] });

      expect(emittedPayloads(ctx.eventBus, 'tool:deactivated')).toEqual([
        { toolName: 'custom_tool', domain: 'workflow', timestamp: expect.any(String) },
      ]);
    });

    it('emits no tool:deactivated when nothing transitions', async () => {
      const ctx = createCtx();

      await handleDeactivateTools(ctx, { names: ['missing_tool'] });

      expect(emittedPayloads(ctx.eventBus, 'tool:deactivated')).toHaveLength(0);
      expect(emittedPayloads(ctx.eventBus, 'tool.activation.changed')).toHaveLength(0);
    });
  });
});

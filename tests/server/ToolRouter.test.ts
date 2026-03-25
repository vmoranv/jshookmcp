import { beforeEach, describe, expect, it, vi } from 'vitest';

function tool(
  name: string,
  description = `Description for ${name}`,
  inputSchema: Record<string, unknown> = { type: 'object', properties: {} },
) {
  return { name, description, inputSchema };
}

const mocks = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
  };

  const builtinTools = [
    tool('browser_launch', 'Launch a browser'),
    tool('browser_attach', 'Attach to an existing browser'),
    tool('page_navigate', 'Navigate to a page'),
    tool('page_screenshot', 'Take a screenshot'),
    tool('page_click', 'Click an element'),
    tool('page_type', 'Type into an input'),
    tool('page_evaluate', 'Evaluate JavaScript'),
    tool('network_enable', 'Enable request capture'),
    tool('network_get_requests', 'Inspect captured requests'),
    tool('network_extract_auth', 'Extract auth credentials'),
    tool('network_export_har', 'Export captured traffic as HAR'),
    tool('network_replay_request', 'Replay a captured request'),
    tool('debugger_enable', 'Enable the debugger'),
    tool('detect_crypto', 'Detect cryptographic code'),
    tool('ai_hook_generate', 'Generate a runtime hook'),
    tool('binary_decode', 'Decode binary data'),
    tool('js_bundle_search', 'Search a JavaScript bundle'),
    tool('sourcemap_discover', 'Discover a source map'),
    tool('sourcemap_fetch_and_parse', 'Fetch and parse a source map'),
    tool('sourcemap_reconstruct_tree', 'Reconstruct the source tree'),
    tool('antidebug_detect_protections', 'Detect anti-debug protections'),
    tool('antidebug_bypass_all', 'Apply anti-debug bypasses'),
    tool('get_token_budget_stats', 'Inspect token budget state'),
    tool('run_extension_workflow', 'Execute extension workflow'),
    tool('list_extension_workflows', 'List loaded extension workflows'),
  ];

  const domainMap = new Map<string, string>([
    ['browser_launch', 'browser'],
    ['browser_attach', 'browser'],
    ['page_navigate', 'browser'],
    ['page_screenshot', 'browser'],
    ['page_click', 'browser'],
    ['page_type', 'browser'],
    ['page_evaluate', 'browser'],
    ['network_enable', 'network'],
    ['network_get_requests', 'network'],
    ['network_extract_auth', 'network'],
    ['network_export_har', 'network'],
    ['network_replay_request', 'network'],
    ['debugger_enable', 'debugger'],
    ['detect_crypto', 'core'],
    ['ai_hook_generate', 'hooks'],
    ['binary_decode', 'encoding'],
    ['js_bundle_search', 'workflow'],
    ['sourcemap_discover', 'sourcemap'],
    ['sourcemap_fetch_and_parse', 'sourcemap'],
    ['sourcemap_reconstruct_tree', 'sourcemap'],
    ['antidebug_detect_protections', 'antidebug'],
    ['antidebug_bypass_all', 'antidebug'],
    ['get_token_budget_stats', 'maintenance'],
    ['run_extension_workflow', 'workflow'],
    ['list_extension_workflows', 'workflow'],
  ]);

  return {
    logger,
    builtinTools,
    domainMap,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/ToolCatalog', () => ({
  allTools: mocks.builtinTools,
  getToolDomain: (name: string) => mocks.domainMap.get(name) ?? null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/MCPServer.search.helpers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getActiveToolNames: (ctx: any) =>
    new Set<string>([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      ...ctx.selectedTools.map((candidate: { name: string }) => candidate.name),
      ...ctx.activatedToolNames,
    ]),
}));

import { describeTool, generateExampleArgs, routeToolRequest } from '@server/ToolRouter';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map(),
    metaToolsByName: new Map(),
    pageController: undefined,
    consoleMonitor: undefined,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
}

describe('ToolRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates example arguments from required fields, enums, defaults, and primitive types', () => {
    const example = generateExampleArgs({
      type: 'object',
      required: ['url', 'count', 'flag', 'mode', 'items', 'config'],
      properties: {
        url: { type: 'string' },
        count: { type: 'integer' },
        flag: { type: 'boolean' },
        mode: { type: 'string', enum: ['fast', 'slow'] },
        items: { type: 'array' },
        config: { type: 'object' },
        optionalDefault: { type: 'string', default: 'value' },
        skippedOptional: { type: 'string' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    expect(example).toEqual({
      url: '<url>',
      count: 0,
      flag: false,
      mode: 'fast',
      items: [],
      config: {},
      optionalDefault: 'value',
    });
  });

  it('returns an empty example object for non-object schemas', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(generateExampleArgs(undefined as any)).toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(generateExampleArgs({ type: 'string' } as any)).toEqual({});
  });

  it('describes built-in and extension tools using canonical names', () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow description\nExtra implementation details', {
              type: 'object',
              properties: { input: { type: 'string' } },
            }),
          },
        ],
      ]),
    });

    expect(describeTool('mcp__jshook__page_navigate', ctx)).toEqual({
      name: 'page_navigate',
      description: 'Navigate to a page',
      inputSchema: { type: 'object', properties: {} },
    });
    expect(describeTool('custom_tool', ctx)).toEqual({
      name: 'custom_tool',
      description: 'Custom workflow description',
      inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    });
    expect(describeTool('missing_tool', ctx)).toBeNull();
  });

  it('prioritizes browser bootstrap and suppresses maintenance noise for network-capture tasks without a page', async () => {
    const ctx = createCtx({
      pageController: {
        getPage: vi.fn(async () => {
          throw new Error('no page');
        }),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: false })),
        getNetworkRequests: vi.fn(() => []),
      },
    });
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'get_token_budget_stats',
          shortDescription: 'Inspect token budget state',
          score: 50,
          domain: 'maintenance',
          isActive: false,
        },
        {
          name: 'network_get_requests',
          shortDescription: 'Inspect captured requests',
          score: 20,
          domain: 'network',
          isActive: false,
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const response = await routeToolRequest(
      { task: 'capture network traffic for this page', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(searchEngine.search).toHaveBeenCalledWith(
      'capture network traffic for this page',
      10,
      new Set<string>(),
    );
    expect(response.workflowHint).toContain('Network capture workflow');
    expect(response.recommendations[0]).toMatchObject({
      name: 'browser_launch',
      domain: 'browser',
      isActive: false,
    });
    expect(response.recommendations.map((item) => item.name)).not.toContain(
      'get_token_budget_stats',
    );
    expect(response.nextActions[0]).toEqual({
      step: 1,
      action: 'activate',
      toolName: undefined,
      command:
        'activate_tools with names: ["browser_launch", "browser_attach", "network_enable", "page_navigate", "network_get_requests"]',
      description: 'Activate 5 recommended tools',
    });
  });

  it('prioritizes network_get_requests when a page exists and traffic is already captured', async () => {
    const ctx = createCtx({
      pageController: {
        getPage: vi.fn(async () => ({})),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: true })),
        getNetworkRequests: vi.fn(() => [{ id: '1' }]),
      },
    });
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'get_token_budget_stats',
          shortDescription: 'Inspect token budget state',
          score: 60,
          domain: 'maintenance',
          isActive: false,
        },
        {
          name: 'page_navigate',
          shortDescription: 'Navigate to a page',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const response = await routeToolRequest(
      { task: 'capture network traffic for this page', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.recommendations).toHaveLength(4);
    expect(response.recommendations[0]!.name).toBe('network_get_requests');
    expect(response.recommendations[0]!.activationCommand).toBe(
      'activate_tools with names: ["network_get_requests"]',
    );
  });

  it('boosts preferred domains for non-workflow searches', async () => {
    const ctx = createCtx();
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'page_navigate',
          shortDescription: 'Navigate to a page',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'network_get_requests',
          shortDescription: 'Inspect captured requests',
          score: 9.5,
          domain: 'network',
          isActive: false,
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const response = await routeToolRequest(
      { task: 'inspect requests', context: { preferredDomain: 'network', autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.recommendations).toHaveLength(2);
    expect(response.recommendations[0]!.name).toBe('network_get_requests');
  });

  it('returns mission-aware recommendations and next actions for signature locate tasks', async () => {
    const ctx = createCtx();
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'get_token_budget_stats',
          shortDescription: 'Inspect token budget state',
          score: 1,
          domain: 'maintenance',
          isActive: false,
        },
      ]),
    } as any;

    const response = await routeToolRequest(
      { task: '帮我定位这个 API 的签名函数', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.mission?.id).toBe('signature-locate');
    expect(response.recommendations).toHaveLength(7);
    expect(response.recommendations[0]?.name).toBe('browser_launch');
    expect(response.nextActions[0]).toEqual({
      step: 1,
      action: 'activate',
      toolName: undefined,
      command:
        'activate_tools with names: ["browser_launch", "browser_attach", "network_enable", "network_get_requests", "debugger_enable", "detect_crypto", "ai_hook_generate"]',
      description: 'Activate 7 mission tools for 签名定位 / Signature Locate',
    });
    expect(response.nextActions[1]).toEqual({
      step: 2,
      action: 'call',
      toolName: 'browser_launch',
      command: 'browser_launch',
      exampleArgs: {},
      description: 'Launch a browser session before executing the mission',
    });
    expect(response.nextActions[2]).toEqual({
      step: 3,
      action: 'call',
      toolName: 'browser_attach',
      command: 'browser_attach',
      exampleArgs: {},
      description: 'Attach mission tooling to the active browser session before capture begins',
    });
    expect(response.nextActions[3]?.toolName).toBe('network_enable');
    expect(response.workflowHint).toContain('Mission 签名定位 / Signature Locate');
  });

  it('emits a direct call next action when the top recommendation is already active', async () => {
    const ctx = createCtx({
      selectedTools: [tool('get_token_budget_stats')],
      activatedToolNames: new Set<string>(['get_token_budget_stats']),
    });
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'get_token_budget_stats',
          shortDescription: 'Inspect token budget state',
          score: 5,
          domain: 'maintenance',
          isActive: true,
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const response = await routeToolRequest(
      { task: 'token budget report', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.nextActions).toEqual([
      {
        step: 1,
        action: 'call',
        toolName: 'get_token_budget_stats',
        command: 'get_token_budget_stats',
        exampleArgs: {},
        description:
          'Call get_token_budget_stats. Use describe_tool("get_token_budget_stats") only if you need the full schema.',
      },
    ]);
  });

  it('keeps maintenance recommendations for maintenance-oriented tasks', async () => {
    const ctx = createCtx();
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'get_token_budget_stats',
          shortDescription: 'Inspect token budget state',
          score: 10,
          domain: 'maintenance',
          isActive: false,
        },
        {
          name: 'page_navigate',
          shortDescription: 'Navigate to a page',
          score: 9,
          domain: 'browser',
          isActive: false,
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const response = await routeToolRequest(
      { task: 'cleanup cache and inspect token budget', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.recommendations).toHaveLength(2);
    expect(response.recommendations[0]!.name).toBe('get_token_budget_stats');
    expect(response.nextActions[0]!).toEqual({
      step: 1,
      action: 'activate',
      toolName: undefined,
      command: 'activate_tools with names: ["get_token_budget_stats", "page_navigate"]',
      description: 'Activate 2 recommended tools',
    });
  });

  it('injects prerequisites into recommendations when conditions are not met', async () => {
    const ctx = createCtx({
      pageController: {
        getPage: vi.fn(() => null),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: false })),
        getNetworkRequests: vi.fn(() => []),
      },
    });
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'network_get_requests',
          shortDescription: 'Inspect captured requests',
          score: 10,
          domain: 'network',
          isActive: false,
        },
        {
          name: 'page_navigate',
          shortDescription: 'Navigate to a page',
          score: 8,
          domain: 'browser',
          isActive: false,
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const response = await routeToolRequest(
      { task: 'capture traffic', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    const netRec = response.recommendations.find((r) => r.name === 'network_get_requests');
    const navRec = response.recommendations.find((r) => r.name === 'page_navigate');

    expect(netRec!.prerequisites).toBeDefined();
    expect(netRec!.prerequisites!.some((p) => p.fix.includes('Call network_enable'))).toBe(true);
    expect(netRec!.prerequisites!.some((p) => p.fix.includes('Call browser_launch'))).toBe(true);
    expect(netRec!.prerequisites!.every((p) => p.satisfied === false)).toBe(true);

    expect(navRec!.prerequisites).toBeDefined();
    expect(navRec!.prerequisites!.some((p) => p.fix.includes('browser_launch'))).toBe(true);
    expect(navRec!.prerequisites!.every((p) => p.satisfied === false)).toBe(true);
  });
});

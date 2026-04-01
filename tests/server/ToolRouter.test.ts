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
  const ensureWorkflowsLoaded = vi.fn(async () => undefined);

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
    tool('ai_hook_inject', 'Inject a runtime hook'),
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
    tool('builtin_newline', '\n'),
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
    ['ai_hook_inject', 'hooks'],
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
    ensureWorkflowsLoaded,
    logger,
    builtinTools,
    domainMap,
  };
});

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@server/ToolCatalog', () => ({
  allTools: mocks.builtinTools,
  getToolDomain: (name: string) => mocks.domainMap.get(name) ?? null,
}));

vi.mock('@server/MCPServer.search.helpers', () => ({
  getActiveToolNames: (ctx: any) =>
    new Set<string>([
      ...ctx.selectedTools.map((candidate: { name: string }) => candidate.name),
      ...ctx.activatedToolNames,
    ]),
}));

vi.mock('@server/extensions/ExtensionManager', () => ({
  ensureWorkflowsLoaded: mocks.ensureWorkflowsLoaded,
}));

import { describeTool, generateExampleArgs, routeToolRequest } from '@server/ToolRouter';
import {
  getToolDescription,
  getToolDomainFromContext,
  isToolActive,
  getAvailableToolNames,
  probeCapturedRequests,
} from '../../src/server/ToolRouter.probe';
import { buildWorkflowToolSequence } from '@server/ToolRouter.policy';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map(),
    extensionWorkflowsById: new Map(),
    extensionWorkflowRuntimeById: new Map(),
    metaToolsByName: new Map(),
    pageController: undefined,
    consoleMonitor: undefined,
    ...overrides,
  } as any;
}

describe('ToolRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureWorkflowsLoaded.mockResolvedValue(undefined);
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
    expect(generateExampleArgs(undefined as any)).toEqual({});
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
    } as any;

    const response = await routeToolRequest(
      { task: 'capture network traffic for this page', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(mocks.ensureWorkflowsLoaded).toHaveBeenCalledWith(ctx);
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
    } as any;

    const response = await routeToolRequest(
      { task: 'inspect requests', context: { preferredDomain: 'network', autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.recommendations).toHaveLength(2);
    expect(response.recommendations[0]!.name).toBe('network_get_requests');
  });

  it('returns preset-aware recommendations and next actions for signature locate tasks', async () => {
    const ctx = createCtx({
      extensionWorkflowsById: new Map([
        [
          'signature-locate',
          {
            id: 'signature-locate',
            displayName: '签名定位 / Signature Locate',
            description: 'Locate API request signing functions',
            source: 'plugins/mission-pack#workflow:signature-locate',
            route: {
              kind: 'preset',
              triggerPatterns: [
                /sign(ature|ing)?\s*(locat|find|extract|定位|查找)/i,
                /(api|request)\s*(sign|签名|加签)/i,
                /(找|定位|逆向).*(签名|sign)/i,
              ],
              requiredDomains: ['network', 'debugger', 'hooks', 'core'],
              priority: 95,
              steps: [
                {
                  id: 'network',
                  toolName: 'network_enable',
                  description: 'Enable request capture before reproducing the signed request flow',
                  prerequisites: [],
                },
                {
                  id: 'capture',
                  toolName: 'network_get_requests',
                  description:
                    'Inspect captured requests to identify the signed endpoint, headers, and payload shape',
                  prerequisites: ['network'],
                },
                {
                  id: 'debugger',
                  toolName: 'debugger_enable',
                  description:
                    'Enable the debugger so the signing path can be paused and inspected live',
                  prerequisites: ['capture'],
                },
                {
                  id: 'locate',
                  toolName: 'detect_crypto',
                  description:
                    'Locate cryptographic and signing-related code around the captured request flow',
                  prerequisites: ['debugger'],
                  parallel: true,
                },
                {
                  id: 'hook',
                  toolName: 'ai_hook_inject',
                  description:
                    'Inject a hook for the candidate signing function once the hook code is ready',
                  prerequisites: ['locate'],
                },
              ],
            },
          },
        ],
      ]),
      extensionWorkflowRuntimeById: new Map([
        [
          'signature-locate',
          {
            source: 'plugins/mission-pack#workflow:signature-locate',
            route: {
              kind: 'preset',
              triggerPatterns: [
                /sign(ature|ing)?\s*(locat|find|extract|定位|查找)/i,
                /(api|request)\s*(sign|签名|加签)/i,
                /(找|定位|逆向).*(签名|sign)/i,
              ],
              requiredDomains: ['network', 'debugger', 'hooks', 'core'],
              priority: 95,
              steps: [
                {
                  id: 'network',
                  toolName: 'network_enable',
                  description: 'Enable request capture before reproducing the signed request flow',
                  prerequisites: [],
                },
                {
                  id: 'capture',
                  toolName: 'network_get_requests',
                  description:
                    'Inspect captured requests to identify the signed endpoint, headers, and payload shape',
                  prerequisites: ['network'],
                },
                {
                  id: 'debugger',
                  toolName: 'debugger_enable',
                  description:
                    'Enable the debugger so the signing path can be paused and inspected live',
                  prerequisites: ['capture'],
                },
                {
                  id: 'locate',
                  toolName: 'detect_crypto',
                  description:
                    'Locate cryptographic and signing-related code around the captured request flow',
                  prerequisites: ['debugger'],
                  parallel: true,
                },
                {
                  id: 'hook',
                  toolName: 'ai_hook_inject',
                  description:
                    'Inject a hook for the candidate signing function once the hook code is ready',
                  prerequisites: ['locate'],
                },
              ],
            },
            workflow: {
              kind: 'workflow-contract',
              version: 1,
              id: 'signature-locate',
              displayName: '签名定位 / Signature Locate',
              description: 'Locate API request signing functions',
              route: {
                kind: 'preset',
                triggerPatterns: [
                  /sign(ature|ing)?\s*(locat|find|extract|定位|查找)/i,
                  /(api|request)\s*(sign|签名|加签)/i,
                  /(找|定位|逆向).*(签名|sign)/i,
                ],
                requiredDomains: ['network', 'debugger', 'hooks', 'core'],
                priority: 95,
                steps: [
                  {
                    id: 'network',
                    toolName: 'network_enable',
                    description:
                      'Enable request capture before reproducing the signed request flow',
                    prerequisites: [],
                  },
                  {
                    id: 'capture',
                    toolName: 'network_get_requests',
                    description:
                      'Inspect captured requests to identify the signed endpoint, headers, and payload shape',
                    prerequisites: ['network'],
                  },
                  {
                    id: 'debugger',
                    toolName: 'debugger_enable',
                    description:
                      'Enable the debugger so the signing path can be paused and inspected live',
                    prerequisites: ['capture'],
                  },
                  {
                    id: 'locate',
                    toolName: 'detect_crypto',
                    description:
                      'Locate cryptographic and signing-related code around the captured request flow',
                    prerequisites: ['debugger'],
                    parallel: true,
                  },
                  {
                    id: 'hook',
                    toolName: 'ai_hook_inject',
                    description:
                      'Inject a hook for the candidate signing function once the hook code is ready',
                    prerequisites: ['locate'],
                  },
                ],
              },
              build: () => ({ kind: 'sequence', id: 'root', steps: [] }),
            },
          },
        ],
      ]),
    });
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

    expect(response.routeMatch?.id).toBe('signature-locate');
    expect(response.recommendations).toHaveLength(7);
    expect(response.recommendations[0]?.name).toBe('browser_launch');
    expect(response.nextActions[0]).toEqual({
      step: 1,
      action: 'activate',
      toolName: undefined,
      command:
        'activate_tools with names: ["browser_launch", "browser_attach", "network_enable", "network_get_requests", "debugger_enable", "detect_crypto", "ai_hook_inject"]',
      description: 'Activate 7 preset tools for 签名定位 / Signature Locate',
    });
    expect(response.nextActions[1]).toEqual({
      step: 2,
      action: 'call',
      toolName: 'browser_launch',
      command: 'browser_launch',
      exampleArgs: {},
      description: 'Launch a browser session before executing the preset',
    });
    expect(response.nextActions[2]).toEqual({
      step: 3,
      action: 'call',
      toolName: 'browser_attach',
      command: 'browser_attach',
      exampleArgs: {},
      description: 'Attach preset tooling to the active browser session before capture begins',
    });
    expect(response.nextActions[3]?.toolName).toBe('network_enable');
    expect(response.workflowHint).toContain('Preset 签名定位 / Signature Locate');
  });

  it('routes executable workflow metadata to run_extension_workflow', async () => {
    const ctx = createCtx({
      extensionWorkflowsById: new Map([
        [
          'workflow.signing.capture.v1',
          {
            id: 'workflow.signing.capture.v1',
            displayName: 'Signing Capture Workflow',
            description: 'Run the signing capture workflow end-to-end',
            source: 'plugins/mission-pack/workflow.ts',
            route: {
              kind: 'workflow',
              triggerPatterns: [/run.*signing.*workflow/i, /签名.*工作流.*执行/i],
              requiredDomains: ['workflow'],
              priority: 92,
              steps: [],
            },
          },
        ],
      ]),
      extensionWorkflowRuntimeById: new Map([
        [
          'workflow.signing.capture.v1',
          {
            source: 'plugins/mission-pack/workflow.ts',
            route: {
              kind: 'workflow',
              triggerPatterns: [/run.*signing.*workflow/i, /签名.*工作流.*执行/i],
              requiredDomains: ['workflow'],
              priority: 92,
              steps: [],
            },
            workflow: {
              kind: 'workflow-contract',
              version: 1,
              id: 'workflow.signing.capture.v1',
              displayName: 'Signing Capture Workflow',
              description: 'Run the signing capture workflow end-to-end',
              route: {
                kind: 'workflow',
                triggerPatterns: [/run.*signing.*workflow/i, /签名.*工作流.*执行/i],
                requiredDomains: ['workflow'],
                priority: 92,
                steps: [],
              },
              build: () => ({ kind: 'sequence', id: 'root', steps: [] }),
            },
          },
        ],
      ]),
    });
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'get_token_budget_stats',
          shortDescription: 'Inspect token budget state',
          score: 2,
          domain: 'maintenance',
          isActive: false,
        },
      ]),
    } as any;

    const response = await routeToolRequest(
      { task: 'run signing workflow for me', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.routeMatch).toMatchObject({
      kind: 'workflow',
      id: 'workflow.signing.capture.v1',
      name: 'Signing Capture Workflow',
    });
    expect(response.recommendations[0]?.name).toBe('run_extension_workflow');
    expect(response.nextActions).toEqual([
      {
        step: 1,
        action: 'activate',
        toolName: 'run_extension_workflow',
        command: 'activate_tools with names: ["run_extension_workflow"]',
        description: 'Activate workflow runner for Signing Capture Workflow',
      },
      {
        step: 2,
        action: 'call',
        toolName: 'run_extension_workflow',
        command: 'run_extension_workflow',
        exampleArgs: {
          workflowId: 'workflow.signing.capture.v1',
        },
        description: 'Execute routed workflow Signing Capture Workflow',
      },
    ]);
    expect(response.workflowHint).toContain('Workflow Signing Capture Workflow');
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

  describe('Edge Case Coverage', () => {
    it('ToolRouter.renderer.ts: handles unknown property types', () => {
      const example = generateExampleArgs({
        type: 'object',
        required: ['unknownProp'],
        properties: {
          unknownProp: { type: 'null' },
        },
      } as any);
      // Fall through branches leaves it undefined in example
      expect(example).toEqual({});
    });

    it('ToolRouter.intent.ts: skips workflow routes without metadata', async () => {
      const ctx = createCtx({
        extensionWorkflowRuntimeById: new Map([
          [
            'no-route',
            {
              workflow: {
                id: 'no-route',
                name: 'Missing Route',
              },
              // explicitly no route property
            },
          ],
        ]),
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      const response = await routeToolRequest({ task: 'foo' }, ctx, searchEngine);
      // It should effectively ignore 'no-route' and return an empty recommendation
      expect(response.recommendations).toHaveLength(0);
    });

    it('ToolRouter.probe.ts: probeNetworkEnabled handles fallback error', async () => {
      const ctx = createCtx({
        consoleMonitor: {
          getNetworkStatus: undefined, // undefined to trigger fallback
          isNetworkEnabled: vi.fn(() => {
            throw new Error('fallback fails too');
          }),
        },
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      // Triggers getRoutingState -> probeNetworkEnabled
      await routeToolRequest({ task: 'foo' }, ctx, searchEngine);
      expect(ctx.consoleMonitor.isNetworkEnabled).toHaveBeenCalled();
      // Should handle the error gracefully internally without throwing
    });

    it('ToolRouter.probe.ts: probeCapturedRequests handles limits fallback', async () => {
      const ctx = createCtx({
        consoleMonitor: {
          getNetworkRequests: vi.fn((opts?: any) => {
            if (opts && opts.limit) {
              throw new Error('limit fails');
            }
            return [{ id: 'fallback' }];
          }),
        },
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      // Triggers getRoutingState -> probeCapturedRequests
      await routeToolRequest({ task: 'foo' }, ctx, searchEngine);
      expect(ctx.consoleMonitor.getNetworkRequests).toHaveBeenCalledTimes(2);
    });

    it('ToolRouter.probe.ts: probeCapturedRequests handles complete failure', async () => {
      const ctx = createCtx({
        consoleMonitor: {
          getNetworkRequests: vi.fn(() => {
            throw new Error('total failure');
          }),
        },
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      await routeToolRequest({ task: 'foo' }, ctx, searchEngine);
      expect(ctx.consoleMonitor.getNetworkRequests).toHaveBeenCalled();
    });

    it('ToolRouter.policy.ts: buildWorkflowToolSequence handles network domain with inactive network', async () => {
      const ctx = createCtx({
        pageController: { getPage: vi.fn(async () => ({})) },
        consoleMonitor: {
          getNetworkStatus: vi.fn(() => ({ enabled: false })),
        },
      });
      // The word "intercept" matches the network task pattern -> BROWSER_OR_NETWORK_TASK_PATTERN
      const searchEngine = {
        search: vi.fn(() => [
          {
            name: 'network_enable',
            shortDescription: 'Enable network',
            score: 1,
            domain: 'network',
            isActive: false,
          },
        ]),
      } as any;
      const response = await routeToolRequest({ task: 'intercept network' }, ctx, searchEngine);
      // Reranker boosts network_enable
      expect(response.recommendations[0]?.name).toBe('network_enable');
      expect(response.recommendations[0]?.score).toBeGreaterThan(1);
    });

    it('ToolRouter.policy.ts: buildPresetToolSequence skips unavailable tools or duplicates', async () => {
      const ctx = createCtx({
        extensionWorkflowsById: new Map([['test', { id: 'test' }]]),
        extensionWorkflowRuntimeById: new Map([
          [
            'test',
            {
              route: {
                kind: 'preset',
                triggerPatterns: [/test missing/i],
                requiredDomains: [],
                priority: 100,
                steps: [
                  { toolName: 'does_not_exist', description: 'missing tool', prerequisites: [] },
                  { toolName: 'browser_launch', description: 'launch', prerequisites: [] },
                  { toolName: 'browser_launch', description: 'dup', prerequisites: [] }, // duplicate
                ],
              },
              workflow: { id: 'test', displayName: 'Test' },
            },
          ],
        ]),
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      const response = await routeToolRequest({ task: 'test missing' }, ctx, searchEngine);
      // Should not include does_not_exist, and should only include browser_launch once
      const presetRecs = response.recommendations.filter((r) => r.domain === 'browser');
      expect(presetRecs).toHaveLength(1);
      expect(presetRecs[0]?.name).toBe('browser_launch');
    });

    it('ToolRouter.ts: deduplicates identical tool elements returned from search', async () => {
      const ctx = createCtx();
      const duplicateTool = {
        name: 'test_duplicate_tool',
        shortDescription: 'Navigate',
        score: 10,
        domain: 'browser',
        isActive: false,
      };
      const searchEngine = {
        search: vi.fn(() => [duplicateTool, duplicateTool]),
      } as any;

      const response = await routeToolRequest(
        { task: 'unknown task triggers nothing' },
        ctx,
        searchEngine,
      );
      // It should strip the duplicate
      const duplicateRecs = response.recommendations.filter(
        (r) => r.name === 'test_duplicate_tool',
      );
      expect(duplicateRecs).toHaveLength(1);
    });

    it('ToolRouter.intent.ts: prioritizes higher priority routes over existing matches', async () => {
      const ctx = createCtx({
        extensionWorkflowRuntimeById: new Map([
          [
            'low-priority',
            {
              route: {
                kind: 'preset',
                triggerPatterns: [/overlap/i],
                requiredDomains: [],
                priority: 10,
                steps: [],
              },
              workflow: { id: 'low', name: 'Low' },
            },
          ],
          [
            'high-priority',
            {
              route: {
                kind: 'preset',
                triggerPatterns: [/overlap/i],
                requiredDomains: [],
                priority: 50,
                steps: [],
              },
              workflow: { id: 'high', name: 'High' },
            },
          ],
          [
            'medium-priority',
            {
              route: {
                kind: 'preset',
                triggerPatterns: [/overlap/i],
                requiredDomains: [],
                priority: 25,
                steps: [],
              },
              workflow: { id: 'medium', name: 'Medium' },
            },
          ],
        ]),
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      const response = await routeToolRequest(
        { task: 'trigger overlap pattern' },
        ctx,
        searchEngine,
      );
      expect(response.routeMatch?.id).toBe('high-priority');
    });

    it('ToolRouter.probe.ts: retrieves tool schema and description from metaToolsByName', () => {
      const ctx = createCtx({
        metaToolsByName: new Map([
          [
            'meta_tool',
            {
              name: 'meta_tool',
              description: 'Meta Description',
              inputSchema: { type: 'object', properties: { meta: { type: 'string' } } },
            },
          ],
        ]),
      });
      const desc = describeTool('meta_tool', ctx);
      expect(desc?.description).toBe('Meta Description');
      expect(desc?.inputSchema).toEqual({
        type: 'object',
        properties: { meta: { type: 'string' } },
      });
    });

    it('ToolRouter.probe.ts: getToolDescription returns default if tool has no description', () => {
      const ctx = createCtx({
        extensionToolsByName: new Map([
          ['no_desc', { tool: { inputSchema: { type: 'object' } } } as any],
        ]),
      });
      expect(describeTool('no_desc', ctx)?.description).toBe('No description available');
    });

    it('ToolRouter.probe.ts: getToolDescription string extraction fallback logic', () => {
      const ctx = createCtx({
        extensionToolsByName: new Map([
          ['ext_empty', { tool: { description: '\n' } } as any],
          ['ext_no_desc', { tool: {} } as any],
        ]),
        metaToolsByName: new Map([
          ['meta_empty', { description: '\n' } as any],
          ['meta_no_desc', {} as any],
        ]),
      });
      // builtin missing description logic -> handled implicitly since builtinTools mock has descriptions, but let's test unknown.
      expect(getToolDescription('unknown', ctx)).toBe('No description available');
      // Empty string block (split('\n')[0] == '')
      expect(getToolDescription('builtin_newline', ctx)).toBe('No description available');
      expect(getToolDescription('ext_empty', ctx)).toBe('No description available');
      expect(getToolDescription('meta_empty', ctx)).toBe('No description available');

      // missing description
      expect(getToolDescription('ext_no_desc', ctx)).toBe('No description available');
      expect(getToolDescription('meta_no_desc', ctx)).toBe('No description available');
    });

    it('ToolRouter.policy.ts: buildWorkflowToolSequence handles non-network domains', () => {
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 0 } as any;
      const available = new Set(['some_tool']);
      const wf = { domain: 'browser', tools: ['some_tool'] } as any;
      const seq = buildWorkflowToolSequence(wf, state, available);
      expect(seq).toEqual(['some_tool']);
    });

    it('ToolRouter.probe.ts: getToolDescription handles empty description string on ext/meta tools', () => {
      const ctx = createCtx({
        extensionToolsByName: new Map([
          ['ext_empty', { tool: { description: '', inputSchema: { type: 'object' } } } as any],
        ]),
        metaToolsByName: new Map([
          [
            'meta_empty',
            { name: 'meta_empty', description: '', inputSchema: { type: 'object' } } as any,
          ],
        ]),
      });
      expect(describeTool('ext_empty', ctx)?.description).toBe('No description available');
      expect(describeTool('meta_empty', ctx)?.description).toBe('No description available');
    });

    it('ToolRouter.probe.ts: getToolDomainFromContext resolves domains from builtin and extensions', () => {
      const ctx = createCtx({
        extensionToolsByName: new Map([
          ['my_ext', { domain: 'custom' } as any],
          ['my_ext_no_domain', {} as any],
        ]),
      });
      expect(getToolDomainFromContext('browser_launch', ctx)).toBe('browser'); // builtin
      expect(getToolDomainFromContext('my_ext', ctx)).toBe('custom'); // extension with domain
      expect(getToolDomainFromContext('my_ext_no_domain', ctx)).toBeNull(); // extension without domain
      expect(getToolDomainFromContext('unknown', ctx)).toBeNull(); // not found
    });

    it('ToolRouter.probe.ts: probeCapturedRequests handles non-array responses', () => {
      // First try returns non-array
      const ctx1 = createCtx({
        consoleMonitor: { getNetworkRequests: vi.fn(() => ({})) } as any,
      });
      expect(probeCapturedRequests(ctx1)).toBe(0);

      // Second try: first try throws, second try returns non-array
      const ctx2 = createCtx({
        consoleMonitor: {
          getNetworkRequests: vi
            .fn()
            .mockImplementationOnce(() => {
              throw new Error();
            })
            .mockImplementationOnce(() => ({})),
        } as any,
      });
      expect(probeCapturedRequests(ctx2)).toBe(0);
    });

    it('ToolRouter.probe.ts: isToolActive returns true if tool is selected or activated', () => {
      const ctx = createCtx({
        selectedTools: [{ name: 'selected_tool' }] as any,
        activatedToolNames: new Set(['activated_tool']),
      });
      expect(isToolActive('selected_tool', ctx)).toBe(true);
      expect(isToolActive('activated_tool', ctx)).toBe(true);
      expect(isToolActive('other', ctx)).toBe(false);
    });

    it('ToolRouter.probe.ts: getAvailableToolNames combines built-in and extension tools', () => {
      const ctx = createCtx({
        extensionToolsByName: new Map([['ext1', {} as any]]),
      });
      const available = getAvailableToolNames(ctx);
      expect(available.has('browser_launch')).toBe(true);
      expect(available.has('ext1')).toBe(true);
    });

    it('ToolRouter.ts: returns inactiveTools if nonMaintenanceTools is empty for a network task', async () => {
      const ctx = createCtx({
        pageController: { getPage: vi.fn(async () => ({})) },
        consoleMonitor: {
          getNetworkStatus: vi.fn(() => ({ enabled: true })),
          getNetworkRequests: vi.fn(() => []),
        },
        activatedToolNames: new Set(['network_enable', 'page_navigate', 'network_get_requests']), // ensure these don't pop up as inactive
      });
      const searchEngine = {
        search: vi.fn(() => [
          {
            name: 'get_token_budget_stats',
            shortDescription: 'Budget',
            score: 1000,
            domain: 'maintenance',
            isActive: false, // inactive but it's a maintenance tool
          },
        ]),
      } as any;
      // Network task triggers BROWSER_OR_NETWORK_TASK_PATTERN
      const response = await routeToolRequest(
        {
          task: 'capture traffic without tools',
          context: { autoActivate: true, preferredDomain: 'maintenance' },
        },
        ctx,
        searchEngine,
      );
      // It should include the maintenance tool in activation candidate if it's the only one
      expect(response.nextActions[0]?.command).toContain('get_token_budget_stats');
    });

    it('ToolRouter.ts: provides empty activation array if all preset tools are active', async () => {
      const ctx = createCtx({
        selectedTools: [{ name: 'browser_launch' }],
        activatedToolNames: new Set(['browser_launch']),
        extensionWorkflowsById: new Map([['test_preset', { id: 'test_preset' }]]),
        extensionWorkflowRuntimeById: new Map([
          [
            'test_preset',
            {
              route: {
                kind: 'preset',
                triggerPatterns: [/all active/i],
                requiredDomains: [],
                priority: 100,
                steps: [{ toolName: 'browser_launch', description: 'launch', prerequisites: [] }],
              },
              workflow: { id: 'test_preset', displayName: 'Test Preset' },
            },
          ],
        ]),
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      const response = await routeToolRequest({ task: 'all active preset' }, ctx, searchEngine);
      // Since browser_launch is active, it shouldn't produce an "activate" step
      const activateSteps = response.nextActions.filter((a) => a.action === 'activate');
      expect(activateSteps).toHaveLength(0);
    });

    it('ToolRouter.ts: maps executable workflow when run_extension_workflow is already active', async () => {
      const ctx = createCtx({
        selectedTools: [{ name: 'run_extension_workflow' }],
        activatedToolNames: new Set(['run_extension_workflow']),
        extensionWorkflowsById: new Map([['workflow.a', { id: 'workflow.a' }]]),
        extensionWorkflowRuntimeById: new Map([
          [
            'workflow.a',
            {
              route: {
                kind: 'workflow',
                triggerPatterns: [/active workflow/i],
                requiredDomains: [],
                priority: 100,
                steps: [],
              },
              workflow: { id: 'workflow.a', displayName: 'Workflow' },
            },
          ],
        ]),
      });
      const searchEngine = { search: vi.fn(() => []) } as any;
      const response = await routeToolRequest({ task: 'run active workflow' }, ctx, searchEngine);

      const activateSteps = response.nextActions.filter((a) => a.action === 'activate');
      expect(activateSteps).toHaveLength(0); // skip activation
      expect(response.nextActions[0]?.command).toBe('run_extension_workflow');
      expect(response.nextActions[0]?.exampleArgs).toEqual({ workflowId: 'workflow.a' });
    });
  });
});

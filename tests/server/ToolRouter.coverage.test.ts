import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRegistry } from '@server/registry/index';

await initRegistry();

function makeTool(
  name: string,
  description = `Description for ${name}`,
  inputSchema: Record<string, unknown> = { type: 'object', properties: {} },
) {
  return { name, description, inputSchema };
}

const mocks = vi.hoisted(() => {
  const logger = { info: vi.fn() };
  const ensureWorkflowsLoaded = vi.fn(async () => undefined);

  const builtinTools = [
    makeTool('browser_launch', 'Launch a browser'),
    makeTool('browser_attach', 'Attach to an existing browser'),
    makeTool('page_navigate', 'Navigate to a page', {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    }),
    makeTool('network_enable', 'Enable request capture'),
    makeTool('network_get_requests', 'Inspect captured requests'),
    makeTool('network_extract_auth', 'Extract auth credentials'),
    makeTool('web_api_capture_session', 'Capture an API session'),
    makeTool('run_extension_workflow', 'Execute extension workflow'),
    makeTool('get_token_budget_stats', 'Inspect token budget state'),
  ];

  const domainMap = new Map<string, string>([
    ['browser_launch', 'browser'],
    ['browser_attach', 'browser'],
    ['page_navigate', 'browser'],
    ['network_enable', 'network'],
    ['network_get_requests', 'network'],
    ['network_extract_auth', 'network'],
    ['web_api_capture_session', 'network'],
    ['run_extension_workflow', 'workflow'],
    ['get_token_budget_stats', 'maintenance'],
  ]);

  return { builtinTools, domainMap, ensureWorkflowsLoaded, logger };
});

vi.mock('@utils/logger', () => ({ logger: mocks.logger }));
vi.mock('@server/ToolCatalog', () => ({
  allTools: mocks.builtinTools,
  getToolDomain: (name: string) => mocks.domainMap.get(name) ?? null,
}));
vi.mock('@server/MCPServer.search.helpers', () => ({
  getActiveToolNames: (ctx: any) =>
    new Set<string>([
      ...ctx.selectedTools.map((tool: { name: string }) => tool.name),
      ...ctx.activatedToolNames,
    ]),
  getVisibleDomainsForTier: () => new Set<string>(),
  getBaseTier: () => 'full',
}));
vi.mock('@server/extensions/ExtensionManager', () => ({
  ensureWorkflowsLoaded: mocks.ensureWorkflowsLoaded,
}));

import { routeToolRequest } from '@server/ToolRouter';
import {
  buildCallToolCommand,
  describeTool,
  generateExampleArgs,
} from '@server/ToolRouter.renderer';
import {
  buildPresetToolSequence,
  buildRouteMatchMetadata,
  buildWorkflowToolSequence,
  rerankResultsForContext,
} from '@server/ToolRouter.policy';
import {
  getRoutingState,
  getToolDescription,
  getToolInputSchema,
  probeActivePage,
  probeCapturedRequests,
  probeNetworkEnabled,
} from '@server/ToolRouter.probe';
import { isBrowserOrNetworkTask, isMaintenanceTask } from '@server/ToolRouter.intent';

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

async function importFreshIntentModule(manifests: Array<Record<string, unknown>>) {
  vi.resetModules();
  vi.doMock('@server/registry/index', () => ({
    getAllManifests: () => manifests,
  }));
  return import('@server/ToolRouter.intent');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureWorkflowsLoaded.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.doUnmock('@server/registry/index');
});

describe('ToolRouter coverage additions', () => {
  it('marks intent-matched tools as policy-rejected when prerequisites are unsatisfied', async () => {
    const ctx = createCtx({
      pageController: {
        getPage: vi.fn(async () => null),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: false })),
        getNetworkRequests: vi.fn(() => []),
      },
    });
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'network_extract_auth',
          shortDescription: 'Extract auth credentials',
          score: 12,
          domain: 'network',
          isActive: false,
        },
      ]),
    } as any;

    const response = await routeToolRequest(
      {
        task: 'capture network traffic and extract auth',
        context: { maxRecommendations: 10 },
      },
      ctx,
      searchEngine,
    );

    const blockedRecommendation = response.recommendations.find(
      (recommendation) => recommendation.name === 'network_extract_auth',
    );
    expect(blockedRecommendation).toBeDefined();
    expect(blockedRecommendation?.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          condition: expect.stringContaining('Network monitoring must be enabled'),
          satisfied: false,
          fix: expect.stringContaining('network_monitor'),
        }),
      ]),
    );
  });

  it('normalizes malformed renderer payloads into stable example args and commands', () => {
    const schema = {
      type: 'object',
      required: ['enumFallback', 'copiedDefault', 'requiredArray', 'requiredObject', 'unknownType'],
      properties: {
        enumFallback: { type: 'string', enum: 'fast' as any },
        copiedDefault: { default: { nested: true } },
        requiredArray: { type: 'array' },
        requiredObject: { type: 'object' },
        unknownType: { type: 'mystery' },
        optionalPrimitive: 7 as any,
      },
    } as any;

    const args = generateExampleArgs(schema);
    expect(args).toEqual({
      enumFallback: '<enumFallback>',
      copiedDefault: { nested: true },
      requiredArray: [],
      requiredObject: {},
    });

    expect(buildCallToolCommand('custom_tool', schema)).toBe(
      'call_tool({ name: "custom_tool", args: {"enumFallback":"<enumFallback>","copiedDefault":{"nested":true},"requiredArray":[],"requiredObject":{}} })',
    );
  });

  it('returns null from describeTool when the normalized tool has no schema', () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_no_schema',
          {
            domain: 'workflow',
            tool: { name: 'custom_no_schema', description: 'No schema tool' },
          },
        ],
      ]),
    });

    expect(describeTool('custom_no_schema', ctx)).toBeNull();
  });
});

describe('ToolRouter.probe edge cases', () => {
  it('canonicalizes prefixed tool names when looking up builtin schemas', () => {
    const ctx = createCtx();
    expect(getToolInputSchema('mcp__jshook__network_enable', ctx)).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('returns the default description when an extension description starts with a blank line', () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'blank_desc',
          {
            domain: 'workflow',
            tool: {
              name: 'blank_desc',
              description: '\nsecond line',
              inputSchema: { type: 'object', properties: {} },
            },
          },
        ],
      ]),
    });

    expect(getToolDescription('blank_desc', ctx)).toBe('No description available');
  });

  it('returns false when getNetworkStatus throws before any fallback probe can run', () => {
    const ctx = createCtx({
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => {
          throw new Error('status failed');
        }),
        isNetworkEnabled: vi.fn(() => true),
      },
    });

    expect(probeNetworkEnabled(ctx)).toBe(false);
    expect(ctx.consoleMonitor.isNetworkEnabled).not.toHaveBeenCalled();
  });

  it('returns the first successful captured-request count without falling back', () => {
    const ctx = createCtx({
      consoleMonitor: {
        getNetworkRequests: vi.fn(() => [{ id: 'one' }, { id: 'two' }]),
      },
    });

    expect(probeCapturedRequests(ctx)).toBe(2);
    expect(ctx.consoleMonitor.getNetworkRequests).toHaveBeenCalledTimes(1);
    expect(ctx.consoleMonitor.getNetworkRequests).toHaveBeenCalledWith({ limit: 1 });
  });

  it('aggregates routing state from page, network, and capture probes', async () => {
    const ctx = createCtx({
      pageController: {
        getPage: vi.fn(async () => ({ id: 'active-page' })),
      },
      consoleMonitor: {
        getNetworkStatus: vi.fn(() => ({ enabled: true })),
        getNetworkRequests: vi.fn(() => [{ id: 'captured-request' }]),
      },
    });

    expect(await probeActivePage(ctx)).toBe(true);
    expect(await getRoutingState(ctx)).toEqual({
      hasActivePage: true,
      networkEnabled: true,
      capturedRequestCount: 1,
    });
  });
});

describe('ToolRouter.intent edge cases', () => {
  it('selects the highest-priority workflow rule from mocked manifests', async () => {
    const { detectWorkflowIntent } = await importFreshIntentModule([
      {
        domain: 'browser',
        workflowRule: {
          patterns: [/browser/i, /launch/i],
          priority: 40,
          tools: ['browser_launch'],
          hint: 'browser hint',
        },
      },
      {
        domain: 'network',
        workflowRule: {
          patterns: [/network/i],
          priority: 90,
          tools: ['network_enable'],
          hint: 'network hint',
        },
      },
    ]);

    const match = detectWorkflowIntent('browser launch plus network capture');
    expect(match?.domain).toBe('network');
    expect(match?.priority).toBe(90);
    expect(match?.hint).toBe('network hint');
  });

  it('uses the nested workflow route fallback and default description when matching a route', async () => {
    const { matchWorkflowRoute } = await importFreshIntentModule([]);
    const ctx = createCtx({
      extensionWorkflowRuntimeById: new Map([
        [
          'capture-flow',
          {
            workflow: {
              id: 'capture-flow',
              displayName: 'Runtime Capture',
              route: {
                kind: 'preset',
                triggerPatterns: [/^nope$/i, /capture/i],
                requiredDomains: ['network'],
                priority: 75,
                steps: [],
              },
            },
          },
        ],
      ]),
    });

    const match = matchWorkflowRoute('please capture this request', ctx);
    expect(match).toEqual(
      expect.objectContaining({
        confidence: 0.75,
        matchedPattern: 'capture',
        workflow: expect.objectContaining({
          id: 'capture-flow',
          name: 'Runtime Capture',
          description: 'Workflow route',
        }),
      }),
    );
  });

  it('classifies workflow-derived browser tasks and Chinese maintenance tasks correctly', () => {
    expect(
      isBrowserOrNetworkTask('completely unrelated text', {
        domain: 'network',
        priority: 1,
        tools: [],
        patterns: [],
        hint: '',
      } as any),
    ).toBe(true);
    expect(isMaintenanceTask('插件重载和缓存清理')).toBe(true);
    expect(isMaintenanceTask('capture traffic')).toBe(false);
  });
});

describe('ToolRouter.policy edge cases', () => {
  it('adds network_get_requests from the final network-enabled branch even without captured requests', () => {
    const sequence = buildWorkflowToolSequence(
      { domain: 'network', tools: [], priority: 10, patterns: [], hint: '' } as any,
      { hasActivePage: true, networkEnabled: true, capturedRequestCount: 0 },
      new Set(['network_get_requests']),
    );

    expect(sequence).toEqual(['network_get_requests']);
  });

  it('bootstraps preset tools when a preset requires the network domain and no page is active', () => {
    const sequence = buildPresetToolSequence(
      {
        workflow: {
          id: 'network-preset',
          name: 'Network Preset',
          description: 'preset',
          route: {
            kind: 'preset',
            triggerPatterns: [/network/i],
            requiredDomains: ['network'],
            priority: 80,
            steps: [
              {
                id: 'capture',
                toolName: 'network_enable',
                description: 'Enable',
                prerequisites: [],
              },
              {
                id: 'capture-duplicate',
                toolName: 'network_enable',
                description: 'Enable again',
                prerequisites: [],
              },
            ],
          },
        },
        confidence: 0.8,
        matchedPattern: 'network',
      } as any,
      { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 },
      new Set(['browser_launch', 'browser_attach', 'network_enable']),
    );

    expect(sequence.map((step) => step.name)).toEqual([
      'browser_launch',
      'browser_attach',
      'network_enable',
    ]);
  });

  it('falls back to the extension domain when route metadata references a non-builtin tool', () => {
    const metadata = buildRouteMatchMetadata(
      {
        workflow: {
          id: 'extension-route',
          name: 'Extension Route',
          description: 'extension route',
          route: {
            kind: 'preset',
            triggerPatterns: [/extension/i],
            requiredDomains: [],
            priority: 55,
            steps: [
              {
                id: 'custom',
                toolName: 'custom_extension_tool',
                description: 'Run extension step',
                prerequisites: ['custom prereq'],
              },
            ],
          },
        },
        confidence: 0.55,
        matchedPattern: 'extension',
      } as any,
      createCtx({
        extensionToolsByName: new Map([
          [
            'custom_extension_tool',
            {
              domain: 'workflow',
              tool: {
                name: 'custom_extension_tool',
                description: 'Extension step',
                inputSchema: { type: 'object', properties: {} },
              },
            },
          ],
        ]),
      }),
    );

    expect(metadata.steps[0]).toEqual(
      expect.objectContaining({
        domain: 'workflow',
        prerequisites: ['custom prereq'],
      }),
    );
  });

  it('boosts request inspection when browser intent comes from the workflow rather than task text', () => {
    const reranked = rerankResultsForContext(
      [
        {
          name: 'network_get_requests',
          shortDescription: 'Inspect captured requests',
          score: 3,
          domain: 'network',
          isActive: false,
        },
      ] as any,
      'plain text without browser keywords',
      { domain: 'network', priority: 1, tools: [], patterns: [], hint: '' } as any,
      { hasActivePage: true, networkEnabled: true, capturedRequestCount: 2 },
    );

    expect(reranked[0]?.score).toBe(4.5);
  });
});

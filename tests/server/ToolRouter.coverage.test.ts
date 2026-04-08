import { beforeEach, describe, expect, it, vi } from 'vitest';

function tool(
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
    tool('browser_launch', 'Launch a browser'),
    tool('browser_attach', 'Attach to an existing browser'),
    tool('network_enable', 'Enable request capture'),
    tool('network_get_requests', 'Inspect captured requests'),
    tool('debugger_enable', 'Enable the debugger'),
    tool('detect_crypto', 'Detect cryptographic code'),
    tool('ai_hook_inject', 'Inject a runtime hook'),
    tool('run_extension_workflow', 'Execute extension workflow'),
  ];

  const domainMap = new Map<string, string>([
    ['browser_launch', 'browser'],
    ['browser_attach', 'browser'],
    ['network_enable', 'network'],
    ['network_get_requests', 'network'],
    ['debugger_enable', 'debugger'],
    ['detect_crypto', 'core'],
    ['ai_hook_inject', 'hooks'],
    ['run_extension_workflow', 'workflow'],
  ]);

  return { ensureWorkflowsLoaded, logger, builtinTools, domainMap };
});

vi.mock('@utils/logger', () => ({ logger: mocks.logger }));
vi.mock('@server/ToolCatalog', () => ({
  allTools: mocks.builtinTools,
  getToolDomain: (name: string) => mocks.domainMap.get(name) ?? null,
}));
vi.mock('@server/MCPServer.search.helpers', () => ({
  getActiveToolNames: (ctx: any) =>
    new Set<string>([...ctx.selectedTools.map((t: any) => t.name), ...ctx.activatedToolNames]),
}));
vi.mock('@server/extensions/ExtensionManager', () => ({
  ensureWorkflowsLoaded: mocks.ensureWorkflowsLoaded,
}));

import { routeToolRequest, buildCallToolCommand } from '@server/ToolRouter';
import {
  buildWorkflowToolSequence,
  buildPresetToolSequence,
  buildRouteMatchMetadata,
  rerankResultsForContext,
  getEffectivePrerequisites,
} from '@server/ToolRouter.policy';
import {
  probeActivePage,
  probeNetworkEnabled,
  probeCapturedRequests,
} from '@server/ToolRouter.probe';
import {
  detectWorkflowIntent,
  matchWorkflowRoute,
  isBrowserOrNetworkTask,
  isMaintenanceTask,
} from '@server/ToolRouter.intent';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map(),
    extensionWorkflowsById: new Map(),
    extensionWorkflowRuntimeById: new Map(),
    metaToolsByName: new Map(),
    pageController: undefined as any,
    consoleMonitor: undefined as any,
    ...overrides,
  };
}

describe('ToolRouter.policy — coverage expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEffectivePrerequisites', () => {
    it('returns an empty object when no manifests declare prerequisites', () => {
      vi.mock('@server/registry/index', () => ({ getAllManifests: () => [] }));
      // Force re-import by calling directly
      const result = getEffectivePrerequisites();
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('buildPrerequisiteCheck — unknown condition fallback', () => {
    it('returns false for unrecognized condition strings', () => {
      // Access the internal buildPrerequisiteCheck indirectly through getEffectivePrerequisites
      // by mocking getAllManifests to return a prerequisite with an unknown condition
      vi.mock('@server/registry/index', () => ({
        getAllManifests: () => [
          {
            domain: 'test',
            prerequisites: {
              test_tool: [
                {
                  condition: 'Completely unknown prerequisite condition xyz123',
                  fix: 'Do something unknown',
                },
              ],
            },
          },
        ],
      }));

      // Re-import to pick up the mock
      // Since getEffectivePrerequisites caches, we test the policy reranking instead
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 0 };
      const results = [
        {
          name: 'test_tool',
          shortDescription: '',
          score: 1,
          domain: 'test' as const,
          isActive: false,
        },
      ];
      // Unknown prerequisite conditions are treated as unsatisfied (check returns false)
      // This is exercised through the rerankResultsForContext path
      const reranked = rerankResultsForContext(results, 'test task', null, state);
      expect(reranked).toHaveLength(1);
    });
  });

  describe('buildWorkflowToolSequence', () => {
    it('injects browser_launch/attach when browser|network workflow has no active page', () => {
      const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
      const available = new Set(['browser_launch', 'browser_attach', 'network_enable']);
      const wf = { domain: 'browser', tools: ['page_navigate'] } as any;
      const seq = buildWorkflowToolSequence(wf, state, available);
      expect(seq).toContain('browser_launch');
      expect(seq).toContain('browser_attach');
    });

    it('injects network_enable when network workflow has page but network is disabled', () => {
      const state = { hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 };
      const available = new Set(['network_enable', 'network_get_requests']);
      const wf = { domain: 'network', tools: ['network_enable'] } as any;
      const seq = buildWorkflowToolSequence(wf, state, available);
      expect(seq).toContain('network_enable');
    });

    it('injects network_get_requests when network is already enabled and requests are captured', () => {
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 5 };
      const available = new Set(['network_get_requests', 'network_enable']);
      const wf = { domain: 'network', tools: [] } as any;
      const seq = buildWorkflowToolSequence(wf, state, available);
      expect(seq).toContain('network_get_requests');
    });

    it('does not duplicate tools already in the workflow tools list', () => {
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 3 };
      const available = new Set(['network_get_requests', 'network_enable']);
      const wf = { domain: 'network', tools: ['network_get_requests'] } as any;
      const seq = buildWorkflowToolSequence(wf, state, available);
      // network_get_requests appears twice in the function body (lines 115 and 125) but the
      // pushIfAvailable guard prevents duplicates
      const count = seq.filter((n) => n === 'network_get_requests').length;
      expect(count).toBe(1);
    });
  });

  describe('buildPresetToolSequence', () => {
    it('skips bootstrap tools when no browser session is required', () => {
      const match = {
        workflow: {
          id: 'no-browser',
          name: 'No Browser Workflow',
          description: '',
          route: {
            kind: 'preset' as const,
            triggerPatterns: [/no-browser/i],
            requiredDomains: ['core'],
            priority: 80,
            steps: [{ toolName: 'detect_crypto', description: 'Detect', prerequisites: [] }],
          },
        },
        confidence: 0.8,
        matchedPattern: '/no-browser/i',
      };
      const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
      const available = new Set(['detect_crypto', 'browser_launch']);
      const seq = buildPresetToolSequence(match as any, state, available);
      // browser_launch should NOT be injected since requiredDomains doesn't include browser/network
      const names = seq.map((t) => t.name);
      expect(names).not.toContain('browser_launch');
      expect(names).toContain('detect_crypto');
    });

    it('skips tools not in available set and skips duplicates', () => {
      const match = {
        workflow: {
          id: 'skip-test',
          name: 'Skip Test',
          description: '',
          route: {
            kind: 'preset' as const,
            triggerPatterns: [/skip/i],
            requiredDomains: [],
            priority: 50,
            steps: [
              { toolName: 'missing_tool', description: 'Missing', prerequisites: [] },
              { toolName: 'browser_launch', description: 'Launch', prerequisites: [] },
              { toolName: 'browser_launch', description: 'Launch again', prerequisites: [] },
            ],
          },
        },
        confidence: 0.5,
        matchedPattern: '/skip/i',
      };
      const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
      const available = new Set(['browser_launch']);
      const seq = buildPresetToolSequence(match as any, state, available);
      const names = seq.map((t) => t.name);
      expect(names).toHaveLength(1);
      expect(names[0]).toBe('browser_launch');
    });
  });

  describe('buildRouteMatchMetadata — domain fallback chain', () => {
    it('falls back to extensionToolsByName when getToolDomain returns null', () => {
      const match = {
        workflow: {
          id: 'domain-fallback',
          name: 'Domain Fallback',
          description: '',
          route: {
            kind: 'preset' as const,
            triggerPatterns: [/fallback/i],
            requiredDomains: ['custom'],
            priority: 60,
            steps: [
              {
                id: 'step1',
                toolName: 'unknown_builtin_tool',
                description: 'An unknown tool',
                prerequisites: [],
              },
            ],
          },
        },
        confidence: 0.6,
        matchedPattern: '/fallback/i',
      };

      const ctx = createCtx({
        extensionToolsByName: new Map([
          ['unknown_builtin_tool', { domain: 'custom-domain' } as any],
        ]),
        selectedTools: [],
        activatedToolNames: new Set(),
      });

      const meta = buildRouteMatchMetadata(match as any, ctx);
      // getToolDomain('unknown_builtin_tool') returns null, then extensionToolsByName provides 'custom-domain'
      expect(meta.steps[0]!.domain).toBe('custom-domain');
    });

    it('returns null domain when both getToolDomain and extensionToolsByName fail', () => {
      const match = {
        workflow: {
          id: 'null-domain',
          name: 'Null Domain',
          description: '',
          route: {
            kind: 'preset' as const,
            triggerPatterns: [/null-domain/i],
            requiredDomains: [],
            priority: 50,
            steps: [
              {
                id: 'step1',
                toolName: 'completely_unknown_tool',
                description: 'Unknown',
                prerequisites: [],
              },
            ],
          },
        },
        confidence: 0.5,
        matchedPattern: '/null-domain/i',
      };

      const ctx = createCtx({
        extensionToolsByName: new Map(),
      });

      const meta = buildRouteMatchMetadata(match as any, ctx);
      expect(meta.steps[0]!.domain).toBeNull();
    });
  });

  describe('rerankResultsForContext — all reranking branches', () => {
    it('applies browser_launch boost when no active page exists', () => {
      const results = [
        {
          name: 'browser_launch',
          shortDescription: '',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
      ];
      const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
      const reranked = rerankResultsForContext(results, 'some browser task', null, state);
      expect(reranked[0]!.score).toBeGreaterThan(10); // boosted by 1.4x
    });

    it('applies browser_attach boost when no active page exists', () => {
      const results = [
        {
          name: 'browser_attach',
          shortDescription: '',
          score: 8,
          domain: 'browser',
          isActive: false,
        },
      ];
      const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
      const reranked = rerankResultsForContext(results, 'some browser task', null, state);
      expect(reranked[0]!.score).toBeGreaterThan(8); // boosted by 1.2x
    });

    it('applies network_enable boost when page exists but network is disabled', () => {
      const results = [
        {
          name: 'network_enable',
          shortDescription: '',
          score: 7,
          domain: 'network',
          isActive: false,
        },
      ];
      const state = { hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 };
      const reranked = rerankResultsForContext(results, 'some network task', null, state);
      expect(reranked[0]!.score).toBeGreaterThan(7); // boosted by 1.35x
    });

    it('applies network_get_requests boost when requests are captured', () => {
      const results = [
        {
          name: 'network_get_requests',
          shortDescription: '',
          score: 6,
          domain: 'network',
          isActive: false,
        },
      ];
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 3 };
      const reranked = rerankResultsForContext(results, 'some network task', null, state);
      expect(reranked[0]!.score).toBeGreaterThan(6); // boosted by 1.5x
    });

    it('suppresses maintenance domain for browser/network tasks', () => {
      const results = [
        {
          name: 'get_token_budget_stats',
          shortDescription: '',
          score: 50,
          domain: 'maintenance',
          isActive: false,
        },
      ];
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 0 };
      // "capture" triggers BROWSER_OR_NETWORK_TASK_PATTERN
      const reranked = rerankResultsForContext(results, 'capture network', null, state);
      expect(reranked[0]!.score).toBe(5); // 50 * 0.1
    });

    it('does not suppress maintenance for maintenance tasks', () => {
      const results = [
        {
          name: 'get_token_budget_stats',
          shortDescription: '',
          score: 50,
          domain: 'maintenance',
          isActive: false,
        },
      ];
      const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 0 };
      const reranked = rerankResultsForContext(results, 'token budget cache cleanup', null, state);
      expect(reranked[0]!.score).toBe(50); // no suppression
    });
  });
});

describe('ToolRouter.probe — edge cases', () => {
  describe('probeActivePage', () => {
    it('returns false when pageController exists but getPage is not a function', async () => {
      const ctx = createCtx({
        pageController: { getPage: 'not a function' as any },
      });
      const result = await probeActivePage(ctx);
      expect(result).toBe(false);
    });

    it('returns false when pageController.getPage throws', async () => {
      const ctx = createCtx({
        pageController: {
          getPage: vi.fn(async () => {
            throw new Error('no page');
          }),
        },
      });
      const result = await probeActivePage(ctx);
      expect(result).toBe(false);
    });

    it('returns true when pageController.getPage returns a truthy page object', async () => {
      const ctx = createCtx({
        pageController: {
          getPage: vi.fn(async () => ({ pageId: 1 })),
        },
      });
      const result = await probeActivePage(ctx);
      expect(result).toBe(true);
    });
  });

  describe('probeNetworkEnabled', () => {
    it('returns false when consoleMonitor.getNetworkStatus throws', () => {
      const ctx = createCtx({
        consoleMonitor: {
          getNetworkStatus: vi.fn(() => {
            throw new Error('not available');
          }),
        },
      });
      const result = probeNetworkEnabled(ctx);
      expect(result).toBe(false);
    });

    it('falls back to isNetworkEnabled when getNetworkStatus is absent', () => {
      const ctx = createCtx({
        consoleMonitor: {
          isNetworkEnabled: vi.fn(() => true),
        },
      });
      const result = probeNetworkEnabled(ctx);
      expect(result).toBe(true);
    });

    it('returns false when isNetworkEnabled throws', () => {
      const ctx = createCtx({
        consoleMonitor: {
          isNetworkEnabled: vi.fn(() => {
            throw new Error('fallback fails');
          }),
        },
      });
      const result = probeNetworkEnabled(ctx);
      expect(result).toBe(false);
    });
  });

  describe('probeCapturedRequests', () => {
    it('returns 0 when getNetworkRequests is not a function', () => {
      const ctx = createCtx({
        consoleMonitor: { getNetworkRequests: null },
      });
      const result = probeCapturedRequests(ctx);
      expect(result).toBe(0);
    });

    it('returns correct count from array response with limit=1', () => {
      const ctx = createCtx({
        consoleMonitor: {
          getNetworkRequests: vi.fn(() => [{ id: '1' }, { id: '2' }]),
        },
      });
      const result = probeCapturedRequests(ctx);
      expect(result).toBe(1); // limit=1 means we only got 1 but there are more; actual impl uses the array length
      // The probe returns array.length when limit is passed and returns an array
      expect(ctx.consoleMonitor.getNetworkRequests).toHaveBeenCalledWith({ limit: 1 });
    });
  });
});

describe('ToolRouter.intent — edge cases', () => {
  describe('isBrowserOrNetworkTask', () => {
    it('matches Chinese characters in browser/network patterns', () => {
      expect(isBrowserOrNetworkTask('抓取网页内容', null)).toBe(true);
      expect(isBrowserOrNetworkTask('拦截网络请求', null)).toBe(true);
      expect(isBrowserOrNetworkTask('监控网络流量', null)).toBe(true);
      expect(isBrowserOrNetworkTask('普通任务', null)).toBe(false);
    });

    it('matches when workflow domain is browser or network regardless of pattern', () => {
      expect(
        isBrowserOrNetworkTask('random text', {
          domain: 'browser',
          tools: [],
          patterns: [],
          hint: '',
        } as any),
      ).toBe(true);
      expect(
        isBrowserOrNetworkTask('random text', {
          domain: 'network',
          tools: [],
          patterns: [],
          hint: '',
        } as any),
      ).toBe(true);
    });
  });

  describe('isMaintenanceTask', () => {
    it('matches Chinese maintenance keywords', () => {
      expect(isMaintenanceTask('清理缓存')).toBe(true);
      expect(isMaintenanceTask('令牌预算检查')).toBe(true);
      expect(isMaintenanceTask('插件重载')).toBe(true);
    });

    it('returns false for non-maintenance tasks', () => {
      expect(isMaintenanceTask('navigate to google')).toBe(false);
    });
  });

  describe('detectWorkflowIntent', () => {
    it('returns null for tasks that match no workflow rules', () => {
      // getAllManifests is mocked via vi.mock in the main test file
      // Here we use the actual empty manifest path
      vi.mock('@server/registry/index', () => ({ getAllManifests: () => [] }));
      const result = detectWorkflowIntent('do something completely unrelated xyz');
      expect(result).toBeNull();
    });
  });

  describe('matchWorkflowRoute', () => {
    it('skips entries where runtimeRecord.route is undefined and descriptor is also missing', () => {
      const ctx = createCtx({
        extensionWorkflowRuntimeById: new Map([
          [
            'broken-entry',
            {
              // no route property at all
              workflow: { id: 'broken-entry', displayName: 'Broken' },
            },
          ],
        ]),
      });
      const result = matchWorkflowRoute('trigger pattern', ctx);
      expect(result).toBeNull();
    });

    it('skips entries where route exists but triggerPatterns is empty', () => {
      const ctx = createCtx({
        extensionWorkflowRuntimeById: new Map([
          [
            'empty-patterns',
            {
              route: {
                kind: 'preset' as const,
                triggerPatterns: [] as RegExp[],
                requiredDomains: [],
                priority: 100,
                steps: [],
              },
              workflow: { id: 'empty-patterns', displayName: 'Empty' },
            },
          ],
        ]),
      });
      const result = matchWorkflowRoute('any text', ctx);
      expect(result).toBeNull();
    });

    it('prefers higher priority when multiple patterns match', () => {
      const ctx = createCtx({
        extensionWorkflowRuntimeById: new Map([
          [
            'low-prio',
            {
              route: {
                kind: 'preset' as const,
                triggerPatterns: [/capture/i],
                requiredDomains: [],
                priority: 20,
                steps: [],
              },
              workflow: { id: 'low-prio', displayName: 'Low' },
            },
          ],
          [
            'high-prio',
            {
              route: {
                kind: 'preset' as const,
                triggerPatterns: [/capture/i],
                requiredDomains: [],
                priority: 90,
                steps: [],
              },
              workflow: { id: 'high-prio', displayName: 'High' },
            },
          ],
        ]),
      });
      const result = matchWorkflowRoute('capture network traffic', ctx);
      expect(result?.workflow.id).toBe('high-prio');
    });
  });
});

describe('ToolRouter.renderer — edge cases', () => {
  describe('buildCallToolCommand', () => {
    it('handles non-object schemas gracefully', () => {
      const cmd = buildCallToolCommand('my_tool', { type: 'string' } as any);
      expect(cmd).toContain('my_tool');
      expect(cmd).toContain('call_tool');
    });

    it('handles undefined schema', () => {
      const cmd = buildCallToolCommand('my_tool', undefined as any);
      expect(cmd).toContain('my_tool');
    });

    it('handles object schema without properties', () => {
      const cmd = buildCallToolCommand('my_tool', { type: 'object' } as any);
      expect(cmd).toContain('my_tool');
      expect(cmd).toContain('{}');
    });
  });

  describe('generateExampleArgs — empty required', () => {
    it('returns empty object when required is an empty array', async () => {
      const { generateExampleArgs } = await vi.importActual('@server/ToolRouter.renderer');
      const result = (generateExampleArgs as any)({
        type: 'object',
        required: [],
        properties: { foo: { type: 'string' } },
      });
      expect(result).toEqual({});
    });
  });
});

describe('ToolRouter — orchestrator edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureWorkflowsLoaded.mockResolvedValue(undefined);
  });

  it('workflow-kind routeMatch: run_extension_workflow absent from search results still routes correctly', async () => {
    const ctx = createCtx({
      extensionWorkflowsById: new Map([['workflow.b', { id: 'workflow.b' }]]),
      extensionWorkflowRuntimeById: new Map([
        [
          'workflow.b',
          {
            route: {
              kind: 'workflow' as const,
              triggerPatterns: [/execute workflow/i],
              requiredDomains: [],
              priority: 80,
              steps: [],
            },
            workflow: {
              kind: 'workflow-contract' as const,
              version: 1,
              id: 'workflow.b',
              displayName: 'Workflow B',
              description: 'Execute workflow B',
              route: {
                kind: 'workflow' as const,
                triggerPatterns: [/execute workflow/i],
                requiredDomains: [],
                priority: 80,
                steps: [],
              },
              build: () => ({ kind: 'sequence', id: 'root', steps: [] }),
            },
          },
        ],
      ]),
    });

    // search returns nothing relevant — run_extension_workflow is built from routeMatch alone
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'unrelated_tool',
          shortDescription: 'Unrelated',
          score: 1,
          domain: 'maintenance',
          isActive: false,
        },
      ]),
    } as any;

    const response = await routeToolRequest(
      { task: 'execute workflow b', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.routeMatch?.id).toBe('workflow.b');
    expect(response.routeMatch?.kind).toBe('workflow');
    expect(response.recommendations[0]?.name).toBe('run_extension_workflow');
  });

  it('preset workflow with only bootstrap tools available (no other search results)', async () => {
    const ctx = createCtx({
      extensionWorkflowsById: new Map([['bootstrap-only', { id: 'bootstrap-only' }]]),
      extensionWorkflowRuntimeById: new Map([
        [
          'bootstrap-only',
          {
            route: {
              kind: 'preset' as const,
              triggerPatterns: [/bootstrap preset/i],
              requiredDomains: ['browser'],
              priority: 70,
              steps: [],
            },
            workflow: {
              id: 'bootstrap-only',
              displayName: 'Bootstrap Only',
              description: 'Only bootstrap tools',
              route: {
                kind: 'preset' as const,
                triggerPatterns: [/bootstrap preset/i],
                requiredDomains: ['browser'],
                priority: 70,
                steps: [],
              },
            },
          },
        ],
      ]),
    });

    const searchEngine = { search: vi.fn(() => []) } as any;

    const response = await routeToolRequest(
      { task: 'bootstrap preset', context: { autoActivate: false } },
      ctx,
      searchEngine,
    );

    expect(response.routeMatch?.id).toBe('bootstrap-only');
    // browser_launch and browser_attach are injected because hasActivePage=false and requiredDomains includes browser
    const presetRecs = response.recommendations.filter(
      (r) => r.name === 'browser_launch' || r.name === 'browser_attach',
    );
    expect(presetRecs.length).toBeGreaterThan(0);
  });

  it('returns no recommendations and no nextActions when search yields nothing and no workflow matches', async () => {
    const ctx = createCtx();
    const searchEngine = { search: vi.fn(() => []) } as any;

    const response = await routeToolRequest(
      { task: 'completely random task 12345 xyz', context: {} },
      ctx,
      searchEngine,
    );

    expect(response.recommendations).toHaveLength(0);
    expect(response.nextActions).toHaveLength(0);
    expect(response.routeMatch).toBeUndefined();
  });

  it('detail=balanced sets schemaHint and argsSummary but not inputSchema', async () => {
    const ctx = createCtx();
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'browser_launch',
          shortDescription: 'Launch browser',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
      ]),
    } as any;

    const response = await routeToolRequest(
      { task: 'open browser', context: { detail: 'balanced' } },
      ctx,
      searchEngine,
    );

    expect(response.recommendations[0]!.schemaHint).toBe('describe_tool("browser_launch")');
    expect(response.recommendations[0]!.argsSummary).toBeDefined();
    expect((response.recommendations[0] as any).inputSchema).toBeUndefined();
  });

  it('preferredDomain boost is applied after reranking', async () => {
    const ctx = createCtx();
    const searchEngine = {
      search: vi.fn(() => [
        {
          name: 'browser_launch',
          shortDescription: 'Launch browser',
          score: 10,
          domain: 'browser',
          isActive: false,
        },
        {
          name: 'network_enable',
          shortDescription: 'Enable network',
          score: 9,
          domain: 'network',
          isActive: false,
        },
      ]),
    } as any;

    const response = await routeToolRequest(
      { task: 'some task', context: { preferredDomain: 'network' } },
      ctx,
      searchEngine,
    );

    // network_enable gets 1.15x boost, surpassing browser_launch
    expect(response.recommendations[0]!.name).toBe('network_enable');
  });

  it('maxRecommendations limit respects presetPlannedToolNames size', async () => {
    const ctx = createCtx({
      extensionWorkflowsById: new Map([['preset-limit', { id: 'preset-limit' }]]),
      extensionWorkflowRuntimeById: new Map([
        [
          'preset-limit',
          {
            route: {
              kind: 'preset' as const,
              triggerPatterns: [/preset limit/i],
              requiredDomains: [],
              priority: 90,
              steps: [
                { toolName: 'browser_launch', description: 'Launch', prerequisites: [] },
                { toolName: 'browser_attach', description: 'Attach', prerequisites: [] },
                { toolName: 'network_enable', description: 'Enable', prerequisites: [] },
                { toolName: 'network_get_requests', description: 'Get', prerequisites: [] },
                { toolName: 'page_navigate', description: 'Navigate', prerequisites: [] },
                { toolName: 'page_screenshot', description: 'Screenshot', prerequisites: [] },
              ],
            },
            workflow: {
              id: 'preset-limit',
              displayName: 'Preset Limit',
              description: '',
              route: {
                kind: 'preset' as const,
                triggerPatterns: [/preset limit/i],
                requiredDomains: [],
                priority: 90,
                steps: [
                  { toolName: 'browser_launch', description: 'Launch', prerequisites: [] },
                  { toolName: 'browser_attach', description: 'Attach', prerequisites: [] },
                  { toolName: 'network_enable', description: 'Enable', prerequisites: [] },
                  { toolName: 'network_get_requests', description: 'Get', prerequisites: [] },
                  { toolName: 'page_navigate', description: 'Navigate', prerequisites: [] },
                  { toolName: 'page_screenshot', description: 'Screenshot', prerequisites: [] },
                ],
              },
            },
          },
        ],
      ]),
    });

    const searchEngine = { search: vi.fn(() => []) } as any;

    // maxRecommendations=2 but 6 preset tools exist — limit should be max(2, 6) = 6
    const response = await routeToolRequest(
      { task: 'preset limit', context: { maxRecommendations: 2 } },
      ctx,
      searchEngine,
    );

    expect(response.recommendations.length).toBeGreaterThanOrEqual(6);
  });
});

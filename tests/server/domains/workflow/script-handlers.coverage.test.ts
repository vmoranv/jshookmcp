import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptHandlers } from '@server/domains/workflow/handlers/script-handlers';
import type { WorkflowSharedState } from '@server/domains/workflow/handlers/shared';

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function parseBody(result: any) {
  return JSON.parse(result.content[0].text);
}

const mockBrowserHandlers = {
  handlePageEvaluate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"result":"ok"}' }],
  }),
  handlePageNavigate: vi.fn(),
  handlePageType: vi.fn(),
  handlePageClick: vi.fn(),
  handleTabWorkflow: vi.fn(),
};

function createMockState(): WorkflowSharedState {
  return {
    deps: {
      browserHandlers: mockBrowserHandlers,
      advancedHandlers: {} as any,
      serverContext: undefined,
    },
    scriptRegistry: new Map(),
    bundleCache: new Map(),
    bundleCacheBytes: 0,
  };
}

describe('ScriptHandlers', () => {
  let handlers: ScriptHandlers;
  let state: WorkflowSharedState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = createMockState();
    handlers = new ScriptHandlers(state);
    mockBrowserHandlers.handlePageEvaluate.mockResolvedValue({
      content: [{ type: 'text', text: '{"result":"ok"}' }],
    });
  });

  describe('handlePageScriptRegister', () => {
    it('returns error when name is missing', async () => {
      const result = await handlers.handlePageScriptRegister({ code: 'x' });
      expect(parseBody(result).success).toBe(false);
      expect(parseBody(result).error).toContain('name and code are required');
    });

    it('returns error when code is missing', async () => {
      const result = await handlers.handlePageScriptRegister({ name: 'test' });
      expect(parseBody(result).success).toBe(false);
    });

    it('registers a new script', async () => {
      const result = await handlers.handlePageScriptRegister({
        name: 'myScript',
        code: 'return 1',
        description: 'test script',
      });
      const body = parseBody(result);
      expect(body.success).toBe(true);
      expect(body.action).toBe('registered');
      expect(body.name).toBe('myScript');
      expect(body.totalScripts).toBe(1);
    });

    it('updates existing script preserving source', async () => {
      state.scriptRegistry.set('myScript', {
        code: 'old',
        description: '',
        source: 'core',
        protectedFromEviction: true,
      });

      const result = await handlers.handlePageScriptRegister({
        name: 'myScript',
        code: 'new code',
      });
      const body = parseBody(result);
      expect(body.action).toBe('updated');
      expect(state.scriptRegistry.get('myScript')?.source).toBe('core');
      expect(state.scriptRegistry.get('myScript')?.protectedFromEviction).toBe(true);
    });

    it('evicts non-protected script at capacity', async () => {
      for (let i = 0; i < 100; i++) {
        state.scriptRegistry.set(`script_${i}`, {
          code: `code_${i}`,
          description: '',
          source: 'user',
          protectedFromEviction: false,
        });
      }

      const result = await handlers.handlePageScriptRegister({
        name: 'overflow',
        code: 'overflow code',
      });
      const body = parseBody(result);
      expect(body.success).toBe(true);
      expect(state.scriptRegistry.size).toBeLessThanOrEqual(100);
    });
  });

  describe('handlePageScriptRun', () => {
    it('returns error for unknown script', async () => {
      const result = await handlers.handlePageScriptRun({ name: 'nonexistent' });
      const body = parseBody(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
      expect(body.available).toBeDefined();
    });

    it('returns error for missing name', async () => {
      const result = await handlers.handlePageScriptRun({});
      const body = parseBody(result);
      expect(body.success).toBe(false);
    });

    it('runs script without params', async () => {
      state.scriptRegistry.set('test', {
        code: 'return 1',
        description: '',
        source: 'user',
        protectedFromEviction: false,
      });

      await handlers.handlePageScriptRun({ name: 'test' });
      expect(mockBrowserHandlers.handlePageEvaluate).toHaveBeenCalledWith({
        code: 'return 1',
      });
    });

    it('runs script with params wrapping', async () => {
      state.scriptRegistry.set('test', {
        code: 'return __params__',
        description: '',
        source: 'user',
        protectedFromEviction: false,
      });

      await handlers.handlePageScriptRun({
        name: 'test',
        params: { key: 'value' },
      });

      const call = mockBrowserHandlers.handlePageEvaluate.mock.calls[0]!;
      expect(call[0].code).toContain('__params__');
    });

    it('handles evaluate error', async () => {
      state.scriptRegistry.set('test', {
        code: 'throw new Error("boom")',
        description: '',
        source: 'user',
        protectedFromEviction: false,
      });
      mockBrowserHandlers.handlePageEvaluate.mockRejectedValue(new Error('Script failed'));

      const result = await handlers.handlePageScriptRun({ name: 'test' });
      const body = parseBody(result);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Script failed');
    });
  });

  describe('handleListExtensionWorkflows', () => {
    it('returns error when no serverContext', async () => {
      const result = await handlers.handleListExtensionWorkflows();
      const body = parseBody(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('unavailable');
    });

    it('returns workflows from context', async () => {
      const mockCtx = {
        extensionWorkflowsById: new Map([
          [
            'wf1',
            {
              id: 'wf1',
              displayName: 'Workflow 1',
              description: 'Test workflow',
              tags: ['test'],
              timeoutMs: 5000,
              defaultMaxConcurrency: 1,
              source: 'plugin',
              route: {
                kind: 'extension',
                priority: 1,
                requiredDomains: [],
                triggerPatterns: [],
                steps: [],
              },
            },
          ],
          [
            'preset1',
            {
              id: 'preset1',
              displayName: 'Preset',
              description: '',
              tags: [],
              timeoutMs: 5000,
              defaultMaxConcurrency: 1,
              source: 'builtin',
              route: {
                kind: 'preset',
                priority: 0,
                requiredDomains: [],
                triggerPatterns: [],
                steps: [],
              },
            },
          ],
        ]),
      } as any;

      state.deps.serverContext = mockCtx;

      vi.doMock('@server/extensions/ExtensionManager', () => ({
        ensureWorkflowsLoaded: vi.fn().mockResolvedValue(undefined),
      }));

      const result = await handlers.handleListExtensionWorkflows();
      const body = parseBody(result);
      expect(body.success).toBe(true);
      expect(body.count).toBe(1);
      expect(body.workflows[0].id).toBe('wf1');
    });
  });

  describe('handleRunExtensionWorkflow', () => {
    it('returns error when no serverContext', async () => {
      const result = await handlers.handleRunExtensionWorkflow({ workflowId: 'test' });
      const body = parseBody(result);
      expect(body.success).toBe(false);
    });

    it('returns error when workflowId is missing', async () => {
      state.deps.serverContext = {} as any;
      const result = await handlers.handleRunExtensionWorkflow({});
      const body = parseBody(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('workflowId is required');
    });

    it('returns error when workflow not found', async () => {
      state.deps.serverContext = {
        extensionWorkflowsById: new Map(),
        extensionWorkflowRuntimeById: new Map(),
      } as any;

      const result = await handlers.handleRunExtensionWorkflow({ workflowId: 'missing' });
      const body = parseBody(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });

    it('returns error for preset workflows', async () => {
      const runtimeRecord = {
        route: { kind: 'preset' },
      };
      state.deps.serverContext = {
        extensionWorkflowsById: new Map([
          ['preset1', { id: 'preset1', route: { kind: 'preset' } }],
        ]),
        extensionWorkflowRuntimeById: new Map([['preset1', runtimeRecord]]),
      } as any;

      const result = await handlers.handleRunExtensionWorkflow({ workflowId: 'preset1' });
      const body = parseBody(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('preset');
    });

    it('executes workflow and returns result', async () => {
      const workflow = { steps: [] };
      const runtimeRecord = {
        route: { kind: 'extension' },
        workflow,
      };
      state.deps.serverContext = {
        extensionWorkflowsById: new Map([['wf1', { id: 'wf1', route: { kind: 'extension' } }]]),
        extensionWorkflowRuntimeById: new Map([['wf1', runtimeRecord]]),
      } as any;

      vi.doMock('@server/extensions/ExtensionManager', () => ({
        ensureWorkflowsLoaded: vi.fn().mockResolvedValue(undefined),
      }));
      vi.doMock('@server/workflows/WorkflowEngine', () => ({
        executeExtensionWorkflow: vi.fn().mockResolvedValue({ status: 'completed' }),
      }));

      const result = await handlers.handleRunExtensionWorkflow({
        workflowId: 'wf1',
        config: { key: 'val' },
      });
      const body = parseBody(result);
      expect(body.success).toBe(true);
    });
  });
});

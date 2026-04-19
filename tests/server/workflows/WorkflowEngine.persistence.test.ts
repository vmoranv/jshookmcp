import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineWorkflow, parallelStep, toolStep } from '@server/workflows/WorkflowContract';

const state = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'run-pr3-001'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: state.randomUUID,
}));

function successResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }) }],
  };
}

describe('WorkflowEngine PR3: parallel keyed results + run persistence', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('ParallelResult keyed by step ID', () => {
    it('returns step-ID-keyed object with __order array', async () => {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async (name: string) => successResponse({ name })),
      };
      const workflow = defineWorkflow('wf-keyed', 'Keyed Parallel', (w) =>
        w.buildGraph(() =>
          parallelStep('par', (p) => {
            p.tool('alpha', 'tool_a');
            p.tool('beta', 'tool_b');
            p.tool('gamma', 'tool_c');
          }),
        ),
      );

      const result = await executeExtensionWorkflow(ctx as never, workflow);
      const par = result.stepResults.par as Record<string, unknown>;

      expect(par).toHaveProperty('alpha');
      expect(par).toHaveProperty('beta');
      expect(par).toHaveProperty('gamma');
      expect(par.__order).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
      expect(par.__order).toHaveLength(3);
    });

    it('keys failure entries by step ID instead of array index', async () => {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async (name: string) => {
          if (name === 'fail_tool') {
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'bad' }) }],
            };
          }
          return successResponse({ name });
        }),
      };
      const workflow = defineWorkflow('wf-fail', 'Fail Parallel', (w) =>
        w.buildGraph(() =>
          parallelStep('par', (p) => {
            p.failFast(false);
            p.tool('ok-step', 'good_tool');
            p.tool('fail-step', 'fail_tool');
          }),
        ),
      );

      const result = await executeExtensionWorkflow(ctx as never, workflow);
      const par = result.stepResults.par as Record<string, unknown>;

      expect(par['ok-step']).toBeDefined();
      expect(par['fail-step']).toEqual({ success: false, error: 'bad' });
      expect(par.__order).toHaveLength(2);
    });

    it('stores individual step results in stepResults map', async () => {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async (name: string) => successResponse({ name })),
      };
      const workflow = defineWorkflow('wf-individual', 'Individual Results', (w) =>
        w.buildGraph(() =>
          parallelStep('par', (p) => {
            p.tool('step-a', 'tool_a');
            p.tool('step-b', 'tool_b');
          }),
        ),
      );

      const result = await executeExtensionWorkflow(ctx as never, workflow);
      expect(result.stepResults).toHaveProperty('step-a');
      expect(result.stepResults).toHaveProperty('step-b');
      expect(result.stepResults).toHaveProperty('par');
    });
  });

  describe('WorkflowRunStore persistence', () => {
    it('records successful runs and retrieves them', async () => {
      const { executeExtensionWorkflow, getWorkflowRunStore } =
        await import('@server/workflows/WorkflowEngine');
      const store = getWorkflowRunStore();
      store.clear();

      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async () => successResponse({ ok: true })),
      };
      const workflow = defineWorkflow('wf-persist', 'Persist Test', (w) =>
        w.buildGraph(() => toolStep('s1', 'some_tool')),
      );

      const result = await executeExtensionWorkflow(ctx as never, workflow);
      const run = store.getRun(result.runId);

      expect(run).toBeDefined();
      expect(run!.workflowId).toBe('wf-persist');
      expect(run!.status).toBe('success');
      expect(run!.stepResultKeys).toContain('s1');
    });

    it('stores last success per workflow ID', async () => {
      state.randomUUID.mockReturnValueOnce('run-a');
      state.randomUUID.mockReturnValueOnce('run-b');
      const { executeExtensionWorkflow, getWorkflowRunStore } =
        await import('@server/workflows/WorkflowEngine');
      const store = getWorkflowRunStore();
      store.clear();

      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async () => successResponse({ ok: true })),
      };
      const workflow = defineWorkflow('wf-last', 'Last Success', (w) =>
        w.buildGraph(() => toolStep('s1', 'tool')),
      );

      await executeExtensionWorkflow(ctx as never, workflow);
      await executeExtensionWorkflow(ctx as never, workflow);

      const last = store.getLastSuccess('wf-last');
      expect(last).toBeDefined();
      expect(last!.runId).toBe('run-b');
    });

    it('records error runs', async () => {
      const { executeExtensionWorkflow, getWorkflowRunStore } =
        await import('@server/workflows/WorkflowEngine');
      const store = getWorkflowRunStore();
      store.clear();

      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn().mockRejectedValue(new Error('crash')),
      };
      const workflow = defineWorkflow('wf-err', 'Error Test', (w) =>
        w.buildGraph(() => toolStep('s1', 'tool')),
      );

      await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('crash');

      const runs = store.listRuns('wf-err');
      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe('error');
    });

    it('listRuns filters by workflowId', async () => {
      state.randomUUID.mockReturnValueOnce('r1');
      state.randomUUID.mockReturnValueOnce('r2');
      const { executeExtensionWorkflow, getWorkflowRunStore } =
        await import('@server/workflows/WorkflowEngine');
      const store = getWorkflowRunStore();
      store.clear();

      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async () => successResponse({ ok: true })),
      };

      const wf1 = defineWorkflow('wf-a', 'A', (w) => w.buildGraph(() => toolStep('s1', 'tool')));
      const wf2 = defineWorkflow('wf-b', 'B', (w) => w.buildGraph(() => toolStep('s2', 'tool')));

      await executeExtensionWorkflow(ctx as never, wf1);
      await executeExtensionWorkflow(ctx as never, wf2);

      expect(store.listRuns('wf-a')).toHaveLength(1);
      expect(store.listRuns('wf-b')).toHaveLength(1);
      expect(store.listRuns()).toHaveLength(2);
    });

    it('clear removes all recorded runs', async () => {
      const { executeExtensionWorkflow, getWorkflowRunStore } =
        await import('@server/workflows/WorkflowEngine');
      const store = getWorkflowRunStore();
      store.clear();

      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(async () => successResponse({ ok: true })),
      };
      const workflow = defineWorkflow('wf-clear', 'Clear Test', (w) =>
        w.buildGraph(() => toolStep('s1', 'tool')),
      );

      await executeExtensionWorkflow(ctx as never, workflow);
      expect(store.listRuns()).toHaveLength(1);

      store.clear();
      expect(store.listRuns()).toHaveLength(0);
      expect(store.getLastSuccess('wf-clear')).toBeUndefined();
    });
  });
});

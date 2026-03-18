import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflow, SequenceNodeBuilder } from '@server/workflows/WorkflowContract';

const state = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'run-123'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: state.randomUUID,
}));

function successResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }) }],
  };
}

describe('workflows/WorkflowEngine', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('executes a sequence workflow, merges config, and returns step results', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = {
      baseTier: 'workflow',
      config: { feature: { enabled: true }, nested: { value: 1 } },
      executeToolWithTracking: vi.fn(async (name: string, args: Record<string, unknown>) =>
        successResponse({ name, args })
      ),
    };
    const workflow = createWorkflow('wf-seq', 'Sequence Workflow')
      .buildGraph((executionContext) => {
        expect(executionContext.getConfig('feature.enabled', false)).toBe(true);
        expect(executionContext.getConfig('override.flag', false)).toBe(true);
        return new SequenceNodeBuilder('root')
          .tool('step-1', 'page_navigate', (builder) =>
            builder.input({ url: 'https://example.com' })
          )
          .tool('step-2', 'page_click');
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow, {
      config: { override: { flag: true } },
      nodeInputOverrides: { 'step-2': { selector: '#submit' } },
    });

    expect(result.runId).toBe('run-123');
    expect(result.profile).toBe('workflow');
    expect(result.workflowId).toBe('wf-seq');
    expect(result.stepResults).toHaveProperty('step-1');
    expect(result.stepResults).toHaveProperty('step-2');
    expect(ctx.executeToolWithTracking).toHaveBeenNthCalledWith(1, 'page_navigate', {
      url: 'https://example.com',
    });
    expect(ctx.executeToolWithTracking).toHaveBeenNthCalledWith(2, 'page_click', {
      selector: '#submit',
    });
  });

  it('retries failed tool nodes until they succeed', async () => {
    vi.useFakeTimers();
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'retry me' }) }],
      })
      .mockResolvedValueOnce(successResponse({ ok: true }));
    const ctx = {
      baseTier: 'workflow',
      config: {},
      executeToolWithTracking,
    };
    const workflow = createWorkflow('wf-retry', 'Retry Workflow')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').tool('retry-step', 'page_click', (builder) =>
          builder.retry({ maxAttempts: 2, backoffMs: 50, multiplier: 1 })
        )
      )
      .build();

    const promise = executeExtensionWorkflow(ctx as never, workflow);
    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;

    expect(executeToolWithTracking).toHaveBeenCalledTimes(2);
    expect(result.stepResults['retry-step']).toEqual(successResponse({ ok: true }));
  });

  it('captures parallel step failures when failFast is disabled', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = {
      baseTier: 'workflow',
      config: {},
      executeToolWithTracking: vi.fn(async (name: string) => {
        if (name === 'bad_tool') {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'boom' }) }],
          };
        }
        return successResponse({ ok: true });
      }),
    };
    const workflow = createWorkflow('wf-parallel', 'Parallel Workflow')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').parallel('parallel', (builder) => {
          builder.failFast(false);
          builder.tool('good-step', 'good_tool');
          builder.tool('bad-step', 'bad_tool');
        })
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    const parallelResult = result.stepResults.parallel as Array<Record<string, unknown>>;

    expect(parallelResult[0]?.content).toBeDefined();
    expect(parallelResult[1]).toEqual({ success: false, error: 'boom' });
  });

  it('uses predicate functions and built-in predicates for branch routing', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = {
      baseTier: 'workflow',
      config: {},
      executeToolWithTracking: vi.fn(async (name: string) => successResponse({ name })),
    };
    const workflow = createWorkflow('wf-branch', 'Branch Workflow')
      .buildGraph(() => {
        const root = new SequenceNodeBuilder('root');
        root.tool('step-1', 'page_navigate');
        root.branch('branch-fn', 'always_false', (builder) => {
          builder.predicateFn(() => true);
          builder.whenTrue(new SequenceNodeBuilder('true-branch').tool('step-2', 'page_click'));
          builder.whenFalse(new SequenceNodeBuilder('false-branch').tool('step-3', 'debug_pause'));
        });
        root.branch('branch-built-in', 'always_false', (builder) => {
          builder.whenTrue(new SequenceNodeBuilder('unused').tool('step-4', 'page_type'));
          builder.whenFalse(new SequenceNodeBuilder('used').tool('step-5', 'debug_pause'));
        });
        return root;
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);

    expect(result.stepResults).toHaveProperty('step-2');
    expect(result.stepResults).toHaveProperty('step-5');
    expect(result.stepResults).not.toHaveProperty('step-3');
  });

  it('calls onError when the workflow exceeds its timeout', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const onError = vi.fn();
      const ctx = {
        baseTier: 'workflow',
        config: {},
        executeToolWithTracking: vi.fn(() => new Promise(() => undefined)),
      };
      const workflow = createWorkflow('wf-timeout', 'Timeout Workflow')
        .timeoutMs(25)
        .buildGraph(() => new SequenceNodeBuilder('root').tool('slow-step', 'slow_tool'))
        .onError(onError)
        .build();

      const promise = executeExtensionWorkflow(ctx as never, workflow);
      // Catch early to prevent unhandled rejection
      const caught = promise.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30);

      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Workflow "wf-timeout" timed out after 25ms');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ workflowRunId: 'run-123' }),
        expect.objectContaining({ message: 'Workflow "wf-timeout" timed out after 25ms' })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

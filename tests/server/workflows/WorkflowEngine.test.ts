import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkflow,
  SequenceNodeBuilder,
  ToolNodeBuilder,
  ParallelNodeBuilder,
} from '@server/workflows/WorkflowContract';

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
        successResponse({ name, args }),
      ),
    };
    const workflow = createWorkflow('wf-seq', 'Sequence Workflow')
      .buildGraph((executionContext) => {
        expect(executionContext.getConfig('feature.enabled', false)).toBe(true);
        expect(executionContext.getConfig('override.flag', false)).toBe(true);
        return new SequenceNodeBuilder('root')
          .tool('step-1', 'page_navigate', (builder) =>
            builder.input({ url: 'https://example.com' }),
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
          builder.retry({ maxAttempts: 2, backoffMs: 50, multiplier: 1 }),
        ),
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
        }),
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

    const result = await executeExtensionWorkflow(ctx as never, workflow, {
      profile: 'custom-profile',
    });

    expect(result.profile).toBe('custom-profile');

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
      const caught = promise.catch((e: any) => e);
      await vi.advanceTimersByTimeAsync(30);

      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Workflow "wf-timeout" timed out after 25ms');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ workflowRunId: 'run-123' }),
        expect.objectContaining({ message: 'Workflow "wf-timeout" timed out after 25ms' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves tool inputFrom references from previous step outputs', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce(successResponse({ result_field: 'hello' }))
      .mockResolvedValueOnce(successResponse({ ok: true }))
      .mockResolvedValueOnce(successResponse({ ok: true }));

    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const workflow = createWorkflow('wf', 'wf')
      .buildGraph(() =>
        new SequenceNodeBuilder('root')
          .tool('step-1', 'tool_1')
          .tool('step-2', 'tool_2', (b) =>
            b.inputFrom({ injectA: 'step-1.result_field', injectB: 'step-1' }),
          )
          .tool('step-3', 'tool_3', (b) => b.inputFrom({ injectC: 'non_existent.field' })),
      )
      .build();

    await executeExtensionWorkflow(ctx as never, workflow);
    expect(executeToolWithTracking).toHaveBeenNthCalledWith(2, 'tool_2', {
      injectA: 'hello',
      injectB: successResponse({ result_field: 'hello' }),
    });
    expect(executeToolWithTracking).toHaveBeenNthCalledWith(3, 'tool_3', { injectC: undefined });
  });

  it('collectSuccessStats handles various response formats for predicates', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce(successResponse({ ok: true }))
      .mockResolvedValueOnce({
        content: [{ text: JSON.stringify({ success: false, error: 'boom' }) }],
      })
      .mockResolvedValueOnce({ content: [{ text: 'invalid json' }] })
      .mockResolvedValueOnce({ error: 'hard error' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ content: [{ text: JSON.stringify({ success: true }) }] }]);

    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const workflow = createWorkflow('wf', 'wf')
      .buildGraph(() =>
        new SequenceNodeBuilder('root')
          .parallel('par', (b) => {
            b.tool('t1', 't')
              .tool('t2', 't')
              .tool('t3', 't')
              .tool('t4', 't')
              .tool('t5', 't')
              .tool('t6', 't');
          })
          .branch('br', 'any_step_failed', (b) => b.whenTrue(new ToolNodeBuilder('t7', 't')))
          .branch('br2', 'success_rate_gte_50', (b) => {
            b.whenTrue(new ToolNodeBuilder('t9', 't'));
            b.whenFalse(new ToolNodeBuilder('t8', 't'));
          }),
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t7');
    expect(result.stepResults).not.toHaveProperty('t8'); // since success rate < 50%
  });

  it('exhausts tool node retries and fails the workflow with tool error', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const executeToolWithTracking = vi.fn().mockRejectedValue(new Error('retry error'));
      const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
      const workflow = createWorkflow('w', 'w')
        .buildGraph(() => new ToolNodeBuilder('t', 't').retry({ maxAttempts: 2, backoffMs: 1 }))
        .build();

      const p = executeExtensionWorkflow(ctx as never, workflow);
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(10);
      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('retry error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails immediately when maxAttempts is 0', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const executeToolWithTracking = vi.fn().mockRejectedValue(new Error('retry error'));
      const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
      const workflow = createWorkflow('w', 'w')
        .buildGraph(() => new ToolNodeBuilder('t', 't').retry({ maxAttempts: 0, backoffMs: 1 }))
        .build();

      const p = executeExtensionWorkflow(ctx as never, workflow);
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(10);
      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Workflow tool node "t" exhausted retries');
    } finally {
      vi.useRealTimers();
    }
  });

  it('parallel node failFast aborts remaining steps', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi.fn(async (name) => {
      if (name === 't1') throw new Error('boom');
      if (name === 't3') throw 'string error';
      return successResponse({});
    });
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const workflow = createWorkflow('w', 'w')
      .buildGraph(() =>
        new ParallelNodeBuilder('p').failFast(false).tool('t1', 't1').tool('t3', 't3'),
      )
      .build();
    const res = await executeExtensionWorkflow(ctx as never, workflow);
    expect((res.stepResults.p as any)[0].error).toBe('boom');
    expect((res.stepResults.p as any)[1].error).toBe('string error');

    const wf2 = createWorkflow('w2', 'w2')
      .buildGraph(() =>
        new ParallelNodeBuilder('p').failFast(true).tool('t1', 't1').tool('t2', 't2'),
      )
      .build();
    await expect(executeExtensionWorkflow(ctx as never, wf2)).rejects.toThrow('boom');
  });

  it('throws on unsupported node kind', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking: vi.fn() };
    const workflow = createWorkflow('w', 'w')
      .buildGraph(() => ({ build: () => ({ kind: 'unknown', id: 'u' }) }) as any)
      .build();
    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Unsupported workflow node kind: unknown',
    );
  });

  it('workflow finishes successfully before timeout', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi.fn().mockResolvedValueOnce(successResponse({}));
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const w = createWorkflow('w', 'w')
      .timeoutMs(1000)
      .buildGraph(() => new ToolNodeBuilder('t', 't'))
      .build();
    await expect(executeExtensionWorkflow(ctx as never, w)).resolves.toMatchObject({
      result: expect.anything(),
    });
  });

  it('workflow natively rejects before timeout', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi.fn().mockRejectedValueOnce(new Error('native error'));
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const w = createWorkflow('w', 'w')
      .timeoutMs(1000)
      .buildGraph(() => new ToolNodeBuilder('t', 't'))
      .build();
    await expect(executeExtensionWorkflow(ctx as never, w)).rejects.toThrow('native error');
  });

  it('supports variable_equals predicate for branch routing', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce(successResponse({ status: 'authenticated' }))
      .mockResolvedValueOnce(successResponse({ route: 'auth' }))
      .mockResolvedValueOnce(successResponse({ route: 'guest' }));

    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const workflow = createWorkflow('wf-var-equals', 'Variable Equals Test')
      .buildGraph(() => {
        const root = new SequenceNodeBuilder('root');
        root.tool('check-auth', 'check_auth');
        root.branch('branch-auth', 'variable_equals_check-auth.status_authenticated', (builder) => {
          builder.whenTrue(new SequenceNodeBuilder('auth-route').tool('auth-action', 'auth_tool'));
          builder.whenFalse(
            new SequenceNodeBuilder('guest-route').tool('guest-action', 'guest_tool'),
          );
        });
        return root;
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);

    expect(result.stepResults).toHaveProperty('auth-route');
    expect(result.stepResults).not.toHaveProperty('guest-route');
  });

  it('supports variable_contains predicate for branch routing', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce(successResponse({ endpoints: ['/api/users', '/api/data'] }))
      .mockResolvedValueOnce(successResponse({ found: true }))
      .mockResolvedValueOnce(successResponse({ found: false }));

    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const workflow = createWorkflow('wf-var-contains', 'Variable Contains Test')
      .buildGraph(() => {
        const root = new SequenceNodeBuilder('root');
        root.tool('scan-endpoints', 'scan');
        root.branch('branch-api', 'variable_contains_scan-endpoints.endpoints_/api/', (builder) => {
          builder.whenTrue(new SequenceNodeBuilder('api-found').tool('process-api', 'process'));
          builder.whenFalse(new SequenceNodeBuilder('no-api').tool('skip', 'skip_tool'));
        });
        return root;
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);

    expect(result.stepResults).toHaveProperty('api-found');
    expect(result.stepResults).not.toHaveProperty('no-api');
  });

  it('supports variable_matches predicate for regex pattern matching', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce(
        successResponse({ token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test' }),
      )
      .mockResolvedValueOnce(successResponse({ valid: true }))
      .mockResolvedValueOnce(successResponse({ valid: false }));

    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const workflow = createWorkflow('wf-var-matches', 'Variable Matches Test')
      .buildGraph(() => {
        const root = new SequenceNodeBuilder('root');
        root.tool('get-token', 'get_token');
        root.branch(
          'branch-jwt',
          'variable_matches_get-token.token_^eyJ[A-Za-z0-9]+\\.',
          (builder) => {
            builder.whenTrue(new SequenceNodeBuilder('jwt-detected').tool('decode-jwt', 'decode'));
            builder.whenFalse(new SequenceNodeBuilder('not-jwt').tool('handle-other', 'handle'));
          },
        );
        return root;
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);

    expect(result.stepResults).toHaveProperty('jwt-detected');
    expect(result.stepResults).not.toHaveProperty('not-jwt');
  });

  it('variable_equals uses deep equality for object comparison', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi
      .fn()
      .mockResolvedValueOnce(successResponse({ user: { id: 1, name: 'test' } }))
      .mockResolvedValueOnce(successResponse({ matched: true }));

    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    // Note: This tests that the predicate correctly handles nested access
    const workflow = createWorkflow('wf-deep', 'Deep Equality Test')
      .buildGraph(() => {
        const root = new SequenceNodeBuilder('root');
        root.tool('get-user', 'get_user');
        // Access nested property via dot notation
        root.branch('branch-user', 'variable_equals_get-user.user.name_test', (builder) => {
          builder.whenTrue(new SequenceNodeBuilder('user-match').tool('verify', 'verify_tool'));
          builder.whenFalse(new SequenceNodeBuilder('user-no-match').tool('reject', 'reject_tool'));
        });
        return root;
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);

    expect(result.stepResults).toHaveProperty('user-match');
  });
});

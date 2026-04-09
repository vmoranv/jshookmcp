import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  branchStep,
  defineWorkflow,
  parallelStep,
  sequenceStep,
  toolStep,
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
    const workflow = defineWorkflow('wf-seq', 'Sequence Workflow', (w) =>
      w.buildGraph((executionContext) => {
        expect(executionContext.getConfig('feature.enabled', false)).toBe(true);
        expect(executionContext.getConfig('override.flag', false)).toBe(true);
        return sequenceStep('root', (s) => {
          s.tool('step-1', 'page_navigate', {
            input: { url: 'https://example.com' },
          });
          s.tool('step-2', 'page_click');
        });
      }),
    );

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
    const workflow = defineWorkflow('wf-retry', 'Retry Workflow', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('retry-step', 'page_click', {
            retry: { maxAttempts: 2, backoffMs: 50, multiplier: 1 },
          });
        }),
      ),
    );

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
    const workflow = defineWorkflow('wf-parallel', 'Parallel Workflow', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.parallel('parallel', (p) => {
            p.failFast(false);
            p.tool('good-step', 'good_tool');
            p.tool('bad-step', 'bad_tool');
          });
        }),
      ),
    );

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
    const workflow = defineWorkflow('wf-branch', 'Branch Workflow', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('step-1', 'page_navigate');
          s.step(
            branchStep('branch-fn', 'always_false', (b) => {
              b.predicateFn(() => true);
              b.whenTrue(sequenceStep('true-branch', (seq) => seq.tool('step-2', 'page_click')));
              b.whenFalse(sequenceStep('false-branch', (seq) => seq.tool('step-3', 'debug_pause')));
            }),
          );
          s.step(
            branchStep('branch-built-in', 'always_false', (b) => {
              b.whenTrue(sequenceStep('unused', (seq) => seq.tool('step-4', 'page_type')));
              b.whenFalse(sequenceStep('used', (seq) => seq.tool('step-5', 'debug_pause')));
            }),
          );
        }),
      ),
    );

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
      const workflow = defineWorkflow('wf-timeout', 'Timeout Workflow', (w) =>
        w
          .timeoutMs(25)
          .buildGraph(() =>
            sequenceStep('root', (s) => {
              s.tool('slow-step', 'slow_tool');
            }),
          )
          .onError(onError),
      );

      const promise = executeExtensionWorkflow(ctx as never, workflow);
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
    const workflow = defineWorkflow('wf', 'wf', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('step-1', 'tool_1');
          s.tool('step-2', 'tool_2', {
            inputFrom: { injectA: 'step-1.result_field', injectB: 'step-1' },
          });
          s.tool('step-3', 'tool_3', {
            inputFrom: { injectC: 'non_existent.field' },
          });
        }),
      ),
    );

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
    const workflow = defineWorkflow('wf', 'wf', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.parallel('par', (p) => {
            p.tool('t1', 't');
            p.tool('t2', 't');
            p.tool('t3', 't');
            p.tool('t4', 't');
            p.tool('t5', 't');
            p.tool('t6', 't');
          });
          s.step(branchStep('br', 'any_step_failed', (b) => b.whenTrue(toolStep('t7', 't'))));
          s.step(
            branchStep('br2', 'success_rate_gte_50', (b) => {
              b.whenTrue(toolStep('t9', 't'));
              b.whenFalse(toolStep('t8', 't'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t7');
    expect(result.stepResults).not.toHaveProperty('t8');
  });

  it('exhausts tool node retries and fails the workflow with tool error', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const executeToolWithTracking = vi.fn().mockRejectedValue(new Error('retry error'));
      const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
      const workflow = defineWorkflow('w', 'w', (w) =>
        w.buildGraph(() => toolStep('t', 't', { retry: { maxAttempts: 2, backoffMs: 1 } })),
      );

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
      const workflow = defineWorkflow('w', 'w', (w) =>
        w.buildGraph(() => toolStep('t', 't', { retry: { maxAttempts: 0, backoffMs: 1 } })),
      );

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
    const workflow = defineWorkflow('w', 'w', (w) =>
      w.buildGraph(() =>
        parallelStep('p', (p) => {
          p.failFast(false);
          p.tool('t1', 't1');
          p.tool('t3', 't3');
        }),
      ),
    );
    const res = await executeExtensionWorkflow(ctx as never, workflow);
    expect((res.stepResults.p as any)[0].error).toBe('boom');
    expect((res.stepResults.p as any)[1].error).toBe('string error');

    const wf2 = defineWorkflow('w2', 'w2', (w) =>
      w.buildGraph(() =>
        parallelStep('p', (p) => {
          p.failFast(true);
          p.tool('t1', 't1');
          p.tool('t2', 't2');
        }),
      ),
    );
    await expect(executeExtensionWorkflow(ctx as never, wf2)).rejects.toThrow('boom');
  });

  it('throws on unsupported node kind', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking: vi.fn() };
    const workflow = defineWorkflow('w', 'w', (w) =>
      w.buildGraph(() => ({ kind: 'unknown', id: 'u' }) as any),
    );
    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Unsupported workflow node kind: unknown',
    );
  });

  it('workflow finishes successfully before timeout', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi.fn().mockResolvedValueOnce(successResponse({}));
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const w = defineWorkflow('w', 'w', (wf) =>
      wf.timeoutMs(1000).buildGraph(() => toolStep('t', 't')),
    );
    await expect(executeExtensionWorkflow(ctx as never, w)).resolves.toMatchObject({
      result: expect.anything(),
    });
  });

  it('workflow natively rejects before timeout', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeToolWithTracking = vi.fn().mockRejectedValueOnce(new Error('native error'));
    const ctx = { baseTier: 'workflow', config: {}, executeToolWithTracking };
    const w = defineWorkflow('w', 'w', (wf) =>
      wf.timeoutMs(1000).buildGraph(() => toolStep('t', 't')),
    );
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
    const workflow = defineWorkflow('wf-var-equals', 'Variable Equals Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('check-auth', 'check_auth');
          s.step(
            branchStep('branch-auth', 'variable_equals_check-auth.status_authenticated', (b) => {
              b.whenTrue(sequenceStep('auth-route', (seq) => seq.tool('auth-action', 'auth_tool')));
              b.whenFalse(
                sequenceStep('guest-route', (seq) => seq.tool('guest-action', 'guest_tool')),
              );
            }),
          );
        }),
      ),
    );

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
    const workflow = defineWorkflow('wf-var-contains', 'Variable Contains Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('scan-endpoints', 'scan');
          s.step(
            branchStep('branch-api', 'variable_contains_scan-endpoints.endpoints_/api/', (b) => {
              b.whenTrue(sequenceStep('api-found', (seq) => seq.tool('process-api', 'process')));
              b.whenFalse(sequenceStep('no-api', (seq) => seq.tool('skip', 'skip_tool')));
            }),
          );
        }),
      ),
    );

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
    const workflow = defineWorkflow('wf-var-matches', 'Variable Matches Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('get-token', 'get_token');
          s.step(
            branchStep(
              'branch-jwt',
              'variable_matches_get-token.token_^eyJ[A-Za-z0-9]+\\.',
              (b) => {
                b.whenTrue(sequenceStep('jwt-detected', (seq) => seq.tool('decode-jwt', 'decode')));
                b.whenFalse(sequenceStep('not-jwt', (seq) => seq.tool('handle-other', 'handle')));
              },
            ),
          );
        }),
      ),
    );

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
    const workflow = defineWorkflow('wf-deep', 'Deep Equality Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('get-user', 'get_user');
          s.step(
            branchStep('branch-user', 'variable_equals_get-user.user.name_test', (b) => {
              b.whenTrue(sequenceStep('user-match', (seq) => seq.tool('verify', 'verify_tool')));
              b.whenFalse(
                sequenceStep('user-no-match', (seq) => seq.tool('reject', 'reject_tool')),
              );
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('user-match');
  });
});

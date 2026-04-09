import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  branchStep,
  defineWorkflow,
  sequenceStep,
  toolStep,
} from '@server/workflows/WorkflowContract';

const state = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'run-additional'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: state.randomUUID,
}));

function successResponse(payload: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }) }],
  };
}

function failureResponse(error = 'fail') {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }],
  };
}

function mcpErrorResponse(text = 'MCP error') {
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}

function mockCtx(overrides: Record<string, unknown> = {}) {
  return {
    baseTier: 'workflow',
    config: {},
    executeToolWithTracking: vi.fn(async () => successResponse()),
    ...overrides,
  };
}

describe('WorkflowEngine additional coverage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('getConfig returns fallback for non-object config', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let configResult: any;
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph((ctx) => {
        configResult = ctx.getConfig('some.deep.path', 'default-val');
        return sequenceStep('root');
      }),
    );

    await executeExtensionWorkflow(mockCtx({ config: null }) as never, workflow);
    expect(configResult).toBe('default-val');
  });

  it('getConfig returns fallback for missing nested segment', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let configResult: any;
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph((ctx) => {
        configResult = ctx.getConfig('a.b.c', 42);
        return sequenceStep('root');
      }),
    );

    await executeExtensionWorkflow(mockCtx({ config: { a: { x: 1 } } }) as never, workflow);
    expect(configResult).toBe(42);
  });

  it('getConfig traverses primitive intermediate segment', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let configResult: any;
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph((ctx) => {
        configResult = ctx.getConfig('a.b', 'fallback');
        return sequenceStep('root');
      }),
    );

    await executeExtensionWorkflow(
      mockCtx({ config: { a: 'string-not-object' } }) as never,
      workflow,
    );
    expect(configResult).toBe('fallback');
  });

  it('detects MCP isError response and throws during tool execution', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => mcpErrorResponse('tool crashed')),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t1', 'broken_tool'))),
    );

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Tool returned MCP error response',
    );
  });

  it('detects success=false without error string and throws generic message', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ success: false }) }],
      })),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t1', 'bad_tool'))),
    );

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Tool reported success=false',
    );
  });

  it('handles non-object response gracefully (no crash)', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => 'just a string'),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t1', 'tool'))),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults['t1']).toBe('just a string');
  });

  it('handles response with no text content', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'image', data: 'binary' }],
      })),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t1', 'tool'))),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t1');
  });

  it('handles response with non-JSON text', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: 'not-json' }],
      })),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t1', 'tool'))),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t1');
  });

  it('handles response with JSON primitive (not object)', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: '"just a string"' }],
      })),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t1', 'tool'))),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t1');
  });

  it('always_true predicate routes to whenTrue', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.step(
            branchStep('br', 'always_true', (b) => {
              b.whenTrue(toolStep('yes', 'tool'));
              b.whenFalse(toolStep('no', 'tool'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('yes');
    expect(result.stepResults).not.toHaveProperty('no');
  });

  it('any_step_failed predicate detects failure in prior steps', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let callCount = 0;
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return failureResponse('step failed');
        return successResponse();
      }),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.parallel('par', (p) => {
            p.failFast(false);
            p.tool('may-fail', 'tool');
          });
          s.step(
            branchStep('br', 'any_step_failed', (b) => {
              b.whenTrue(toolStep('recovery', 'recover_tool'));
              b.whenFalse(toolStep('continue', 'next_tool'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('recovery');
  });

  it('success_rate_gte_N predicate evaluates correctly', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let callCount = 0;
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        callCount++;
        if (callCount === 2) return failureResponse('one fails');
        return successResponse();
      }),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.parallel('par', (p) => {
            p.failFast(false);
            p.tool('t1', 'tool');
            p.tool('t2', 'tool');
            p.tool('t3', 'tool');
            p.tool('t4', 'tool');
          });
          s.step(
            branchStep('br', 'success_rate_gte_50', (b) => {
              b.whenTrue(toolStep('above', 'tool'));
              b.whenFalse(toolStep('below', 'tool'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('above');
  });

  it('success_rate_gte predicate returns false when no steps exist', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.step(
            branchStep('br', 'success_rate_gte_50', (b) => {
              b.whenTrue(toolStep('above', 'tool'));
              b.whenFalse(toolStep('below', 'tool'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('below');
  });

  it('unknown predicate throws error', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.step(
            branchStep('br', 'unknown_predicate', (b) => {
              b.whenTrue(toolStep('t', 'tool'));
            }),
          );
        }),
      ),
    );

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Unknown workflow predicateId "unknown_predicate"',
    );
  });

  it('branch with false predicate and no whenFalse returns undefined', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.step(
            branchStep('br', 'always_false', (b) => {
              b.whenTrue(toolStep('t', 'tool'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults['br']).toBeUndefined();
  });

  it('parallel failFast stops on first error', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async (name: string) => {
        if (name === 'slow_fail') {
          throw new Error('hard crash');
        }
        return successResponse();
      }),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.parallel('par', (p) => {
            p.failFast(true);
            p.maxConcurrency(1);
            p.tool('ok', 'good_tool');
            p.tool('crash', 'slow_fail');
            p.tool('never', 'good_tool');
          });
        }),
      ),
    );

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('hard crash');
  });

  it('exhausted retries throw the last error', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = mockCtx({
        executeToolWithTracking: vi.fn(async () => failureResponse('always fails')),
      });
      const workflow = defineWorkflow('wf', 'Test', (w) =>
        w.buildGraph(() =>
          sequenceStep('root', (s) => {
            s.tool('t', 'tool', {
              retry: { maxAttempts: 2, backoffMs: 10, multiplier: 2 },
            });
          }),
        ),
      );

      const promise = executeExtensionWorkflow(ctx as never, workflow).catch((e: any) => e);
      await vi.advanceTimersByTimeAsync(100);
      const err = await promise;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('always fails');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tool node timeout triggers error', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = mockCtx({
        executeToolWithTracking: vi.fn(() => new Promise(() => undefined)),
      });
      const workflow = defineWorkflow('wf', 'Test', (w) =>
        w.buildGraph(() =>
          sequenceStep('root', (s) => {
            s.tool('t', 'tool', { timeoutMs: 50 });
          }),
        ),
      );

      const promise = executeExtensionWorkflow(ctx as never, workflow).catch((e: any) => e);
      await vi.advanceTimersByTimeAsync(60);
      const err = await promise;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('timed out after 50ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('onStart and onFinish are called in order', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const calls: string[] = [];
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w
        .buildGraph(() => sequenceStep('root', (s) => s.tool('t', 'tool')))
        .onStart(() => {
          calls.push('start');
        })
        .onFinish(() => {
          calls.push('finish');
        }),
    );

    await executeExtensionWorkflow(ctx as never, workflow);
    expect(calls).toEqual(['start', 'finish']);
  });

  it('onError called when workflow throws, and error is re-thrown', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const onError = vi.fn();
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t', 'tool'))).onError(onError),
    );

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('boom');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: 'run-additional' }),
      expect.objectContaining({ message: 'boom' }),
    );
  });

  it('wraps non-Error throws into Error', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw 'string error';
      }),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() => sequenceStep('root', (s) => s.tool('t', 'tool'))),
    );

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('string error');
  });

  it('executionContext.invokeTool delegates to ctx.executeToolWithTracking', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeFn = vi.fn(async () => successResponse());
    const ctx = mockCtx({ executeToolWithTracking: executeFn });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph((execCtx) => {
        void execCtx.invokeTool('test_tool', { arg: 1 });
        return sequenceStep('root');
      }),
    );

    await executeExtensionWorkflow(ctx as never, workflow);
    expect(executeFn).toHaveBeenCalledWith('test_tool', { arg: 1 });
  });

  it('emitMetric records metrics during execution', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph((execCtx) => {
        execCtx.emitMetric('my.counter', 1, 'counter', { tag: 'test' });
        return sequenceStep('root');
      }),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.metrics).toContainEqual(
      expect.objectContaining({ name: 'my.counter', value: 1, type: 'counter' }),
    );
  });

  it('defaults profile to baseTier when not specified', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({ baseTier: 'full' });
    const workflow = defineWorkflow('wf', 'Test', (w) => w.buildGraph(() => sequenceStep('root')));

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.profile).toBe('full');
  });

  it('uses explicit profile over baseTier', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({ baseTier: 'full' });
    const workflow = defineWorkflow('wf', 'Test', (w) => w.buildGraph(() => sequenceStep('root')));

    const result = await executeExtensionWorkflow(ctx as never, workflow, { profile: 'custom' });
    expect(result.profile).toBe('custom');
  });

  it('non-finite timeout passes promise through without wrapping', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.timeoutMs(0).buildGraph(() => sequenceStep('root', (s) => s.tool('t', 'tool'))),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t');
  });

  it('error key in response triggers failure count in any_step_failed', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => ({ error: 'something went wrong' })),
    });
    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w.buildGraph(() =>
        sequenceStep('root', (s) => {
          s.tool('errored', 'tool');
          s.step(
            branchStep('br', 'any_step_failed', (b) => {
              b.whenTrue(toolStep('detected', 'tool'));
            }),
          );
        }),
      ),
    );

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('detected');
  });
});

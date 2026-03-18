import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkflow,
  ParallelNodeBuilder,
  SequenceNodeBuilder,
  ToolNodeBuilder,
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

  // --- extractConfigValue edge cases ---

  it('getConfig returns fallback for non-object config', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let configResult: unknown;
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph((ctx) => {
        configResult = ctx.getConfig('some.deep.path', 'default-val');
        return new SequenceNodeBuilder('root');
      })
      .build();

    await executeExtensionWorkflow(mockCtx({ config: null }) as never, workflow);
    expect(configResult).toBe('default-val');
  });

  it('getConfig returns fallback for missing nested segment', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let configResult: unknown;
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph((ctx) => {
        configResult = ctx.getConfig('a.b.c', 42);
        return new SequenceNodeBuilder('root');
      })
      .build();

    await executeExtensionWorkflow(mockCtx({ config: { a: { x: 1 } } }) as never, workflow);
    expect(configResult).toBe(42);
  });

  it('getConfig traverses primitive intermediate segment', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let configResult: unknown;
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph((ctx) => {
        configResult = ctx.getConfig('a.b', 'fallback');
        return new SequenceNodeBuilder('root');
      })
      .build();

    await executeExtensionWorkflow(
      mockCtx({ config: { a: 'string-not-object' } }) as never,
      workflow
    );
    expect(configResult).toBe('fallback');
  });

  // --- responseIndicatesFailure paths ---

  it('detects MCP isError response and throws during tool execution', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => mcpErrorResponse('tool crashed')),
    });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t1', 'broken_tool'))
      .build();

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Tool returned MCP error response'
    );
  });

  it('detects success=false without error string and throws generic message', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ success: false }) }],
      })),
    });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t1', 'bad_tool'))
      .build();

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Tool reported success=false'
    );
  });

  // --- parseToolPayload edge cases ---

  it('handles non-object response gracefully (no crash)', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => 'just a string'),
    });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t1', 'tool'))
      .build();

    // String response doesn't trigger failure detection, passes through
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
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t1', 'tool'))
      .build();

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
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t1', 'tool'))
      .build();

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
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t1', 'tool'))
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t1');
  });

  // --- branch predicate coverage ---

  it('always_true predicate routes to whenTrue', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').branch('br', 'always_true', (b) => {
          b.whenTrue(new ToolNodeBuilder('yes', 'tool'));
          b.whenFalse(new ToolNodeBuilder('no', 'tool'));
        })
      )
      .build();

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
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root')
          .parallel('par', (b: ParallelNodeBuilder) => {
            b.failFast(false);
            b.tool('may-fail', 'tool');
          })
          .branch('br', 'any_step_failed', (b) => {
            b.whenTrue(new ToolNodeBuilder('recovery', 'recover_tool'));
            b.whenFalse(new ToolNodeBuilder('continue', 'next_tool'));
          })
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('recovery');
  });

  it('success_rate_gte_N predicate evaluates correctly', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    let callCount = 0;
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        callCount++;
        // 3 out of 4 succeed = 75% success rate
        if (callCount === 2) return failureResponse('one fails');
        return successResponse();
      }),
    });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root')
          .parallel('par', (b: ParallelNodeBuilder) => {
            b.failFast(false);
            b.tool('t1', 'tool');
            b.tool('t2', 'tool');
            b.tool('t3', 'tool');
            b.tool('t4', 'tool');
          })
          .branch('br', 'success_rate_gte_50', (b) => {
            b.whenTrue(new ToolNodeBuilder('above', 'tool'));
            b.whenFalse(new ToolNodeBuilder('below', 'tool'));
          })
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('above');
  });

  it('success_rate_gte predicate returns false when no steps exist', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').branch('br', 'success_rate_gte_50', (b) => {
          b.whenTrue(new ToolNodeBuilder('above', 'tool'));
          b.whenFalse(new ToolNodeBuilder('below', 'tool'));
        })
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    // No prior steps → total=0 → returns false
    expect(result.stepResults).toHaveProperty('below');
  });

  it('unknown predicate throws error', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').branch('br', 'unknown_predicate', (b) => {
          b.whenTrue(new ToolNodeBuilder('t', 'tool'));
        })
      )
      .build();

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow(
      'Unknown workflow predicateId "unknown_predicate"'
    );
  });

  it('branch with false predicate and no whenFalse returns undefined', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').branch('br', 'always_false', (b) => {
          b.whenTrue(new ToolNodeBuilder('t', 'tool'));
          // No whenFalse
        })
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults['br']).toBeUndefined();
  });

  // --- parallel failFast ---

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
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root').parallel('par', (b: ParallelNodeBuilder) => {
          b.failFast(true);
          b.maxConcurrency(1); // Force sequential to guarantee ordering
          b.tool('ok', 'good_tool');
          b.tool('crash', 'slow_fail');
          b.tool('never', 'good_tool');
        })
      )
      .build();

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('hard crash');
  });

  // --- retry exhaustion ---

  it('exhausted retries throw the last error', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = mockCtx({
        executeToolWithTracking: vi.fn(async () => failureResponse('always fails')),
      });
      const workflow = createWorkflow('wf', 'Test')
        .buildGraph(() =>
          new SequenceNodeBuilder('root').tool('t', 'tool', (b) =>
            b.retry({ maxAttempts: 2, backoffMs: 10, multiplier: 2 })
          )
        )
        .build();

      const promise = executeExtensionWorkflow(ctx as never, workflow).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(100);
      const err = await promise;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('always fails');
    } finally {
      vi.useRealTimers();
    }
  });

  // --- tool node timeout ---

  it('tool node timeout triggers error', async () => {
    vi.useFakeTimers();
    try {
      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      const ctx = mockCtx({
        executeToolWithTracking: vi.fn(() => new Promise(() => undefined)),
      });
      const workflow = createWorkflow('wf', 'Test')
        .buildGraph(() => new SequenceNodeBuilder('root').tool('t', 'tool', (b) => b.timeout(50)))
        .build();

      const promise = executeExtensionWorkflow(ctx as never, workflow).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(60);
      const err = await promise;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('timed out after 50ms');
    } finally {
      vi.useRealTimers();
    }
  });

  // --- lifecycle callbacks ---

  it('onStart and onFinish are called in order', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const calls: string[] = [];
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t', 'tool'))
      .onStart(() => {
        calls.push('start');
      })
      .onFinish(() => {
        calls.push('finish');
      })
      .build();

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
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t', 'tool'))
      .onError(onError)
      .build();

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('boom');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: 'run-additional' }),
      expect.objectContaining({ message: 'boom' })
    );
  });

  it('wraps non-Error throws into Error', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      }),
    });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t', 'tool'))
      .build();

    await expect(executeExtensionWorkflow(ctx as never, workflow)).rejects.toThrow('string error');
  });

  // --- invokeTool on executionContext ---

  it('executionContext.invokeTool delegates to ctx.executeToolWithTracking', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const executeFn = vi.fn(async () => successResponse());
    const ctx = mockCtx({ executeToolWithTracking: executeFn });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph((execCtx) => {
        // Call invokeTool during build for coverage
        void execCtx.invokeTool('test_tool', { arg: 1 });
        return new SequenceNodeBuilder('root');
      })
      .build();

    await executeExtensionWorkflow(ctx as never, workflow);
    expect(executeFn).toHaveBeenCalledWith('test_tool', { arg: 1 });
  });

  // --- emitMetric on executionContext ---

  it('emitMetric records metrics during execution', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph((execCtx) => {
        execCtx.emitMetric('my.counter', 1, 'counter', { tag: 'test' });
        return new SequenceNodeBuilder('root');
      })
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.metrics).toContainEqual(
      expect.objectContaining({ name: 'my.counter', value: 1, type: 'counter' })
    );
  });

  // --- profile defaults to baseTier ---

  it('defaults profile to baseTier when not specified', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({ baseTier: 'full' });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root'))
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.profile).toBe('full');
  });

  it('uses explicit profile over baseTier', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({ baseTier: 'full' });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root'))
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow, { profile: 'custom' });
    expect(result.profile).toBe('custom');
  });

  // --- withTimeout non-finite timeout passes through ---

  it('non-finite timeout passes promise through without wrapping', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx();
    const workflow = createWorkflow('wf', 'Test')
      .timeoutMs(0) // zero = no timeout
      .buildGraph(() => new SequenceNodeBuilder('root').tool('t', 'tool'))
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('t');
  });

  // --- collectSuccessStats coverage ---

  it('error key in response triggers failure count in any_step_failed', async () => {
    const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
    const ctx = mockCtx({
      executeToolWithTracking: vi.fn(async () => {
        // Return response that has an 'error' key but isn't standard format
        return { error: 'something went wrong' };
      }),
    });
    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() =>
        new SequenceNodeBuilder('root')
          .tool('errored', 'tool')
          .branch('br', 'any_step_failed', (b) => {
            b.whenTrue(new ToolNodeBuilder('detected', 'tool'));
          })
      )
      .build();

    const result = await executeExtensionWorkflow(ctx as never, workflow);
    expect(result.stepResults).toHaveProperty('detected');
  });
});

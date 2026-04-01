import { describe, expect, it, vi } from 'vitest';

import batchRegisterWorkflow from '@server/workflows/examples/batch-register.workflow';

describe('workflows/examples/batch-register.workflow', () => {
  it('exposes the expected workflow metadata and graph', () => {
    const emitMetric = vi.fn();
    const buildContext = {
      getConfig: vi.fn((key: string, fallback: number) =>
        key === 'workflows.batchRegister.maxConcurrency' ? 5 : fallback,
      ),
      emitMetric,
    };

    expect(batchRegisterWorkflow.id).toBe('workflow.batch-register.v1');
    expect(batchRegisterWorkflow.displayName).toBe('Batch Register Accounts');
    expect(batchRegisterWorkflow.tags).toEqual(
      expect.arrayContaining(['workflow', 'registration', 'batch', 'automation']),
    );
    expect(batchRegisterWorkflow.timeoutMs).toBe(15 * 60_000);
    expect(batchRegisterWorkflow.defaultMaxConcurrency).toBe(3);

    const graph = batchRegisterWorkflow.build(buildContext as never);
    expect(buildContext.getConfig).toHaveBeenCalledWith(
      'workflows.batchRegister.maxConcurrency',
      3,
    );

    expect(graph.kind).toBe('sequence');
    expect(graph.steps).toHaveLength(3);
    expect(graph.steps[0]).toMatchObject({
      kind: 'tool',
      id: 'precheck',
      toolName: 'web_api_capture_session',
      input: {
        url: 'about:blank',
        exportHar: false,
        exportReport: false,
      },
    });

    expect(graph.steps[1]).toMatchObject({
      kind: 'parallel',
      id: 'register-parallel',
      maxConcurrency: 5,
      failFast: false,
    });

    const parallelStep = graph.steps[1] as Extract<
      (typeof graph.steps)[number],
      { kind: 'parallel' }
    >;
    expect(parallelStep.steps).toHaveLength(2);
    expect(parallelStep.steps[0]).toMatchObject({
      id: 'register-account-1',
      toolName: 'register_account_flow',
    });
    expect(parallelStep.steps[1]).toMatchObject({
      id: 'register-account-2',
      toolName: 'register_account_flow',
    });

    const branchStep = graph.steps[2] as Extract<(typeof graph.steps)[number], { kind: 'branch' }>;
    expect(branchStep.predicateId).toBe('batch_success_rate_gte_80');
    expect(branchStep.predicateFn?.(buildContext as never)).toBe(true);
    expect(branchStep.whenTrue).toMatchObject({
      kind: 'tool',
      id: 'success-summary',
      toolName: 'console_execute',
    });
    expect(branchStep.whenFalse).toMatchObject({
      kind: 'tool',
      id: 'failure-summary',
      toolName: 'console_execute',
    });
  });

  it('emits lifecycle metrics with expected payloads', () => {
    const emitMetric = vi.fn();
    const ctx = { emitMetric };
    const error = new Error('boom');

    batchRegisterWorkflow.onStart?.(ctx as never);
    batchRegisterWorkflow.onFinish?.(ctx as never, null);
    batchRegisterWorkflow.onError?.(ctx as never, error);

    expect(emitMetric).toHaveBeenNthCalledWith(1, 'workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      stage: 'start',
    });
    expect(emitMetric).toHaveBeenNthCalledWith(2, 'workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      stage: 'finish',
    });
    expect(emitMetric).toHaveBeenNthCalledWith(3, 'workflow_errors_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      error: 'Error',
    });
  });
});

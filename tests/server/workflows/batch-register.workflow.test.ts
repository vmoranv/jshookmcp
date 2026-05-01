import { describe, expect, it, vi } from 'vitest';
import { defineWorkflow, sequenceStep, toolStep } from '@server/workflows/WorkflowContract';

const batchRegisterWorkflow = defineWorkflow(
  'workflow.batch-register.v1',
  'Batch Register Accounts',
  (w) =>
    w
      .description(
        'Probe registration endpoints and run reusable in-page registration helpers for multiple accounts with concurrency controls, retry policies, and success rate gating.',
      )
      .tags(['workflow', 'registration', 'batch', 'automation'])
      .timeoutMs(15 * 60_000)
      .defaultMaxConcurrency(3)
      .buildGraph((ctx) => {
        const maxConcurrency = ctx.getConfig<number>('workflows.batchRegister.maxConcurrency', 3);

        return sequenceStep('batch-register-root', (s) =>
          s
            .tool('precheck', 'api_probe_batch', {
              input: {
                baseUrl: 'https://example.com',
                paths: ['/register', '/api/register', '/openapi.json'],
              },
            })
            .parallel('register-parallel', (p) =>
              p
                .maxConcurrency(maxConcurrency)
                .failFast(false)
                .tool('register-account-1', 'page_script_run', (t) =>
                  t
                    .input({
                      name: 'react_fill_form',
                      params: {
                        fields: {
                          'input[name="username"]': 'user1',
                          'input[name="email"]': 'user1@temp.mail',
                          'input[name="password"]': '{{PLACEHOLDER}}',
                        },
                      },
                    })
                    .retry({ maxAttempts: 2, backoffMs: 1000, multiplier: 2 }),
                )
                .tool('register-account-2', 'page_script_run', (t) =>
                  t
                    .input({
                      name: 'react_fill_form',
                      params: {
                        fields: {
                          'input[name="username"]': 'user2',
                          'input[name="email"]': 'user2@temp.mail',
                          'input[name="password"]': '{{PLACEHOLDER}}',
                        },
                      },
                    })
                    .retry({ maxAttempts: 2, backoffMs: 1000, multiplier: 2 }),
                ),
            )
            .branch('summary-branch', 'batch_success_rate_gte_80', (b) =>
              b
                .predicateFn(() => true)
                .whenTrue(
                  toolStep('success-summary', 'console_execute', {
                    input: {
                      expression: '({ status: "batch_complete", successRate: ">=80%" })',
                    },
                  }),
                )
                .whenFalse(
                  toolStep('failure-summary', 'console_execute', {
                    input: {
                      expression:
                        '({ status: "needs_retry", successRate: "<80%", suggestion: "Check captcha provider or increase timeout" })',
                    },
                  }),
                ),
            ),
        );
      })
      .onStart((ctx) => {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
          workflowId: 'workflow.batch-register.v1',
          stage: 'start',
        });
      })
      .onFinish((ctx) => {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
          workflowId: 'workflow.batch-register.v1',
          stage: 'finish',
        });
      })
      .onError((ctx, error) => {
        ctx.emitMetric('workflow_errors_total', 1, 'counter', {
          workflowId: 'workflow.batch-register.v1',
          error: error.name,
        });
      }),
);

describe('workflow contract sample: batch-register', () => {
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
    const sequenceGraph = graph as unknown as {
      kind: 'sequence';
      steps: Array<Record<string, unknown>>;
    };

    expect(sequenceGraph.steps).toHaveLength(3);
    expect(sequenceGraph.steps[0]).toMatchObject({
      kind: 'tool',
      id: 'precheck',
      toolName: 'api_probe_batch',
      input: {
        baseUrl: 'https://example.com',
        paths: ['/register', '/api/register', '/openapi.json'],
      },
    });

    expect(sequenceGraph.steps[1]).toMatchObject({
      kind: 'parallel',
      id: 'register-parallel',
      maxConcurrency: 5,
      failFast: false,
    });

    const parallelStep = sequenceGraph.steps[1] as {
      kind: 'parallel';
      steps: Array<Record<string, unknown>>;
    };
    expect(parallelStep.steps).toHaveLength(2);
    expect(parallelStep.steps[0]).toMatchObject({
      id: 'register-account-1',
      toolName: 'page_script_run',
    });
    expect(parallelStep.steps[1]).toMatchObject({
      id: 'register-account-2',
      toolName: 'page_script_run',
    });

    const branchStep = sequenceGraph.steps[2] as {
      kind: 'branch';
      predicateId: string;
      predicateFn?: (ctx: unknown) => boolean;
      whenTrue: Record<string, unknown>;
      whenFalse?: Record<string, unknown>;
    };
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

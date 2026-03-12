/**
 * Example workflow: Batch Account Registration.
 * Demonstrates SequenceNode, ToolNode, ParallelNode, and BranchNode.
 * Declarative — executed by a WorkflowEngine.
 */
import {
  createWorkflow,
  ToolNodeBuilder,
  SequenceNodeBuilder,
} from '@server/workflows/WorkflowContract';

const batchRegisterWorkflow = createWorkflow('workflow.batch-register.v1', 'Batch Register Accounts')
  .description(
    'Run register_account_flow for multiple accounts with concurrency controls, ' +
    'retry policies, and success rate gating.'
  )
  .tags(['workflow', 'registration', 'batch', 'automation'])
  .timeoutMs(15 * 60_000)
  .defaultMaxConcurrency(3)
  .buildGraph((ctx) => {
    const maxConcurrency = ctx.getConfig<number>(
      'workflows.batchRegister.maxConcurrency',
      3
    );

    return new SequenceNodeBuilder('batch-register-root')
      .tool('precheck', 'web_api_capture_session', t => t
        .input({
          url: 'about:blank',
          exportHar: false,
          exportReport: false,
        })
      )
      .parallel('register-parallel', p => p
        .maxConcurrency(maxConcurrency)
        .failFast(false)
        .tool('register-account-1', 'register_account_flow', t => t
          .input({
            registerUrl: 'https://example.com/register',
            fields: { username: 'user1', email: 'user1@temp.mail', password: '{{PLACEHOLDER}}' },
          })
          .retry({ maxAttempts: 2, backoffMs: 1000, multiplier: 2 })
        )
        .tool('register-account-2', 'register_account_flow', t => t
          .input({
            registerUrl: 'https://example.com/register',
            fields: { username: 'user2', email: 'user2@temp.mail', password: '{{PLACEHOLDER}}' },
          })
          .retry({ maxAttempts: 2, backoffMs: 1000, multiplier: 2 })
        )
      )
      .branch('summary-branch', 'batch_success_rate_gte_80', b => b
        .predicateFn((_ctx) => true)
        .whenTrue(
          new ToolNodeBuilder('success-summary', 'console_execute')
            .input({ expression: '({ status: "batch_complete", successRate: ">=80%" })' })
        )
        .whenFalse(
          new ToolNodeBuilder('failure-summary', 'console_execute')
            .input({ expression: '({ status: "needs_retry", successRate: "<80%", suggestion: "Check captcha provider or increase timeout" })' })
        )
      );
  })
  .onStart(ctx => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      stage: 'start',
    });
  })
  .onFinish(ctx => {
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
  })
  .build();

export default batchRegisterWorkflow;

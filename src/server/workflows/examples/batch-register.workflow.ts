/**
 * Example workflow: Batch Account Registration.
 * Demonstrates SequenceNode, ToolNode, ParallelNode, and BranchNode.
 * Declarative — executed by a WorkflowEngine.
 */
import type { WorkflowContract } from '../WorkflowContract.js';
import {
  branchNode,
  parallelNode,
  sequenceNode,
  toolNode,
} from '../WorkflowContract.js';

const batchRegisterWorkflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'workflow.batch-register.v1',
  displayName: 'Batch Register Accounts',
  description:
    'Run register_account_flow for multiple accounts with concurrency controls, ' +
    'retry policies, and success rate gating.',
  tags: ['workflow', 'registration', 'batch', 'automation'],
  timeoutMs: 15 * 60_000,
  defaultMaxConcurrency: 3,

  build(ctx) {
    const maxConcurrency = ctx.getConfig<number>(
      'workflows.batchRegister.maxConcurrency',
      3,
    );

    // Pre-flight: verify browser and page are ready
    const precheck = toolNode('precheck', 'web_api_capture_session', {
      input: {
        url: 'about:blank',
        exportHar: false,
        exportReport: false,
      },
    });

    // Parallel registration with per-account retry policy
    const registerSteps = parallelNode(
      'register-parallel',
      [
        toolNode(
          'register-account-1',
          'register_account_flow',
          {
            input: {
              registerUrl: 'https://example.com/register',
              fields: { username: 'user1', email: 'user1@temp.mail', password: '{{PLACEHOLDER}}' },
            },
            retry: { maxAttempts: 2, backoffMs: 1000, multiplier: 2 },
          },
        ),
        toolNode(
          'register-account-2',
          'register_account_flow',
          {
            input: {
              registerUrl: 'https://example.com/register',
              fields: { username: 'user2', email: 'user2@temp.mail', password: '{{PLACEHOLDER}}' },
            },
            retry: { maxAttempts: 2, backoffMs: 1000, multiplier: 2 },
          },
        ),
      ],
      maxConcurrency,
      false, // don't fail fast — let all accounts attempt
    );

    // Branch on success rate; predicateFn is type-safe fallback for predicateId
    const summarize = branchNode(
      'summary-branch',
      'batch_success_rate_gte_80',
      toolNode('success-summary', 'console_execute', {
        input: { expression: '({ status: "batch_complete", successRate: ">=80%" })' },
      }),
      toolNode('failure-summary', 'console_execute', {
        input: { expression: '({ status: "needs_retry", successRate: "<80%", suggestion: "Check captcha provider or increase timeout" })' },
      }),
      // Placeholder — real engine resolves from step results
      (_ctx) => {
        return true;
      },
    );

    return sequenceNode('batch-register-root', [precheck, registerSteps, summarize]);
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      stage: 'start',
    });
  },

  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      stage: 'finish',
    });
  },

  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', {
      workflowId: 'workflow.batch-register.v1',
      error: error.name,
    });
  },
};

export default batchRegisterWorkflow;

import { randomUUID } from 'node:crypto';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { getRoutingState } from '@server/ToolRouter.probe';
import type { ToolArgs } from '@server/types';
import {
  resolveInputFrom,
  resolveInputValues,
  responseIndicatesFailure,
  WorkflowDataBus,
} from '@server/workflows/WorkflowDataBus';
import { evaluatePredicate } from '@server/workflows/WorkflowPredicates';
import {
  collectUnsatisfiedPrerequisites,
  getEvidenceState,
} from '@server/workflows/WorkflowPreflight';
import { WorkflowRunStore } from '@server/workflows/WorkflowRunStore';
import type {
  BranchNode,
  FallbackNode,
  ParallelNode,
  SequenceNode,
  ToolNode,
  WorkflowContract,
  WorkflowNode,
} from '@server/workflows/WorkflowContract';
import {
  type ExecuteWorkflowOptions,
  type ExecuteWorkflowResult,
  type InternalExecutionContext,
  type JsonRecord,
  type ParallelResult,
  type PreflightWarning,
  type WorkflowMetric,
  type WorkflowSpan,
  PreflightError,
} from '@server/workflows/WorkflowEngine.types';

type WorkflowEngineExecutionContext = InternalExecutionContext<WorkflowDataBus>;

const globalRunStore = new WorkflowRunStore();

export function getWorkflowRunStore(): WorkflowRunStore {
  return globalRunStore;
}

function extractConfigValue<T = unknown>(config: unknown, path: string, fallback?: T): T {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = config;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return fallback as T;
    current = (current as Record<string, unknown>)[segment];
  }
  return (current as T) ?? (fallback as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function runToolNode(
  ctx: MCPServerContext,
  node: ToolNode,
  overrides: ExecuteWorkflowOptions['nodeInputOverrides'],
  executionContext: WorkflowEngineExecutionContext,
): Promise<unknown> {
  const fromResolved = node.inputFrom
    ? resolveInputFrom(node.inputFrom, executionContext.dataBus)
    : {};
  const fromInputValues = node.input
    ? resolveInputValues(node.input, executionContext.dataBus)
    : {};
  const mergedInput: ToolArgs = {
    ...fromInputValues,
    ...fromResolved,
    ...overrides?.[node.id],
  };

  const runAttempt = async (): Promise<unknown> => {
    const response = await withTimeout(
      ctx.executeToolWithTracking(node.toolName, mergedInput),
      node.timeoutMs ?? 0,
      `Workflow tool node "${node.id}"`,
    );
    const failure = responseIndicatesFailure(response);
    if (failure) {
      throw new Error(failure);
    }
    // Store result in dataBus for subsequent nodes to reference
    executionContext.dataBus.set(node.id, response);
    return response;
  };

  const retry = node.retry;
  if (!retry) {
    return runAttempt();
  }

  let attempt = 0;
  let backoffMs = retry.backoffMs;
  while (attempt < retry.maxAttempts) {
    try {
      return await runAttempt();
    } catch (error) {
      attempt += 1;
      if (attempt >= retry.maxAttempts) {
        throw error;
      }
      await sleep(backoffMs);
      backoffMs = Math.max(0, Math.floor(backoffMs * (retry.multiplier ?? 1)));
    }
  }

  throw new Error(`Workflow tool node "${node.id}" exhausted retries`);
}

async function runParallelNode(
  ctx: MCPServerContext,
  node: ParallelNode,
  executionContext: WorkflowEngineExecutionContext,
  options: ExecuteWorkflowOptions,
): Promise<ParallelResult> {
  const concurrency = Math.max(1, node.maxConcurrency ?? 4);
  const keyedResults: ParallelResult = { __order: [] };
  let nextIndex = 0;
  let stopped = false;

  const worker = async () => {
    while (true) {
      if (stopped) return;
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= node.steps.length) return;

      const step = node.steps[currentIndex];
      /* istanbul ignore next */
      if (!step) return;
      try {
        const result = await executeNode(ctx, step, executionContext, options);
        keyedResults[step.id] = result;
        keyedResults.__order.push(step.id);
      } catch (error) {
        if (node.failFast) {
          stopped = true;
          throw error;
        }
        keyedResults[step.id] = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        keyedResults.__order.push(step.id);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, node.steps.length) }, () => worker()),
  );
  return keyedResults;
}

async function executeNode(
  ctx: MCPServerContext,
  node: WorkflowNode,
  executionContext: WorkflowEngineExecutionContext,
  options: ExecuteWorkflowOptions,
): Promise<unknown> {
  executionContext.emitSpan('workflow.node.start', { nodeId: node.id, kind: node.kind });

  let result: unknown;
  switch (node.kind) {
    case 'tool':
      result = await runToolNode(ctx, node, options.nodeInputOverrides, executionContext);
      break;
    case 'sequence': {
      const sequenceNode = node as SequenceNode;
      const items: unknown[] = [];
      for (const step of sequenceNode.steps) {
        items.push(await executeNode(ctx, step, executionContext, options));
      }
      result = items;
      break;
    }
    case 'parallel':
      result = await runParallelNode(ctx, node as ParallelNode, executionContext, options);
      break;
    case 'branch': {
      const branchNode = node as BranchNode;
      const predicate = await evaluatePredicate(branchNode, executionContext);
      const selected = predicate ? branchNode.whenTrue : branchNode.whenFalse;
      if (selected) {
        result = await executeNode(ctx, selected, executionContext, options);
      } else {
        result = undefined;
      }
      break;
    }
    case 'fallback': {
      const fallbackNode = node as FallbackNode;
      try {
        result = await executeNode(ctx, fallbackNode.primary, executionContext, options);
      } catch (error) {
        executionContext.emitSpan('workflow.node.fallback', {
          nodeId: fallbackNode.id,
          primaryNodeId: fallbackNode.primary.id,
          fallbackNodeId: fallbackNode.fallback.id,
          error: error instanceof Error ? error.message : String(error),
        });
        result = await executeNode(ctx, fallbackNode.fallback, executionContext, options);
      }
      break;
    }
    default:
      throw new Error(`Unsupported workflow node kind: ${(node as { kind: string }).kind}`);
  }

  executionContext.stepResults.set(node.id, result);
  executionContext.emitSpan('workflow.node.finish', { nodeId: node.id, kind: node.kind });
  return result;
}

export async function executeExtensionWorkflow(
  ctx: MCPServerContext,
  workflow: WorkflowContract,
  options: ExecuteWorkflowOptions = {},
): Promise<ExecuteWorkflowResult> {
  const runId = randomUUID();
  const profile = options.profile ?? String(ctx.baseTier ?? 'workflow');
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const metrics: WorkflowMetric[] = [];
  const spans: WorkflowSpan[] = [];
  const stepResults = new Map<string, unknown>();
  const dataBus = new WorkflowDataBus();
  const mergedConfig = options.config
    ? { ...(ctx.config as unknown as JsonRecord), ...options.config }
    : ctx.config;

  const executionContext: WorkflowEngineExecutionContext = {
    workflowRunId: runId,
    profile,
    stepResults,
    dataBus,
    invokeTool(toolName: string, args: Record<string, unknown>) {
      return ctx.executeToolWithTracking(toolName, args);
    },
    emitSpan(name, attrs) {
      spans.push({ name, attrs, at: new Date().toISOString() });
    },
    emitMetric(name, value, type, attrs) {
      metrics.push({ name, value, type, attrs, at: new Date().toISOString() });
    },
    getConfig(path, fallback) {
      return extractConfigValue(mergedConfig, path, fallback);
    },
  };

  try {
    await workflow.onStart?.(executionContext);
    const graph = workflow.build(executionContext);

    // ── Preflight Gate ────────────────────────────────────────────
    const preflightMode = options.preflightMode ?? 'warn';
    let preflightWarnings: PreflightWarning[] = [];

    if (preflightMode === 'skip') {
      executionContext.emitSpan('workflow.preflight', {
        mode: preflightMode,
        skipped: true,
        evidenceState: getEvidenceState(ctx),
        warningCount: 0,
      });
    } else {
      try {
        const routingState = await getRoutingState(ctx);
        const evidenceState = getEvidenceState(ctx);
        preflightWarnings = collectUnsatisfiedPrerequisites(graph, routingState);
        executionContext.emitSpan('workflow.preflight', {
          mode: preflightMode,
          routingState,
          evidenceState,
          warningCount: preflightWarnings.length,
          warnings: preflightWarnings,
        });

        if (preflightMode === 'strict' && preflightWarnings.length > 0) {
          throw new PreflightError(preflightWarnings);
        }
      } catch (error) {
        if (error instanceof PreflightError) {
          throw error;
        }
        // Preflight is best-effort — registry may not be initialised in tests
        executionContext.emitSpan('workflow.preflight', {
          mode: preflightMode,
          warningCount: 0,
          skipped: true,
          error: error instanceof Error ? error.message : String(error),
          evidenceState: getEvidenceState(ctx),
        });
      }
    }

    const result = await withTimeout(
      executeNode(ctx, graph, executionContext, options),
      options.timeoutMs ?? workflow.timeoutMs ?? 0,
      `Workflow "${workflow.id}"`,
    );
    await workflow.onFinish?.(executionContext, result);

    // ── Evidence Auto-Export ─────────────────────────────────────
    try {
      const evidenceGraph =
        typeof ctx.getDomainInstance === 'function'
          ? ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph')
          : undefined;
      if (evidenceGraph && evidenceGraph.nodeCount > 0) {
        stepResults.set('__evidenceSnapshot', evidenceGraph.exportJson());
        executionContext.emitSpan('workflow.evidence.auto-export', {
          nodeCount: evidenceGraph.nodeCount,
          edgeCount: evidenceGraph.edgeCount,
        });
      }
    } catch (exportError) {
      executionContext.emitSpan('workflow.evidence.auto-export', {
        skipped: true,
        error: exportError instanceof Error ? exportError.message : String(exportError),
      });
    }

    const runResult: ExecuteWorkflowResult = {
      workflowId: workflow.id,
      displayName: workflow.displayName,
      runId,
      profile,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      result,
      stepResults: Object.fromEntries(stepResults.entries()),
      metrics,
      spans,
    };
    globalRunStore.recordSuccess(runResult);
    return runResult;
  } catch (error) {
    const workflowError = error instanceof Error ? error : new Error(String(error));
    globalRunStore.recordError(workflow.id, runId, startedAt, workflowError);
    await workflow.onError?.(executionContext, workflowError);
    throw workflowError;
  }
}

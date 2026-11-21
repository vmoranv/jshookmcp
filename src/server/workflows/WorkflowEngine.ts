import { randomUUID } from 'node:crypto';
import { getTypedDomain, type MCPServerContext } from '@server/MCPServer.context';
import { getRoutingState } from '@server/ToolRouter.probe';
import {
  MetricNames,
  resolveInstrumentation,
  SpanNames,
} from '@server/observability/InstrumentationContract';
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
import { WorkflowRunStore, type WorkflowStepOutcome } from '@server/workflows/WorkflowRunStore';
import { createWorkflowHistoryPort } from '@server/workflows/WorkflowHistoryAdapter';
import {
  WorkflowSpanNames,
  type BranchNode,
  type FallbackNode,
  type ParallelNode,
  type SequenceNode,
  type ToolNode,
  type WorkflowContract,
  type WorkflowNode,
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

/**
 * Reconstruct a partial per-step outcome list from the spans emitted before a
 * run failed.
 *
 * The engine's outermost catch only has the thrown error; the per-step detail
 * lives in `stepResults` (hook values, not outcomes) and in the `workflow.node.*`
 * spans. Pairing `nodeStart`/`nodeFinish` by `attrs.nodeId` — the same
 * convention `MacroRunner.buildProgress` uses — yields every step that ran to
 * completion, plus whichever step started but never finished: the one that
 * threw. The failing node is therefore reported as an error and the completed
 * ones as successes, without retaining any step payload.
 *
 * Steps that never started are absent rather than reported as successes, so a
 * predicate counting failures is not misled by steps the run never reached.
 */
function derivePartialStepOutcomes(spans: readonly WorkflowSpan[]): WorkflowStepOutcome[] {
  const startTimes = new Map<string, number>();
  const outcomes: WorkflowStepOutcome[] = [];
  const finished = new Set<string>();

  for (const span of spans) {
    const nodeId = span.attrs?.nodeId;
    if (typeof nodeId !== 'string') continue;
    const at = new Date(span.at).getTime();

    if (span.name === WorkflowSpanNames.nodeStart) {
      startTimes.set(nodeId, at);
      continue;
    }

    if (span.name === WorkflowSpanNames.nodeFinish) {
      const startedAtMs = startTimes.get(nodeId);
      outcomes.push({
        stepId: nodeId,
        status: 'success',
        durationMs: startedAtMs === undefined ? undefined : Math.max(0, at - startedAtMs),
      });
      finished.add(nodeId);
    }
  }

  // Any step that started but never finished is the one that failed.
  for (const [nodeId, startedAtMs] of startTimes) {
    if (finished.has(nodeId)) continue;
    const lastSpanAt = spans.reduce((latest, span) => {
      const at = new Date(span.at).getTime();
      return Number.isFinite(at) && at > latest ? at : latest;
    }, startedAtMs);
    outcomes.push({
      stepId: nodeId,
      status: 'error',
      durationMs: Math.max(0, lastSpanAt - startedAtMs),
    });
  }

  return outcomes;
}

async function runToolNode(
  ctx: MCPServerContext,
  node: ToolNode,
  overrides: ExecuteWorkflowOptions['nodeInputOverrides'],
  executionContext: WorkflowEngineExecutionContext,
  globalRetry?: ExecuteWorkflowOptions['retryPolicy'],
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

  const retry = node.retry ?? globalRetry;
  if (!retry) {
    return runAttempt();
  }

  let attempt = 0;
  while (attempt < retry.maxAttempts) {
    try {
      return await runAttempt();
    } catch (error) {
      attempt += 1;
      if (attempt >= retry.maxAttempts) {
        throw error;
      }
      // attempt is the one-based retry number here.
      const jittered = Math.floor(
        retry.backoffMs * Math.pow(retry.multiplier ?? 1, attempt - 1) * (0.5 + Math.random()),
      );
      await sleep(jittered);
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

/**
 * Per-step span wrapper.
 *
 * The span is owned here, around the whole node execution, rather than inline in
 * the node body: a node can throw from any of several nested calls (a tool node,
 * a nested sequence, a fallback's primary), and only a `finally` around all of
 * them guarantees exactly one `end`. An unterminated span reports a null
 * duration, which is worse than having no span at all.
 */
async function executeNode(
  ctx: MCPServerContext,
  node: WorkflowNode,
  executionContext: WorkflowEngineExecutionContext,
  options: ExecuteWorkflowOptions,
): Promise<unknown> {
  const stepSpan = resolveInstrumentation(ctx).startSpan(SpanNames.workflowStep, {
    nodeId: node.id,
    kind: node.kind,
  });
  let completed = false;
  try {
    const result = await executeNodeInner(ctx, node, executionContext, options);
    completed = true;
    return result;
  } finally {
    stepSpan.end({ ok: completed });
  }
}

async function executeNodeInner(
  ctx: MCPServerContext,
  node: WorkflowNode,
  executionContext: WorkflowEngineExecutionContext,
  options: ExecuteWorkflowOptions,
): Promise<unknown> {
  executionContext.emitSpan(WorkflowSpanNames.nodeStart, { nodeId: node.id, kind: node.kind });

  let result: unknown;
  switch (node.kind) {
    case 'tool':
      result = await runToolNode(
        ctx,
        node,
        options.nodeInputOverrides,
        executionContext,
        options.retryPolicy,
      );
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
        executionContext.emitSpan(WorkflowSpanNames.nodeFallback, {
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
  executionContext.emitSpan(WorkflowSpanNames.nodeFinish, { nodeId: node.id, kind: node.kind });
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
  const instrumentation = resolveInstrumentation(ctx);
  // Run-scope span, added ALONGSIDE the engine's own `workflow.node.*` spans
  // rather than replacing them. Those names are load-bearing:
  // `MacroRunner.buildProgress` matches `workflow.node.start`/`finish` plus
  // `attrs.nodeId` to derive per-step durations, so renaming them would silently
  // blank out macro progress. `workflow.run` is a different granularity.
  const runSpan = instrumentation.startSpan(SpanNames.workflowRun, {
    workflowId: workflow.id,
    runId,
    profile,
  });
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
    // History view so branch predicates can reason about this workflow's past
    // runs. Built from the same store the run outcomes are recorded into.
    history: createWorkflowHistoryPort(globalRunStore),
    workflowId: workflow.id,
  };

  try {
    await workflow.onStart?.(executionContext);
    const graph = workflow.build(executionContext);

    // ── Preflight Gate ────────────────────────────────────────────
    const preflightMode = options.preflightMode ?? 'warn';
    let preflightWarnings: PreflightWarning[] = [];

    if (preflightMode === 'skip') {
      executionContext.emitSpan(WorkflowSpanNames.preflight, {
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
        executionContext.emitSpan(WorkflowSpanNames.preflight, {
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
        executionContext.emitSpan(WorkflowSpanNames.preflight, {
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
          ? getTypedDomain(ctx, 'evidenceGraph')
          : undefined;
      if (evidenceGraph && evidenceGraph.nodeCount > 0) {
        stepResults.set('__evidenceSnapshot', evidenceGraph.exportJson());
        executionContext.emitSpan(WorkflowSpanNames.evidenceAutoExport, {
          nodeCount: evidenceGraph.nodeCount,
          edgeCount: evidenceGraph.edgeCount,
        });
      }
    } catch (exportError) {
      executionContext.emitSpan(WorkflowSpanNames.evidenceAutoExport, {
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
    runSpan.end({ status: 'success' });
    instrumentation.emitMetric(MetricNames.workflowRunsTotal, 1, 'counter', {
      profile,
      status: 'success',
    });
    instrumentation.emitMetric(MetricNames.workflowDurationMs, runResult.durationMs, 'histogram', {
      profile,
      status: 'success',
    });
    return runResult;
  } catch (error) {
    const workflowError = error instanceof Error ? error : new Error(String(error));
    // Ended BEFORE `onError` runs: a user-supplied hook can itself throw, and the
    // run span must not be left open because a callback failed.
    runSpan.end({ status: 'error', error: workflowError.message });
    instrumentation.emitMetric(MetricNames.workflowRunsTotal, 1, 'counter', {
      profile,
      status: 'error',
    });
    instrumentation.emitMetric(MetricNames.workflowErrorsTotal, 1, 'counter', { profile });
    instrumentation.emitMetric(
      MetricNames.workflowDurationMs,
      Date.now() - startedAtMs,
      'histogram',
      { profile, status: 'error' },
    );
    globalRunStore.recordError(
      workflow.id,
      runId,
      startedAt,
      workflowError,
      derivePartialStepOutcomes(spans),
    );
    await workflow.onError?.(executionContext, workflowError);
    throw workflowError;
  }
}

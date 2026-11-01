import type { ToolResponse } from '@server/types';
import type { BranchNode } from '@server/workflows/WorkflowContract';
import type { InternalExecutionContext } from '@server/workflows/WorkflowEngine.types';
import {
  computeFailureRate,
  computeFallbackRate,
  computeMaxFailedSteps,
  type WorkflowHistoryEntry,
  type WorkflowHistoryPort,
} from '@server/workflows/WorkflowHistoryPort';
import { collectSuccessStats, parseToolPayload } from '@server/workflows/WorkflowDataBus';

/**
 * How many most-recent runs the history predicates consider by default.
 *
 * A short window tracks the current regime; a long one would average a
 * recovered-from past into a stale failure rate.
 */
const DEFAULT_HISTORY_WINDOW = 10;

/**
 * Temporary bridge between predicates and the run store.
 *
 * `InternalExecutionContext` does not declare `history` or `workflowId` yet —
 * stage 3 adds them once the run-store rework (stage 1) lands and an adapter
 * exists. Predicates therefore read both through this optional-field
 * accessor, which treats absence as "no history available" rather than as a
 * type error. Every history predicate degrades to a documented default when
 * the port is missing, so workflows that never supply one behave exactly as
 * they did before this module knew about history.
 */
type HistoryAwareContext = InternalExecutionContext & {
  readonly history?: WorkflowHistoryPort;
  readonly workflowId?: string;
};

function getHistoryPort(ctx: InternalExecutionContext): WorkflowHistoryPort | undefined {
  return (ctx as HistoryAwareContext).history;
}

/**
 * Resolve the workflow whose history a predicate should inspect.
 *
 * `ctx` carries a `workflowRunId` (the UUID of the run in flight) but not the
 * stable workflow id — the engine knows it at construction time and just does
 * not pass it down. Until stage 3 adds it, predicates take the workflow id
 * from an explicit `predicateId` suffix (`last_run_failed:heap_snapshot`),
 * falling back to `ctx.workflowId` when a caller happens to supply one.
 */
function resolveWorkflowId(ctx: InternalExecutionContext, explicit?: string): string | undefined {
  return explicit ?? (ctx as HistoryAwareContext).workflowId;
}

/**
 * Most-recent runs for `workflowId`, newest first, capped at `window`.
 *
 * Returns `undefined`, not `[]`, when there is no port or no workflow to look
 * up: the callers must tell "no history to judge" from "history is empty" —
 * see `computeFailureRate` for why those warrant opposite defaults.
 */
function getRecentHistory(
  ctx: InternalExecutionContext,
  workflowId: string | undefined,
  window: number,
): WorkflowHistoryEntry[] | undefined {
  const port = getHistoryPort(ctx);
  if (!port || !workflowId) {
    return undefined;
  }

  const entries = port.getHistory(workflowId, { limit: window });
  return entries.slice(0, window);
}

function getWorkflowVariable(stepResults: Map<string, unknown>, keyPath: string): unknown {
  if (stepResults.has(keyPath)) {
    return stepResults.get(keyPath);
  }

  const [stepId, ...fieldSegments] = keyPath.split('.');
  if (!stepId || !stepResults.has(stepId)) {
    return undefined;
  }

  let current: unknown = stepResults.get(stepId);
  if (current && typeof current === 'object') {
    const payload = parseToolPayload(current as ToolResponse);
    if (payload) {
      current = payload;
    }
  }

  for (const segment of fieldSegments) {
    if (current && typeof current === 'object') {
      const arrayMatch = segment.match(/^(\d+)$/);
      if (arrayMatch && Array.isArray(current)) {
        current = current[Number(arrayMatch[1])];
        continue;
      }

      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    if (Array.isArray(left) !== Array.isArray(right)) {
      return false;
    }

    if (Array.isArray(left)) {
      const leftArray = left as unknown[];
      const rightArray = right as unknown[];
      return (
        leftArray.length === rightArray.length &&
        leftArray.every((value, index) => deepEquals(value, rightArray[index]))
      );
    }

    const leftKeys = Object.keys(left as object);
    const rightKeys = Object.keys(right as object);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) =>
      deepEquals((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    );
  }

  return false;
}

export async function evaluatePredicate(
  node: BranchNode,
  ctx: InternalExecutionContext,
): Promise<boolean> {
  if (node.predicateFn) {
    return await node.predicateFn(ctx);
  }

  const simple = evaluateSimplePredicate(node.predicateId, ctx);
  if (simple !== null) return simple;

  const history = evaluateHistoryPredicate(node.predicateId, ctx);
  if (history !== null) return history;

  throw new Error(`Unknown workflow predicateId "${node.predicateId}"`);
}

/** Built-in / variable predicates. Returns null when the id is not one of them. */
function evaluateSimplePredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  if (predicateId === 'always_true') return true;
  if (predicateId === 'always_false') return false;
  if (predicateId === 'any_step_failed') {
    return [...ctx.stepResults.values()].some((value) => collectSuccessStats(value).failure > 0);
  }
  return (
    evaluateSuccessRatePredicate(predicateId, ctx) ??
    evaluateVariableEqualsPredicate(predicateId, ctx) ??
    evaluateVariableContainsPredicate(predicateId, ctx) ??
    evaluateVariableMatchesPredicate(predicateId, ctx)
  );
}

/** Aggregate success rate over all step results for `success_rate_gte_N`. */
function aggregateSuccessStats(ctx: InternalExecutionContext): {
  success: number;
  failure: number;
} {
  return [...ctx.stepResults.values()].reduce<{ success: number; failure: number }>(
    (acc, value) => {
      const next = collectSuccessStats(value);
      acc.success += next.success;
      acc.failure += next.failure;
      return acc;
    },
    { success: 0, failure: 0 },
  );
}

function evaluateSuccessRatePredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  const successRateMatch = predicateId.match(/success_rate_gte_(\d+)/i);
  if (!successRateMatch?.[1]) return null;
  const threshold = Number(successRateMatch[1]);
  const aggregate = aggregateSuccessStats(ctx);
  const total = aggregate.success + aggregate.failure;
  return total > 0 && aggregate.success / total >= threshold / 100;
}

function evaluateVariableEqualsPredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  const equalsMatch = predicateId.match(/^variable_equals_(.+?)_(.+)$/);
  if (!equalsMatch?.[1] || !equalsMatch[2]) return null;
  return deepEquals(getWorkflowVariable(ctx.stepResults, equalsMatch[1]), equalsMatch[2]);
}

function evaluateVariableContainsPredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  const containsMatch = predicateId.match(/^variable_contains_(.+?)_(.+)$/);
  if (!containsMatch?.[1] || !containsMatch[2]) return null;
  const value = getWorkflowVariable(ctx.stepResults, containsMatch[1]);
  if (typeof value !== 'string' && !Array.isArray(value)) {
    return false;
  }
  return String(value).includes(containsMatch[2]);
}

function evaluateVariableMatchesPredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  const matchesMatch = predicateId.match(/^variable_matches_(.+?)_(.+)$/);
  if (!matchesMatch?.[1] || !matchesMatch[2]) return null;
  const value = getWorkflowVariable(ctx.stepResults, matchesMatch[1]);
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return new RegExp(matchesMatch[2]).test(value);
  } catch {
    return false;
  }
}

/** ── History-aware predicates ──────────────────────────────────────
 * These reason about THIS workflow's past runs, so a branch can take the
 * conservative path while a workflow is progressing and the aggressive one
 * when it has stalled. All of them degrade to `false` when history is
 * unavailable (no port, unknown workflow id, no recorded runs): a branch
 * that flips behavior on evidence it does not have would silently change
 * the workflow's meaning. Callers wanting "optimistic" behavior can pair
 * `history_failure_rate_lte_N` with an `always_true` alternative branch.
 * Returns null when the id is not a history predicate. */
function evaluateHistoryPredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  return (
    evaluateFailureRatePredicate(predicateId, ctx) ??
    evaluateLastRunFailedPredicate(predicateId, ctx) ??
    evaluateRecentStepsFailingPredicate(predicateId, ctx) ??
    evaluateFallbackRatePredicate(predicateId, ctx)
  );
}

/** Compare a history-derived rate against a gte/lte threshold (null when the
 * id does not match; false when history is unavailable). */
function compareRatePredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
  pattern: RegExp,
  compute: (entries: NonNullable<ReturnType<typeof getRecentHistory>>) => number | undefined,
): boolean | null {
  const match = predicateId.match(pattern);
  if (!match?.[1] || !match[2]) return null;
  const threshold = Number(match[2]);
  const entries = getRecentHistory(ctx, resolveWorkflowId(ctx, match[3]), DEFAULT_HISTORY_WINDOW);
  const rate = entries ? compute(entries) : undefined;
  if (rate === undefined) return false;
  return match[1] === 'gte' ? rate >= threshold : rate <= threshold;
}

function evaluateFailureRatePredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  return compareRatePredicate(
    predicateId,
    ctx,
    /^history_failure_rate_(gte|lte)_(\d+)(?::(.+))?$/,
    computeFailureRate,
  );
}

function evaluateLastRunFailedPredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  const lastRunFailedMatch = predicateId.match(/^last_run_failed(?::(.+))?$/);
  if (!lastRunFailedMatch) return null;
  const entries = getRecentHistory(ctx, resolveWorkflowId(ctx, lastRunFailedMatch[1]), 1);
  return entries !== undefined && entries.length > 0 && entries[0]?.status === 'error';
}

function evaluateRecentStepsFailingPredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  const failingStepsMatch = predicateId.match(/^recent_steps_failing_(\d+)(?::(.+))?$/);
  if (!failingStepsMatch?.[1]) return null;
  const threshold = Number(failingStepsMatch[1]);
  const entries = getRecentHistory(
    ctx,
    resolveWorkflowId(ctx, failingStepsMatch[2]),
    DEFAULT_HISTORY_WINDOW,
  );
  const worst = entries ? computeMaxFailedSteps(entries) : undefined;
  if (worst === undefined) return false;
  return worst >= threshold;
}

/** Runs that recovered through a fallback arm still terminate as `success`, so
 * `history_failure_rate_*` cannot see a route that keeps needing its backup.
 * This predicate reads that signal: "the primary path is degrading, stop
 * relying on it" — the case a terminal-status-only view is blind to. */
function evaluateFallbackRatePredicate(
  predicateId: string,
  ctx: InternalExecutionContext,
): boolean | null {
  return compareRatePredicate(
    predicateId,
    ctx,
    /^history_fallback_rate_(gte|lte)_(\d+)(?::(.+))?$/,
    computeFallbackRate,
  );
}

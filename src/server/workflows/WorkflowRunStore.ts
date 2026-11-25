import type { ExecuteWorkflowResult, WorkflowSpan } from '@server/workflows/WorkflowEngine.types';
import { WorkflowSpanNames } from '@server/workflows/WorkflowContract';
import { WORKFLOW_MAX_RUNS } from '@src/constants';
import type {
  SnapshotRestoreSummary,
  SnapshotSource,
} from '@server/persistence/RuntimeSnapshotScheduler';
import { logger } from '@utils/logger';

/**
 * Per-step outcome for one run. Deliberately summary-only: a step's raw
 * result payload is NOT retained here (see the invariant on `lastSuccess`
 * below) — only its status, duration, and (for failures) a short error
 * snippet, so a long-lived process cannot accumulate unbounded payloads.
 */
export interface WorkflowStepOutcome {
  stepId: string;
  status: 'success' | 'error';
  durationMs?: number;
  errorSnippet?: string;
}

/**
 * One step's recent history across runs of one workflow (newest first).
 * Stage-2 history-aware predicates use this to answer "did step X fail the
 * last N times?" without touching raw step outputs.
 */
export interface WorkflowStepHistoryEntry {
  runId: string;
  status: 'success' | 'error';
  durationMs?: number;
  errorSnippet?: string;
}

export interface WorkflowRunEntry {
  workflowId: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'success' | 'error';
  stepResultKeys: string[];
  /** Error message for failed runs (truncated, never the full error object). */
  errorMessage?: string;
  /** Per-step outcome summary (capped; absent when the caller had none). */
  stepOutcomes?: WorkflowStepOutcome[];
  /**
   * Number of `fallback` nodes that had to take their fallback arm in this run.
   *
   * A run that recovers via a fallback still terminates as `success`, so its
   * degraded path would otherwise leave no trace at all — and a history-aware
   * branch reading only terminal status would never learn that a route keeps
   * needing its backup. Absent (rather than 0) when the run emitted no spans to
   * derive it from.
   */
  fallbackCount?: number;
}

export interface ListRunsOptions {
  /** Maximum number of entries to return (default: no limit). */
  limit?: number;
  /** Number of entries to skip from the oldest end (default: 0). */
  offset?: number;
}

/** Failure-rate sliding window used when the caller does not pass one. */
const DEFAULT_FAILURE_RATE_WINDOW = 10;
/** Hard cap on outcomes kept per run — a runaway workflow cannot bloat an entry. */
const MAX_STEP_OUTCOMES_PER_RUN = 100;
/** Truncation limits: summaries only, never full error payloads. */
const MAX_ERROR_MESSAGE_CHARS = 500;
const MAX_ERROR_SNIPPET_CHARS = 200;

/** Snapshot payload persisted by the RuntimeSnapshotScheduler (stage-3 wiring). */
export interface WorkflowRunStoreSnapshot {
  schemaVersion: 1;
  savedAt: string;
  runs: WorkflowRunEntry[];
  /** workflowId → runId of the last successful run (entries live in `runs`). */
  lastSuccessByWorkflow: Record<string, string>;
}

export class WorkflowRunStore implements SnapshotSource {
  private readonly runs = new Map<string, WorkflowRunEntry>();
  // Only the latest successful run per workflow is retained, and only as a
  // summary (step-result KEYS) — never the raw step outputs — so a long-lived
  // process cannot accumulate unbounded payloads here.
  private readonly lastSuccess = new Map<string, WorkflowRunEntry>();
  private readonly maxRuns: number;
  private dirty = false;

  constructor(maxRuns: number = WORKFLOW_MAX_RUNS) {
    this.maxRuns = Math.max(1, Math.trunc(maxRuns) || 1);
  }

  recordSuccess(result: ExecuteWorkflowResult): void {
    const entry: WorkflowRunEntry = {
      workflowId: result.workflowId,
      runId: result.runId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      status: 'success',
      stepResultKeys: Object.keys(result.stepResults),
      stepOutcomes: deriveStepOutcomes(result),
      fallbackCount: deriveFallbackCount(result.spans),
    };
    this.setRun(result.runId, entry);
    this.lastSuccess.set(result.workflowId, entry);
    this.markDirty();
    logger.debug(`workflow run recorded: ${result.runId} (${result.workflowId})`);
  }

  /**
   * @param stepOutcomes Optional per-step outcomes for the run. The engine
   *   currently has no partial-step summary to pass (it throws from the
   *   outermost try/catch), so this stays optional; a stage-3 update of the
   *   WorkflowEngine call site can populate it without breaking other callers.
   */
  recordError(
    workflowId: string,
    runId: string,
    startedAt: string,
    error: unknown,
    stepOutcomes?: WorkflowStepOutcome[],
  ): void {
    const entry: WorkflowRunEntry = {
      workflowId,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      status: 'error',
      stepResultKeys: [],
      errorMessage: truncate(extractErrorMessage(error), MAX_ERROR_MESSAGE_CHARS),
      stepOutcomes: normalizeStepOutcomes(stepOutcomes),
    };
    this.setRun(runId, entry);
    this.markDirty();
    // Log the sanitized message: template interpolation throws for Symbol and
    // for objects without a usable primitive conversion.
    logger.debug(`workflow run error: ${runId} (${workflowId}): ${entry.errorMessage}`);
  }

  getRun(runId: string): WorkflowRunEntry | undefined {
    return this.runs.get(runId);
  }

  getLastSuccess(workflowId: string): WorkflowRunEntry | undefined {
    return this.lastSuccess.get(workflowId);
  }

  listRuns(workflowId?: string, options: ListRunsOptions = {}): WorkflowRunEntry[] {
    const entries = [...this.runs.values()];
    const filtered = workflowId
      ? entries.filter((entry) => entry.workflowId === workflowId)
      : entries;
    const offset = options.offset ?? 0;
    if (typeof options.limit === 'number') {
      return filtered.slice(offset, offset + options.limit);
    }
    return offset > 0 ? filtered.slice(offset) : filtered;
  }

  /**
   * Structured run history for one workflow, newest first (by finishedAt;
   * equal timestamps keep recording order, so the latest recorded run wins).
   * Includes failures — unlike getLastSuccess.
   */
  getHistory(workflowId: string, limit?: number): WorkflowRunEntry[] {
    const entries = this.sortedByFinishedAtDesc(workflowId);
    return typeof limit === 'number' ? entries.slice(0, Math.max(0, limit)) : entries;
  }

  /**
   * Sliding-window failure rate over the most recent `window` runs
   * (default {@link DEFAULT_FAILURE_RATE_WINDOW}). `rate` is 0 when the
   * workflow has no history at all.
   */
  getFailureRate(
    workflowId: string,
    window: number = DEFAULT_FAILURE_RATE_WINDOW,
  ): { total: number; failures: number; rate: number } {
    const entries = this.sortedByFinishedAtDesc(workflowId);
    const total = Math.min(Math.max(1, Math.trunc(window) || 1), entries.length);
    const failures = entries.slice(0, total).filter((entry) => entry.status === 'error').length;
    return { total, failures, rate: total === 0 ? 0 : failures / total };
  }

  /** Most recent failed run (with its error message), or undefined. */
  getLastFailure(workflowId: string): WorkflowRunEntry | undefined {
    return this.sortedByFinishedAtDesc(workflowId).find((entry) => entry.status === 'error');
  }

  /**
   * Recent history of one step across runs of one workflow, newest first.
   * A run contributes an entry only if it recorded an outcome for that step.
   */
  getStepHistory(workflowId: string, stepId: string, limit?: number): WorkflowStepHistoryEntry[] {
    const history: WorkflowStepHistoryEntry[] = [];
    for (const entry of this.sortedByFinishedAtDesc(workflowId)) {
      const outcome = entry.stepOutcomes?.find((o) => o.stepId === stepId);
      if (!outcome) continue;
      history.push({
        runId: entry.runId,
        status: outcome.status,
        durationMs: outcome.durationMs,
        errorSnippet: outcome.errorSnippet,
      });
      if (typeof limit === 'number' && history.length >= Math.max(0, limit)) break;
    }
    return history;
  }

  clear(): void {
    this.runs.clear();
    this.lastSuccess.clear();
    this.markDirty();
  }

  // ── Snapshot persistence (RuntimeSnapshotScheduler contract) ──────────
  //
  // Structured run history is worth surviving a restart: stage-2 predicates
  // read failure patterns that would otherwise reset to "unknown" on every
  // process start.
  //
  // TODO(stage 3): register this store with the RuntimeSnapshotScheduler —
  // `scheduler.register('workflow-run-store.json', getWorkflowRunStore())`
  // — and route markDirty() through a persist notifier. This class only
  // provides the SnapshotSource contract; the cross-module wiring belongs to
  // the engine-orchestration phase.

  isPersistDirty(): boolean {
    return this.dirty;
  }

  markPersisted(): void {
    this.dirty = false;
  }

  exportSnapshot(): WorkflowRunStoreSnapshot {
    // Oldest first so a restore re-creates the chronological insertion order
    // the eviction logic relies on (Map.keys() is the eviction queue).
    const runs = [...this.runs.values()].toSorted((a, b) =>
      a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0,
    );
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      runs,
      lastSuccessByWorkflow: Object.fromEntries(
        [...this.lastSuccess.entries()].map(([workflowId, entry]) => [workflowId, entry.runId]),
      ),
    };
  }

  restoreSnapshot(data: unknown): SnapshotRestoreSummary {
    if (!data || typeof data !== 'object') return { evictedHistoryKeys: 0 };
    const snapshot = data as Partial<WorkflowRunStoreSnapshot>;
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.runs)) {
      return { evictedHistoryKeys: 0 };
    }

    const restored: WorkflowRunEntry[] = [];
    let evicted = 0;
    for (const raw of snapshot.runs) {
      const entry = normalizeEntry(raw);
      if (entry) {
        restored.push(entry);
      } else {
        evicted += 1;
      }
    }
    // Oldest first (see exportSnapshot), so front-of-map eviction trims the
    // right end after the cap is applied.
    restored.sort((a, b) =>
      a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0,
    );

    this.runs.clear();
    this.lastSuccess.clear();
    for (const entry of restored) {
      this.setRun(entry.runId, entry);
    }
    // Re-derive lastSuccess by runId reference; a stale or missing id is
    // dropped rather than resurrecting a run the cap already evicted.
    const byRunId = new Map(this.runs.entries());
    if (snapshot.lastSuccessByWorkflow && typeof snapshot.lastSuccessByWorkflow === 'object') {
      for (const [workflowId, runId] of Object.entries(snapshot.lastSuccessByWorkflow)) {
        const entry = typeof runId === 'string' ? byRunId.get(runId) : undefined;
        if (entry && entry.status === 'success') {
          this.lastSuccess.set(workflowId, entry);
        }
      }
    }

    evicted += restored.length - this.runs.size;
    this.dirty = false;
    return { evictedHistoryKeys: evicted };
  }

  /**
   * Insert a run entry, evicting the oldest retained run once the cap is
   * reached (Map preserves insertion order, so the first key is the oldest).
   */
  private setRun(runId: string, entry: WorkflowRunEntry): void {
    if (this.runs.has(runId)) {
      this.runs.set(runId, entry);
      return;
    }
    if (this.runs.size >= this.maxRuns) {
      const oldestKey = this.runs.keys().next().value;
      if (oldestKey !== undefined) {
        this.runs.delete(oldestKey);
      }
    }
    this.runs.set(runId, entry);
  }

  /**
   * Runs of one workflow, newest first. Ties on finishedAt break by recording
   * order (later-recorded first): two runs can legitimately finish within the
   * same millisecond, and the one recorded later is the more recent one.
   */
  private sortedByFinishedAtDesc(workflowId: string): WorkflowRunEntry[] {
    return [...this.runs.values()]
      .map((entry, index) => ({ entry, index }))
      .filter((item) => item.entry.workflowId === workflowId)
      .toSorted((a, b) => {
        if (a.entry.finishedAt < b.entry.finishedAt) return 1;
        if (a.entry.finishedAt > b.entry.finishedAt) return -1;
        return b.index - a.index;
      })
      .map((item) => item.entry);
  }

  private markDirty(): void {
    this.dirty = true;
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    // JSON.stringify returns undefined for undefined/functions/symbols.
    if (typeof json === 'string') return json;
  } catch {
    // Circular / BigInt — fall through to a primitive conversion.
  }
  try {
    return String(error);
  } catch {
    return '<unserializable>';
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

/** True for the `{ success: false, error }` shape runToolNode's parallel path writes. */
function stepResultIndicatesFailure(value: unknown): { error?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { success?: unknown; error?: unknown };
  if (candidate.success !== false) return null;
  return typeof candidate.error === 'string' ? { error: candidate.error } : null;
}

/** nodeStart/nodeFinish span pairs → per-node duration (same pairing MacroRunner uses). */
function stepDurationsFromSpans(spans: WorkflowSpan[]): Map<string, number> {
  const durations = new Map<string, number>();
  const starts = new Map<string, string>();
  for (const span of spans) {
    const nodeId =
      span.attrs && typeof span.attrs.nodeId === 'string' ? span.attrs.nodeId : undefined;
    if (!nodeId) continue;
    if (span.name === 'workflow.node.start' && !starts.has(nodeId)) {
      starts.set(nodeId, span.at);
    } else if (span.name === 'workflow.node.finish' && starts.has(nodeId)) {
      const duration = new Date(span.at).getTime() - new Date(starts.get(nodeId)!).getTime();
      if (Number.isFinite(duration) && duration >= 0) durations.set(nodeId, duration);
    }
  }
  return durations;
}

/**
 * Count `workflow.node.fallback` spans, which the engine emits whenever a
 * `fallback` node's primary arm threw and the backup arm ran instead. A run
 * that recovers this way is still a `success`, so this count is the only trace
 * of the degraded route.
 */
function deriveFallbackCount(spans: readonly WorkflowSpan[]): number | undefined {
  if (spans.length === 0) return undefined;
  return spans.filter((span) => span.name === WorkflowSpanNames.nodeFallback).length;
}

function deriveStepOutcomes(result: ExecuteWorkflowResult): WorkflowStepOutcome[] | undefined {
  const durations = stepDurationsFromSpans(result.spans);
  const outcomes: WorkflowStepOutcome[] = [];
  for (const [stepId, value] of Object.entries(result.stepResults)) {
    if (outcomes.length >= MAX_STEP_OUTCOMES_PER_RUN) break;
    // Engine-internal keys (e.g. __evidenceSnapshot) live in stepResults but
    // are not user steps — keep them in stepResultKeys, exclude from outcomes.
    if (stepId.startsWith('__')) continue;
    const failure = stepResultIndicatesFailure(value);
    outcomes.push(
      failure
        ? {
            stepId,
            status: 'error',
            errorSnippet: truncate(failure.error ?? '', MAX_ERROR_SNIPPET_CHARS),
          }
        : { stepId, status: 'success', durationMs: durations.get(stepId) },
    );
  }
  return outcomes.length === 0 ? undefined : outcomes;
}

function normalizeStepOutcomes(
  outcomes: WorkflowStepOutcome[] | undefined,
): WorkflowStepOutcome[] | undefined {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return undefined;
  // Also called from restoreSnapshot() with unvalidated persisted data: a
  // null/primitive element would make `outcome.stepId` throw and abort the
  // whole restore.
  return outcomes
    .filter(
      (outcome): outcome is WorkflowStepOutcome => Boolean(outcome) && typeof outcome === 'object',
    )
    .slice(0, MAX_STEP_OUTCOMES_PER_RUN)
    .map((outcome) => {
      const normalized: WorkflowStepOutcome = {
        stepId: String(outcome.stepId),
        status: outcome.status === 'error' ? 'error' : 'success',
      };
      if (typeof outcome.durationMs === 'number' && Number.isFinite(outcome.durationMs)) {
        normalized.durationMs = outcome.durationMs;
      }
      if (typeof outcome.errorSnippet === 'string') {
        normalized.errorSnippet = truncate(outcome.errorSnippet, MAX_ERROR_SNIPPET_CHARS);
      }
      return normalized;
    });
}

function normalizeEntry(raw: unknown): WorkflowRunEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Partial<WorkflowRunEntry>;
  if (
    typeof entry.runId !== 'string' ||
    typeof entry.workflowId !== 'string' ||
    typeof entry.startedAt !== 'string' ||
    typeof entry.finishedAt !== 'string' ||
    typeof entry.durationMs !== 'number' ||
    !Number.isFinite(entry.durationMs) ||
    (entry.status !== 'success' && entry.status !== 'error') ||
    !Array.isArray(entry.stepResultKeys) ||
    !entry.stepResultKeys.every((key) => typeof key === 'string')
  ) {
    return undefined;
  }
  const normalized: WorkflowRunEntry = {
    workflowId: entry.workflowId,
    runId: entry.runId,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    durationMs: entry.durationMs,
    status: entry.status,
    stepResultKeys: [...entry.stepResultKeys],
  };
  if (typeof entry.errorMessage === 'string') {
    normalized.errorMessage = truncate(entry.errorMessage, MAX_ERROR_MESSAGE_CHARS);
  }
  const outcomes = normalizeStepOutcomes(entry.stepOutcomes);
  if (outcomes) normalized.stepOutcomes = outcomes;
  if (typeof entry.fallbackCount === 'number' && Number.isFinite(entry.fallbackCount)) {
    normalized.fallbackCount = Math.max(0, Math.trunc(entry.fallbackCount));
  }
  return normalized;
}

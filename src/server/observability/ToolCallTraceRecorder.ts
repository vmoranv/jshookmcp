/**
 * ToolCallTraceRecorder — an ordered, replayable trace of tool calls.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ToolCallContextGuard.recordCall(toolName)` already sees every tool call, but
 * it keeps a COUNTER: `{ lastToolName, consecutiveCount }` — enough to answer
 * "is this the 3rd identical call in a row?" (the degenerate-loop warning) and
 * nothing else. A counter cannot answer any question that requires order:
 *
 *   - did the agent retry a failing tool with the SAME arguments, or change
 *     approach? (a counter per-session cannot tell a retry from a switch)
 *   - was there a phase structure — navigate, then instrument, then collect —
 *     or a flat grind through one tool?
 *   - which domains were touched, and did a failure ever get a follow-up call?
 *   - how long did calls take, and how large were the payloads that the
 *     offloader had to spill to disk?
 *
 * Those are exactly the dimensions the A²E paper (arXiv:2608.07346) calls
 * `tool` / `plan` / `efficiency`, scored on a standardized execution trace. Its
 * OTHER dimensions — reasoning quality, plan grade, skill/memory use — are
 * judged by an LLM over the agent's chain of thought. A tool SERVER never sees
 * that chain, so those are NOT ported here; pretending otherwise would produce
 * a metric that reads a number off nothing. What a server does own is the
 * action layer, and that layer is fully observable in this process.
 *
 * WHY A SEPARATE OBJECT INSTEAD OF CHANGING `recordCall`
 * ------------------------------------------------------
 * `recordCall` is called from the hot execution path and its return value is
 * load-bearing (`enrichResponse` injects `repeatWarning` when the count trips).
 * Widening it to return a trace entry would change a public signature that
 * several call sites and tests depend on, for a consumer that has nothing to do
 * with repeat detection.
 *
 * So this recorder is a SEPARATE observer with its own lifecycle: the caller
 * that already knows a call happened (it has the duration, the domain, the
 * response) feeds one entry in. Nothing in the guard changes, and the recorder
 * can be attached, reset, or omitted per deployment without the guard knowing.
 *
 * PURE MEMORY, NO I/O
 * -------------------
 * Recording must never be the reason a tool call fails, and it must never do
 * blocking work on the execution path. This class therefore writes nothing:
 * `toJSONL()` returns a string, and the caller decides whether to persist it
 * (see `scripts/audit-tool-traces.mjs` for the offline analyzer). That also
 * keeps the class unit-testable without a temp directory.
 *
 * BOUNDED ON PURPOSE
 * ------------------
 * A long-running server that appends one entry per tool call forever is a memory
 * leak. The window is fixed (DEFAULT_MAX_ENTRIES) and the oldest entries are
 * dropped; `droppedEntries` is part of the snapshot so the loss is VISIBLE
 * rather than silent — a buffer that quietly discards is a defect this repo has
 * found in several places, and it is worse here than most, because a trace is
 * evidence: a truncated trace that claims to be complete is a false statement
 * about what the agent did, whereas one that reports "N dropped" is still
 * usable for the rate metrics below only if the caller knows the denominator.
 */

import { RingBuffer } from '@utils/RingBuffer';

/** Entries retained before the oldest are evicted. */
const DEFAULT_MAX_ENTRIES = 2000;

/** Cap on concurrently tracked sessions before the oldest is evicted. */
const MAX_TRACKED_SESSIONS = 64;

/**
 * How a failure was classified, by where in the pipeline it was caught.
 *
 * Deliberately a closed set of PIPELINE STAGES rather than an error taxonomy:
 * the stage is the fact this process actually knows. `timeout` means the hang
 * watchdog fired, `validation` means the argument validator rejected the call
 * before any handler ran, `gate` means a permission rule or the doom-loop
 * breaker blocked it, `handler` means the tool body threw or returned an error
 * response. Guessing a finer cause from the message would be inference dressed
 * up as measurement.
 */
export type ToolCallErrorKind = 'timeout' | 'validation' | 'gate' | 'handler' | 'unknown';

/** One tool call, at the action layer. */
export interface ToolCallTraceEntry {
  /** Monotonic sequence number within the session. Starts at 1; never reused. */
  readonly seq: number;
  readonly toolName: string;
  /** Domain the tool belongs to (`null` for meta tools and unknown names). */
  readonly domain: string | null;
  /** Epoch ms at which the call started. */
  readonly startedAt: number;
  readonly durationMs: number;
  /** False when the tool reported a failure (`isError` or `success: false`). */
  readonly ok: boolean;
  readonly errorKind?: ToolCallErrorKind;
  /** Serialized size of the arguments, when the caller measured it. */
  readonly argsSizeBytes?: number;
  /** Serialized size of the response — pairs with the offloader's spill record. */
  readonly resultSizeBytes?: number;
  /** True when this is the same tool as the immediately preceding entry. */
  readonly repeated: boolean;
}

export interface ToolCallTrace {
  readonly sessionId: string;
  readonly entries: readonly ToolCallTraceEntry[];
  readonly startedAt: number;
  /** Entries evicted by the capacity window. Non-zero means the trace is partial. */
  readonly droppedEntries: number;
  /** Total entries recorded, including evicted ones. The honest denominator. */
  readonly totalRecorded: number;
}

/** Fields the caller supplies; `seq` and `repeated` are derived here. */
export type ToolCallTraceInput = Omit<ToolCallTraceEntry, 'seq' | 'repeated'>;

/** Per-session recording state. */
interface SessionState {
  readonly startedAt: number;
  readonly entries: RingBuffer<ToolCallTraceEntry>;
  nextSeq: number;
  totalRecorded: number;
  droppedEntries: number;
  lastToolName: string | null;
}

/**
 * Options for one recording instance.
 *
 * `sessionId` is a default for callers that have no per-call session (the
 * recorder is process-wide today; a shared daemon will pass the real MCP
 * session id per entry). Entries recorded without a session land here.
 */
export interface ToolCallTraceRecorderOptions {
  readonly maxEntries?: number;
  readonly sessionId?: string;
}

const DEFAULT_SESSION_ID = 'default';

export class ToolCallTraceRecorder {
  private readonly maxEntries: number;
  private readonly defaultSessionId: string;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: ToolCallTraceRecorderOptions = {}) {
    // A non-positive cap would make every entry vanish while `totalRecorded`
    // kept climbing — a recorder that records nothing and says it recorded
    // everything. Clamp to at least one entry instead.
    const requested = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxEntries = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 1;
    this.defaultSessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  }

  /**
   * Record one completed tool call.
   *
   * `repeated` is computed against the previous entry IN THE SAME SESSION: two
   * sessions interleaved on one process must not look like one agent repeating
   * itself, which is the whole reason the state is keyed by session.
   */
  recordToolCall(entry: ToolCallTraceInput, sessionId?: string): ToolCallTraceEntry {
    const state = this.getSession(sessionId);
    const repeated = state.lastToolName === entry.toolName;
    const recorded: ToolCallTraceEntry = {
      ...entry,
      seq: state.nextSeq,
      repeated,
    };
    state.nextSeq += 1;
    state.totalRecorded += 1;
    state.lastToolName = entry.toolName;
    if (state.entries.length === this.maxEntries) state.droppedEntries += 1;
    state.entries.push(recorded);
    return recorded;
  }

  /** Ordered entries for one session (oldest first). */
  snapshot(sessionId?: string): ToolCallTrace {
    const key = sessionId ?? this.defaultSessionId;
    const state = this.sessions.get(key);
    if (!state) {
      return {
        sessionId: key,
        entries: [],
        startedAt: 0,
        droppedEntries: 0,
        totalRecorded: 0,
      };
    }
    return {
      sessionId: key,
      entries: state.entries.toArray(),
      startedAt: state.startedAt,
      droppedEntries: state.droppedEntries,
      totalRecorded: state.totalRecorded,
    };
  }

  /**
   * Every session's trace, in the order the sessions were first seen.
   *
   * Separate from `snapshot` on purpose: `snapshot()` answers "what did THIS
   * agent do", which is the question a per-session analysis (repetition,
   * plan phases) needs. Merging sessions into one list would interleave two
   * agents' calls and make both metrics meaningless.
   */
  snapshotAll(): readonly ToolCallTrace[] {
    return [...this.sessions.keys()].map((key) => this.snapshot(key));
  }

  /**
   * Reset one session, or every session when `sessionId` is omitted.
   *
   * Omitting the argument is NOT the same as `reset(this.defaultSessionId)`:
   * the latter would leave other agents' state behind while appearing to clear
   * the recorder.
   */
  reset(sessionId?: string): void {
    if (sessionId === undefined) {
      this.sessions.clear();
      return;
    }
    this.sessions.delete(sessionId);
  }

  /** Session ids currently held, oldest first. */
  sessionIds(): readonly string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Serializable form: one JSON object per line, oldest first, per session.
   *
   * Sessions are emitted as separate blocks with no separator record — the
   * `sessionId` is on every line so a reader can group without positional
   * assumptions, and a truncated file stays interpretable.
   */
  toJSONL(sessionId?: string): string {
    const traces = sessionId === undefined ? this.snapshotAll() : [this.snapshot(sessionId)];
    const lines: string[] = [];
    for (const trace of traces) {
      for (const entry of trace.entries) {
        lines.push(JSON.stringify({ sessionId: trace.sessionId, ...entry }));
      }
    }
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  private getSession(sessionId?: string): SessionState {
    const key = sessionId ?? this.defaultSessionId;
    let state = this.sessions.get(key);
    if (state) return state;
    if (this.sessions.size >= MAX_TRACKED_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    state = {
      startedAt: Date.now(),
      entries: new RingBuffer<ToolCallTraceEntry>(this.maxEntries),
      nextSeq: 1,
      totalRecorded: 0,
      droppedEntries: 0,
      lastToolName: null,
    };
    this.sessions.set(key, state);
    return state;
  }
}

/**
 * Compact the pipeline fact into an error kind.
 *
 * Kept as a free function rather than inlined at the call site so the mapping is
 * one thing that can be tested, and so every future call site classifies
 * identically. `undefined` inputs and an explicit `false` success flag are
 * treated as failure: a call that reported no success is not a success.
 */
export function classifyErrorKind(outcome: {
  readonly isError?: boolean;
  readonly successFlag?: boolean | undefined;
  readonly thrown?: boolean;
  readonly timedOut?: boolean;
  readonly rejectedByValidation?: boolean;
  readonly blockedByGate?: boolean;
}): ToolCallErrorKind | undefined {
  const failed =
    outcome.timedOut === true ||
    outcome.thrown === true ||
    outcome.rejectedByValidation === true ||
    outcome.blockedByGate === true ||
    outcome.isError === true ||
    outcome.successFlag === false;
  if (!failed) return undefined;
  if (outcome.timedOut === true) return 'timeout';
  if (outcome.rejectedByValidation === true) return 'validation';
  if (outcome.blockedByGate === true) return 'gate';
  if (outcome.thrown === true || outcome.isError === true) return 'handler';
  return 'unknown';
}

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
import { PrerequisiteError } from '@errors/PrerequisiteError';

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
 * response.
 *
 * The cause-level kinds (`prereq_missing` / `target_gone` / `network` /
 * `invalid_args` / `timeout`) are NEVER inferred from free-form prose except
 * for the two cases where prose is the only carrier that exists: a Chromium
 * `net::ERR_*` marker (Playwright and Puppeteer both flatten it into the
 * message) and a timeout marker on a soft-fail response, which has no Error
 * instance to inspect at all. Everything else requires a structural signal — a
 * `PrerequisiteError` instance or a `ToolError` code. Unmarked failures stay at
 * the stage kind (`handler` / `unknown`).
 */
export type ToolCallErrorKind =
  | 'timeout'
  | 'validation'
  | 'gate'
  | 'handler'
  | 'unknown'
  | 'prereq_missing'
  | 'target_gone'
  | 'network'
  | 'not_found'
  | 'invalid_args';

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

/**
 * Structural signals that distinguish a cause from a generic handler failure.
 * Every field is one the process already holds (an error instance it caught, or
 * a `ToolError` code), so no branch below reads prose.
 */
export interface ToolFailureSignals {
  /** The thrown value, when the failure surfaced as an exception. */
  readonly error?: unknown;
  /** `ToolError.code` of the caught error, when it is a `ToolError`. */
  readonly errorCode?: string;
  /** Chromium/`net::` error name or Node platform code seen by the caller. */
  readonly platformError?: string;
}

/**
 * Cause-level classification layered on `classifyErrorKind`.
 *
 * `classifyErrorKind` answers "which stage caught this"; this answers "what, if
 * anything structural, explains it". They are separate so the stage kind stays
 * stable for consumers that only understand stages, and the cause kind can be
 * added to the metric dimension without re-interpreting old data.
 *
 * Precedence: a stage that never reached the handler (gate / validation) is
 * more informative than any structural hint, so those win. Then a
 * `PrerequisiteError` instance, because retrying without the prerequisite only
 * burns tokens. Timeout comes next — deliberately BEFORE the network table, so
 * ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT read as `timeout` rather than being
 * swallowed as a generic network failure.
 *
 * Every branch below reads a structural signal. The only prose it consults is
 * the two markers with no structural carrier at all: a Chromium `net::ERR_*`
 * name (Playwright and Puppeteer both flatten it into the message) and a
 * timeout phrase on a soft-fail response (which carries no Error instance).
 *
 * The whole `cause` chain is walked, not just the outermost error: a handler
 * that wraps a ToolError in its own error must still be classified by the
 * wrapped code.
 */
export function classifyFailureCause(
  stage: ToolCallErrorKind | undefined,
  signals: ToolFailureSignals = {},
): ToolCallErrorKind | undefined {
  if (stage === undefined) return undefined;
  if (stage === 'gate' || stage === 'validation') return stage;

  const chain = readCauseChain(signals.error);
  const declaredCode = signals.errorCode ?? chain.toolErrorCode;
  const platformText = signals.platformError;
  const platformNet = readPlatformText(platformText);

  if (chain.hasPrerequisite || declaredCode === 'PREREQUISITE') return 'prereq_missing';
  // A timeout is a timeout whether it arrived as a ToolError code, a Node
  // socket code (ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT) or prose. Checked before
  // the network table on purpose: a socket timeout must not be swallowed as a
  // generic network failure.
  if (
    declaredCode === 'TIMEOUT' ||
    (declaredCode !== undefined && TIMEOUT_ERROR_CODES.has(declaredCode)) ||
    chain.hasTimeoutCode ||
    isTimeoutText(platformText)
  ) {
    return 'timeout';
  }
  switch (declaredCode) {
    case 'VALIDATION':
      return 'invalid_args';
    case 'NOT_FOUND':
      // NOT_FOUND covers a missing file, a missing tool and a gone CDP target
      // alike; the code alone cannot separate them, so it keeps its own name
      // instead of claiming the target is gone.
      return 'not_found';
    case 'CONNECTION':
      // A closed CDP session and a refused socket are both connection
      // failures. This is the broad-but-true answer; the narrower
      // target/network distinction needs evidence the code does not carry.
      return 'network';
    default:
      break;
  }
  if (chain.hasGoneNetError || platformNet === 'gone') return 'target_gone';
  if (chain.hasNetError || platformNet === 'network') return 'network';
  // A soft-fail `R.fail(...)` response carries only prose — the cause is
  // genuinely unknown, and the stage ('handler') is the honest answer rather
  // than inventing a category.
  return stage;
}

/** Timeout markers shared by the thrown and soft-fail paths. */
function isTimeoutText(text: string | undefined): boolean {
  if (text === undefined) return false;
  // "timed out" does NOT contain "timeout" — the earlier pattern silently
  // missed the most common phrasing a plain `Error` uses.
  return /tim(?:ed\s*out|eout)|exceeded.*ms/i.test(text);
}

/**
 * A ToolError code that could be confirmed at ANY depth of the cause chain.
 * Only the codes this module maps are recorded; the rest are ignored so an
 * unrelated `code` property on a third-party error cannot be mistaken for one.
 */
interface CauseChainSignals {
  readonly hasPrerequisite: boolean;
  readonly toolErrorCode: string | undefined;
  readonly hasTimeoutCode: boolean;
  readonly hasGoneNetError: boolean;
  readonly hasNetError: boolean;
}

/** Bounded depth: a pathological cause cycle must not hang the telemetry path. */
const MAX_CAUSE_DEPTH = 4;

/** ToolError codes this module can classify. */
const CLASSIFIABLE_TOOL_ERROR_CODES = new Set([
  'PREREQUISITE',
  'VALIDATION',
  'NOT_FOUND',
  'CONNECTION',
  'TIMEOUT',
]);

/**
 * Walk the `cause` chain once, collecting every structural signal it holds.
 *
 * Playwright, Puppeteer and the tool handlers themselves all bury the real
 * cause a level or two down, never on the outermost error's own code.
 */
function readCauseChain(error: unknown): CauseChainSignals {
  let hasPrerequisite = false;
  let toolErrorCode: string | undefined;
  let hasTimeoutCode = false;
  let hasGoneNetError = false;
  let hasNetError = false;

  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== null && current !== undefined;
    depth++
  ) {
    if (current instanceof PrerequisiteError) hasPrerequisite = true;
    const code = isToolErrorLike(current) ? current.code : undefined;
    if (code !== undefined) {
      if (CLASSIFIABLE_TOOL_ERROR_CODES.has(code) && toolErrorCode === undefined)
        toolErrorCode = code;
      if (TIMEOUT_ERROR_CODES.has(code)) hasTimeoutCode = true;
      if (NETWORK_ERROR_CODES.has(code)) hasNetError = true;
    }
    const message = current instanceof Error ? current.message : null;
    if (message !== null && message.includes('net::ERR_')) {
      if (isGoneNetError(message)) hasGoneNetError = true;
      else hasNetError = true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }

  return { hasPrerequisite, toolErrorCode, hasTimeoutCode, hasGoneNetError, hasNetError };
}

/** Timeout codes. Checked before the network table so they keep their own name. */
const TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * Node platform codes that mean "the network path failed", not the target.
 * Deliberately excludes the timeout codes above — they live in their own set.
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

/**
 * Chromium network errors that mean "the peer is gone".
 *
 * `ERR_ABORTED` is NOT here: Chromium reports it for any canceled or
 * superseded navigation, including one the caller triggered deliberately and
 * one where the target is perfectly alive. Treating it as target loss would
 * label a working browser as disconnected.
 */
const GONE_NET_ERRORS = ['ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET'];

function isGoneNetError(text: string): boolean {
  return GONE_NET_ERRORS.some((name) => text.includes(name));
}

function isToolErrorLike(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/**
 * Classify a soft-fail response's message text, which is the only carrier a
 * `R.fail(...)` response has.
 */
function readPlatformText(text: string | undefined): 'gone' | 'network' | null {
  if (text === undefined) return null;
  if (text.includes('net::ERR_')) return isGoneNetError(text) ? 'gone' : 'network';
  for (const code of NETWORK_ERROR_CODES) {
    if (text.includes(code)) return 'network';
  }
  return null;
}

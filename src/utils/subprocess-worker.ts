/**
 * Generic subprocess worker isolation — parent + worker halves in one module.
 *
 * Heavy, crash-prone, or externally-driven logic (JVM invocations, untrusted
 * input parsing, …) runs in a dedicated Node child process instead of the MCP
 * server process. The parent keeps its module graph free of whatever the
 * worker pulls in, and a wedged or crashing worker never takes the server
 * down: requests are correlated by id, timeouts/aborts are honoured, and the
 * worker survives stray `uncaughtException`s inside a time-bounded tolerance
 * window so one bad input cannot abort a whole batch of operations
 * (pattern after the CyberStrike hackbrowser-worker triple).
 *
 * ── Transport: UTF-8 JSON Lines over stdin/stdout ──
 *
 * One JSON object per line. Line framing is used because `JSON.stringify`
 * never emits a raw `\n` inside a string (it is escaped to `\\n`), so a
 * newline is an unambiguous frame delimiter: no length prefixes, no escaping
 * layer, and a partially-flushed write can only delay a frame, never corrupt
 * one — a line is only parsed once its `\n` arrives. Windows pipes may emit
 * `\r\n`; both sides trim before parsing. stderr stays free-form (crash
 * noise, native output) and is only used for error-reporting tails.
 *
 * ── Protocol ──
 *
 *   parent → worker: { type: 'start', id, options }   run `handler(options)`
 *                    { type: 'abort', id }             abort request `id`
 *   worker → parent: { type: 'log', level, message }  side-channel log
 *                    { type: 'event', id?, data }      progress / notification
 *                    { type: 'result', id, result }    request resolved
 *                    { type: 'error', id?, message }   id: request failed
 *                                                      no id: worker-global
 *                                                      failure (e.g. flood)
 *
 * A worker-global `error` (no id) settles every pending parent request — the
 * tolerance-window flood path emits one before exiting.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ProcessRegistry } from '@utils/ProcessRegistry';

// ============================================================
// Protocol message types + parse guards
// ============================================================

/** Parent → worker frames. */
export type SubprocessWorkerInboundMessage =
  | { type: 'start'; id: number; options: unknown }
  | { type: 'abort'; id: number };

/** Worker → parent frames. */
export type SubprocessWorkerOutboundMessage =
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  | { type: 'event'; id?: number; data: unknown }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id?: number; message: string };

/** Frames the parent forwards to consumers via {@link SubprocessWorker.onNotification}. */
export type SubprocessWorkerNotification = Extract<
  SubprocessWorkerOutboundMessage,
  { type: 'log' | 'event' }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJsonLine(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

/**
 * Parse one JSONL frame from the worker. Returns null for anything that is
 * not a well-formed protocol message — unparseable noise (e.g. a stray
 * `console.log` inside the worker) must degrade to silence, never throw
 * inside the parent's data handler or corrupt the stream.
 */
export function parseWorkerOutboundFrame(raw: string): SubprocessWorkerOutboundMessage | null {
  const parsed = parseJsonLine(raw);
  if (!parsed || typeof parsed['type'] !== 'string') return null;
  switch (parsed['type']) {
    case 'log': {
      const level = parsed['level'];
      if (
        typeof parsed['message'] !== 'string' ||
        (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error')
      ) {
        return null;
      }
      return { type: 'log', level, message: parsed['message'] };
    }
    case 'event':
      if (!('data' in parsed)) return null;
      return {
        type: 'event',
        id: typeof parsed['id'] === 'number' ? parsed['id'] : undefined,
        data: parsed['data'],
      };
    case 'result':
      return typeof parsed['id'] === 'number'
        ? { type: 'result', id: parsed['id'], result: parsed['result'] }
        : null;
    case 'error':
      return typeof parsed['message'] === 'string'
        ? {
            type: 'error',
            id: typeof parsed['id'] === 'number' ? parsed['id'] : undefined,
            message: parsed['message'],
          }
        : null;
    default:
      return null;
  }
}

/** Parse one JSONL frame from the parent (worker side). Null on noise. */
export function parseWorkerInboundFrame(raw: string): SubprocessWorkerInboundMessage | null {
  const parsed = parseJsonLine(raw);
  if (!parsed || typeof parsed['type'] !== 'string') return null;
  if (parsed['type'] === 'start') {
    return typeof parsed['id'] === 'number'
      ? { type: 'start', id: parsed['id'], options: parsed['options'] }
      : null;
  }
  if (parsed['type'] === 'abort') {
    return typeof parsed['id'] === 'number' ? { type: 'abort', id: parsed['id'] } : null;
  }
  return null;
}

// ============================================================
// Error normalization (parent side)
// ============================================================

export type SubprocessWorkerErrorCode =
  | 'CHILD_EXITED' // worker died before answering (crash / tolerance flood / external kill)
  | 'TIMEOUT' // request exceeded its deadline
  | 'ABORTED' // request aborted through its AbortSignal
  | 'REQUEST_FAILED' // worker answered with an error frame for this id
  | 'DISPOSED'; // worker disposed while requests were pending

export class SubprocessWorkerError extends Error {
  readonly code: SubprocessWorkerErrorCode;
  /** Child exit code when known (CHILD_EXITED paths). */
  readonly exitCode: number | null;
  /** Terminating signal when known. */
  readonly signal: NodeJS.Signals | null;
  /** Capped stderr tail captured before the child died. */
  readonly stderrTail: string;

  constructor(
    code: SubprocessWorkerErrorCode,
    message: string,
    details?: { exitCode?: number | null; signal?: NodeJS.Signals | null; stderrTail?: string },
  ) {
    super(message);
    this.name = 'SubprocessWorkerError';
    this.code = code;
    this.exitCode = details?.exitCode ?? null;
    this.signal = details?.signal ?? null;
    this.stderrTail = details?.stderrTail ?? '';
  }
}

/** Cap for the stderr tail kept for error messages. */
const STDERR_TAIL_BYTES = 4 * 1024;
/** argv flags used to forward tolerance parameters to the worker template. */
const TOLERANCE_LIMIT_FLAG = '--subprocess-worker-uncaught-limit';
const TOLERANCE_WINDOW_FLAG = '--subprocess-worker-uncaught-window-ms';

// ============================================================
// Parent side
// ============================================================

export interface SubprocessWorkerOptions {
  /** Diagnostics label used in error messages. */
  name: string;
  /** Worker entry path — a compiled `.mjs` chunk in production, the `.ts` source in dev/tests. */
  workerPath: string;
  /** Extra node argv inserted before the worker path (e.g. V8 flags). */
  nodeArgs?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /**
   * Crash-tolerance parameters forwarded to the worker via argv (the worker
   * template reads them in {@link runSubprocessWorker}). Defaults to the
   * worker template's own defaults (25 uncaught exceptions / 15s window).
   */
  tolerance?: { uncaughtLimit?: number; uncaughtWindowMs?: number };
  /** Default per-request deadline when `request()` is called without one. */
  defaultRequestTimeoutMs?: number;
  /** Grace between SIGTERM and SIGKILL on {@link SubprocessWorker.dispose}. */
  killGraceMs?: number;
}

export interface SubprocessWorkerRequestOptions {
  /** Per-request deadline in ms. */
  timeoutMs?: number;
  /** Abort signal wired through to the worker (frame `{type:'abort', id}`). */
  signal?: AbortSignal;
}

interface PendingRequest {
  readonly id: number;
  /** The child this request was written to — a stale close from a replaced
   *  child must not settle requests that belong to the current child. */
  child: ChildProcess | null;
  resolve: (value: unknown) => void;
  reject: (error: SubprocessWorkerError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal: AbortSignal | null;
  onAbort: (() => void) | null;
}

/**
 * Typed JSONL front-end to a worker subprocess. The child is spawned lazily
 * on the first request and kept alive across requests (module-graph
 * amortisation); if it dies, pending requests are rejected with a normalized
 * {@link SubprocessWorkerError} and the next request respawns it — a worker
 * crash costs one failed in-flight request, never the server.
 */
export class SubprocessWorker {
  private readonly options: SubprocessWorkerOptions;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<
    (notification: SubprocessWorkerNotification) => void
  >();
  private child: ChildProcess | null = null;
  private disposed = false;
  private nextId = 1;
  private stderrTail = '';

  constructor(options: SubprocessWorkerOptions) {
    this.options = options;
  }

  /** Subscribe to worker `log`/`event` frames (progress reporting, diagnostics). */
  onNotification(listener: (notification: SubprocessWorkerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  /**
   * Send a correlated request and await the worker's `result` frame.
   * `payload` must be JSON-serializable; the generic parameter describes the
   * consumer-defined request shape, `TResult` the worker's answer shape.
   */
  request<TRequest, TResult>(
    payload: TRequest,
    requestOptions?: SubprocessWorkerRequestOptions,
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(
        new SubprocessWorkerError('DISPOSED', `[${this.options.name}] worker is disposed`),
      );
    }
    const signal = requestOptions?.signal ?? null;
    if (signal?.aborted) {
      return Promise.reject(
        new SubprocessWorkerError('ABORTED', `[${this.options.name}] request aborted before start`),
      );
    }

    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      // Widen TResult to unknown for the untyped pending map (settled via
      // this.settle, which resolves with whatever the worker returned).
      const pending: PendingRequest = {
        id,
        child: null,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: null,
        signal,
        onAbort: null,
      };
      this.pending.set(id, pending);

      const timeoutMs = requestOptions?.timeoutMs ?? this.options.defaultRequestTimeoutMs;
      if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
        pending.timer = setTimeout(() => {
          this.settle(
            id,
            new SubprocessWorkerError(
              'TIMEOUT',
              `[${this.options.name}] request #${id} timed out after ${timeoutMs}ms`,
            ),
          );
          // The worker template aborts the handler through its per-request
          // controller; a wedged worker that never answers is reaped by
          // dispose() / ProcessRegistry rather than killing a possibly
          // healthy batch channel here.
          this.send({ type: 'abort', id });
        }, timeoutMs);
      }

      if (signal) {
        pending.onAbort = () => {
          this.settle(
            id,
            new SubprocessWorkerError('ABORTED', `[${this.options.name}] request #${id} aborted`),
          );
          this.send({ type: 'abort', id });
        };
        signal.addEventListener('abort', pending.onAbort, { once: true });
      }

      try {
        const child = this.ensureChild();
        pending.child = child;
        this.send({ type: 'start', id, options: payload }, child);
      } catch (error) {
        this.settle(
          id,
          new SubprocessWorkerError(
            'CHILD_EXITED',
            `[${this.options.name}] failed to write request: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  /** Kill the child and reject pending requests. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    this.child = null;
    this.settleAllPending(
      new SubprocessWorkerError('DISPOSED', `[${this.options.name}] worker disposed`),
    );
    if (!child) return;
    await killChildProcess(child, this.options.killGraceMs ?? 2_000);
  }

  private settle(id: number, error?: SubprocessWorkerError, value?: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.onAbort && pending.signal) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    if (error) pending.reject(error);
    else pending.resolve(value);
  }

  private settleAllPending(error: SubprocessWorkerError): void {
    for (const id of Array.from(this.pending.keys())) {
      this.settle(id, error);
    }
  }

  /** Settle only the requests that were written to `child`. A stale close
   *  from a replaced child must not kill the current child's in-flight
   *  requests — Windows delivers 'close' late enough to race a respawn. */
  private settlePendingForChild(child: ChildProcess, error: SubprocessWorkerError): void {
    for (const id of Array.from(this.pending.keys())) {
      const pending = this.pending.get(id);
      if (!pending || pending.child !== child) continue;
      this.settle(id, error);
    }
  }

  private ensureChild(): ChildProcess {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      return this.child;
    }

    const args = buildWorkerSpawnArgs(this.options.workerPath, this.options.nodeArgs ?? [], {
      uncaughtLimit: this.options.tolerance?.uncaughtLimit,
      uncaughtWindowMs: this.options.tolerance?.uncaughtWindowMs,
    });
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: this.options.env,
      cwd: this.options.cwd,
    });
    ProcessRegistry.register(child);
    // NOTE: deliberately NOT unref'd (unlike WorkerPool's worker threads).
    // Unref'ing the child and its stdio handles starves the parent's pipe
    // reads whenever the event loop runs on promises alone — data events are
    // then delayed until unrelated loop activity or lost entirely to the
    // child's exit event. An idle worker keeping the loop alive is the same
    // contract as ExternalToolRunner's children; teardown is handled by
    // dispose() and ProcessRegistry.
    this.child = child;
    this.stderrTail = '';

    child.stdin?.on('error', () => {
      // EPIPE when the child dies before consuming stdin — the 'close'
      // handler below normalizes pending requests.
    });

    const stdoutLines = createInterface({ input: child.stdout!, terminal: false });
    stdoutLines.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      const frame = parseWorkerOutboundFrame(trimmed);
      if (!frame) return; // tolerate stray noise on the protocol channel
      this.handleFrame(frame);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    child.on('exit', () => {
      // Earliest death signal — 'close' can be delivered late enough to race a
      // respawn request, which would otherwise bind to and write into a dying
      // child (the EPIPE is swallowed and the request pends forever). Clearing
      // here makes ensureChild() spawn a fresh channel immediately.
      if (this.child === child) this.child = null;
    });

    child.on('error', (error) => {
      // Spawn failure (ENOENT-style) — no 'close' follows reliably.
      if (this.child === child) this.child = null;
      this.settlePendingForChild(
        child,
        new SubprocessWorkerError(
          'CHILD_EXITED',
          `[${this.options.name}] worker spawn failed: ${error.message}`,
          { stderrTail: this.stderrTail.trim() },
        ),
      );
    });

    child.on('close', (code, signal) => {
      if (this.child === child) this.child = null;
      this.settlePendingForChild(
        child,
        new SubprocessWorkerError(
          'CHILD_EXITED',
          `[${this.options.name}] worker exited unexpectedly with code ${code ?? 'null'} signal ${signal ?? 'null'}. stderr: ${this.stderrTail.trim() || '<empty>'}`,
          { exitCode: code, signal: signal ?? null, stderrTail: this.stderrTail.trim() },
        ),
      );
    });

    return child;
  }

  private handleFrame(frame: SubprocessWorkerOutboundMessage): void {
    if (frame.type === 'result') {
      this.settle(frame.id, undefined, frame.result);
      return;
    }
    if (frame.type === 'error') {
      if (frame.id === undefined) {
        // Worker-global failure (e.g. tolerance flood): settle everything and
        // retire the channel — the worker exits right after this frame, and
        // the next request must respawn instead of reusing the dying child.
        this.settleAllPending(
          new SubprocessWorkerError('CHILD_EXITED', `[${this.options.name}] ${frame.message}`),
        );
        this.child = null;
      } else {
        this.settle(
          frame.id,
          new SubprocessWorkerError('REQUEST_FAILED', `[${this.options.name}] ${frame.message}`),
        );
      }
      return;
    }
    for (const listener of this.notificationListeners) {
      listener(frame);
    }
  }

  private send(message: SubprocessWorkerInboundMessage, target?: ChildProcess): void {
    try {
      const child = target ?? this.ensureChild();
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    } catch {
      // The child died mid-write; its 'close' handler normalizes pending requests.
    }
  }
}

// ============================================================
// Spawn-arg construction (parent + dev-time TS loader)
// ============================================================

export interface WorkerToleranceArgs {
  uncaughtLimit?: number;
  uncaughtWindowMs?: number;
}

/**
 * Build the argv for `node <workerPath>`. Tolerance parameters are forwarded
 * as script arguments AFTER the worker path — unknown flags placed before the
 * script would make node itself reject the invocation. The parent's execArgv
 * is forwarded — under tsx dev mode it carries the TS loader so the worker
 * can execute `.ts` entry sources; `--inspect*` flags are stripped because a
 * second inspector endpoint would fail the child. In production the path is
 * always a compiled `.mjs` chunk and no loader is added.
 */
export function buildWorkerSpawnArgs(
  workerPath: string,
  nodeArgs: string[],
  tolerance?: WorkerToleranceArgs,
): string[] {
  const args = [...nodeArgs];

  const forwardedExecArgv = process.execArgv.filter((arg) => !arg.startsWith('--inspect'));
  args.push(...forwardedExecArgv);

  // A bare `node` cannot execute TypeScript: when the entry is a `.ts`
  // source (dev/tests), make sure a TS loader is present. tsx registers its
  // loader via execArgv when the parent itself runs under tsx, so the extra
  // `--import` is only needed when the parent is plain node / vitest.
  if (/\.tsx?$/i.test(workerPath) && !forwardedExecArgv.some((arg) => arg.includes('tsx'))) {
    args.push('--import', 'tsx');
  }

  args.push(workerPath);

  if (tolerance?.uncaughtLimit !== undefined)
    args.push(`${TOLERANCE_LIMIT_FLAG}=${tolerance.uncaughtLimit}`);
  if (tolerance?.uncaughtWindowMs !== undefined) {
    args.push(`${TOLERANCE_WINDOW_FLAG}=${tolerance.uncaughtWindowMs}`);
  }

  return args;
}

// ============================================================
// Worker side — crash tolerance window
// ============================================================

export interface CrashGuardOptions {
  /** Max tolerated uncaught exceptions inside the window (default 25). */
  uncaughtLimit?: number;
  /** Sliding window in ms (default 15_000). */
  uncaughtWindowMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Invoked instead of `process.exit` when the flood limit is exceeded. */
  onFlood?: (count: number, windowMs: number) => void;
}

export interface CrashGuard {
  /** Feed one uncaught exception; returns the count currently in-window. */
  record(): number;
  /** Current in-window count without recording (tests). */
  size(): number;
}

/**
 * Sliding-window uncaught-exception tolerance. A single bad input must not
 * kill a whole batch — the worker logs and continues — but a flood means the
 * worker/session is genuinely corrupted, so the caller exits instead of
 * spinning forever (hackbrowser-worker crash-guard pattern).
 */
export function createCrashGuard(options: CrashGuardOptions = {}): CrashGuard {
  const limit = options.uncaughtLimit ?? 25;
  const windowMs = options.uncaughtWindowMs ?? 15_000;
  const now = options.now ?? Date.now;
  let timestamps: number[] = [];

  return {
    record(): number {
      const stamp = now();
      timestamps.push(stamp);
      timestamps = timestamps.filter((entry) => stamp - entry < windowMs);
      if (timestamps.length > limit) {
        options.onFlood?.(timestamps.length, windowMs);
      }
      return timestamps.length;
    },
    size(): number {
      const stamp = now();
      timestamps = timestamps.filter((entry) => stamp - entry < windowMs);
      return timestamps.length;
    },
  };
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return (error.stack ?? error.message).slice(0, 500);
  try {
    return String(error).slice(0, 500);
  } catch {
    return '<unstringifiable>';
  }
}

/** Read tolerance parameters from spawn argv (parent → worker contract). */
function readToleranceFromArgv(argv: string[]): WorkerToleranceArgs {
  const read = (flag: string): number | undefined => {
    const prefix = `${flag}=`;
    const raw = argv.find((arg) => arg.startsWith(prefix));
    if (!raw) return undefined;
    const value = Number(raw.slice(prefix.length));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    uncaughtLimit: read(TOLERANCE_LIMIT_FLAG),
    uncaughtWindowMs: read(TOLERANCE_WINDOW_FLAG),
  };
}

// ============================================================
// Worker side — entry template
// ============================================================

export interface SubprocessWorkerHandlerContext {
  /** Aborted when the parent sends `{type:'abort', id}` or stdin closes. */
  signal: AbortSignal;
}

export type SubprocessWorkerHandler<TOptions, TResult> = (
  options: TOptions,
  context: SubprocessWorkerHandlerContext,
) => Promise<TResult>;

export interface SubprocessWorkerRunOptions {
  /** Crash-tolerance overrides; by default the parent's argv flags are read. */
  uncaughtLimit?: number;
  uncaughtWindowMs?: number;
  /**
   * Map console.* calls to protocol `log` frames so stray logging inside the
   * handler cannot corrupt the JSONL channel (default true).
   */
  captureConsole?: boolean;
  /**
   * Install the process-level `uncaughtException`/`unhandledRejection`
   * guards (default true). Disable when the worker loop runs embedded in an
   * existing process (tests) instead of a dedicated child.
   */
  installProcessGuards?: boolean;
  /** Injectable streams (tests). Default: process.stdin / process.stdout. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Test hook replacing `process.exit` after a tolerance flood. */
  onFloodExit?: () => void;
}

/**
 * Worker-side entry template. Wires the JSONL loop, per-request abort
 * controllers, console capture, and the crash-tolerance guards, then keeps
 * the process alive until stdin closes. Consumers write a standalone entry
 * script that calls this once with their handler — no protocol code needed.
 *
 * Options and results must be JSON-serializable. Errors thrown by the
 * handler become `{type:'error', id}` frames — the worker keeps serving
 * subsequent requests.
 */
export function runSubprocessWorker<TOptions, TResult>(
  handler: SubprocessWorkerHandler<TOptions, TResult>,
  runOptions: SubprocessWorkerRunOptions = {},
): void {
  const output = runOptions.output ?? process.stdout;
  const input = runOptions.input ?? process.stdin;

  const send = (message: SubprocessWorkerOutboundMessage): void => {
    try {
      output.write(`${JSON.stringify(message)}\n`);
    } catch {
      // Parent died mid-write — stdin close tears the loop down.
    }
  };

  if (runOptions.captureConsole ?? true) installConsoleCapture(send);

  const tolerance = readToleranceFromArgv(process.argv);
  const guard = createCrashGuard({
    uncaughtLimit: runOptions.uncaughtLimit ?? tolerance.uncaughtLimit,
    uncaughtWindowMs: runOptions.uncaughtWindowMs ?? tolerance.uncaughtWindowMs,
    onFlood: (count, windowMs) => {
      const message = `worker aborted after ${count} uncaught exceptions in ${Math.round(
        windowMs / 1000,
      )}s — likely corrupted state`;
      // Last-gasp diagnostics on stderr (synchronous fd write): the parent
      // folds its stderr tail into the normalized child-exit error, so the
      // cause survives even when the final stdout frame loses the race
      // against the exit event on Windows pipes.
      try {
        writeSync(2, `${message}\n`);
      } catch {
        // stderr unavailable (broken pipe) — the frame below is best-effort.
      }
      // Exit only after the final error frame is actually flushed: piping a
      // write and calling process.exit() synchronously races the pipe buffer.
      // The unref'd timer is a fallback for a broken pipe.
      let finished = false;
      const finishFlood = (): void => {
        if (finished) return;
        finished = true;
        if (runOptions.onFloodExit) runOptions.onFloodExit();
        else process.exit(1);
      };
      const flushed = output.write(
        `${JSON.stringify({ type: 'error', message } satisfies SubprocessWorkerOutboundMessage)}\n`,
        () => finishFlood(),
      );
      if (flushed) finishFlood();
      else setTimeout(finishFlood, 1_000).unref();
    },
  });

  // An unhandledRejection escaped every await (fire-and-forget background
  // promise): log and continue — same rationale as the hackbrowser worker.
  if (runOptions.installProcessGuards ?? true) {
    process.on('unhandledRejection', (reason) => {
      send({
        type: 'log',
        level: 'warn',
        message: `unhandledRejection (continuing): ${stringifyError(reason)}`,
      });
    });
    process.on('uncaughtException', (error) => {
      send({
        type: 'log',
        level: 'error',
        message: `uncaughtException (continuing): ${stringifyError(error)}`,
      });
      guard.record();
    });
  }

  const active = new Map<number, AbortController>();
  const lines = createInterface({ input, terminal: false });

  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const frame = parseWorkerInboundFrame(trimmed);
    if (!frame) return;

    if (frame.type === 'abort') {
      active.get(frame.id)?.abort();
      return;
    }

    if (active.has(frame.id)) return; // duplicate start for an in-flight id

    const controller = new AbortController();
    active.set(frame.id, controller);
    void Promise.resolve()
      .then(() => handler(frame.options as TOptions, { signal: controller.signal }))
      .then((result) => {
        send({ type: 'result', id: frame.id, result });
      })
      .catch((error: unknown) => {
        send({ type: 'error', id: frame.id, message: stringifyError(error) });
      })
      .finally(() => {
        active.delete(frame.id);
      });
  });

  // Parent closed stdin (disposed, crashed, or normal shutdown): abort every
  // in-flight request so handlers can wind down. The force-exit backstop only
  // applies to dedicated child processes — when the loop runs embedded in an
  // existing process (injected input, tests) the host owns process lifetime.
  lines.once('close', () => {
    for (const controller of active.values()) controller.abort();
    if (!runOptions.input) {
      setTimeout(() => process.exit(0), 5_000).unref();
    }
  });

  output.on?.('error', () => {
    // EPIPE when the parent dies before draining stdout.
  });
}

/**
 * Redirect console.* to protocol `log` frames. Any stray `console.log` in a
 * handler would otherwise land raw on stdout and break JSONL framing — the
 * transport must stay reserved for protocol messages.
 */
function installConsoleCapture(send: (message: SubprocessWorkerOutboundMessage) => void): void {
  const remap: Array<[keyof Console, 'debug' | 'info' | 'warn' | 'error']> = [
    ['debug', 'debug'],
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ];
  const originals = new Map<keyof Console, (...args: unknown[]) => void>();
  for (const [method, level] of remap) {
    const original = console[method] as unknown as (...args: unknown[]) => void;
    if (typeof original !== 'function') continue;
    originals.set(method, original);
    (console as unknown as Record<string, unknown>)[method as string] = (
      ...args: unknown[]
    ): void => {
      const message = args
        .map((entry) => (typeof entry === 'string' ? entry : stringifyError(entry)))
        .join(' ');
      send({ type: 'log', level, message });
    };
  }
  // Best-effort restore on teardown so embedded/test runtimes are not
  // permanently patched after the worker loop ends.
  process.once('exit', () => {
    for (const [method, original] of originals) {
      (console as unknown as Record<string, unknown>)[method as string] = original;
    }
  });
}

// ============================================================
// Child kill helper (repo taskkill pattern)
// ============================================================

/**
 * Terminate a child and (on Windows) its subtree. Java-based grandchildren
 * ignore SIGTERM/SIGKILL on Windows, hence the taskkill escalation — the same
 * pattern ExternalToolRunner / GhidraAnalyzer use for their own children.
 */
async function killChildProcess(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      if (child.pid !== undefined && child.pid > 0 && process.platform === 'win32') {
        execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], () => {});
      }
      resolve();
    }, graceMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

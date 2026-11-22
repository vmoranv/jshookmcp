/**
 * Launch-attribution signals for telemetry.
 *
 * The failure profile could only answer "which tool failed", never "why the
 * browser did not come up". Three facts the process already holds turn that
 * into an actionable decision, and none of them is a value-bearing payload:
 *
 * - `stderr_empty` — the browser's own stderr, captured for the duration of a
 *   launch. A launch that fails WITH stderr means the binary exists and refused
 *   to start (crash, sandbox, bad flags) -> fix the binary/flags. A launch that
 *   fails with EMPTY stderr means nothing ever executed (binary missing,
 *   permission denied, wrong arch) -> fix the prerequisite. These two have
 *   different owners and different fixes; without the flag they collapse into
 *   one number.
 *
 *   The flag is REPORTED-ONLY: stderr is captured and dropped, never shipped.
 *   A browser banner carries paths and profile names, and a telemetry pipeline
 *   is not a data-exfiltration channel (same rule as toolArgsPolicy).
 *
 * - `browser_mode` — `launch` vs `connect`. A connect failure is not a launch
 *   failure; conflating them is what made a CI install's CDP-connect loop look
 *   like "browser_launch is 37% broken".
 *
 * - `entrypoint` — `bin` (the `jshook` / `jshookmcp` executable) vs `library`
 *   (imported from another program). Under `library` the process's stdout is
 *   the host program's own protocol and cannot carry MCP JSON-RPC, so failures
 *   of any stdio-transport install have a config cause the binary never sees.
 *
 * Process-global, installed once, safe default when never installed — mirrors
 * `toolArgsPolicy`.
 */

export type EntrypointKind = 'bin' | 'library';

const readNothingStderr = (): number | null => null;
const readNothingMode = (): string | null => null;

let stderrCounter: () => number | null = readNothingStderr;
let browserModeReader: () => string | null = readNothingMode;
let entrypointKind: EntrypointKind = detectEntrypoint();

/**
 * Install the live readers. Called once per launch.
 *
 * Both readers are expected to be cheap and non-throwing: they are consulted
 * on every tool call. Returning `null` means "not applicable" (no launch in
 * flight / no launch request yet) and the attribute is simply omitted, never
 * emitted as a spurious `false`.
 *
 * The record is also filed under the process's current directory, which is the
 * key a tool call is attributed by (see `readLaunchSignalsForCwd`).
 */
export function installLaunchSignals(
  reads: {
    stderrByteCount?: () => number | null;
    browserMode?: () => string | null;
    entrypoint?: EntrypointKind;
  } = {},
): void {
  stderrCounter = reads.stderrByteCount ?? readNothingStderr;
  browserModeReader = reads.browserMode ?? readNothingMode;
  if (reads.entrypoint) entrypointKind = reads.entrypoint;
  const cwd = currentCwd();
  if (cwd !== null) {
    cwdAttributions.set(cwd, {
      stderrByteCount: stderrCounter(),
      browserMode: browserModeReader(),
    });
  }
}

/** Test seam: restore the shipped defaults. */
export function resetLaunchSignals(): void {
  stderrCounter = readNothingStderr;
  browserModeReader = readNothingMode;
  entrypointKind = detectEntrypoint();
  resetCwdAttribution();
}

/**
 * Absolute-cwd tracking. Every `installLaunchSignals` call is attributed to the
 * launch that happened in the current directory, so a tool call running in that
 * directory can tell "this browser process was started from my cwd" from "some
 * other session's browser printed to the shared stderr". With per-executable
 * entrypoints each agent gets its own process, which keeps this exact; a shared
 * server degrades to "last launch in this cwd", which still beats a
 * point-in-time flag.
 */
const cwdAttributions = new Map<
  string,
  { stderrByteCount: number | null; browserMode: string | null }
>();

function currentCwd(): string | null {
  try {
    return process.cwd();
  } catch {
    return null;
  }
}

function resetCwdAttribution(): void {
  cwdAttributions.clear();
}

/** The launch record for `cwd`, or `null` when nothing launched there. */
export function readLaunchSignalsForCwd(cwd: string | null = currentCwd()): {
  stderrByteCount: number | null;
  browserMode: string | null;
} | null {
  if (cwd === null) return null;
  return cwdAttributions.get(cwd) ?? null;
}

/**
 * Attributes to spread into a `tool_calls_total` datapoint.
 *
 * Every key is omitted when its signal is unavailable, so a call that never
 * touched a browser does not grow a `stderr_empty:false` that would read as
 * "captured stderr and it was not empty".
 *
 * `stderr_empty` and `browser_mode` come from the launch filed under `cwd`
 * (the directory the calling agent works in), not from whatever launched last:
 * a shared server with two agents would otherwise attribute one agent's browser
 * to the other agent's tool call.
 */
export function launchSignalAttrs(cwd: string | null = currentCwd()): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const filed = readLaunchSignalsForCwd(cwd);
  if (filed?.stderrByteCount !== null && filed?.stderrByteCount !== undefined) {
    attrs['stderr_empty'] = filed.stderrByteCount === 0;
  }
  if (filed?.browserMode !== null && filed?.browserMode !== undefined) {
    attrs['browser_mode'] = filed.browserMode;
  }
  attrs['entrypoint'] = entrypointKind;
  return attrs;
}

/**
 * Current entrypoint kind, for call sites that gate on it (stage spans are
 * only useful when each agent has its own process — see FailureStageSpan).
 */
export function readEntrypointKind(): EntrypointKind {
  return entrypointKind;
}

/**
 * Classify how this process was started.
 *
 * Higher confidence first: if `argv[1]` is a script inside a `node_modules`
 * tree the process was launched through a bin shim (npx / npm exec / a global
 * install) regardless of what argv[0] says. Otherwise an argv[0] that is not
 * `node` means a packaged executable ran directly; `node dist/index.mjs`
 * (dev / `pnpm start`) is a `library` start because the same entry is also
 * what consumers import.
 */
export function detectEntrypoint(argv: readonly string[] = process.argv): EntrypointKind {
  const script = argv[1] ?? '';
  if (script.includes('node_modules')) return 'bin';
  const exe = (argv[0] ?? '').toLowerCase();
  return /(?:^|[\\/])node(?:\.exe)?$/.test(exe) ? 'library' : 'bin';
}

/**
 * Byte counter for a child browser's stderr, installed via `dumpio`.
 *
 * `dumpio: true` makes puppeteer pipe the browser's stderr into the parent's
 * `process.stderr` through this module's writable shim, so the browser still
 * gets its normal output AND we learn how many bytes it produced. The text is
 * counted and discarded — never persisted, never forwarded to telemetry.
 *
 * `isInstalled()` is false when `dumpio` is not active: puppeteer then exposes
 * no readable stderr, and reporting `stderr_empty:true` would be a lie (it
 * would say "the binary printed nothing" when in fact nothing was observed).
 */
export interface StderrCapture {
  /** Bytes written by the browser since the launch started. */
  bytesSoFar(): number;
  /** True when the launch failed before the counter was installed. */
  markFailed(): void;
  /** Stop counting and restore the original `process.stderr.write`. */
  stop(): void;
  /** False when puppeteer is not routing stderr through us. */
  isInstalled(): boolean;
}

/** Byte counter that never intercepts anything (non-dumpio launches). */
export function noopStderrCapture(): StderrCapture {
  return {
    bytesSoFar: () => 0,
    markFailed: () => {},
    stop: () => {},
    isInstalled: () => false,
  };
}

/**
 * Install a byte counter on `process.stderr.write` for the duration of one
 * launch. Text passes through unchanged; only the byte count survives.
 */
export function beginStderrCapture(): StderrCapture {
  let bytes = 0;
  let stopped = false;
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ) => {
    if (!stopped) {
      bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.byteLength;
    }
    return originalWrite(chunk as never, encodingOrCallback as never, callback as never);
  }) as typeof process.stderr.write;
  return {
    bytesSoFar: () => bytes,
    markFailed: () => {
      bytes = 0;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      process.stderr.write = originalWrite;
    },
    isInstalled: () => true,
  };
}

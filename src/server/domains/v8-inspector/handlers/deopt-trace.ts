/**
 * V8 Deopt Trace Handler — v8_deopt_trace
 *
 * Enables deoptimization tracing via CDP Runtime.evaluate with V8 natives syntax
 * and captures deopt events by subscribing to Runtime.consoleAPICalled. V8 prints
 * deopt diagnostics ("[deoptimizing (DEOPT …): … <JS Function <name>>…]") to the
 * console when %TraceDeoptimizations(true) is active — it does NOT raise
 * Debugger.paused events, so we listen on the console channel and parse the log
 * lines. Each captured event records the function name, deopt reason, and the
 * source line of the bailout.
 *
 * The listener + tracing + CDP session are torn down in a finally block so no
 * handle leaks across calls (the previous implementation left a Debugger.paused
 * listener and a setTimeout orphaned per call).
 *
 * Requires a browser with V8 natives syntax (%DebugTrace, %TraceDeoptimizations).
 * Falls back gracefully when natives are not available.
 */

import { argNumber, argBool } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeoptEvent {
  timestamp: number;
  functionName: string;
  reason: string;
  bailoutId?: number;
  inliningId?: number;
  sourcePosition?: number;
}

interface DeoptTraceResult {
  success: boolean;
  error?: string;
  mode: 'natives' | 'unavailable';
  traceEnabled: boolean;
  durationMs: number;
  events: DeoptEvent[];
  eventCount: number;
  summary: string;
  note?: string;
}

// ── CDP Helpers ────────────────────────────────────────────────────────────────

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  detach(): Promise<void>;
}

async function createCDPSession(getPage?: () => Promise<unknown>): Promise<CDPSessionLike | null> {
  if (!getPage) return null;
  try {
    const page = await getPage();
    if (
      page &&
      typeof page === 'object' &&
      'createCDPSession' in page &&
      typeof (page as Record<string, unknown>).createCDPSession === 'function'
    ) {
      const factory = (page as Record<string, unknown>).createCDPSession as () => Promise<unknown>;
      return (await factory()) as CDPSessionLike;
    }
    return null;
  } catch {
    return null;
  }
}

async function checkNativesSupport(session: CDPSessionLike): Promise<boolean> {
  try {
    const resp = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression:
        'typeof %DebugTrace === "function" && typeof %TraceDeoptimizations === "function"',
      returnByValue: true,
      awaitPromise: false,
    });
    return resp?.result?.value === true;
  } catch {
    return false;
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleDeoptTrace(
  args: Record<string, unknown>,
  getPage?: () => Promise<unknown>,
): Promise<DeoptTraceResult> {
  const durationRaw = argNumber(args, 'durationMs', 5000);
  // Mirror definitions.ts minimum:100 / maximum:60000 constraints at runtime
  // (argNumber alone does not enforce schema bounds).
  const durationMs = Math.min(
    60000,
    Math.max(100, Number.isFinite(durationRaw) ? durationRaw : 5000),
  );
  const maxEventsRaw = argNumber(args, 'maxEvents', 50);
  const maxEvents = Math.min(1000, Math.max(1, Number.isFinite(maxEventsRaw) ? maxEventsRaw : 50));
  const enableTracing = argBool(args, 'enable', true);

  const session = await createCDPSession(getPage);
  if (!session) {
    return {
      success: false,
      error:
        'No CDP session available — browser must be connected via browser_launch or browser_attach',
      mode: 'unavailable',
      traceEnabled: false,
      durationMs: 0,
      events: [],
      eventCount: 0,
      summary: 'CDP session unavailable',
    };
  }

  const nativesAvailable = await checkNativesSupport(session);

  if (!nativesAvailable) {
    await session.detach().catch(() => {});
    return {
      success: true,
      mode: 'unavailable',
      traceEnabled: false,
      durationMs: 0,
      events: [],
      eventCount: 0,
      summary: 'V8 natives syntax (%TraceDeoptimizations) not available in this target',
      note: 'Try launching Chrome with --js-flags="--allow-natives-syntax" or --no-sandbox for deopt tracing.',
    };
  }

  const events: DeoptEvent[] = [];
  const startTime = Date.now();

  // %TraceDeoptimizations prints deopt reasons to the V8 console, it does NOT
  // raise Debugger.paused events (the previous wiring assumed it did, and so
  // never captured anything). Subscribe to Runtime.consoleAPICalled and parse
  // the "deoptimizing" / "deoptimize" log lines that V8 emits.
  type ConsoleHandler = (params: Record<string, unknown>) => void;
  const consoleHandler: ConsoleHandler = (params) => {
    const type = params['type'];
    const apiArgs = Array.isArray(params['args']) ? params['args'] : [];
    // V8 deopt logging goes to 'log' / 'verbose' console channels.
    if (type !== 'log' && type !== 'verbose' && type !== 'info') return;
    for (const a of apiArgs) {
      if (typeof a !== 'object' || a === null) continue;
      const desc = (a as Record<string, unknown>)['description'];
      if (typeof desc !== 'string') continue;
      // Lines look like: "[deoptimizing (DEOPT eager): begin 0x... <JS Function <name>...",
      // "... (opt #...) @...] FP to SP delta: ...", "... : deoptimize at <file>:<line>:<col>"
      if (!/deoptim/i.test(desc)) continue;
      // V8 prints "<JS Function NAME (sfi #N)>" or "<JS Function NAME>"; cut at
      // the first '(' or '<' after the name so the captured name is clean.
      const fnMatch = desc.match(/<JS Function ([^()<]+)/);
      const reasonMatch = desc.match(/DEOPT (\w+)/);
      const posMatch = desc.match(/deoptimize at [^:]+:(\d+):(\d+)/);
      const fnName = fnMatch?.[1]?.trim() ?? '<anonymous>';
      const reason = reasonMatch?.[1] ?? 'unknown';
      const posLine = posMatch?.[1];
      events.push({
        timestamp: Date.now() - startTime,
        functionName: fnName,
        reason,
        sourcePosition: posLine ? Number(posLine) : undefined,
      });
      if (events.length >= maxEvents) return;
    }
  };

  const cdp = session as unknown as {
    on?: (event: string, handler: ConsoleHandler) => void;
    off?: (event: string, handler: ConsoleHandler) => void;
    removeListener?: (event: string, handler: ConsoleHandler) => void;
  };

  // Register the console listener BEFORE enabling tracing so we do not miss
  // the first events. try/finally guarantees we tear it down + disable tracing
  // + detach the session on every path (fixes the previous listener/timer leak
  // where Debugger.paused listener and the setTimeout were never cleared).
  try {
    await session.send('Runtime.enable').catch(() => {});
    if (typeof cdp.on === 'function') {
      cdp.on('Runtime.consoleAPICalled', consoleHandler);
    }

    if (enableTracing) {
      await session.send('Runtime.evaluate', {
        expression: `
          (() => {
            if (typeof %TraceDeoptimizations === 'function') {
              %TraceDeoptimizations(true);
              return true;
            }
            return false;
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });
    }

    // Wait for the collection window. We resolve after durationMs; no orphan
    // timer is left running (the previous setTimeout was never cleared).
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, Math.min(durationMs, 10000) - elapsed);
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }

    // Disable tracing
    if (enableTracing) {
      await session
        .send('Runtime.evaluate', {
          expression: `
          (() => {
            if (typeof %TraceDeoptimizations === 'function') {
              %TraceDeoptimizations(false);
              return true;
            }
            return false;
          })()
        `,
          returnByValue: true,
          awaitPromise: false,
        })
        .catch(() => {});
    }
  } catch {
    // Best-effort — continue with whatever events we collected
  } finally {
    if (typeof cdp.off === 'function') {
      cdp.off('Runtime.consoleAPICalled', consoleHandler);
    } else if (typeof cdp.removeListener === 'function') {
      cdp.removeListener('Runtime.consoleAPICalled', consoleHandler);
    }
    await session.detach().catch(() => {});
  }

  const actualDuration = Date.now() - startTime;

  const functionNames = new Set(events.map((e) => e.functionName));
  const summaryParts: string[] = [];
  if (events.length > 0) {
    summaryParts.push(`${events.length} deopt events`);
    summaryParts.push(`${functionNames.size} unique functions affected`);
  } else {
    summaryParts.push('No deopt events captured during trace window');
  }

  return {
    success: true,
    mode: 'natives',
    traceEnabled: enableTracing,
    durationMs: actualDuration,
    events: events.slice(0, maxEvents),
    eventCount: events.length,
    summary: summaryParts.join('; '),
  };
}

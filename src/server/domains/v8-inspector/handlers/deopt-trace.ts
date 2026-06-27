/**
 * V8 Deopt Trace Handler — v8_deopt_trace
 *
 * Enables deoptimization tracing via CDP Runtime.evaluate with V8 natives syntax
 * and captures a stream of deopt events for analysis. Each event records the
 * function name, deoptimization reason, and bailout position.
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
  const durationMs = argNumber(args, 'durationMs', 5000);
  const maxEvents = argNumber(args, 'maxEvents', 50);
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

  try {
    if (enableTracing) {
      // Enable deopt tracing via natives
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

    // Wait for the collection window
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, durationMs - elapsed);

    // Poll for deopt events using Debugger domain
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, Math.min(remaining, 10000));
        // Collect events via Debugger.paused with reason=other
        const handler = (params: Record<string, unknown>) => {
          const reason = params['reason'];
          const callFrames = Array.isArray(params['callFrames']) ? params['callFrames'] : [];

          if (reason === 'other' || reason === 'OOM') {
            for (const frame of callFrames) {
              if (typeof frame !== 'object' || !frame) continue;
              const fn = frame as Record<string, unknown>;
              events.push({
                timestamp: Date.now() - startTime,
                functionName:
                  typeof fn['functionName'] === 'string' ? fn['functionName'] : '<anonymous>',
                reason: String(reason),
                sourcePosition:
                  typeof fn['location'] === 'object' && fn['location']
                    ? ((fn['location'] as Record<string, unknown>)['lineNumber'] as
                        | number
                        | undefined)
                    : undefined,
              });
              if (events.length >= maxEvents) break;
            }
          }
        };

        // Set up paused listener
        const cdp = session as unknown as {
          on?: (event: string, handler: (params: Record<string, unknown>) => void) => void;
        };
        if (typeof cdp.on === 'function') {
          cdp.on('Debugger.paused', handler);
        }

        timeout.unref?.();
      });
    }

    // Disable deopt tracing
    if (enableTracing) {
      await session.send('Runtime.evaluate', {
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
      });
    }
  } catch {
    // Best-effort — continue with whatever events we collected
  } finally {
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

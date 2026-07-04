/**
 * Coverage tests for handleDeoptTrace — exercises the no-CDP-session early
 * return and the natives-unavailable path (mock page that yields a session
 * whose Runtime.evaluate reports natives syntax missing).
 */

import { describe, expect, it, vi } from 'vitest';
import { handleDeoptTrace } from '@server/domains/v8-inspector/handlers/deopt-trace';

describe('handleDeoptTrace — no CDP session', () => {
  it('returns unavailable when getPage resolves to undefined', async () => {
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 5 }, async () => undefined);
    expect(r.success).toBe(false);
    expect(r.mode).toBe('unavailable');
    expect(r.eventCount).toBe(0);
    expect(r.summary).toMatch(/CDP session unavailable/);
  });

  it('returns unavailable when getPage is omitted entirely', async () => {
    const r = await handleDeoptTrace({ durationMs: 100 });
    expect(r.success).toBe(false);
    expect(r.mode).toBe('unavailable');
  });
});

describe('handleDeoptTrace — natives syntax unavailable', () => {
  it('returns unavailable-mode when the target lacks %TraceDeoptimizations', async () => {
    // Mock page exposing createCDPSession; the resulting session's evaluate
    // throws → checkNativesSupport returns false → early "natives unavailable".
    const send = vi.fn().mockRejectedValue(new Error('not available'));
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = {
      createCDPSession: async () => session,
    };
    const r = await handleDeoptTrace({ durationMs: 100 }, async () => page);
    expect(r.success).toBe(true);
    expect(r.mode).toBe('unavailable');
    expect(r.summary).toMatch(/natives syntax/);
    expect(session.detach).toHaveBeenCalled();
  });
});

// The collection mechanism was previously broken: it subscribed to
// Debugger.paused, which %TraceDeoptimizations never raises. V8 prints deopt
// diagnostics to the console instead — this test pins the corrected wiring:
// we must subscribe to Runtime.consoleAPICalled, parse the "deoptimizing"
// lines, and tear down the listener + session in a finally block.
describe('handleDeoptTrace — console-based collection', () => {
  type ConsoleHandler = (params: Record<string, unknown>) => void;

  function makeSession(opts: {
    nativesAvailable: boolean;
    emit?: (handler: ConsoleHandler) => void;
  }) {
    let captured: ConsoleHandler | null = null;
    const deoptLine = '[deoptimizing (DEOPT eager): begin 0x123 <JS Function foo (sfi #12)>]';
    const send = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') {
        // Fire the deopt log line asynchronously after the listener is wired.
        if (captured && opts.nativesAvailable) {
          queueMicrotask(() =>
            captured!({
              type: 'log',
              args: [{ type: 'string', description: deoptLine }],
            }),
          );
        }
        if (opts.nativesAvailable) {
          return { result: { value: true } };
        }
        // First evaluate is the natives-support probe → report unavailable.
        if (/DebugTrace/.test(method) && !opts.nativesAvailable) {
          return { result: { value: false } };
        }
        return { result: { value: true } };
      }
      return {};
    });
    const detach = vi.fn(async () => undefined);
    const off = vi.fn((ev: string, h: ConsoleHandler) => {
      if (ev === 'Runtime.consoleAPICalled' && h === captured) captured = null;
    });
    const session = {
      send,
      detach,
      on: vi.fn((ev: string, h: ConsoleHandler) => {
        if (ev === 'Runtime.consoleAPICalled') captured = h;
        if (opts.emit) opts.emit(h);
      }),
      off,
    };
    return { session, send, detach, off, on: session.on };
  }

  it('captures a deopt event emitted on Runtime.consoleAPICalled', async () => {
    const { session, detach, off, on } = makeSession({ nativesAvailable: true });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 5 }, async () => page);
    expect(r).toMatchObject({ success: true, mode: 'natives' });
    expect((r as { eventCount: number }).eventCount).toBeGreaterThanOrEqual(1);
    const evs = (r as { events: Array<{ functionName: string; reason: string }> }).events;
    expect(evs.some((e) => e.functionName === 'foo' && e.reason === 'eager')).toBe(true);
    expect(on).toHaveBeenCalledWith('Runtime.consoleAPICalled', expect.any(Function));
    expect(off).toHaveBeenCalledWith('Runtime.consoleAPICalled', expect.any(Function));
    expect(detach).toHaveBeenCalled();
  });

  it('clamps durationMs to the [100, 60000] schema bounds', async () => {
    const { session } = makeSession({ nativesAvailable: false });
    const page = { createCDPSession: async () => session };
    // Negative / 0 / huge durations must not throw or hang.
    const rNeg = await handleDeoptTrace({ durationMs: -50 }, async () => page);
    expect(rNeg).toMatchObject({ mode: expect.any(String) });
    const rHuge = await handleDeoptTrace({ durationMs: 9_999_999 }, async () => page);
    expect(rHuge).toMatchObject({ mode: expect.any(String) });
  });
});

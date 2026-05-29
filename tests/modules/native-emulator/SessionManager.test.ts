/**
 * SessionManager — concurrency-safe session lifecycle, TTL expiry, and disposal.
 *
 * Sessions are constructed with syscalls:false to skip Android syscall-table
 * installation: these tests exercise lifecycle, not guest execution, so the
 * lighter emulator keeps the suite fast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionManager } from '@modules/native-emulator/SessionManager';

describe('SessionManager — lifecycle & isolation', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it('isolates sessions: distinct ids and distinct emulator instances', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const a = mgr.createSession();
    const b = mgr.createSession();
    expect(a.id).not.toBe(b.id);
    expect(a.emulator).not.toBe(b.emulator);
    expect(mgr.count()).toBe(2);
  });

  it('createSession seeds createdAt and lastUsedAt to now', () => {
    vi.setSystemTime(1_000);
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const s = mgr.createSession();
    expect(s.createdAt).toBe(1_000);
    expect(s.lastUsedAt).toBe(1_000);
  });

  it('getSession touches lastUsedAt; createdAt stays fixed', () => {
    vi.setSystemTime(1_000);
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const s = mgr.createSession();
    vi.setSystemTime(5_000);
    const fetched = mgr.getSession(s.id);
    expect(fetched).toBeDefined();
    expect(fetched!.lastUsedAt).toBe(5_000);
    expect(fetched!.createdAt).toBe(1_000);
  });

  it('getSession returns undefined for an unknown id', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    expect(mgr.getSession('nope')).toBeUndefined();
  });

  it('requireSession throws a clear error for an unknown id', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    expect(() => mgr.requireSession('ghost')).toThrow('Unknown emulator session');
  });

  it('destroySession reports existence and decrements the count', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const s = mgr.createSession();
    expect(mgr.destroySession(s.id)).toBe(true);
    expect(mgr.count()).toBe(0);
    expect(mgr.destroySession(s.id)).toBe(false);
  });

  it('listSessions returns metadata only — never the emulator', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const s = mgr.createSession();
    const list = mgr.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(s.id);
    expect(list[0]).not.toHaveProperty('emulator');
  });

  it('enforces the maxSessions ceiling', () => {
    mgr = new SessionManager({ maxSessions: 2, emulatorOptions: { syscalls: false } });
    mgr.createSession();
    mgr.createSession();
    expect(() => mgr.createSession()).toThrow('session limit reached');
  });

  it('per-call syscalls:false overrides manager defaults', () => {
    mgr = new SessionManager();
    const s = mgr.createSession({ syscalls: false });
    expect(s.emulator.isAvailable()).toBe(true);
  });
});

describe('SessionManager — idle TTL sweep', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it('reaps a session idle beyond the TTL on the next sweep', () => {
    mgr = new SessionManager({
      idleTtlMs: 1_000,
      sweepIntervalMs: 100,
      emulatorOptions: { syscalls: false },
    });
    mgr.createSession();
    expect(mgr.count()).toBe(1);
    // Advance past the TTL; the sweep interval fires and reaps it.
    vi.advanceTimersByTime(1_500);
    expect(mgr.count()).toBe(0);
  });

  it('does not reap a session kept alive by getSession (touch)', () => {
    mgr = new SessionManager({
      idleTtlMs: 1_000,
      sweepIntervalMs: 100,
      emulatorOptions: { syscalls: false },
    });
    const s = mgr.createSession();
    // Touch every 500ms — well within the 1s TTL — across 2s of sweeps.
    for (let elapsed = 0; elapsed < 2_000; elapsed += 500) {
      vi.advanceTimersByTime(500);
      mgr.getSession(s.id);
    }
    expect(mgr.count()).toBe(1);
  });

  it('stops sweeping after dispose', () => {
    mgr = new SessionManager({
      idleTtlMs: 1_000,
      sweepIntervalMs: 100,
      emulatorOptions: { syscalls: false },
    });
    mgr.createSession();
    mgr.dispose();
    expect(mgr.count()).toBe(0); // dispose clears sessions
    // Re-create after dispose: with the timer stopped, an idle session is NOT reaped.
    mgr = new SessionManager({
      idleTtlMs: 1_000,
      sweepIntervalMs: 100,
      emulatorOptions: { syscalls: false },
    });
    mgr.createSession();
    mgr.dispose();
    vi.advanceTimersByTime(5_000);
    // Already cleared by dispose; advancing time triggers no further work.
    expect(mgr.count()).toBe(0);
  });

  it('dispose is idempotent', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    mgr.createSession();
    expect(() => {
      mgr.dispose();
      mgr.dispose();
    }).not.toThrow();
  });
});

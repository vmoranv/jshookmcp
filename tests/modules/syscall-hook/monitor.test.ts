import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import {
  MAX_CAPTURED_EVENTS,
  SYSCALL_TRACE_KILL_GRACE_MS,
  SyscallMonitor,
} from '@modules/syscall-hook/SyscallMonitor';
import { RingBuffer } from '@utils/RingBuffer';

type EventHandler = (...args: any[]) => void;

function createFakeChildProcess() {
  const processHandlers = new Map<string, EventHandler[]>();
  const stdoutHandlers = new Map<string, EventHandler[]>();
  const stderrHandlers = new Map<string, EventHandler[]>();

  const child = {
    stdout: {
      on: vi.fn((event: string, handler: EventHandler) => {
        const handlers = stdoutHandlers.get(event) ?? [];
        handlers.push(handler);
        stdoutHandlers.set(event, handlers);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: EventHandler) => {
        const handlers = stderrHandlers.get(event) ?? [];
        handlers.push(handler);
        stderrHandlers.set(event, handlers);
      }),
    },
    kill: vi.fn(() => true),
    exitCode: null as number | null,
    signalCode: null as string | null,
    on: vi.fn((event: string, handler: EventHandler) => {
      const handlers = processHandlers.get(event) ?? [];
      handlers.push(handler);
      processHandlers.set(event, handlers);
    }),
    once: vi.fn((event: string, handler: EventHandler) => {
      const handlers = processHandlers.get(event) ?? [];
      handlers.push(handler);
      processHandlers.set(event, handlers);
    }),
    emit(event: string, ...args: any[]) {
      // Emit-and-clear gives 'once' semantics for both registration styles;
      // the tests never emit the same event twice on the same child.
      const handlers = processHandlers.get(event) ?? [];
      processHandlers.delete(event);
      for (const handler of handlers) {
        handler(...args);
      }
    },
    emitStdout(chunk: string | Buffer) {
      for (const handler of stdoutHandlers.get('data') ?? []) {
        handler(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
    },
    emitStderr(chunk: string | Buffer) {
      for (const handler of stderrHandlers.get('data') ?? []) {
        handler(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
    },
  };

  return child;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => createFakeChildProcess()),
}));

const mockSpawn = vi.mocked(spawn);

describe('SyscallMonitor', () => {
  let monitor: SyscallMonitor;

  beforeEach(() => {
    monitor = new SyscallMonitor();
    vi.clearAllMocks();
  });

  it('reports supported backends for the current platform', () => {
    expect(Array.isArray(monitor.getSupportedBackends())).toBe(true);
  });

  it('starts in simulation mode when requested', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats()).toHaveProperty('backend');
  });

  it('captures synthetic events after start', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    const events = await monitor.captureEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it('filters captured events by syscall name', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    const events = await monitor.captureEvents({ name: ['connect'] });
    expect(events.every((event) => event.syscall === 'connect')).toBe(true);
  });

  it('stops monitoring cleanly', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    await monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('falls back to simulation when subprocess capture fails', async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats()).toHaveProperty('subprocessError');
  });

  it('kills the active subprocess when stopping a real capture session', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });

    await monitor.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('parses strace output emitted on stderr into captured events', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithStrace(4321);
    expect(mockSpawn).toHaveBeenCalledWith(
      'strace',
      ['-p', '4321', '-f', '-yy', '-X', 'verbose', '-e', 'trace=all', '-t'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.emitStderr(
      '4321 14:30:00.123456 openat(AT_FDCWD, "/tmp/foo", O_RDONLY) = 3 <0.000123>\n',
    );

    const events = await monitor.captureEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        pid: 4321,
        syscall: 'openat',
        args: ['AT_FDCWD', '"/tmp/foo"', 'O_RDONLY'],
        returnValue: 3,
      }),
    );
    expect(events[0]?.duration).toBeCloseTo(0.123, 6);
  });

  it('preserves strace fd path annotations in syscall args', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithStrace(4321);
    child.emitStderr('4321 14:30:00.123456 read(3</tmp/foo>, "abc", 3) = 3 <0.000010>\n');

    const events = await monitor.captureEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        pid: 4321,
        syscall: 'read',
        args: ['3</tmp/foo>', '"abc"', '3'],
        returnValue: 3,
      }),
    );
  });

  it('parses ETW stdout lines into captured events', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithETW(9876);
    child.emitStdout(
      '[2024-01-15 14:30:00.123] PID=9999 NtCreateFile Handle=0x90 Status=0x00000000\n',
    );

    const events = await monitor.captureEvents();
    expect(events).toEqual([
      expect.objectContaining({
        pid: 9999,
        syscall: 'NtCreateFile',
        args: ['Handle=0x90', 'Status=0x00000000'],
      }),
    ]);
  });

  it('parses dtrace stdout lines into captured events', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithDTrace(2468);
    // A return probe with no buffered entry still emits a best-effort event
    // carrying returnValue (no duration can be computed).
    child.emitStdout('1234   0  5678  open_nocancel:return  3  1000\n');

    const events = await monitor.captureEvents();
    expect(events).toEqual([
      expect.objectContaining({
        pid: 5678,
        syscall: 'open_nocancel',
        returnValue: 3,
      }),
    ]);
  });

  it('parses two-column dtrace printf output (no CPU prefix)', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithDTrace(2468);
    // printf("%d %d %s:return ...", pid, pid, probefunc, ...) → two columns.
    child.emitStdout('5678  5678  open_nocancel:return  3  1000\n');

    const events = await monitor.captureEvents();
    expect(events).toEqual([
      expect.objectContaining({
        pid: 5678,
        syscall: 'open_nocancel',
        returnValue: 3,
      }),
    ]);
  });

  it('pairs dtrace entry/return probes to capture returnValue and duration', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithDTrace(2468);
    // Entry: <timestampNs> <arg0-copied-tail>; buffered, emits nothing.
    child.emitStdout('1234   0  5678  open_nocancel:entry  5000000  /private/tmp/foo O_RDONLY\n');
    let events = await monitor.captureEvents();
    expect(events).toHaveLength(0);

    // Return: <returnValue> <timestampNs>; pairs against the buffered entry.
    child.emitStdout('1234   0  5678  open_nocancel:return  3  5500000\n');
    events = await monitor.captureEvents();
    expect(events).toEqual([
      expect.objectContaining({
        pid: 5678,
        syscall: 'open_nocancel',
        args: ['/private/tmp/foo', 'O_RDONLY'],
        returnValue: 3,
      }),
    ]);
    // duration = (5500000 - 5000000) ns / 1e6 = 0.5 ms
    expect(events[0]?.duration).toBeCloseTo(0.5, 6);
  });

  it('emits dtrace return-only events with numeric returnValue parsed from the tail', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithDTrace(2468);
    // Non-numeric returnValue leaves returnValue undefined (best-effort fallback).
    child.emitStdout('1234   0  5678  getuid:return  ENOTSUP  2000\n');

    const events = await monitor.captureEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.returnValue).toBeUndefined();
  });

  it('passes requested ETW provider names through to logman as GUID flags', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = {
      startedAt: Date.now(),
      etwProviders: ['kernel-network', 'kernel-file'],
    };
    await (monitor as any).captureWithETW(1357);

    const [, logmanArgs] = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1]!.slice(0, 2);
    expect(logmanArgs).toEqual(
      expect.arrayContaining([
        '-p',
        '{7dd42a49-5329-4832-8dfd-43d979153a88}',
        '0xff',
        '-p',
        '{edd08927-9cc4-4e65-b970-c2560fb5c289}',
        '0xff',
      ]),
    );
  });

  it('falls back to the NT Kernel Logger session when no ETW providers are requested', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now(), etwProviders: [] };
    await (monitor as any).captureWithETW(1357);

    const logmanArgs = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1]![1];
    expect(logmanArgs).toEqual(expect.arrayContaining(['-p', 'NT Kernel Logger', '0x10000']));
  });

  it('falls back to simulation when tracer readiness times out', async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => child as any);

    const startPromise = monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });

    await vi.advanceTimersByTimeAsync(3000);
    await startPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats().subprocessError).toContain('did not signal readiness');
    vi.useRealTimers();
  });

  it('rejects ETW capture when the trace session exits non-zero before readiness', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('exit', 1));
      return child as any;
    });

    await expect((monitor as any).captureWithETW(1234)).rejects.toThrow(/ended \(code 1\)/);
  });

  it('rejects dtrace capture when the subprocess reports an error', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('error', new Error('permission denied')));
      return child as any;
    });

    await expect((monitor as any).captureWithDTrace(1234)).rejects.toThrow(/permission denied/);
  });

  // ── Session 61: getStats session-config introspection ───────────────────────

  it('exposes pid/simulate/etwProviders in getStats for an active etw session', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 5555,
      simulate: true,
      etwProviders: ['kernel-network'],
    });
    const stats = monitor.getStats();
    expect(stats).toMatchObject({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 5555,
      simulate: true,
    });
    // etwProviders only surfaced on etw backend
    if (process.platform === 'win32') {
      expect(stats.etwProviders).toEqual(['kernel-network']);
    }
  });

  it('omits session config fields when no session is active', async () => {
    const stats = monitor.getStats();
    expect(stats.pid).toBeUndefined();
    expect(stats.simulate).toBeUndefined();
    expect(stats.etwProviders).toBeUndefined();
  });

  it('reports simulate=false when a real subprocess is attached', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 7777,
      simulate: false,
    });
    const stats = monitor.getStats();
    expect(stats.simulate).toBe(false);
    expect(stats.subprocessActive).toBe(true);
  });

  it('clears session config after stop()', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 5555,
      simulate: true,
    });
    await monitor.stop();
    const stats = monitor.getStats();
    expect(stats.pid).toBeUndefined();
    expect(stats.simulate).toBeUndefined();
  });

  // ── Session 61: ETW provider catalog (static discovery) ─────────────────────

  it('ETW_PROVIDER_CATALOG entries align with ETW_PROVIDERS GUIDs', async () => {
    const { ETW_PROVIDER_CATALOG, ETW_PROVIDERS } =
      await import('@modules/syscall-hook/SyscallMonitor');
    for (const entry of ETW_PROVIDER_CATALOG) {
      expect(entry.guid).toBe(ETW_PROVIDERS[entry.name]);
      expect(entry.description.length).toBeGreaterThan(10);
    }
    // Catalog covers every known provider name
    const catalogNames = ETW_PROVIDER_CATALOG.map((e: any) => e.name).toSorted();
    const providerNames = Object.keys(ETW_PROVIDERS).toSorted();
    expect(catalogNames).toEqual(providerNames);
  });

  // ── b3-11: strace stdout lines must be parsed, not just accumulated ──────

  it('parses strace output emitted on stdout into captured events', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithStrace(4321);
    child.emitStdout('4321 14:30:00.123456 write(3</tmp/foo>, "x", 1) = 1 <0.000010>\n');

    const events = await monitor.captureEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        pid: 4321,
        syscall: 'write',
        returnValue: 1,
      }),
    );
    expect(events[0]?.duration).toBeCloseTo(0.01, 6);
  });

  it('keeps incomplete strace stdout lines buffered across chunks', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithStrace(4321);
    // No trailing newline yet — the partial line must stay buffered.
    child.emitStdout('4321 14:30:00.123456 openat(AT_FDCWD, "/tmp/foo", O_RDONLY) = 3');
    expect(await monitor.captureEvents()).toHaveLength(0);

    // The remainder completes the line — exactly one event, nothing duplicated.
    child.emitStdout(' <0.000123>\n');
    const events = await monitor.captureEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        pid: 4321,
        syscall: 'openat',
        returnValue: 3,
      }),
    );
  });

  it('no longer retains a placeholder line accumulator or parser', async () => {
    expect((monitor as any).processLineBuffer).toBeUndefined();
  });

  // ── b3-12: capturedEvents must be bounded and drops must be reported ──────

  it('caps captured events at MAX_CAPTURED_EVENTS and counts dropped events', async () => {
    const child = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as any;
    });

    (monitor as any).activeState = { startedAt: Date.now() };
    await (monitor as any).captureWithStrace(4321);

    const extra = 50;
    const total = MAX_CAPTURED_EVENTS + extra;
    const lines: string[] = [];
    for (let i = 1; i <= total; i++) {
      lines.push(`4321 14:30:00.123456 openat(arg=${i}, "/tmp/foo", O_RDONLY) = 3 <0.000123>`);
    }
    child.emitStdout(lines.join('\n') + '\n');

    const events = await monitor.captureEvents();
    expect(events).toHaveLength(MAX_CAPTURED_EVENTS);
    expect(monitor.getStats().droppedEvents).toBe(extra);
    expect(monitor.getStats().eventsCaptured).toBe(MAX_CAPTURED_EVENTS);
    // Oldest `extra` events were shifted out; the retained window starts at 51.
    expect(events[0]?.args[0]).toBe('arg=51');
    expect(events[events.length - 1]?.args[0]).toBe(`arg=${total}`);
  });

  it('resets the event buffer and dropped counter when a new session starts', async () => {
    for (let i = 0; i < MAX_CAPTURED_EVENTS + 7; i++) {
      (monitor as any).pushCapturedEvent({ timestamp: i, pid: 1, syscall: 'read', args: [] });
    }
    expect(monitor.getStats().droppedEvents).toBe(7);

    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    expect(monitor.getStats().droppedEvents).toBe(0);
    expect(monitor.getStats().eventsCaptured).toBeGreaterThan(0);
  });

  it('stores captured events in a bounded ring buffer so dropping the oldest is O(1)', () => {
    // The event store must be a RingBuffer (bounded, O(1) overwrite of the
    // oldest), not a plain array whose shift() memmoves 100K elements per drop.
    expect((monitor as any).capturedEvents).toBeInstanceOf(RingBuffer);
    expect((monitor as any).capturedEvents.length).toBe(0);
  });

  // ── b3-13: restarting must terminate the previous subprocess ──────────────

  it('kills the previous subprocess before replacing it with a new session', async () => {
    const child1 = createFakeChildProcess();
    const child2 = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child1.emit('spawn'));
      return child1 as any;
    });

    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });
    expect(child1.kill).not.toHaveBeenCalled();

    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child2.emit('spawn'));
      return child2 as any;
    });
    const secondStart = monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });
    // Termination runs synchronously up to its first await: SIGTERM is issued
    // before the new capture is spawned.
    expect(child1.kill).toHaveBeenCalledWith('SIGTERM');
    child1.emit('exit');
    await secondStart;

    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats().subprocessActive).toBe(true);
    expect(child2.kill).not.toHaveBeenCalled();
  });

  it('escalates to SIGKILL when the replaced subprocess ignores SIGTERM', async () => {
    vi.useFakeTimers();
    const child1 = createFakeChildProcess();
    const child2 = createFakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child1.emit('spawn'));
      return child1 as any;
    });

    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });

    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child2.emit('spawn'));
      return child2 as any;
    });
    const secondStart = monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });
    expect(child1.kill).toHaveBeenCalledWith('SIGTERM');

    // The old subprocess never exits — after the grace period SIGKILL is sent
    // and the replacement session proceeds.
    await vi.advanceTimersByTimeAsync(SYSCALL_TRACE_KILL_GRACE_MS);
    await secondStart;

    expect(child1.kill).toHaveBeenCalledWith('SIGKILL');
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats().subprocessActive).toBe(true);
    vi.useRealTimers();
  });
});

describe('SyscallMonitor.ingestExternal (adb backend)', () => {
  it('feeds external events into capture/stats without synthetic regeneration', async () => {
    const monitor = new SyscallMonitor();
    monitor.ingestExternal(
      'adb',
      [
        { timestamp: 1, pid: 42, syscall: 'connect', args: [], returnValue: 0 },
        { timestamp: 2, pid: 42, syscall: 'sendto', args: [], returnValue: 118 },
      ],
      42,
    );

    const stats = monitor.getStats();
    expect(stats.backend).toBe('adb');
    expect(stats.simulate).toBe(false);
    expect(stats.eventsCaptured).toBe(2);

    const events = await monitor.captureEvents();
    expect(events.map((event) => event.syscall)).toEqual(['connect', 'sendto']);
    // A second read must not append synthetic seeds for an external session.
    expect(await monitor.captureEvents()).toHaveLength(2);
  });

  it('filters externally ingested events by pid and syscall name', async () => {
    const monitor = new SyscallMonitor();
    monitor.ingestExternal(
      'adb',
      [
        { timestamp: 1, pid: 1, syscall: 'openat', args: [] },
        { timestamp: 2, pid: 2, syscall: 'connect', args: [] },
      ],
      0,
    );

    expect(await monitor.captureEvents({ pid: 2 })).toHaveLength(1);
    expect(await monitor.captureEvents({ name: ['openat'] })).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { SyscallMonitor } from '@modules/syscall-hook/SyscallMonitor';

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
    kill: vi.fn(),
    on: vi.fn((event: string, handler: EventHandler) => {
      const handlers = processHandlers.get(event) ?? [];
      handlers.push(handler);
      processHandlers.set(event, handlers);
    }),
    emit(event: string, ...args: any[]) {
      for (const handler of processHandlers.get(event) ?? []) {
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
});

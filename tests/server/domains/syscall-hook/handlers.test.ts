import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';

describe('SyscallHookHandlers', () => {
  let monitor: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    captureEvents: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
    getSupportedBackends: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
  };
  let mapper: {
    map: ReturnType<typeof vi.fn>;
  };
  let handlers: SyscallHookHandlers;

  beforeEach(() => {
    monitor = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      captureEvents: vi.fn().mockResolvedValue([]),
      getStats: vi.fn().mockReturnValue({ eventsCaptured: 0 }),
      getSupportedBackends: vi.fn().mockReturnValue(['etw', 'strace', 'dtrace']),
      isRunning: vi.fn().mockReturnValue(false),
    };
    mapper = {
      map: vi.fn().mockReturnValue(null),
    };
    handlers = new SyscallHookHandlers(monitor as any, mapper as any);
  });

  it('starts monitoring with a supported backend', async () => {
    const result = await handlers.handleSyscallStartMonitor({ backend: 'strace', pid: 1234 });
    expect(monitor.start).toHaveBeenCalledWith({ backend: 'strace', pid: 1234 });
    expect(result).toMatchObject({ ok: true, started: true, backend: 'strace', pid: 1234 });
  });

  it('returns validation error for unsupported backend', async () => {
    const result = await handlers.handleSyscallStartMonitor({ backend: 'invalid' });
    expect(result).toMatchObject({ ok: false });
  });

  it('stops monitoring and returns stats', async () => {
    const result = await handlers.handleSyscallStopMonitor();
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, stopped: true });
  });

  it('captures syscall events with optional filter', async () => {
    monitor.captureEvents.mockResolvedValueOnce([
      { syscall: 'openat', pid: 1, timestamp: 1, args: [] },
    ]);
    const result = await handlers.handleSyscallCaptureEvents({ filter: { name: ['openat'] } });
    expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat'] });
    expect(result).toMatchObject({ ok: true, count: 1 });
  });

  it('correlates js calls from syscall events', async () => {
    mapper.map.mockReturnValueOnce({
      syscall: { syscall: 'openat', pid: 1, timestamp: 1, args: [] },
      jsFunction: 'fs.open',
      confidence: 0.8,
      reasoning: 'matched',
    });
    const result = await handlers.handleSyscallCorrelateJs({
      syscallEvents: [{ syscall: 'openat', pid: 1, timestamp: 1, args: [] }],
    });
    expect(result).toMatchObject({ ok: true, matched: 1 });
  });

  it('filters events by syscall name list', async () => {
    const result = await handlers.handleSyscallFilter({ names: ['openat'] });
    expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat'] });
    expect(result).toMatchObject({ ok: true, names: ['openat'] });
  });

  it('returns current monitoring stats', async () => {
    const result = await handlers.handleSyscallGetStats();
    expect(result).toMatchObject({ ok: true, running: false });
  });
});

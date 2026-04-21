import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';

// ---------------------------------------------------------------------------
// Helpers — mock creation
// ---------------------------------------------------------------------------

function createMockMonitor() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    captureEvents: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockReturnValue({ eventsCaptured: 0, uptime: 0, backend: 'etw' }),
    getSupportedBackends: vi.fn().mockReturnValue(['etw', 'strace', 'dtrace']),
    isRunning: vi.fn().mockReturnValue(false),
  };
}

function createMockMapper() {
  return {
    map: vi.fn().mockReturnValue(null),
  };
}

function createMockEventBus() {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
  };
}

function validSyscallEvent(overrides?: Record<string, unknown>) {
  return {
    timestamp: 1000,
    pid: 42,
    syscall: 'openat',
    args: ['/tmp/file.txt', 'O_RDONLY'],
    returnValue: 3,
    duration: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyscallHookHandlers — coverage expansion', () => {
  let monitor: ReturnType<typeof createMockMonitor>;
  let mapper: ReturnType<typeof createMockMapper>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let handlers: SyscallHookHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    monitor = createMockMonitor();
    mapper = createMockMapper();
    eventBus = createMockEventBus();
    handlers = new SyscallHookHandlers(
      monitor as unknown as import('@modules/syscall-hook').SyscallMonitor,
      mapper as unknown as import('@modules/syscall-hook').SyscallToJSMapper,
      eventBus as unknown as import('@server/EventBus').EventBus<
        import('@server/EventBus').ServerEventMap
      >,
    );
  });

  // =========================================================================
  // handleSyscallStartMonitor
  // =========================================================================
  describe('handleSyscallStartMonitor', () => {
    it('returns error when backend is missing', async () => {
      const result = await handlers.handleSyscallStartMonitor({});
      expect(result).toEqual({
        ok: false,
        error: 'backend must be one of: etw, strace, dtrace',
      });
    });

    it('returns error when backend is null', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: null });
      expect(result).toEqual({
        ok: false,
        error: 'backend must be one of: etw, strace, dtrace',
      });
    });

    it('returns error when backend is a number', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 123 });
      expect(result).toEqual({
        ok: false,
        error: 'backend must be one of: etw, strace, dtrace',
      });
    });

    it('returns error when backend is an unrecognized string', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'perf' });
      expect(result).toEqual({
        ok: false,
        error: 'backend must be one of: etw, strace, dtrace',
      });
    });

    it('returns error when pid is provided but not a finite number', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw', pid: Infinity });
      expect(result).toEqual({
        ok: false,
        error: 'pid must be a finite number when provided',
      });
    });

    it('returns error when pid is NaN', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw', pid: NaN });
      expect(result).toEqual({
        ok: false,
        error: 'pid must be a finite number when provided',
      });
    });

    it('returns error when pid is a string', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'strace', pid: 'abc' });
      expect(result).toEqual({
        ok: false,
        error: 'pid must be a finite number when provided',
      });
    });

    it('accepts etw backend', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(result).toMatchObject({ ok: true, started: true, backend: 'etw' });
    });

    it('accepts strace backend with pid', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'strace', pid: 1234 });
      expect(result).toMatchObject({ ok: true, started: true, backend: 'strace', pid: 1234 });
      expect(monitor.start).toHaveBeenCalledWith({ backend: 'strace', pid: 1234 });
    });

    it('accepts dtrace backend without pid', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'dtrace' });
      expect(result).toMatchObject({ ok: true, started: true, backend: 'dtrace' });
      expect(monitor.start).toHaveBeenCalledWith({ backend: 'dtrace', pid: undefined });
    });

    it('omits pid from start call when not provided', async () => {
      await handlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(monitor.start).toHaveBeenCalledWith({ backend: 'etw', pid: undefined });
    });

    it('emits syscall:trace_started event on success', async () => {
      await handlers.handleSyscallStartMonitor({ backend: 'etw', pid: 999 });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'syscall:trace_started',
        expect.objectContaining({
          backend: 'etw',
          pid: 999,
        }),
      );
      // timestamp is an ISO string
      const emittedArg = eventBus.emit.mock.calls[0]![1] as Record<string, unknown>;
      expect(typeof emittedArg['timestamp']).toBe('string');
    });

    it('returns stats from monitor on success', async () => {
      monitor.getStats.mockReturnValueOnce({ eventsCaptured: 42, uptime: 5000 });
      const result = await handlers.handleSyscallStartMonitor({ backend: 'strace' });
      expect(result).toMatchObject({ ok: true, stats: { eventsCaptured: 42, uptime: 5000 } });
    });

    it('handles monitor.start throwing an Error', async () => {
      monitor.start.mockRejectedValueOnce(new Error('Permission denied'));
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(result).toMatchObject({
        ok: false,
        error: 'Permission denied',
        requestedBackend: 'etw',
        supportedBackends: ['etw', 'strace', 'dtrace'],
      });
    });

    it('handles monitor.start throwing a non-Error value', async () => {
      monitor.start.mockRejectedValueOnce('string error');
      const result = await handlers.handleSyscallStartMonitor({ backend: 'dtrace' });
      expect(result).toMatchObject({
        ok: false,
        error: 'Unknown syscall-hook error',
        requestedBackend: 'dtrace',
      });
    });

    it('does not emit event when monitor.start throws', async () => {
      monitor.start.mockRejectedValueOnce(new Error('fail'));
      await handlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not validate pid when not provided at all', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(result).toMatchObject({ ok: true });
    });
  });

  // =========================================================================
  // handleSyscallStopMonitor
  // =========================================================================
  describe('handleSyscallStopMonitor', () => {
    it('stops successfully and returns stats', async () => {
      monitor.getStats.mockReturnValueOnce({ eventsCaptured: 10, uptime: 3000 });
      const result = await handlers.handleSyscallStopMonitor();
      expect(monitor.stop).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        ok: true,
        stopped: true,
        stats: { eventsCaptured: 10, uptime: 3000 },
      });
    });

    it('handles monitor.stop throwing an Error', async () => {
      monitor.stop.mockRejectedValueOnce(new Error('Not started'));
      const result = await handlers.handleSyscallStopMonitor();
      expect(result).toMatchObject({ ok: false, error: 'Not started' });
    });

    it('handles monitor.stop throwing a non-Error value', async () => {
      monitor.stop.mockRejectedValueOnce(42);
      const result = await handlers.handleSyscallStopMonitor();
      expect(result).toMatchObject({ ok: false, error: 'Unknown syscall-hook error' });
    });
  });

  // =========================================================================
  // handleSyscallCaptureEvents
  // =========================================================================
  describe('handleSyscallCaptureEvents', () => {
    it('captures events without filter', async () => {
      const events = [validSyscallEvent()];
      monitor.captureEvents.mockResolvedValueOnce(events);
      const result = await handlers.handleSyscallCaptureEvents({});
      expect(monitor.captureEvents).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ ok: true, events, count: 1 });
    });

    it('captures events with name filter', async () => {
      const events = [validSyscallEvent()];
      monitor.captureEvents.mockResolvedValueOnce(events);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { name: ['openat', 'read'] },
      });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat', 'read'] });
      expect(result).toMatchObject({ ok: true, count: 1 });
    });

    it('captures events with pid filter', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { pid: 1234 },
      });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ pid: 1234 });
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('captures events with both name and pid filter', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { name: ['write'], pid: 99 },
      });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['write'], pid: 99 });
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('passes undefined filter when filter value is not a record', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({ filter: 'invalid' });
      expect(monitor.captureEvents).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('passes undefined filter when filter is null', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({ filter: null });
      expect(monitor.captureEvents).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('passes undefined filter when filter is a number', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({ filter: 42 });
      expect(monitor.captureEvents).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('passes filter with only names when pid is non-finite', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { name: ['openat'], pid: Infinity },
      });
      // Infinity fails readNumber, so pid should be excluded
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat'] });
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('passes filter with only pid when name contains non-strings', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { name: ['openat', 123], pid: 42 },
      });
      // name array has a number, so readStringArray returns undefined
      expect(monitor.captureEvents).toHaveBeenCalledWith({ pid: 42 });
      expect(result).toMatchObject({ ok: true, count: 0 });
    });

    it('returns empty events array and stats', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      monitor.getStats.mockReturnValueOnce({ eventsCaptured: 0, uptime: 0, backend: 'strace' });
      const result = await handlers.handleSyscallCaptureEvents({});
      expect(result).toMatchObject({
        ok: true,
        events: [],
        count: 0,
        stats: { eventsCaptured: 0 },
      });
    });

    it('handles captureEvents returning multiple events', async () => {
      const events = [
        validSyscallEvent({ syscall: 'openat' }),
        validSyscallEvent({ syscall: 'read', args: ['fd=3'] }),
        validSyscallEvent({ syscall: 'write', args: ['fd=3', 'count=128'] }),
      ];
      monitor.captureEvents.mockResolvedValueOnce(events);
      const result = await handlers.handleSyscallCaptureEvents({});
      expect(result).toMatchObject({ ok: true, count: 3 });
    });
  });

  // =========================================================================
  // handleSyscallCorrelateJs
  // =========================================================================
  describe('handleSyscallCorrelateJs', () => {
    it('returns error when syscallEvents is not an array', async () => {
      const result = await handlers.handleSyscallCorrelateJs({ syscallEvents: 'not-array' });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when syscallEvents is null', async () => {
      const result = await handlers.handleSyscallCorrelateJs({ syscallEvents: null });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when syscallEvents is missing', async () => {
      const result = await handlers.handleSyscallCorrelateJs({});
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when an event has missing timestamp', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ pid: 1, syscall: 'openat', args: [] }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when an event has missing pid', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, syscall: 'openat', args: [] }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when an event has missing syscall', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, pid: 1, args: [] }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when an event has missing args', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, pid: 1, syscall: 'openat' }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when args is not a string array', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, pid: 1, syscall: 'openat', args: [1, 2] }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when timestamp is not a number', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: '1000', pid: 1, syscall: 'openat', args: [] }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when pid is not a number', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, pid: '1', syscall: 'openat', args: [] }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when returnValue is a non-number (not undefined)', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [
          { timestamp: 1000, pid: 1, syscall: 'openat', args: [], returnValue: 'bad' },
        ],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('returns error when duration is a non-number (not undefined)', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, pid: 1, syscall: 'openat', args: [], duration: 'slow' }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });

    it('accepts events with undefined returnValue and duration', async () => {
      mapper.map.mockReturnValueOnce({
        syscall: validSyscallEvent(),
        jsFunction: 'fs.open',
        confidence: 0.8,
        reasoning: 'matched',
      });
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [{ timestamp: 1000, pid: 1, syscall: 'openat', args: [] }],
      });
      expect(result).toMatchObject({ ok: true, matched: 1 });
    });

    it('accepts events with numeric returnValue and duration', async () => {
      mapper.map.mockReturnValueOnce(null);
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [
          { timestamp: 1000, pid: 1, syscall: 'openat', args: [], returnValue: 3, duration: 0.5 },
        ],
      });
      expect(result).toMatchObject({ ok: true, matched: 0, unmatched: expect.any(Array) });
    });

    it('correlates matched events and reports unmatched', async () => {
      const event1 = validSyscallEvent({ syscall: 'openat' });
      const event2 = validSyscallEvent({ syscall: 'unknown_syscall' });
      const correlation = {
        syscall: event1,
        jsFunction: 'fs.open',
        confidence: 0.85,
        reasoning: 'File open',
      };
      mapper.map.mockReturnValueOnce(correlation).mockReturnValueOnce(null);

      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [event1, event2],
      });

      expect(result).toMatchObject({
        ok: true,
        matched: 1,
        unmatched: [expect.objectContaining({ syscall: 'unknown_syscall' })],
      });
      expect((result as Record<string, unknown>)['correlations']).toHaveLength(1);
    });

    it('handles all events matching', async () => {
      const event = validSyscallEvent();
      mapper.map.mockReturnValue({
        syscall: event,
        jsFunction: 'fs.open',
        confidence: 0.9,
        reasoning: 'matched',
      });

      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [event, event, event],
      });

      expect(result).toMatchObject({ ok: true, matched: 3, unmatched: [] });
    });

    it('handles all events unmatched', async () => {
      mapper.map.mockReturnValue(null);

      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [validSyscallEvent(), validSyscallEvent()],
      });

      expect(result).toMatchObject({ ok: true, matched: 0, unmatched: expect.any(Array) });
      expect(((result as Record<string, unknown>)['unmatched'] as unknown[]).length).toBe(2);
    });

    it('clones events before passing to mapper', async () => {
      const originalEvent = validSyscallEvent();
      mapper.map.mockReturnValue(null);

      await handlers.handleSyscallCorrelateJs({
        syscallEvents: [originalEvent],
      });

      // The mapper should receive a cloned event (different reference, same values)
      const passedEvent = mapper.map.mock.calls[0]![0] as Record<string, unknown>;
      expect(passedEvent).not.toBe(originalEvent);
      expect(passedEvent['args']).not.toBe(originalEvent.args);
      expect(passedEvent).toEqual(originalEvent);
    });

    it('handles empty syscallEvents array', async () => {
      const result = await handlers.handleSyscallCorrelateJs({ syscallEvents: [] });
      expect(result).toMatchObject({ ok: true, matched: 0, correlations: [], unmatched: [] });
    });

    it('returns error when some events are invalid', async () => {
      const result = await handlers.handleSyscallCorrelateJs({
        syscallEvents: [validSyscallEvent(), { bad: 'event' }],
      });
      expect(result).toEqual({
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      });
    });
  });

  // =========================================================================
  // handleSyscallFilter
  // =========================================================================
  describe('handleSyscallFilter', () => {
    it('filters without names (undefined)', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallFilter({});
      expect(monitor.captureEvents).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ ok: true, names: undefined, events: [], count: 0 });
    });

    it('filters with empty names array', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallFilter({ names: [] });
      // Empty names array → readStringArray returns [] → names && names.length > 0 is false → captureEvents(undefined)
      expect(monitor.captureEvents).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ ok: true, names: [] });
    });

    it('filters with valid name list', async () => {
      const events = [validSyscallEvent({ syscall: 'openat' })];
      monitor.captureEvents.mockResolvedValueOnce(events);
      const result = await handlers.handleSyscallFilter({ names: ['openat'] });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat'] });
      expect(result).toMatchObject({ ok: true, names: ['openat'], count: 1, events });
    });

    it('filters with multiple names', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallFilter({ names: ['openat', 'read', 'write'] });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat', 'read', 'write'] });
      expect(result).toMatchObject({ ok: true, names: ['openat', 'read', 'write'] });
    });

    it('returns error when names is not a string array (contains numbers)', async () => {
      const result = await handlers.handleSyscallFilter({ names: ['openat', 123] });
      expect(result).toMatchObject({
        ok: false,
        error: 'names must be an array of strings when provided',
      });
    });

    it('returns error when names is a string instead of array', async () => {
      const result = await handlers.handleSyscallFilter({ names: 'openat' });
      expect(result).toMatchObject({
        ok: false,
        error: 'names must be an array of strings when provided',
      });
    });

    it('returns error when names is a number', async () => {
      const result = await handlers.handleSyscallFilter({ names: 42 });
      expect(result).toMatchObject({
        ok: false,
        error: 'names must be an array of strings when provided',
      });
    });

    it('returns error when names is null', async () => {
      const result = await handlers.handleSyscallFilter({ names: null });
      expect(result).toMatchObject({
        ok: false,
        error: 'names must be an array of strings when provided',
      });
    });
  });

  // =========================================================================
  // handleSyscallGetStats
  // =========================================================================
  describe('handleSyscallGetStats', () => {
    it('returns stats with all fields', async () => {
      monitor.getStats.mockReturnValueOnce({ eventsCaptured: 50, uptime: 10000, backend: 'etw' });
      monitor.isRunning.mockReturnValueOnce(true);
      monitor.getSupportedBackends.mockReturnValueOnce(['etw']);
      const result = await handlers.handleSyscallGetStats();
      expect(result).toMatchObject({
        ok: true,
        eventsCaptured: 50,
        uptime: 10000,
        backend: 'etw',
        running: true,
        supportedBackends: ['etw'],
      });
    });

    it('returns running=false when monitor is not active', async () => {
      monitor.getStats.mockReturnValueOnce({ eventsCaptured: 0, uptime: 0, backend: 'etw' });
      monitor.isRunning.mockReturnValueOnce(false);
      monitor.getSupportedBackends.mockReturnValueOnce(['etw', 'strace', 'dtrace']);
      const result = await handlers.handleSyscallGetStats();
      expect(result).toMatchObject({ ok: true, running: false });
    });
  });

  // =========================================================================
  // ensureMonitor — lazy instantiation when no monitor is provided
  // =========================================================================
  describe('ensureMonitor lazy instantiation', () => {
    it('creates a new SyscallMonitor when none is provided', async () => {
      const noMonitorHandlers = new SyscallHookHandlers(undefined, undefined, undefined);
      // handleSyscallGetStats triggers ensureMonitor
      const result = await noMonitorHandlers.handleSyscallGetStats();
      expect(result).toMatchObject({ ok: true });
    });
  });

  // =========================================================================
  // ensureMapper — lazy instantiation when no mapper is provided
  // =========================================================================
  describe('ensureMapper lazy instantiation', () => {
    it('creates a new SyscallToJSMapper when none is provided', async () => {
      const noMapperHandlers = new SyscallHookHandlers(
        monitor as unknown as import('@modules/syscall-hook').SyscallMonitor,
        undefined,
        undefined,
      );
      // Pass a valid event to trigger ensureMapper
      const result = await noMapperHandlers.handleSyscallCorrelateJs({
        syscallEvents: [validSyscallEvent()],
      });
      expect(result).toMatchObject({ ok: true });
    });
  });

  // =========================================================================
  // eventBus integration
  // =========================================================================
  describe('eventBus integration', () => {
    it('does not throw when eventBus is undefined during start', async () => {
      const noBusHandlers = new SyscallHookHandlers(
        monitor as unknown as import('@modules/syscall-hook').SyscallMonitor,
        mapper as unknown as import('@modules/syscall-hook').SyscallToJSMapper,
        undefined,
      );
      const result = await noBusHandlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(result).toMatchObject({ ok: true, started: true });
    });

    it('uses void operator to handle emit return (does not await emit)', async () => {
      // Verify the emit is called but not awaited (void expression)
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw' });
      expect(result).toMatchObject({ ok: true });
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Validation helper edge cases
  // =========================================================================
  describe('input validation edge cases', () => {
    it('handles backend with wrong casing', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'ETW' });
      expect(result).toMatchObject({ ok: false });
    });

    it('handles empty string backend', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: '' });
      expect(result).toMatchObject({ ok: false });
    });

    it('accepts negative but finite pid', async () => {
      // Negative numbers are technically finite — behavior depends on implementation
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw', pid: -1 });
      expect(result).toMatchObject({ ok: true, pid: -1 });
    });

    it('accepts zero pid', async () => {
      const result = await handlers.handleSyscallStartMonitor({ backend: 'etw', pid: 0 });
      expect(result).toMatchObject({ ok: true, pid: 0 });
    });

    it('handles filter with only name array containing empty strings', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { name: ['', ''] },
      });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['', ''] });
      expect(result).toMatchObject({ ok: true });
    });

    it('handles filter object with extra unknown keys', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = await handlers.handleSyscallCaptureEvents({
        filter: { name: ['openat'], pid: 1, extra: 'ignored' },
      });
      expect(monitor.captureEvents).toHaveBeenCalledWith({ name: ['openat'], pid: 1 });
      expect(result).toMatchObject({ ok: true });
    });
  });
});

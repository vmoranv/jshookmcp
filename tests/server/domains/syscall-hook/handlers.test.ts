import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn(),
  })),
}));

describe('SyscallHookHandlers', () => {
  let handlers: SyscallHookHandlers;

  beforeEach(() => {
    handlers = new SyscallHookHandlers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handleMonitorStart', () => {
    it('should start monitor with valid PID', async () => {
      const result = await handlers.handleMonitorStart({ pid: 1234 });
      const obj = result as Record<string, unknown>;
      expect(obj.sessionId).toBeDefined();
      expect(typeof obj.sessionId).toBe('string');
      expect(obj.pid).toBe(1234);
      expect(typeof obj.platform).toBe('string');
    });

    it('should throw for missing PID', async () => {
      await expect(handlers.handleMonitorStart({})).rejects.toThrow('pid must be a number');
    });

    it('should throw for non-numeric PID', async () => {
      await expect(handlers.handleMonitorStart({ pid: 'abc' })).rejects.toThrow(
        'pid must be a number',
      );
    });

    it('should throw for infinite PID', async () => {
      await expect(handlers.handleMonitorStart({ pid: Infinity })).rejects.toThrow(
        'pid must be a number',
      );
    });

    it('should accept maxEvents parameter', async () => {
      const result = await handlers.handleMonitorStart({ pid: 1234, maxEvents: 500 });
      const obj = result as Record<string, unknown>;
      expect(obj.sessionId).toBeDefined();
    });

    it('should return correct platform string', async () => {
      const result = await handlers.handleMonitorStart({ pid: 1234 });
      const obj = result as Record<string, unknown>;
      const expected =
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'linux'
            ? 'linux'
            : 'darwin';
      expect(obj.platform).toBe(expected);
    });
  });

  describe('handleMonitorStop', () => {
    it('should stop an active session', async () => {
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      const result = await handlers.handleMonitorStop({ sessionId });
      const obj = result as Record<string, unknown>;
      expect(obj.sessionId).toBe(sessionId);
      expect(typeof obj.eventCount).toBe('number');
    });

    it('should throw for non-existent session', async () => {
      await expect(handlers.handleMonitorStop({ sessionId: 'nonexistent' })).rejects.toThrow(
        'Session "nonexistent" not found',
      );
    });

    it('should throw for missing sessionId', async () => {
      await expect(handlers.handleMonitorStop({})).rejects.toThrow(
        'sessionId must be a non-empty string',
      );
    });

    it('should throw for empty sessionId', async () => {
      await expect(handlers.handleMonitorStop({ sessionId: '' })).rejects.toThrow(
        'sessionId must be a non-empty string',
      );
    });
  });

  describe('handleEventsGet', () => {
    it('should return events for a valid session', async () => {
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      const result = await handlers.handleEventsGet({ sessionId });
      const obj = result as Record<string, unknown>;
      expect(obj.sessionId).toBe(sessionId);
      expect(Array.isArray(obj.events)).toBe(true);
      expect(typeof obj.eventCount).toBe('number');
    });

    it('should throw for non-existent session', async () => {
      await expect(handlers.handleEventsGet({ sessionId: 'nonexistent' })).rejects.toThrow(
        'Session "nonexistent" not found',
      );
    });

    it('should filter events by name', async () => {
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      const result = await handlers.handleEventsGet({
        sessionId,
        filter: 'Nt',
      });
      const obj = result as Record<string, unknown>;
      expect(Array.isArray(obj.events)).toBe(true);
    });

    it('should throw for missing sessionId', async () => {
      await expect(handlers.handleEventsGet({})).rejects.toThrow(
        'sessionId must be a non-empty string',
      );
    });
  });

  describe('handleMapToJS', () => {
    it('should map syscall event to JS function (direct object)', async () => {
      const result = await handlers.handleMapToJS({
        syscallEvent: {
          syscallName: 'openat',
          pid: 1234,
          timestamp: Date.now(),
        },
        jsStack: ['at readFile (app.js:10:5)'],
      });
      const obj = result as Record<string, unknown>;
      expect(obj.syscall).toBe('openat');
      expect(typeof obj.confidence).toBe('number');
      expect(typeof obj.confidenceLabel).toBe('string');
    });

    it('should map via sessionId + eventIndex', async () => {
      // Start a monitor, since mock spawn produces no events,
      // we use a negative test for empty event list
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      // No events produced by mocked spawn, so expect out-of-range
      await expect(
        handlers.handleMapToJS({
          sessionId,
          eventIndex: 0,
          jsStack: ['at doSomething (app.js:20:3)'],
        }),
      ).rejects.toThrow('out of range');
    });

    it('should throw for out-of-range eventIndex', async () => {
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      await expect(
        handlers.handleMapToJS({
          sessionId,
          eventIndex: 999,
          jsStack: [],
        }),
      ).rejects.toThrow('eventIndex 999 out of range');
    });

    it('should throw when neither syscallEvent nor sessionId+eventIndex provided', async () => {
      await expect(handlers.handleMapToJS({ jsStack: [] })).rejects.toThrow(
        'Either syscallEvent (object) or sessionId + eventIndex must be provided',
      );
    });

    it('should return confidence labels correctly', async () => {
      // Test with network-related function name
      const result = await handlers.handleMapToJS({
        syscallEvent: {
          syscallName: 'connect',
          pid: 1234,
          timestamp: Date.now(),
        },
        jsStack: ['at fetchRemote (network.js:15:8)'],
      });
      const obj = result as Record<string, unknown>;
      expect(obj.confidenceLabel).toBeDefined();
      expect(['high', 'medium', 'low', 'none']).toContain(obj.confidenceLabel);
    });

    it('should handle empty js stack', async () => {
      const result = await handlers.handleMapToJS({
        syscallEvent: {
          syscallName: 'read',
          pid: 1234,
          timestamp: Date.now(),
        },
        jsStack: [],
      });
      const obj = result as Record<string, unknown>;
      expect(obj.syscall).toBe('read');
    });
  });

  describe('handleFilterAdd', () => {
    it('should add a filter rule', async () => {
      const result = await handlers.handleFilterAdd({
        name: 'block-IsDebuggerPresent',
        action: 'block',
        matchPattern: 'IsDebuggerPresent',
      });
      const obj = result as Record<string, unknown>;
      expect(obj.ruleId).toBeDefined();
      expect(typeof obj.ruleId).toBe('string');
    });

    it('should add a log rule', async () => {
      const result = await handlers.handleFilterAdd({
        name: 'log-read',
        action: 'log',
        matchPattern: 'read',
      });
      const obj = result as Record<string, unknown>;
      expect(obj.ruleId).toBeDefined();
    });

    it('should add an allow rule', async () => {
      const result = await handlers.handleFilterAdd({
        name: 'allow-all',
        action: 'allow',
      });
      const obj = result as Record<string, unknown>;
      expect(obj.ruleId).toBeDefined();
    });

    it('should throw for missing name', async () => {
      await expect(handlers.handleFilterAdd({ action: 'block' })).rejects.toThrow(
        'name must be a non-empty string',
      );
    });

    it('should throw for empty name', async () => {
      await expect(handlers.handleFilterAdd({ name: '', action: 'block' })).rejects.toThrow(
        'name must be a non-empty string',
      );
    });

    it('should throw for invalid action', async () => {
      await expect(handlers.handleFilterAdd({ name: 'test', action: 'invalid' })).rejects.toThrow(
        'action must be one of: allow, block, log',
      );
    });

    it('should throw for missing action', async () => {
      await expect(handlers.handleFilterAdd({ name: 'test' })).rejects.toThrow(
        'action must be one of: allow, block, log',
      );
    });

    it('should accept optional replacement', async () => {
      const result = await handlers.handleFilterAdd({
        name: 'block-fake',
        action: 'block',
        matchPattern: 'NtQueryInformationProcess',
        replacement: '0',
      });
      const obj = result as Record<string, unknown>;
      expect(obj.ruleId).toBeDefined();
    });
  });

  describe('handleFilterList', () => {
    it('should return empty rules initially', async () => {
      const result = await handlers.handleFilterList();
      const obj = result as Record<string, unknown>;
      expect(obj.ruleCount).toBe(0);
      expect(Array.isArray(obj.rules)).toBe(true);
    });

    it('should return added rules', async () => {
      await handlers.handleFilterAdd({
        name: 'test-rule',
        action: 'block',
        matchPattern: 'test',
      });

      const result = await handlers.handleFilterList();
      const obj = result as Record<string, unknown>;
      expect(obj.ruleCount).toBe(1);
      expect((obj.rules as unknown[]).length).toBe(1);
    });

    it('should return multiple rules', async () => {
      await handlers.handleFilterAdd({ name: 'r1', action: 'block', matchPattern: 'a' });
      await handlers.handleFilterAdd({ name: 'r2', action: 'log', matchPattern: 'b' });
      await handlers.handleFilterAdd({ name: 'r3', action: 'allow' });

      const result = await handlers.handleFilterList();
      const obj = result as Record<string, unknown>;
      expect(obj.ruleCount).toBe(3);
    });
  });

  describe('handleFilterApply', () => {
    it('should throw for missing sessionId', async () => {
      await expect(handlers.handleFilterApply({})).rejects.toThrow(
        'sessionId must be a non-empty string',
      );
    });

    it('should throw for non-existent session', async () => {
      await expect(handlers.handleFilterApply({ sessionId: 'nonexistent' })).rejects.toThrow(
        'Session "nonexistent" not found',
      );
    });

    it('should apply rules and return counts', async () => {
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      await handlers.handleFilterAdd({
        name: 'test-block',
        action: 'block',
        matchPattern: 'NtQuery',
      });

      const result = await handlers.handleFilterApply({ sessionId });
      const obj = result as Record<string, unknown>;
      expect(typeof obj.totalEvents).toBe('number');
      expect(typeof obj.allowedCount).toBe('number');
      expect(typeof obj.blockedCount).toBe('number');
      expect(typeof obj.loggedCount).toBe('number');
    });

    it('should return correct rule counts with no events', async () => {
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      const result = await handlers.handleFilterApply({ sessionId });
      const obj = result as Record<string, unknown>;
      expect(obj.totalEvents).toBe(0);
      expect(obj.allowedCount).toBe(0);
      expect(obj.blockedCount).toBe(0);
      expect(obj.loggedCount).toBe(0);
    });
  });

  describe('end-to-end workflow', () => {
    it('should support full monitor + filter + map workflow', async () => {
      // 1. Start monitor
      const startResult = await handlers.handleMonitorStart({ pid: 1234 });
      const startObj = startResult as Record<string, unknown>;
      const sessionId = startObj.sessionId as string;

      // 2. Add filter rules
      await handlers.handleFilterAdd({
        name: 'block-debug-check',
        action: 'block',
        matchPattern: 'IsDebuggerPresent',
      });
      await handlers.handleFilterAdd({
        name: 'log-file-access',
        action: 'log',
        matchPattern: 'openat',
      });

      // 3. List rules
      const listResult = await handlers.handleFilterList();
      const listObj = listResult as Record<string, unknown>;
      expect(listObj.ruleCount).toBe(2);

      // 4. Apply filters
      const applyResult = await handlers.handleFilterApply({ sessionId });
      const applyObj = applyResult as Record<string, unknown>;
      expect(typeof applyObj.totalEvents).toBe('number');

      // 5. Get events
      const eventsResult = await handlers.handleEventsGet({ sessionId });
      const eventsObj = eventsResult as Record<string, unknown>;
      expect(Array.isArray(eventsObj.events)).toBe(true);

      // 6. Stop monitor
      const stopResult = await handlers.handleMonitorStop({ sessionId });
      const stopObj = stopResult as Record<string, unknown>;
      expect(typeof stopObj.eventCount).toBe('number');
    });
  });
});

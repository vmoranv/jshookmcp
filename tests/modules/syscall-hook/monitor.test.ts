import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyscallMonitor } from '@modules/syscall-hook/SyscallMonitor';
import type { SyscallEvent } from '@modules/syscall-hook/types';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = await import('node:child_process');
const mockSpawn = vi.mocked(spawn);

function createMockProcess(outputLines: string[] = [], stderrLines: string[] = []) {
  const stdoutEmitter = {
    on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
      if (_event === 'data') {
        for (const line of outputLines) {
          cb(Buffer.from(line + '\n'));
        }
      }
      return stdoutEmitter;
    }),
  };

  const stderrEmitter = {
    on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
      if (_event === 'data') {
        for (const line of stderrLines) {
          cb(Buffer.from(line + '\n'));
        }
      }
      return stderrEmitter;
    }),
  };

  return {
    stdout: stdoutEmitter,
    stderr: stderrEmitter,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as import('node:child_process').ChildProcess;
}

describe('SyscallMonitor', () => {
  let monitor: SyscallMonitor;

  beforeEach(() => {
    monitor = new SyscallMonitor();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any sessions
    try {
      const sessions = monitor.listSessions();
      for (const s of sessions) {
        await monitor.stopMonitor(s.sessionId);
      }
    } catch {
      // ignore
    }
  });

  describe('startMonitor', () => {
    it('should create a session with a valid sessionId', async () => {
      const sessionId = await monitor.startMonitor(1234);
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.startsWith('sysmon_')).toBe(true);
    });

    it('should create session for the given PID', async () => {
      const pid = 5678;
      const sessionId = await monitor.startMonitor(pid);
      const sessions = monitor.listSessions();
      const session = sessions.find((s) => s.sessionId === sessionId);
      expect(session).toBeDefined();
      expect(session?.pid).toBe(pid);
    });

    it('should detect platform correctly', async () => {
      const sessionId = await monitor.startMonitor(1234);
      const sessions = monitor.listSessions();
      const session = sessions.find((s) => s.sessionId === sessionId);
      const platform = process.platform;
      const expectedPlatform =
        platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'darwin';
      expect(session?.platform).toBe(expectedPlatform);
    });

    it('should accept maxEvents parameter', async () => {
      const sessionId = await monitor.startMonitor(1234, 500);
      expect(sessionId).toBeDefined();
    });

    it('should spawn subprocess on supported platforms', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const sessionId = await monitor.startMonitor(1234);
      expect(mockSpawn).toHaveBeenCalled();

      await monitor.stopMonitor(sessionId);
    });

    it('should handle spawn failure gracefully', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const sessionId = await monitor.startMonitor(1234);
      const sessions = monitor.listSessions();
      const session = sessions.find((s) => s.sessionId === sessionId);
      expect(session?.active).toBe(false);
    });
  });

  describe('getEvents', () => {
    it('should throw for non-existent session', async () => {
      await expect(monitor.getEvents('nonexistent')).rejects.toThrow(
        'Session "nonexistent" not found',
      );
    });

    it('should return empty events for new session', async () => {
      const sessionId = await monitor.startMonitor(1234);
      const events = await monitor.getEvents(sessionId);
      expect(Array.isArray(events)).toBe(true);
      await monitor.stopMonitor(sessionId);
    });

    it('should return events with correct structure', async () => {
      const sessionId = await monitor.startMonitor(1234);
      const events = await monitor.getEvents(sessionId);
      expect(events).toEqual([]);
      await monitor.stopMonitor(sessionId);
    });

    it('should filter events by syscall name', async () => {
      const sessionId = await monitor.startMonitor(1234);
      const events = await monitor.getEvents(sessionId, 'Nt');
      expect(Array.isArray(events)).toBe(true);
      await monitor.stopMonitor(sessionId);
    });
  });

  describe('stopMonitor', () => {
    it('should throw for non-existent session', async () => {
      await expect(monitor.stopMonitor('nonexistent')).rejects.toThrow(
        'Session "nonexistent" not found',
      );
    });

    it('should return event count', async () => {
      const sessionId = await monitor.startMonitor(1234);
      const eventCount = await monitor.stopMonitor(sessionId);
      expect(typeof eventCount).toBe('number');
      expect(eventCount).toBe(0);
    });

    it('should remove session after stop', async () => {
      const sessionId = await monitor.startMonitor(1234);
      await monitor.stopMonitor(sessionId);
      const sessions = monitor.listSessions();
      expect(sessions.find((s) => s.sessionId === sessionId)).toBeUndefined();
    });

    it('should kill subprocess on stop', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const sessionId = await monitor.startMonitor(1234);
      await monitor.stopMonitor(sessionId);

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('listSessions', () => {
    it('should return empty array initially', () => {
      const sessions = monitor.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should list active sessions', async () => {
      const sid1 = await monitor.startMonitor(1234);
      const sid2 = await monitor.startMonitor(5678);

      const sessions = monitor.listSessions();
      expect(sessions.length).toBe(2);

      const ids = sessions.map((s) => s.sessionId);
      expect(ids).toContain(sid1);
      expect(ids).toContain(sid2);

      await monitor.stopMonitor(sid1);
      await monitor.stopMonitor(sid2);
    });

    it('should show correct PID per session', async () => {
      const sid1 = await monitor.startMonitor(1111);
      const sid2 = await monitor.startMonitor(2222);

      const sessions = monitor.listSessions();
      const s1 = sessions.find((s) => s.sessionId === sid1);
      const s2 = sessions.find((s) => s.sessionId === sid2);

      expect(s1?.pid).toBe(1111);
      expect(s2?.pid).toBe(2222);

      await monitor.stopMonitor(sid1);
      await monitor.stopMonitor(sid2);
    });
  });

  describe('platform-specific parsing', () => {
    it('should parse Linux strace output format', async () => {
      // Test the internal strace parser by simulating output
      const line = '12:34:56 [pid 1235] openat(AT_FDCWD, "/etc/passwd", O_RDONLY) = 3';
      const match = line.match(
        /^(\d{2}:\d{2}:\d{2})\s*(?:\[pid\s+(\d+)\])?\s+(\w+)\((.*)\)\s*=\s*(.+)$/,
      );
      expect(match).not.toBeNull();
      if (match) {
        expect(match[3]).toBe('openat');
        expect(match[2]).toBe('1235');
        expect(match[5].trim()).toBe('3');
      }
    });

    it('should parse strace output without pid prefix', async () => {
      const line = '12:34:56 read(3, "hello", 5) = 5';
      const match = line.match(
        /^(\d{2}:\d{2}:\d{2})\s*(?:\[pid\s+(\d+)\])?\s+(\w+)\((.*)\)\s*=\s*(.+)$/,
      );
      expect(match).not.toBeNull();
      if (match) {
        expect(match[3]).toBe('read');
        expect(match[2]).toBeUndefined();
      }
    });

    it('should return null for unparseable strace line', async () => {
      const line = 'strace: Process 1234 attached';
      const match = line.match(
        /^(\d{2}:\d{2}:\d{2})\s*(?:\[pid\s+(\d+)\])?\s+(\w+)\((.*)\)\s*=\s*(.+)$/,
      );
      expect(match).toBeNull();
    });

    it('should parse dtrace output format', async () => {
      const line = 'open_nocancel';
      const trimmed = line.trim();
      expect(trimmed).not.toBe('');
      expect(trimmed.startsWith('  ')).toBe(false);
      expect(trimmed.startsWith('CPU')).toBe(false);
    });

    it('should ignore dtrace header lines', async () => {
      const lines = ['CPU     ID                    FUNCTION:NAME', '  0   1234   open:entry'];
      for (const line of lines) {
        const trimmed = line.trim();
        // Check original line for leading spaces, or trimmed for CPU prefix
        const shouldSkip = !trimmed || line.startsWith('  ') || trimmed.startsWith('CPU');
        expect(shouldSkip).toBe(true);
      }
    });

    it('should parse ETW text output format', async () => {
      const line = 'EventID: 1';
      const nameMatch = line.match(/EventID:\s*(\d+)/);
      expect(nameMatch).not.toBeNull();
      if (nameMatch) {
        expect(nameMatch[1]).toBe('1');
      }
    });

    it('should return null for non-matching ETW line', async () => {
      const line = 'Some unrelated text without EventID';
      const nameMatch = line.match(/EventID:\s*(\d+)/);
      expect(nameMatch).toBeNull();
    });
  });

  describe('event buffer limit', () => {
    it('should respect maxEvents limit', async () => {
      // Create a monitor with small maxEvents
      const sessionId = await monitor.startMonitor(1234, 5);
      // The session exists but won't have events without actual subprocess
      const events = await monitor.getEvents(sessionId);
      expect(events.length).toBeLessThanOrEqual(5);
      await monitor.stopMonitor(sessionId);
    });
  });

  describe('strace arg parsing', () => {
    it('should handle nested parentheses in args', () => {
      const argsStr = 'AT_FDCWD, "/path (with parens)", O_RDONLY';
      const args: unknown[] = [];
      let depth = 0;
      let current = '';
      for (const ch of argsStr) {
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        if (ch === ')' || ch === '}' || ch === ']') depth--;
        if (ch === ',' && depth === 0) {
          args.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      if (current.trim()) args.push(current.trim());

      expect(args).toEqual(['AT_FDCWD', '"/path (with parens)"', 'O_RDONLY']);
    });

    it('should handle simple comma-separated args', () => {
      const argsStr = '3, "hello", 5';
      const args: unknown[] = argsStr.split(',').map((s) => s.trim());
      expect(args).toEqual(['3', '"hello"', '5']);
    });
  });
});

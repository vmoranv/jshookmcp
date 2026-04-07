import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * LinuxProcessManager additional coverage tests.
 * Fills branches not covered by LinuxProcessManager.test.ts or LinuxProcessManager.edge-cases.test.ts:
 * - detectDisplayServer() success path (returns X11)
 * - findChromeProcesses() catch block on getProcessWindows error
 * - findChromeProcesses() when detailedInfo exists but has no commandLine
 * - getProcessWindows() under X11 with xdotool present, empty window list
 * - launchWithDebug() catch block path
 */

const state = vi.hoisted(() => {
  const execAsync = vi.fn();
  const spawn = vi.fn();
  return { execAsync, spawn };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: vi.fn(),
    spawn: state.spawn,
  };
});

vi.mock('util', () => ({
  promisify: vi.fn(() => state.execAsync),
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { LinuxProcessManager } from '@modules/process/LinuxProcessManager';

function setupExecByCommand(map: Record<string, { stdout: string; stderr?: string }>) {
  state.execAsync.mockImplementation(async (cmd: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (cmd.includes(key)) return { stdout: value.stdout, stderr: value.stderr ?? '' };
    }
    return { stdout: '', stderr: '' };
  });
}

function createSpawnChild(pid: number) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('LinuxProcessManager - coverage expansion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // --- detectDisplayServer success path ---

  describe('detectDisplayServer', () => {
    it('detects Wayland session type', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'wayland\n', stderr: '' });
      const manager = new LinuxProcessManager();
      await new Promise(setImmediate);
      expect(manager.isRunningOnWayland()).toBe(true);
    });

    it('can log a Wayland display server when detectDisplayServer flips the flag synchronously', () => {
      const detectSpy = vi
        .spyOn(LinuxProcessManager.prototype as any, 'detectDisplayServer')
        .mockImplementation(function (this: any) {
          this.isWayland = true;
          return Promise.resolve();
        });

      const manager = new LinuxProcessManager();
      expect(manager.isRunningOnWayland()).toBe(true);

      detectSpy.mockRestore();
    });
  });

  // --- findProcesses sanitization coverage ---

  describe('findProcesses sanitization', () => {
    it('removes shell metacharacters from pattern', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        'ps aux': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      await manager.findProcesses('chrome; rm -rf /');
      const cmd = state.execAsync.mock.calls.find((c) => c[0].includes('ps aux'))?.[0] as string;
      expect(cmd).not.toContain(';');
      expect(cmd).toContain('chrome rm -rf /');
    });

    it('handles pattern that becomes empty after sanitization', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        'ps aux': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.findProcesses(';;;');
      expect(result).toEqual([]);
    });

    it('accepts an undefined pattern and falls back to an empty grep string', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        'ps aux': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.findProcesses(undefined as any);
      expect(result).toEqual([]);
    });
  });

  // --- findChromeProcesses branches ---

  describe('findChromeProcesses', () => {
    it('catches errors from getProcessWindows during target window search', async () => {
      setupExecByCommand({
        'ps aux': { stdout: 'user 1 0 0 0 0 ? S 0 0 chrome\n' },
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 1,
        name: 'chrome',
        commandLine: 'chrome',
      });
      vi.spyOn(manager, 'getProcessWindows').mockRejectedValue(new Error('xdotool error'));

      const result = await manager.findChromeProcesses();
      // Should still return result (with catch block falling through)
      expect(result.mainProcess?.pid).toBe(1);
      expect(result.targetWindow).toBeUndefined();
    });

    it('falls back to mainProcess when detailedInfo.commandLine is missing', async () => {
      setupExecByCommand({
        'ps aux': { stdout: 'user 1 0 0 0 0 ? S 0 0 chrome\n' },
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 1,
        name: 'chrome',
        // commandLine missing
      } as any);
      vi.spyOn(manager, 'getProcessWindows').mockResolvedValue([]);

      const result = await manager.findChromeProcesses();
      expect(result.mainProcess?.pid).toBe(1);
    });

    it('returns early when no chrome processes found', async () => {
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const manager = new LinuxProcessManager();
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess).toBeUndefined();
      expect(result.rendererProcesses).toEqual([]);
    });

    it('classifies the main process when commandLine has no --type flag', async () => {
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'findProcesses').mockResolvedValue([
        { pid: 10, name: 'chrome', commandLine: 'chrome --profile-directory=Default' },
      ]);
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 10,
        name: 'chrome',
        commandLine: 'chrome --profile-directory=Default',
      });
      vi.spyOn(manager, 'getProcessWindows').mockResolvedValue([]);

      const result = await manager.findChromeProcesses();
      expect(result.mainProcess?.pid).toBe(10);
    });
  });

  // --- getProcessWindows X11 path ---

  describe('getProcessWindows', () => {
    it('returns empty array when xdotool search finds no windows', async () => {
      setupExecByCommand({
        'which xdotool': { stdout: '/usr/bin/xdotool' },
        'xdotool search': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toEqual([]);
    });

    it('parses window IDs and retrieves title and class successfully', async () => {
      setupExecByCommand({
        'which xdotool': { stdout: '/usr/bin/xdotool' },
        'xdotool search': { stdout: '999\n' },
        'getwindowname 999': { stdout: 'My Window\n' },
        'getwindowclassname 999': { stdout: 'Chrome_WidgetWin_1\n' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('My Window');
      expect(result[0]!.className).toBe('Chrome_WidgetWin_1');
    });
  });

  // --- launchWithDebug ---

  describe('launchWithDebug', () => {
    it('catches spawn error and returns null', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const manager = new LinuxProcessManager();
      const result = await manager.launchWithDebug('/nonexistent', 9222);
      expect(result).toBeNull();
    });

    it('waits PROCESS_LAUNCH_WAIT_MS and then calls getProcessByPid', async () => {
      vi.useFakeTimers();
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const child = createSpawnChild(1234);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('/status')) return { stdout: 'Name:\tchrome\nPPid:\t1\n' };
        if (cmd.includes('/cmdline')) return { stdout: 'chrome' };
        if (cmd.includes('/stat')) return { stdout: '0 0 0 0 0 0 0 0 0 0 0 0 0 1 1' };
        if (cmd.includes('readlink')) return { stdout: '/usr/bin/chrome' };
        return { stdout: '' };
      });

      const manager = new LinuxProcessManager();
      const pending = manager.launchWithDebug('/usr/bin/chrome', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result?.pid).toBe(1234);
      expect(result?.name).toBe('chrome');
      vi.useRealTimers();
    });
  });

  // --- killProcess ---

  describe('killProcess', () => {
    it('successfully kills a process with kill -9 then kill -15 fallback', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      // First call (kill -9) succeeds
      state.execAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
      const manager = new LinuxProcessManager();
      const result = await manager.killProcess(1234);
      expect(result).toBe(true);
      const cmd = state.execAsync.mock.calls.at(-1)?.[0] as string;
      expect(cmd).toContain('kill -9 1234');
    });

    it('rejects Infinity PID without calling exec', async () => {
      const manager = new LinuxProcessManager();
      const result = await manager.killProcess(Infinity);
      expect(result).toBe(false);
    });
  });

  // --- getProcessCommandLine ---

  describe('getProcessCommandLine', () => {
    it('returns empty object when cat /proc/pid/cmdline returns empty', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        'cat /proc/123/cmdline': { stdout: '' },
        'grep PPid': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessCommandLine(123);
      expect(result).toEqual({});
    });

    it('extracts parent PID from PPid line correctly', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        'cat /proc/123/cmdline': { stdout: 'chrome --remote-debugging-port=9222' },
        'grep PPid': { stdout: 'PPid:\t1' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessCommandLine(123);
      expect(result.commandLine).toBe('chrome --remote-debugging-port=9222');
      expect(result.parentPid).toBe(1);
    });
  });

  // --- checkDebugPort ---

  describe('checkDebugPort', () => {
    it('returns port from command-line match', async () => {
      const manager = new LinuxProcessManager();
      const result = await manager.checkDebugPort(123, {
        commandLine: 'chrome --remote-debugging-port=9222',
      });
      expect(result).toBe(9222);
    });

    it('falls back to ss port scan when no command-line match', async () => {
      setupExecByCommand({
        'ss ': { stdout: 'LISTEN 0 50 *:9222 *:* users:(("chrome",pid=123,fd=10))\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(123);
      expect(result).toBe(9222);
    });

    it('returns null when port not in candidates', async () => {
      setupExecByCommand({
        'ss ': { stdout: 'LISTEN 0 50 *:8080\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(123);
      expect(result).toBeNull();
    });

    it('falls through to the socket scan when the command line contains a non-numeric debug port', async () => {
      setupExecByCommand({
        'ss ': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.checkDebugPort(123, {
        commandLine: 'chrome --remote-debugging-port=abc',
      });
      expect(result).toBeNull();
    });
  });

  // --- getProcessByPid ---

  describe('getProcessByPid', () => {
    it('extracts cpuUsage from utime+stime correctly', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        '/status': { stdout: 'Name:\tproc\nPPid:\t0\n' },
        '/cmdline': { stdout: 'proc' },
        '/stat': { stdout: '1 (proc) S 0 0 0 0 0 0 0 0 0 0 100 200' },
        readlink: { stdout: '/proc/proc\n' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(1);
      expect(result?.cpuUsage).toBe(300);
    });

    it('returns null when safePid rejects NaN', async () => {
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(NaN);
      expect(result).toBeNull();
    });

    it('falls back to unknown and undefined metadata when /proc omits optional fields', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        '/status': { stdout: 'State:\tS\n' },
        '/cmdline': { stdout: '' },
        '/stat': { stdout: '1 (proc) S 0' },
        readlink: { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(1);
      expect(result).toMatchObject({
        pid: 1,
        name: 'unknown',
        executablePath: undefined,
        commandLine: undefined,
        parentPid: undefined,
        memoryUsage: undefined,
        cpuUsage: 0,
      });
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

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

describe('LinuxProcessManager - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectDisplayServer', () => {
    it('defaults to X11 when echo $XDG_SESSION_TYPE throws error', async () => {
      state.execAsync.mockRejectedValue(new Error('Command failed'));
      const manager = new LinuxProcessManager();
      // Need to wait for the async constructor to finish its detection promise
      await new Promise(setImmediate);
      expect(manager.isRunningOnWayland()).toBe(false);
    });
  });

  describe('findProcesses', () => {
    it('returns empty array on exec error', async () => {
      state.execAsync.mockRejectedValue(new Error('cmd error'));
      const manager = new LinuxProcessManager();
      const result = await manager.findProcesses('test');
      expect(result).toEqual([]);
    });

    it('ignores malformed ps aux lines', async () => {
      setupExecByCommand({
        'ps aux': {
          stdout:
            'USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\nroot 1\nuser 123 1.0 2.0 0 0 ? S 00:00 00:00 /usr/bin/test\n',
        },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.findProcesses('test');
      expect(result).toHaveLength(1);
      expect(result[0]!.pid).toBe(123);
    });
  });

  describe('getProcessByPid', () => {
    it('handles negative or invalid PID', async () => {
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(-100);
      expect(result).toBeNull();
    });

    it('returns null when cat /proc/pid/status fails and returning empty', async () => {
      setupExecByCommand({
        'cat /proc/123/status': { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toBeNull();
    });

    it('handles process without VmRSS or PPid', async () => {
      setupExecByCommand({
        '/status': { stdout: 'Name:\tbrowser-bin\n' },
        '/cmdline': { stdout: '/usr/bin/browser-bin' },
        '/stat': { stdout: '0 0 0' },
        readlink: { stdout: '' },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toEqual({
        pid: 123,
        name: 'browser-bin',
        executablePath: undefined,
        commandLine: '/usr/bin/browser-bin',
        parentPid: undefined,
        memoryUsage: undefined,
        cpuUsage: 0,
      });
    });

    it('handles readlink error by returning undefined executablePath', async () => {
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('readlink')) throw new Error('not permitted');
        if (cmd.includes('/status')) return { stdout: 'Name:\tapp\n' };
        if (cmd.includes('/cmdline')) return { stdout: 'app\n' };
        if (cmd.includes('/stat')) return { stdout: '0 0 0' };
        return { stdout: '' };
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result?.executablePath).toBeUndefined();
    });
  });

  describe('getProcessWindows', () => {
    it('returns empty array when xdotool is not installed', async () => {
      setupExecByCommand({
        'which xdotool': { stdout: '  ' }, // empty output
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toEqual([]);
    });

    it('returns empty array on general exec error', async () => {
      setupExecByCommand({
        'which xdotool': { stdout: '/usr/bin/xdotool' },
      });
      state.execAsync.mockImplementationOnce(async (cmd: string) => {
        if (cmd.includes('xdotool search')) throw new Error('Search failed');
        return { stdout: '/usr/bin/xdotool' };
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toEqual([]);
    });

    it('skips windows that throw error during title/class retrieval', async () => {
      setupExecByCommand({
        'which xdotool': { stdout: '/usr/bin/xdotool' },
        'xdotool search': { stdout: '1111\n2222\n' },
      });
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('which')) return { stdout: '/usr/bin/xdotool' };
        if (cmd.includes('xdotool search')) return { stdout: '1111\n2222\n' };
        if (cmd.includes('1111')) {
          return { stdout: 'Title1' };
        }
        if (cmd.includes('2222')) {
          throw new Error('Window closed');
        }
        return { stdout: '' };
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toHaveLength(1);
      expect(result[0]!.handle).toBe('1111');
      expect(result[0]!.title).toBe('Title1');
    });
  });

  describe('findChromeProcesses', () => {
    it('returns empty structures on error finding processes', async () => {
      state.execAsync.mockRejectedValue(new Error('Fail'));
      const manager = new LinuxProcessManager();
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess).toBeUndefined();
      expect(result.rendererProcesses).toEqual([]);
    });

    it('classifies chrome processes based on type flag', async () => {
      setupExecByCommand({
        'ps aux': {
          stdout: [
            'user 1 0 0 0 0 ? S 0 0 chrome --type=renderer',
            'user 2 0 0 0 0 ? S 0 0 chrome --type=gpu-process',
            'user 3 0 0 0 0 ? S 0 0 chrome --type=utility',
            'user 4 0 0 0 0 ? S 0 0 chrome', // main
            'user 5 0 0 0 0 ? S 0 0 chrome', // another main fallback
          ].join('\n'),
        },
      });

      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockImplementation(async (pid: number) => {
        let cmd = 'chrome';
        if (pid === 1) cmd = 'chrome --type=renderer';
        if (pid === 2) cmd = 'chrome --type=gpu-process';
        if (pid === 3) cmd = 'chrome --type=utility';
        if (pid === 4) cmd = 'chrome';
        if (pid === 5) return null as any; // Trigger null fallback branch
        return { pid, name: 'chrome', executePath: '/usr/bin/chrome', commandLine: cmd } as any;
      });
      vi.spyOn(manager, 'getProcessWindows').mockResolvedValue([]);

      const result = await manager.findChromeProcesses();
      expect(result.rendererProcesses).toHaveLength(1);
      expect(result.gpuProcess?.pid).toBe(2);
      expect(result.utilityProcesses).toHaveLength(1);
      expect(result.mainProcess?.pid).toBe(4);
    });

    it('correctly associates target window when found', async () => {
      setupExecByCommand({
        'ps aux': { stdout: 'user 1 0 0 0 0 ? S 0 0 chrome\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 1,
        name: 'chrome',
        commandLine: 'chrome',
      } as any);
      vi.spyOn(manager, 'getProcessWindows').mockResolvedValue([
        { handle: '11', title: 'Chromium', className: 'Google-chrome', processId: 1, threadId: 0 },
      ]);
      const result = await manager.findChromeProcesses();
      expect(result.targetWindow?.handle).toBe('11');
    });
  });

  describe('getProcessCommandLine', () => {
    it('returns empty object on exec error', async () => {
      state.execAsync.mockRejectedValue(new Error('fail'));
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({});
    });
  });

  describe('checkDebugPort', () => {
    it('returns null on exec error', async () => {
      state.execAsync.mockRejectedValue(new Error('fail'));
      const manager = new LinuxProcessManager();
      const result = await manager.checkDebugPort(100);
      expect(result).toBeNull();
    });

    it('parses ss/netstat port output correctly', async () => {
      setupExecByCommand({
        'ss ': { stdout: 'LISTEN 0 50 *:9222 *:* users:(("chrome",pid=100,fd=10))\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(100);
      expect(result).toBe(9222);
    });

    it('returns null if port is not in candidates', async () => {
      setupExecByCommand({
        'ss ': { stdout: 'LISTEN 0 50 *:8080 *:* users:(("chrome",pid=100,fd=10))\n' },
      });
      const manager = new LinuxProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(100);
      expect(result).toBeNull();
    });
  });

  describe('killProcess', () => {
    it('returns false on error', async () => {
      state.execAsync.mockRejectedValue(new Error('fail'));
      const manager = new LinuxProcessManager();
      const result = await manager.killProcess(100);
      expect(result).toBe(false);
    });
  });

  describe('launchWithDebug', () => {
    it('returns null on spawn exception', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('spawn Err');
      });
      const manager = new LinuxProcessManager();
      const result = await manager.launchWithDebug('chrome', 9222);
      expect(result).toBeNull();
    });

    it('returns null if child.pid is completely missing', async () => {
      vi.useFakeTimers();
      const child = new EventEmitter() as any;
      child.unref = vi.fn();
      state.spawn.mockReturnValue(child);

      const manager = new LinuxProcessManager();
      const pending = manager.launchWithDebug('chrome', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toBeNull();
    });
  });
});

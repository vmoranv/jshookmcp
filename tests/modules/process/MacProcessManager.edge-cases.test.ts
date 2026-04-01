import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => {
  const execAsync = vi.fn();
  const execFileAsync = vi.fn();
  const spawn = vi.fn();
  const loadScript = vi.fn();
  return { execAsync, execFileAsync, spawn, loadScript };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: () => {},
    execFile: () => {},
    spawn: state.spawn,
  };
});

vi.mock('util', () => ({
  promisify: vi.fn((fn: any) => {
    if (fn.name === 'execFile') {
      return state.execFileAsync;
    }
    return state.execAsync;
  }),
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@native/ScriptLoader', () => ({
  ScriptLoader: class {
    async loadScript() {
      return state.loadScript();
    }
  },
}));

import { MacProcessManager } from '@modules/process/MacProcessManager';

function setupExecByCommand(map: Record<string, { stdout: string; stderr?: string }>) {
  state.execAsync.mockImplementation(async (cmd: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (cmd.includes(key)) return { stdout: value.stdout, stderr: value.stderr ?? '' };
    }
    return { stdout: '', stderr: '' };
  });
}

describe('MacProcessManager - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findProcesses', () => {
    it('returns empty array on exec error', async () => {
      state.execAsync.mockRejectedValue(new Error('cmd error'));
      const manager = new MacProcessManager();
      const result = await manager.findProcesses('test');
      expect(result).toEqual([]);
    });

    it('ignores malformed ps aux lines', async () => {
      setupExecByCommand({
        'ps aux': {
          stdout:
            'USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\nuser 123 1.0 2.0 0 0 ? S 00:00 00:00 /usr/bin/test\nuser notapid 1.0 2.0 0 0 ? S 00:00 00:00 /usr/bin/test',
        },
      });
      const manager = new MacProcessManager();
      const result = await manager.findProcesses('test');
      expect(result).toHaveLength(1);
      expect(result[0]!.pid).toBe(123);
    });
  });

  describe('getProcessByPid', () => {
    it('handles negative or invalid PID', async () => {
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(-100);
      expect(result).toBeNull();
    });

    it('returns null when ps output fails or has < 2 lines', async () => {
      setupExecByCommand({
        'ps -p 123': { stdout: 'PID PPID %CPU %MEM COMM ARGS\n' },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toBeNull();
    });

    it('returns null if ps output throws error', async () => {
      state.execAsync.mockRejectedValue(new Error('error'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toBeNull();
    });

    it('handles getProcessPath error by returning undefined executablePath', async () => {
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('comm=')) throw new Error('not permitted');
        if (cmd.includes('ps -p'))
          return {
            stdout: 'PID PPID %CPU %MEM COMM ARGS\n123 1 2.5 3.5 /usr/bin/app /usr/bin/app\n',
          };
        return { stdout: '' };
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result?.executablePath).toBeUndefined();
    });
  });

  describe('getProcessWindows', () => {
    it('returns empty windows when AppleScript output has no title entries', async () => {
      setupExecByCommand({
        'ps -p 501 -o pid,ppid,pcpu,pmem,comm,args': {
          stdout: 'PID PPID %CPU %MEM COMM ARGS\n501 1 0.1 0.2 Browser Browser\n',
        },
        'ps -p 501 -o comm=': { stdout: 'Browser\n' },
        'osascript -e': { stdout: '{}' },
      });
      const manager = new MacProcessManager();
      const windows = await manager.getProcessWindows(501);

      expect(windows).toEqual([]);
    });
  });
  describe('getProcessWindowsCG', () => {
    it('returns empty array on exec error', async () => {
      state.loadScript.mockResolvedValue('print("hello")');
      state.execFileAsync.mockRejectedValue(new Error('python failed'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });

    it('substitutes the PID placeholder and parses bounds', async () => {
      state.loadScript.mockResolvedValue('print("{{PID}}")');
      state.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify([
          {
            handle: '1',
            title: 'Test',
            className: 'app',
            processId: 123,
            bounds: { X: 10, Y: 20, Width: 30, Height: 40 },
          },
        ]),
        stderr: '',
      });

      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);

      expect(state.execFileAsync).toHaveBeenCalledWith(
        'python3',
        ['-c', expect.stringContaining('123')],
        expect.objectContaining({ timeout: 10_000, windowsHide: true }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.bounds).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });
    it('returns empty array on JSON parse error', async () => {
      state.loadScript.mockResolvedValue('print("hello")');
      state.execFileAsync.mockResolvedValue({ stdout: 'invalid json', stderr: '' });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });

    it('parses valid output without bounds', async () => {
      state.loadScript.mockResolvedValue('print("hello")');
      state.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify([{ handle: '1', title: 'Test', className: 'app', processId: 123 }]),
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toHaveLength(1);
      expect(result[0]?.bounds).toBeUndefined();
    });
  });

  describe('findChromeProcesses', () => {
    it('returns empty structures on error finding processes', async () => {
      state.execAsync.mockRejectedValue(new Error('Fail'));
      const manager = new MacProcessManager();
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess).toBeUndefined();
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

      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockImplementation(async (pid: number) => {
        let cmd = 'chrome';
        if (pid === 1) cmd = 'chrome --type=renderer';
        if (pid === 2) cmd = 'chrome --type=gpu-process';
        if (pid === 3) cmd = 'chrome --type=utility';
        if (pid === 4) cmd = 'chrome';
        if (pid === 5) return null as any;
        return { pid, name: 'chrome', executePath: '/usr/bin/chrome', commandLine: cmd } as any;
      });
      vi.spyOn(manager, 'getProcessWindowsCG').mockResolvedValue([]);

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
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 1,
        name: 'chrome',
        commandLine: 'chrome',
      } as any);
      vi.spyOn(manager, 'getProcessWindowsCG').mockResolvedValue([
        { handle: '11', title: 'Chromium', className: 'Google-chrome', processId: 1, threadId: 0 },
      ]);
      const result = await manager.findChromeProcesses();
      expect(result.targetWindow?.handle).toBe('11');
    });
  });

  describe('getProcessCommandLine', () => {
    it('returns empty object if ps ppid= args= returns few parts', async () => {
      setupExecByCommand({
        'ps -p': { stdout: '123\n' }, // No args
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result.commandLine).toBeUndefined();
    });

    it('returns empty object when ps output is malformed after parse', async () => {
      setupExecByCommand({
        'ps -p': { stdout: 'PID PPID %CPU %MEM COMM ARGS\n123' },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result.parentPid).toBeNaN();
      expect(result.commandLine).toContain('PPID %CPU %MEM COMM ARGS 123');
    });
    it('returns empty object on exec error', async () => {
      state.execAsync.mockRejectedValue(new Error('fail'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({});
    });
  });

  describe('checkDebugPort', () => {
    it('returns null on exec error', async () => {
      state.execAsync.mockRejectedValue(new Error('fail'));
      const manager = new MacProcessManager();
      const result = await manager.checkDebugPort(100);
      expect(result).toBeNull();
    });

    it('parses lsof port output correctly', async () => {
      setupExecByCommand({
        lsof: {
          stdout:
            'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nchrome 100 user 10u IPv4 0x0 0t0 TCP *:9222 (LISTEN)\n',
        },
      });
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(100);
      expect(result).toBe(9222);
    });

    it('returns null if port is not in candidates', async () => {
      setupExecByCommand({
        lsof: {
          stdout:
            'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nchrome 100 user 10u IPv4 0x0 0t0 TCP *:8080 (LISTEN)\n',
        },
      });
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(100);
      expect(result).toBeNull();
    });
  });

  describe('killProcess', () => {
    it('returns true on successful kill', async () => {
      setupExecByCommand({
        'kill -9 100': { stdout: '', stderr: '' },
      });
      const manager = new MacProcessManager();
      const result = await manager.killProcess(100);
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      state.execAsync.mockRejectedValue(new Error('fail'));
      const manager = new MacProcessManager();
      const result = await manager.killProcess(100);
      expect(result).toBe(false);
    });
  });

  describe('launchWithDebug', () => {
    it('returns null on spawn exception', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('spawn Err');
      });
      const manager = new MacProcessManager();
      const result = await manager.launchWithDebug('chrome', 9222);
      expect(result).toBeNull();
    });

    it('returns null if child.pid is completely missing', async () => {
      vi.useFakeTimers();
      const child = new EventEmitter() as any;
      child.unref = vi.fn();
      state.spawn.mockReturnValue(child);

      const manager = new MacProcessManager();
      const pending = manager.launchWithDebug('chrome', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toBeNull();
    });
  });
});

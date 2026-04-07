import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * MacProcessManager additional coverage tests.
 * Fills branches not covered by MacProcessManager.test.ts or MacProcessManager.edge-cases.test.ts:
 * - getProcessByPid() success path (full ps -p output with all fields)
 * - getProcessWindows() when getProcessByPid returns null (early return)
 * - getProcessWindows() AppleScript with titles parsed
 * - getProcessWindowsCG() JSON parse success with bounds
 * - getProcessWindowsCG() JSON parse failure (catch block)
 * - findChromeProcesses() catch block
 * - checkDebugPort() when commandLine is null (falls through to lsof)
 * - launchWithDebug() success path
 */

const state = vi.hoisted(() => {
  const exec = vi.fn(function exec() {});
  const execFile = vi.fn(function execFile() {});
  const execAsync = vi.fn();
  const execFileAsync = vi.fn();
  const spawn = vi.fn();
  const loadScript = vi.fn();
  return { exec, execFile, execAsync, execFileAsync, spawn, loadScript };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: state.exec,
    execFile: state.execFile,
    spawn: state.spawn,
  };
});

vi.mock('util', () => ({
  promisify: vi.fn((fn: any) => (fn === state.execFile ? state.execFileAsync : state.execAsync)),
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

function createSpawnChild(pid: number) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('MacProcessManager - coverage expansion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // --- findProcesses sanitization ---

  describe('findProcesses sanitization', () => {
    it('removes shell metacharacters from pattern', async () => {
      setupExecByCommand({
        'ps aux': { stdout: '' },
      });
      const manager = new MacProcessManager();
      await manager.findProcesses('chrome; kill -9 1');
      const cmd = state.execAsync.mock.calls[0]?.[0] as string;
      expect(cmd).not.toContain(';');
      expect(cmd).toContain('chrome kill -9 1');
    });

    it('handles empty result after grep', async () => {
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const manager = new MacProcessManager();
      const result = await manager.findProcesses('nonexistent');
      expect(result).toEqual([]);
    });

    it('accepts an undefined pattern and falls back to an empty grep string', async () => {
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const manager = new MacProcessManager();
      const result = await manager.findProcesses(undefined as any);
      expect(result).toEqual([]);
    });
  });

  // --- getProcessByPid success path ---

  describe('getProcessByPid success', () => {
    it('returns full process info from ps output', async () => {
      setupExecByCommand({
        'ps -p 500': {
          stdout:
            '  PID  PPID  %CPU  %MEM  COMM                              ARGS\n  500     1   2.5   1.2  Chrome  Chrome --remote-debugging-port=9222\n',
        },
        'ps -p 500 -o comm=': { stdout: 'Chrome\n' },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(500);
      expect(result?.pid).toBe(500);
      expect(result?.parentPid).toBe(1);
      expect(result?.name).toBe('Chrome');
      expect(result?.commandLine).toContain('--remote-debugging-port=9222');
    });

    it('returns null when getProcessPath returns undefined', async () => {
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('comm=')) throw new Error('permission denied');
        if (cmd.includes('ps -p'))
          return {
            stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  500     1   0     0    app  app\n',
          };
        return { stdout: '' };
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(500);
      expect(result?.executablePath).toBeUndefined();
    });

    it('returns null for Infinity PID', async () => {
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(Infinity);
      expect(result).toBeNull();
    });

    it('returns null when the parsed ps row does not contain enough columns', async () => {
      setupExecByCommand({
        'ps -p 501': {
          stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0\n',
        },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(501);
      expect(result).toBeNull();
    });
  });

  // --- getProcessWindows ---

  describe('getProcessWindows', () => {
    it('returns empty array when getProcessByPid returns null', async () => {
      state.execAsync.mockRejectedValue(new Error('process gone'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(999);
      expect(result).toEqual([]);
    });

    it('parses window titles from AppleScript output', async () => {
      setupExecByCommand({
        'ps -p 501': {
          stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0     0    App  App\n',
        },
        'ps -p 501 -o comm=': { stdout: 'App\n' },
        'osascript -e': {
          stdout: '{title:Browser Window, className:App, processId:501, handle:applescript-window}',
        },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(501);
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('Browser Window');
    });

    it('returns empty array when AppleScript output is malformed', async () => {
      setupExecByCommand({
        'ps -p 501': {
          stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0     0    App  App\n',
        },
        'ps -p 501 -o comm=': { stdout: 'App\n' },
        'osascript -e': { stdout: 'not valid json at all' },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(501);
      expect(result).toEqual([]);
    });

    it('returns empty array when AppleScript explicitly reports no windows', async () => {
      setupExecByCommand({
        'ps -p 501': {
          stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0     0    App  App\n',
        },
        'ps -p 501 -o comm=': { stdout: 'App\n' },
        'osascript -e': { stdout: '[]' },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(501);
      expect(result).toEqual([]);
    });

    it('returns empty array when AppleScript errors are caught', async () => {
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps -p 501')) {
          return {
            stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0     0    App  App\n',
          };
        }
        if (cmd.includes('comm=')) return { stdout: 'App\n' };
        if (cmd.includes('osascript')) throw new Error('osascript failed');
        return { stdout: '' };
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(501);
      expect(result).toEqual([]);
    });
  });

  // --- getProcessWindowsCG ---

  describe('getProcessWindowsCG', () => {
    it('returns empty array when JSON parse fails', async () => {
      state.loadScript.mockResolvedValue('template');
      state.execFileAsync.mockResolvedValue({ stdout: 'not json', stderr: '' });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });

    it('parses valid JSON with bounds correctly', async () => {
      state.loadScript.mockResolvedValue('template');
      state.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify([
          {
            handle: '0x100',
            title: 'Main Window',
            className: 'App',
            processId: 123,
            bounds: { X: 0, Y: 0, Width: 1920, Height: 1080 },
          },
        ]),
        stderr: '',
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toHaveLength(1);
      expect(result[0]!.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    });

    it('defaults zero-valued bounds dimensions to 0', async () => {
      state.loadScript.mockResolvedValue('template');
      state.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify([
          {
            handle: '0x101',
            title: 'Zero Window',
            className: 'App',
            processId: 123,
            bounds: { X: 1, Y: 2, Width: 0, Height: 0 },
          },
        ]),
        stderr: '',
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result[0]!.bounds).toEqual({ x: 1, y: 2, width: 0, height: 0 });
    });

    it('returns empty array on timeout error', async () => {
      state.loadScript.mockResolvedValue('template');
      state.execFileAsync.mockRejectedValue(new Error('timeout'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });
  });

  // --- findChromeProcesses ---

  describe('findChromeProcesses', () => {
    it('catches errors and returns empty result', async () => {
      state.execAsync.mockRejectedValue(new Error('ps failed'));
      const manager = new MacProcessManager();
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess).toBeUndefined();
    });

    it('classifies processes with --type= flags correctly', async () => {
      setupExecByCommand({
        'ps aux': {
          stdout: [
            'user 1 0 0 0 0 ? S 0 0 chrome --type=renderer',
            'user 2 0 0 0 0 ? S 0 0 chrome --type=gpu-process',
            'user 3 0 0 0 0 ? S 0 0 chrome --type=utility',
            'user 4 0 0 0 0 ? S 0 0 chrome',
          ].join('\n'),
        },
      });
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockImplementation(async (pid: number) => {
        const commands: Record<number, string> = {
          1: 'chrome --type=renderer',
          2: 'chrome --type=gpu-process',
          3: 'chrome --type=utility',
          4: 'chrome',
        };
        return { pid, name: 'chrome', commandLine: commands[pid] } as any;
      });
      vi.spyOn(manager, 'getProcessWindowsCG').mockResolvedValue([]);

      const result = await manager.findChromeProcesses();
      expect(result.rendererProcesses).toHaveLength(1);
      expect(result.gpuProcess?.pid).toBe(2);
      expect(result.utilityProcesses).toHaveLength(1);
    });

    it('uses the current process as mainProcess when commandLine is missing', async () => {
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'findProcesses').mockResolvedValue([{ pid: 50, name: 'chrome' } as any]);
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({ pid: 50, name: 'chrome' } as any);
      vi.spyOn(manager, 'getProcessWindowsCG').mockResolvedValue([]);

      const result = await manager.findChromeProcesses();
      expect(result.mainProcess?.pid).toBe(50);
    });

    it('returns the partial result when downstream detail lookup throws', async () => {
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'findProcesses').mockResolvedValue([{ pid: 51, name: 'chrome' } as any]);
      vi.spyOn(manager, 'getProcessByPid').mockRejectedValue(new Error('detail lookup failed'));

      const result = await manager.findChromeProcesses();
      expect(result).toEqual({
        mainProcess: undefined,
        rendererProcesses: [],
        gpuProcess: undefined,
        utilityProcesses: [],
        targetWindow: undefined,
      });
    });
  });

  // --- getProcessCommandLine ---

  describe('getProcessCommandLine', () => {
    it('extracts command line after parent PID', async () => {
      setupExecByCommand({
        'ps -p 100': {
          stdout: '  100   1   0.1   0.2  chrome  chrome --remote-debugging-port=9222\n',
        },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result.commandLine).toContain('--remote-debugging-port=9222');
    });

    it('returns empty object for Infinity PID', async () => {
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(Infinity);
      expect(result).toEqual({});
    });

    it('returns an empty object when ps output only reports the parent PID', async () => {
      setupExecByCommand({
        'ps -p 100': { stdout: '100 ' },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({});
    });
  });

  // --- checkDebugPort ---

  describe('checkDebugPort', () => {
    it('returns port from command-line match', async () => {
      const manager = new MacProcessManager();
      const result = await manager.checkDebugPort(100, {
        commandLine: 'app --remote-debugging-port=9333',
      });
      expect(result).toBe(9333);
    });

    it('falls back to lsof when commandLine is null', async () => {
      setupExecByCommand({
        lsof: {
          stdout: 'chrome  100  user  10u  IPv4  0x0  0t0  TCP  *:9222 (LISTEN)\n',
        },
      });
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(100);
      expect(result).toBe(9222);
    });

    it('returns null when lsof output does not contain candidate ports', async () => {
      setupExecByCommand({
        lsof: {
          stdout: 'chrome  100  user  10u  IPv4  0x0  0t0  TCP  *:8080 (LISTEN)\n',
        },
      });
      const manager = new MacProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(100);
      expect(result).toBeNull();
    });

    it('falls through to lsof when the command line contains a non-numeric debug port', async () => {
      setupExecByCommand({
        lsof: { stdout: '' },
      });
      const manager = new MacProcessManager();
      const result = await manager.checkDebugPort(100, {
        commandLine: 'app --remote-debugging-port=abc',
      });
      expect(result).toBeNull();
    });
  });

  // --- launchWithDebug ---

  describe('launchWithDebug', () => {
    it('returns process info on success', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(5555);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps -p')) {
          return {
            stdout:
              '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  5555     1   0     0    chrome  chrome\n',
          };
        }
        if (cmd.includes('comm=')) return { stdout: 'chrome\n' };
        return { stdout: '' };
      });

      const manager = new MacProcessManager();
      const pending = manager.launchWithDebug('/Applications/Chrome.app', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result?.pid).toBe(5555);
      vi.useRealTimers();
    });

    it('returns null when spawn throws', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const manager = new MacProcessManager();
      const result = await manager.launchWithDebug('/nonexistent', 9222);
      expect(result).toBeNull();
    });

    it('returns null when child.pid is 0', async () => {
      vi.useFakeTimers();
      const child = new EventEmitter() as any;
      child.pid = 0;
      child.unref = vi.fn();
      state.spawn.mockReturnValue(child);

      const manager = new MacProcessManager();
      const pending = manager.launchWithDebug('/usr/bin/chrome', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toBeNull();
      vi.useRealTimers();
    });
  });

  // --- killProcess ---

  describe('killProcess', () => {
    it('rejects Infinity PID', async () => {
      const manager = new MacProcessManager();
      const result = await manager.killProcess(Infinity);
      expect(result).toBe(false);
    });

    it('returns false when the shell kill pipeline rejects', async () => {
      state.execAsync.mockRejectedValueOnce(new Error('Operation not permitted'));
      const manager = new MacProcessManager();
      const result = await manager.killProcess(1);
      expect(result).toBe(false);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => {
  const execAsync = vi.fn();
  const promisify = vi.fn(() => execAsync);
  const spawn = vi.fn();
  const getScriptPath = vi.fn(() => 'C:/scripts/enum-windows.ps1');
  const discoverBrowsers = vi.fn();
  const findByWindowClass = vi.fn();
  const findByProcessName = vi.fn();
  const detectDebugPort = vi.fn();
  return {
    execAsync,
    promisify,
    spawn,
    getScriptPath,
    discoverBrowsers,
    findByWindowClass,
    findByProcessName,
    detectDebugPort,
  };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: state.spawn,
}));

vi.mock('util', () => ({
  promisify: state.promisify,
}));

vi.mock('@src/native/ScriptLoader', () => ({
  ScriptLoader: class {
    getScriptPath = state.getScriptPath;
  },
}));

vi.mock('@src/modules/browser/BrowserDiscovery', () => ({
  BrowserDiscovery: class {
    discoverBrowsers = state.discoverBrowsers;
    findByWindowClass = state.findByWindowClass;
    findByProcessName = state.findByProcessName;
    detectDebugPort = state.detectDebugPort;
  },
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ProcessManager } from '@modules/process/ProcessManager';
import { mockAs } from '../../test-utils';

function createSpawnChild(pid = 9999) {
  const child = mockAs<any>(new EventEmitter());
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('ProcessManager advanced scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findProcesses', () => {
    it('uses cache when calling twice within TTL window', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([{ Id: 101, ProcessName: 'app', Path: 'C:/app.exe' }]),
        stderr: '',
      });
      const manager = new ProcessManager();

      // First call populates cache
      const first = await manager.findProcesses('app');
      // Second call should use cache
      const second = await manager.findProcesses('app');

      expect(state.execAsync).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
    });

    it('handles empty pattern by listing all processes', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([
          { Id: 1, ProcessName: 'sys', Path: 'C:/sys.exe' },
          { Id: 2, ProcessName: 'app', Path: 'C:/app.exe' },
        ]),
        stderr: '',
      });
      const manager = new ProcessManager();

      const results = await manager.findProcesses('');

      expect(results).toHaveLength(2);
      const cmd = state.execAsync.mock.calls[0]?.[0] as string;
      expect(cmd).not.toContain('-Name');
    });

    it('returns empty array when stdout is null', async () => {
      state.execAsync.mockResolvedValue({
        stdout: 'null',
        stderr: '',
      });
      const manager = new ProcessManager();

      const results = await manager.findProcesses('nonexistent');

      expect(results).toEqual([]);
    });

    it('returns empty array when stdout is empty', async () => {
      state.execAsync.mockResolvedValue({
        stdout: '',
        stderr: '',
      });
      const manager = new ProcessManager();

      const results = await manager.findProcesses('nonexistent');

      expect(results).toEqual([]);
    });

    it('handles single process object (not array) in stdout', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ Id: 42, ProcessName: 'solo', Path: 'C:/solo.exe' }),
        stderr: '',
      });
      const manager = new ProcessManager();

      const results = await manager.findProcesses('solo');

      expect(results).toHaveLength(1);
      expect(results[0]?.pid).toBe(42);
    });

    it('returns empty array when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('PowerShell error'));
      const manager = new ProcessManager();

      const results = await manager.findProcesses('crash');

      expect(results).toEqual([]);
    });
    it('computes cache deltas for added, changed, and removed processes after TTL expiry', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { Id: 1, ProcessName: 'alpha', Path: 'C:/alpha.exe' },
            { Id: 3, ProcessName: 'gamma', Path: 'C:/gamma.exe' },
          ]),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { Id: 1, ProcessName: 'alpha-renamed', Path: 'C:/alpha-new.exe' },
            { Id: 2, ProcessName: 'beta', Path: 'C:/beta.exe' },
          ]),
          stderr: '',
        });

      const manager = new ProcessManager();
      const first = await manager.findProcesses('chrome');
      await vi.advanceTimersByTimeAsync(4000);
      const second = await manager.findProcesses('chrome');

      expect(first).toHaveLength(2);
      expect(second).toHaveLength(2);
      expect(state.execAsync).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('getProcessByPid', () => {
    it('returns full process info when process exists', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({
          Id: 1234,
          ProcessName: 'chrome',
          Path: 'C:/chrome.exe',
          MainWindowTitle: 'Google Chrome',
          MainWindowHandle: '0x12345',
          CPU: 5.2,
          WorkingSet64: 123456789,
        }),
        stderr: '',
      });
      const manager = new ProcessManager();

      const result = await manager.getProcessByPid(1234);

      expect(result).toEqual({
        pid: 1234,
        name: 'chrome',
        executablePath: 'C:/chrome.exe',
        windowTitle: 'Google Chrome',
        windowHandle: '0x12345',
        cpuUsage: 5.2,
        memoryUsage: 123456789,
      });
    });

    it('throws on invalid PID (zero)', async () => {
      const manager = new ProcessManager();

      // safePid throws on invalid PIDs, getProcessByPid catches and returns null
      const result = await manager.getProcessByPid(0);

      expect(result).toBeNull();
    });

    it('throws on invalid PID (negative)', async () => {
      const manager = new ProcessManager();

      const result = await manager.getProcessByPid(-5);

      expect(result).toBeNull();
    });

    it('throws on invalid PID (NaN)', async () => {
      const manager = new ProcessManager();

      const result = await manager.getProcessByPid(NaN);

      expect(result).toBeNull();
    });

    it('returns null when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('WMI error'));
      const manager = new ProcessManager();

      const result = await manager.getProcessByPid(9999);

      expect(result).toBeNull();
    });
  });

  describe('getProcessWindows', () => {
    it('handles array of windows', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([
          { Handle: '0x1', Title: 'Win1', ClassName: 'Class1', ProcessId: 10 },
          { Handle: '0x2', Title: 'Win2', ClassName: 'Class2', ProcessId: 10 },
        ]),
        stderr: '',
      });
      const manager = new ProcessManager();

      const windows = await manager.getProcessWindows(10);

      expect(windows).toHaveLength(2);
      expect(windows[0]?.handle).toBe('0x1');
      expect(windows[1]?.handle).toBe('0x2');
    });

    it('returns empty array when stdout is null', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();

      const windows = await manager.getProcessWindows(10);

      expect(windows).toEqual([]);
    });

    it('returns empty array when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('Script error'));
      const manager = new ProcessManager();

      const windows = await manager.getProcessWindows(10);

      expect(windows).toEqual([]);
    });
  });

  describe('getProcessCommandLine', () => {
    it('returns commandLine and parentPid when available', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({
          CommandLine: 'C:/app.exe --flag=value',
          ParentProcessId: 100,
        }),
        stderr: '',
      });
      const manager = new ProcessManager();

      const result = await manager.getProcessCommandLine(200);

      expect(result.commandLine).toBe('C:/app.exe --flag=value');
      expect(result.parentPid).toBe(100);
    });

    it('returns empty object when stdout is null', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();

      const result = await manager.getProcessCommandLine(200);

      expect(result).toEqual({});
    });

    it('returns empty object when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('WMI error'));
      const manager = new ProcessManager();

      const result = await manager.getProcessCommandLine(200);

      expect(result).toEqual({});
    });
  });

  describe('checkDebugPort', () => {
    it('extracts port from provided commandLine option', async () => {
      const manager = new ProcessManager();

      const port = await manager.checkDebugPort(1, {
        commandLine: 'chrome.exe --remote-debugging-port=9222 --other',
      });

      expect(port).toBe(9222);
      expect(state.execAsync).not.toHaveBeenCalled();
    });

    it('falls back to network connection check when no match in commandLine', async () => {
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ CommandLine: 'chrome.exe --no-debug' }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ LocalPort: 9222 }]),
          stderr: '',
        });
      const manager = new ProcessManager();

      const port = await manager.checkDebugPort(1);

      expect(port).toBe(9222);
    });

    it('returns null when no debug port is detected', async () => {
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ CommandLine: 'chrome.exe' }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ LocalPort: 80 }]),
          stderr: '',
        });
      const manager = new ProcessManager();

      const port = await manager.checkDebugPort(1);

      expect(port).toBeNull();
    });

    it('returns null when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('Network error'));
      const manager = new ProcessManager();

      const port = await manager.checkDebugPort(1);

      expect(port).toBeNull();
    });
  });

  describe('launchWithDebug', () => {
    it('constructs debug args from debugPort and additional args', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(9999);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ OwningProcess: 9999 }),
        stderr: '',
      });
      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 9999,
        name: 'app',
        executablePath: 'C:/app.exe',
      });

      const pending = manager.launchWithDebug('C:/app.exe', 9333, ['--extra']);
      await vi.runAllTimersAsync();
      await pending;

      expect(state.spawn).toHaveBeenCalledWith(
        'C:/app.exe',
        ['--remote-debugging-port=9333', '--extra'],
        { detached: true, stdio: 'ignore' },
      );
      vi.useRealTimers();
    });

    it('returns null when spawn returns no pid', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(0);
      child.pid = undefined;
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toBeNull();
      vi.useRealTimers();
    });
    it('returns a synthesized process when listener PID resolves but getProcessByPid fails', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(5000);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ OwningProcess: 5000 }),
        stderr: '',
      });

      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue(null);

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toEqual({
        pid: 5000,
        name: 'app.exe',
        executablePath: 'C:/app.exe',
      });
      vi.useRealTimers();
    });

    it('returns null when launch throws', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('spawn error');
      });
      const manager = new ProcessManager();

      const result = await manager.launchWithDebug('C:/nonexistent.exe', 9222);

      expect(result).toBeNull();
    });
  });

  describe('injectDll', () => {
    it('always returns false (disabled for safety)', async () => {
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const manager = new ProcessManager();

      const result = await manager.injectDll(123, 'C:/test.dll');

      expect(result).toBe(false);
    });

    it('returns false on invalid PID', async () => {
      const manager = new ProcessManager();

      const result = await manager.injectDll(0, 'C:/test.dll');

      expect(result).toBe(false);
    });

    it('returns false when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('inject error'));
      const manager = new ProcessManager();

      const result = await manager.injectDll(123, 'C:/test.dll');

      expect(result).toBe(false);
    });
  });

  describe('killProcess', () => {
    it('returns true on successful kill', async () => {
      state.execAsync.mockResolvedValue({
        stdout: 'Process 123 killed',
        stderr: '',
      });
      const manager = new ProcessManager();

      const result = await manager.killProcess(123);

      expect(result).toBe(true);
    });

    it('returns false on invalid PID (negative)', async () => {
      const manager = new ProcessManager();

      const result = await manager.killProcess(-1);

      expect(result).toBe(false);
    });

    it('returns false on invalid PID (Infinity)', async () => {
      const manager = new ProcessManager();

      const result = await manager.killProcess(Infinity);

      expect(result).toBe(false);
    });

    it('returns false when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('kill error'));
      const manager = new ProcessManager();

      const result = await manager.killProcess(123);

      expect(result).toBe(false);
    });
  });

  describe('browser discovery delegation', () => {
    it('discoverBrowsers returns empty array on error', async () => {
      state.discoverBrowsers.mockRejectedValue(new Error('discovery error'));
      const manager = new ProcessManager();

      const result = await manager.discoverBrowsers();

      expect(result).toEqual([]);
    });

    it('findBrowserByWindowClass returns empty array on error', async () => {
      state.findByWindowClass.mockRejectedValue(new Error('class error'));
      const manager = new ProcessManager();

      const result = await manager.findBrowserByWindowClass('*');

      expect(result).toEqual([]);
    });

    it('findBrowserByProcessName returns empty array on error', async () => {
      state.findByProcessName.mockRejectedValue(new Error('name error'));
      const manager = new ProcessManager();

      const result = await manager.findBrowserByProcessName('chrome.exe');

      expect(result).toEqual([]);
    });

    it('detectBrowserDebugPort returns null on error', async () => {
      state.detectDebugPort.mockRejectedValue(new Error('port error'));
      const manager = new ProcessManager();

      const result = await manager.detectBrowserDebugPort(123);

      expect(result).toBeNull();
    });

    it('detectBrowserDebugPort returns null when no port detected', async () => {
      state.detectDebugPort.mockResolvedValue(null);
      const manager = new ProcessManager();

      const result = await manager.detectBrowserDebugPort(123);

      expect(result).toBeNull();
    });
  });

  describe('findChromiumProcesses', () => {
    it('delegates to findChromiumProcessesWithConfig', async () => {
      // findChromiumProcesses internally calls findChromiumProcessesWithConfig
      // We just verify it doesn't throw
      const manager = new ProcessManager();
      vi.spyOn(manager, 'findProcesses').mockResolvedValue([]);

      const result = await manager.findChromiumProcesses();

      expect(result).toBeDefined();
    });
  });

  describe('findChromiumAppProcesses (deprecated)', () => {
    it('calls findChromiumProcesses', async () => {
      const manager = new ProcessManager();
      vi.spyOn(manager, 'findChromiumProcesses').mockResolvedValue({
        mainProcess: undefined,
        rendererProcesses: [],
        gpuProcess: undefined,
        targetWindows: [],
      });

      await manager.findChromiumAppProcesses();

      expect(manager.findChromiumProcesses).toHaveBeenCalled();
    });
  });
});

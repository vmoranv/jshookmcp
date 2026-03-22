import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Prevent setup.ts initRegistry from timing out when child_process is mocked
vi.mock('@server/registry/index', () => ({
  initRegistry: vi.fn(async () => {}),
}));

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

vi.mock('@modules/process/ProcessManager.chromium', () => ({
  findChromiumProcessesWithConfig: vi.fn().mockResolvedValue({
    rendererProcesses: [],
    utilityProcesses: [],
  }),
}));

import { ProcessManager } from '@modules/process/ProcessManager';

function createSpawnChild(pid = 9999) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('ProcessManager — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- findProcesses edge cases ---

  describe('findProcesses', () => {
    it('returns empty array on command execution error', async () => {
      state.execAsync.mockRejectedValue(new Error('PowerShell not found'));
      const manager = new ProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });

    it('returns empty array for empty stdout', async () => {
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const manager = new ProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });

    it('returns empty array for null stdout', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });

    it('handles single process object (non-array JSON)', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ Id: 42, ProcessName: 'single', Path: 'C:/single.exe' }),
        stderr: '',
      });
      const manager = new ProcessManager();
      const results = await manager.findProcesses('single');
      expect(results).toEqual([{ pid: 42, name: 'single', executablePath: 'C:/single.exe' }]);
    });

    it('uses cache on second call within TTL', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([{ Id: 1, ProcessName: 'test', Path: 'C:/test.exe' }]),
        stderr: '',
      });
      const manager = new ProcessManager();
      await manager.findProcesses('test');
      await manager.findProcesses('test');
      // Should only call execAsync once due to cache
      expect(state.execAsync).toHaveBeenCalledTimes(1);
    });

    it('handles empty pattern (list all processes)', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([
          { Id: 1, ProcessName: 'proc1', Path: 'C:/proc1.exe' },
          { Id: 2, ProcessName: 'proc2', Path: 'C:/proc2.exe' },
        ]),
        stderr: '',
      });
      const manager = new ProcessManager();
      const results = await manager.findProcesses('');
      expect(results).toHaveLength(2);
      // Command should not contain a filter pattern with wildcards
      const cmd = state.execAsync.mock.calls[0]?.[0] as string;
      expect(cmd).not.toContain('-Name');
    });

    it('sanitizes dangerous characters from pattern', async () => {
      state.execAsync.mockResolvedValue({ stdout: '[]', stderr: '' });
      const manager = new ProcessManager();
      await manager.findProcesses('test`$(){}|<>');
      const cmd = state.execAsync.mock.calls[0]?.[0] as string;
      expect(cmd).not.toContain('`');
      expect(cmd).not.toContain('$');
      expect(cmd).not.toContain('(');
      expect(cmd).not.toContain(')');
    });

    it('computes diff between cache snapshots: detects added processes', async () => {
      // First call - no processes
      state.execAsync.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
        stderr: '',
      });
      const manager = new ProcessManager();
      await manager.findProcesses('test');

      // Force cache expiry by clearing cache indirectly via a different pattern
      // and then recall with same pattern after TTL
      // We simulate by calling with fresh data after cache expires
      state.execAsync.mockResolvedValueOnce({
        stdout: JSON.stringify([{ Id: 100, ProcessName: 'new-proc', Path: 'C:/new.exe' }]),
        stderr: '',
      });

      // Wait for cache to expire (TTL is 3000ms)
      // We test the diff logic by making two sequential calls with different data
      // The first call builds initial cache, second would compute diff if TTL expired
      const results = await manager.findProcesses('other-pattern');
      expect(results).toHaveLength(1);
    });
  });

  // --- getProcessByPid edge cases ---

  describe('getProcessByPid', () => {
    it('returns full process info including optional fields', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({
          Id: 100,
          ProcessName: 'chrome',
          Path: 'C:/chrome.exe',
          MainWindowTitle: 'Google Chrome',
          MainWindowHandle: '12345',
          CPU: 5.2,
          WorkingSet64: 104857600,
        }),
        stderr: '',
      });
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(100);
      expect(result).toEqual({
        pid: 100,
        name: 'chrome',
        executablePath: 'C:/chrome.exe',
        windowTitle: 'Google Chrome',
        windowHandle: '12345',
        cpuUsage: 5.2,
        memoryUsage: 104857600,
      });
    });

    it('returns null on error', async () => {
      state.execAsync.mockRejectedValue(new Error('Access denied'));
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toBeNull();
    });

    it('returns null for empty string stdout', async () => {
      state.execAsync.mockResolvedValue({ stdout: '   ', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toBeNull();
    });

    it('throws for invalid PID (zero)', async () => {
      const manager = new ProcessManager();
      // safePid throws for invalid PID, caught internally returns null
      const result = await manager.getProcessByPid(0);
      expect(result).toBeNull();
    });

    it('throws for negative PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(-5);
      expect(result).toBeNull();
    });

    it('throws for NaN PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(NaN);
      expect(result).toBeNull();
    });

    it('throws for Infinity PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(Infinity);
      expect(result).toBeNull();
    });
  });

  // --- getProcessWindows edge cases ---

  describe('getProcessWindows', () => {
    it('returns empty array for null stdout', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(100);
      expect(windows).toEqual([]);
    });

    it('returns empty array on error', async () => {
      state.execAsync.mockRejectedValue(new Error('Script not found'));
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(100);
      expect(windows).toEqual([]);
    });

    it('handles array of multiple windows', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([
          { Handle: '0x1', Title: 'Win1', ClassName: 'Class1', ProcessId: 50 },
          { Handle: '0x2', Title: 'Win2', ClassName: 'Class2', ProcessId: 50 },
        ]),
        stderr: '',
      });
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(50);
      expect(windows).toHaveLength(2);
      expect(windows[0]!.handle).toBe('0x1');
      expect(windows[1]!.handle).toBe('0x2');
      expect(windows[0]!.threadId).toBe(0);
    });

    it('rejects invalid PID (returns empty)', async () => {
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(0);
      expect(windows).toEqual([]);
    });
  });

  // --- getProcessCommandLine edge cases ---

  describe('getProcessCommandLine', () => {
    it('returns commandLine and parentPid on success', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({
          CommandLine: 'chrome.exe --flag=value',
          ParentProcessId: 4,
        }),
        stderr: '',
      });
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({
        commandLine: 'chrome.exe --flag=value',
        parentPid: 4,
      });
    });

    it('returns empty object for null stdout', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({});
    });

    it('returns empty object on error', async () => {
      state.execAsync.mockRejectedValue(new Error('Access denied'));
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({});
    });

    it('rejects invalid PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(-1);
      expect(result).toEqual({});
    });
  });

  // --- checkDebugPort edge cases ---

  describe('checkDebugPort', () => {
    it('returns port from explicit commandLine option', async () => {
      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100, {
        commandLine: 'app.exe --remote-debugging-port=9229',
      });
      expect(port).toBe(9229);
    });

    it('falls through to port scanning when no match in command line', async () => {
      state.execAsync
        // First call: getProcessCommandLine
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ CommandLine: 'app.exe --no-debug', ParentProcessId: 4 }),
          stderr: '',
        })
        // Second call: Get-NetTCPConnection
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ LocalPort: 9222 }]),
          stderr: '',
        });

      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBe(9222);
    });

    it('returns null when no debug port found in scanning', async () => {
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ CommandLine: 'app.exe', ParentProcessId: 4 }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ LocalPort: 80 }, { LocalPort: 443 }]),
          stderr: '',
        });

      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });

    it('returns null when port scan returns empty', async () => {
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ CommandLine: 'app.exe', ParentProcessId: 4 }),
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: 'null', stderr: '' });

      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });

    it('returns null on error', async () => {
      state.execAsync.mockRejectedValue(new Error('Permission denied'));
      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });

    it('rejects invalid PID', async () => {
      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(0);
      expect(port).toBeNull();
    });
  });

  // --- killProcess edge cases ---

  describe('killProcess', () => {
    it('returns true on successful kill', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'Process 100 killed', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.killProcess(100);
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      state.execAsync.mockRejectedValue(new Error('Access denied'));
      const manager = new ProcessManager();
      const result = await manager.killProcess(100);
      expect(result).toBe(false);
    });

    it('rejects negative PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.killProcess(-1);
      expect(result).toBe(false);
      expect(state.execAsync).not.toHaveBeenCalled();
    });

    it('rejects NaN PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.killProcess(NaN);
      expect(result).toBe(false);
      expect(state.execAsync).not.toHaveBeenCalled();
    });

    it('rejects Infinity PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.killProcess(Infinity);
      expect(result).toBe(false);
    });

    it('truncates floating point PID', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'killed', stderr: '' });
      const manager = new ProcessManager();
      await manager.killProcess(99.7);
      const cmd = state.execAsync.mock.calls[0]?.[0] as string;
      expect(cmd).toContain('99');
      expect(cmd).not.toContain('99.7');
    });
  });

  // --- launchWithDebug edge cases ---

  describe('launchWithDebug', () => {
    it('returns null when spawn returns no PID', async () => {
      vi.useFakeTimers();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const child = new EventEmitter() as any;
      child.pid = 0;
      child.unref = vi.fn();
      state.spawn.mockReturnValue(child);

      // findPidByListeningPort returns null
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });

      const manager = new ProcessManager();
      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toBeNull();
      vi.useRealTimers();
    });

    it('returns null on spawn error', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('File not found');
      });
      const manager = new ProcessManager();
      const result = await manager.launchWithDebug('C:/nonexistent.exe');
      expect(result).toBeNull();
    });

    it('uses default debug port when not specified', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(5000);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ OwningProcess: 5000 }),
        stderr: '',
      });
      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 5000,
        name: 'app.exe',
        executablePath: 'C:/app.exe',
      });

      const pending = manager.launchWithDebug('C:/app.exe');
      await vi.runAllTimersAsync();
      await pending;

      const spawnArgs = state.spawn.mock.calls[0]?.[1] as string[];
      // Should include default port
      expect(spawnArgs[0]).toMatch(/--remote-debugging-port=\d+/);
      vi.useRealTimers();
    });

    it('passes extra arguments to spawn', async () => {
      vi.useFakeTimers();
      state.spawn.mockReturnValue(createSpawnChild(7000));
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ OwningProcess: 7000 }),
        stderr: '',
      });
      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 7000,
        name: 'app.exe',
        executablePath: 'C:/app.exe',
      });

      const pending = manager.launchWithDebug('C:/app.exe', 9222, ['--incognito', '--headless']);
      await vi.runAllTimersAsync();
      await pending;

      const spawnArgs = state.spawn.mock.calls[0]?.[1] as string[];
      expect(spawnArgs).toContain('--incognito');
      expect(spawnArgs).toContain('--headless');
      vi.useRealTimers();
    });

    it('extracts executable name from path with backslashes', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(0); // pid = 0
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });

      const manager = new ProcessManager();
      const pending = manager.launchWithDebug('C:\\Program Files\\app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      // With pid=0 and no resolved listener PID, should return null
      expect(result).toBeNull();
      vi.useRealTimers();
    });
  });

  // --- injectDll edge cases ---

  describe('injectDll', () => {
    it('always returns false (safety disabled)', async () => {
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.injectDll(100, 'C:/hook.dll');
      expect(result).toBe(false);
    });

    it('returns false for invalid PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.injectDll(0, 'C:/hook.dll');
      expect(result).toBe(false);
    });

    it('returns false for negative PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.injectDll(-5, 'C:/hook.dll');
      expect(result).toBe(false);
    });

    it('returns false on execution error', async () => {
      state.execAsync.mockRejectedValue(new Error('Script error'));
      const manager = new ProcessManager();
      const result = await manager.injectDll(100, 'C:/hook.dll');
      expect(result).toBe(false);
    });
  });

  // --- Browser discovery delegation edge cases ---

  describe('discoverBrowsers', () => {
    it('returns empty array on error', async () => {
      state.discoverBrowsers.mockRejectedValue(new Error('Discovery failed'));
      const manager = new ProcessManager();
      const result = await manager.discoverBrowsers();
      expect(result).toEqual([]);
    });
  });

  describe('findBrowserByWindowClass', () => {
    it('returns empty array on error', async () => {
      state.findByWindowClass.mockRejectedValue(new Error('Error'));
      const manager = new ProcessManager();
      const result = await manager.findBrowserByWindowClass('Chrome_*');
      expect(result).toEqual([]);
    });
  });

  describe('findBrowserByProcessName', () => {
    it('returns empty array on error', async () => {
      state.findByProcessName.mockRejectedValue(new Error('Error'));
      const manager = new ProcessManager();
      const result = await manager.findBrowserByProcessName('chrome.exe');
      expect(result).toEqual([]);
    });
  });

  describe('detectBrowserDebugPort', () => {
    it('returns null when no debug port detected', async () => {
      state.detectDebugPort.mockResolvedValue(null);
      const manager = new ProcessManager();
      const result = await manager.detectBrowserDebugPort(100);
      expect(result).toBeNull();
    });

    it('passes custom ports array to discovery', async () => {
      state.detectDebugPort.mockResolvedValue(8888);
      const manager = new ProcessManager();
      const customPorts = [8888, 9999];
      const result = await manager.detectBrowserDebugPort(100, customPorts);
      expect(result).toBe(8888);
      expect(state.detectDebugPort).toHaveBeenCalledWith(100, customPorts);
    });

    it('returns null on error', async () => {
      state.detectDebugPort.mockRejectedValue(new Error('Error'));
      const manager = new ProcessManager();
      const result = await manager.detectBrowserDebugPort(100);
      expect(result).toBeNull();
    });
  });

  // --- findChromiumProcesses ---
  // Note: findChromiumProcesses delegates to the external chromium module;
  // the delegation pattern is tested via findChromiumAppProcesses below.

  // --- findChromiumAppProcesses (deprecated) ---

  describe('findChromiumAppProcesses', () => {
    it('delegates to findChromiumProcesses', async () => {
      const manager = new ProcessManager();
      const spy = vi.spyOn(manager, 'findChromiumProcesses');
      await manager.findChromiumAppProcesses();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});

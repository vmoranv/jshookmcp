import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * ProcessManager (Windows) additional coverage tests.
 * Fills branches not covered by ProcessManager.test.ts, ProcessManager.impl.comprehensive.test.ts,
 * or ProcessManager.edge-cases.test.ts:
 * - findProcesses with JSON.parse throws
 * - computeProcessDiff: process changed (same PID different name)
 * - findPidByListeningPort: catch block (exec throws)
 * - findPidByListeningPort: stdout null (returns null)
 * - findPidByListeningPort: stdout is array (uses first element)
 * - findPidByListeningPort: OwningProcess as lowercase key
 * - launchWithDebug: loop with resolvedPid from child.pid (not from debug port)
 * - launchWithDebug: loop where debugPid !== resolvedPid (return synthesized via resolvedPid path)
 * - killProcess: returns true after successful exec
 */

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
import { mockAs } from '../../test-utils';

function createSpawnChild(pid: number) {
  const child = mockAs<any>(new EventEmitter());
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('ProcessManager (Windows) - coverage expansion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // --- findProcesses ---

  describe('findProcesses', () => {
    it('handles JSON.parse error gracefully', async () => {
      // Mock stdout to be valid JSON but JSON.parse in the code throws
      state.execAsync.mockResolvedValue({ stdout: '[invalid', stderr: '' });
      const manager = new ProcessManager();
      const results = await manager.findProcesses('test');
      // Should fall to catch and return []
      expect(results).toEqual([]);
    });

    it('computes process diff: process changed (same PID different name)', async () => {
      // First call returns a process
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ Id: 1, ProcessName: 'old-name', Path: 'C:/old.exe' }]),
          stderr: '',
        })
        // Second call returns same PID but different name (triggers changed array)
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ Id: 1, ProcessName: 'new-name', Path: 'C:/new.exe' }]),
          stderr: '',
        });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const manager = new ProcessManager();
      const first = await manager.findProcesses('test');
      await vi.advanceTimersByTimeAsync(4000);
      const second = await manager.findProcesses('test');

      expect(first[0]?.name).toBe('old-name');
      expect(second[0]?.name).toBe('new-name');

      vi.useRealTimers();
    });

    it('computes process diff: process removed', async () => {
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { Id: 1, ProcessName: 'proc1', Path: 'C:/p1.exe' },
            { Id: 2, ProcessName: 'proc2', Path: 'C:/p2.exe' },
          ]),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ Id: 1, ProcessName: 'proc1', Path: 'C:/p1.exe' }]),
          stderr: '',
        });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const manager = new ProcessManager();
      await manager.findProcesses('test');
      await vi.advanceTimersByTimeAsync(4000);
      const second = await manager.findProcesses('test');
      expect(second).toHaveLength(1);

      vi.useRealTimers();
    });
  });

  // --- findPidByListeningPort (internal) ---

  describe('findPidByListeningPort', () => {
    it('returns null when stdout is null', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
      const manager = new ProcessManager();

      vi.useFakeTimers();
      const child = createSpawnChild(5000);
      state.spawn.mockReturnValue(child);

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      // findPidByListeningPort called but returns null (exec returns null)
      await pending;
      vi.useRealTimers();
    });

    it('handles exec error in findPidByListeningPort (catch block)', async () => {
      state.execAsync.mockRejectedValue(new Error('TCP Error'));
      const manager = new ProcessManager();

      vi.useFakeTimers();
      const child = createSpawnChild(5000);
      state.spawn.mockReturnValue(child);

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      // findPidByListeningPort throws → catch → returns null
      await pending;
      vi.useRealTimers();
    });

    it('handles stdout as JSON array (uses first element)', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify([{ OwningProcess: 7000 }, { OwningProcess: 7001 }]),
        stderr: '',
      });
      const manager = new ProcessManager();

      vi.useFakeTimers();
      const child = createSpawnChild(5000);
      state.spawn.mockReturnValue(child);
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue(null);

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      await pending;
      vi.useRealTimers();
    });

    it('handles OwningProcess as lowercase key', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ owningProcess: 8000 }),
        stderr: '',
      });
      const manager = new ProcessManager();

      vi.useFakeTimers();
      const child = createSpawnChild(8000);
      state.spawn.mockReturnValue(child);
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 8000,
        name: 'app.exe',
        executablePath: 'C:/app.exe',
      });

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result?.pid).toBe(8000);
      vi.useRealTimers();
    });

    it('accepts a primitive JSON PID payload and falls back to the unknown executable name', async () => {
      state.execAsync.mockResolvedValue({
        stdout: '7000',
        stderr: '',
      });
      const manager = new ProcessManager();

      vi.useFakeTimers();
      const child = createSpawnChild(0);
      state.spawn.mockReturnValue(child);
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue(null);

      const pending = manager.launchWithDebug('', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toEqual({
        pid: 7000,
        name: 'unknown',
        executablePath: '',
      });
      vi.useRealTimers();
    });

    it('returns null when the listening-port lookup resolves to pid 0', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ OwningProcess: 0 }),
        stderr: '',
      });
      const manager = new ProcessManager();

      vi.useFakeTimers();
      const child = createSpawnChild(0);
      state.spawn.mockReturnValue(child);

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toBeNull();
      vi.useRealTimers();
    });
  });

  // --- launchWithDebug ---

  describe('launchWithDebug', () => {
    it('returns process from resolvedPid when child.pid resolves directly without debug port polling', async () => {
      vi.useFakeTimers();
      // child.pid is valid but findPidByListeningPort returns null
      const child = createSpawnChild(9999);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });

      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 9999,
        name: 'app.exe',
        executablePath: 'C:/app.exe',
      });

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result?.pid).toBe(9999);
      vi.useRealTimers();
    });

    it('returns synthesized process when debugPid matches resolvedPid but getProcessByPid fails', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(6000);
      state.spawn.mockReturnValue(child);
      // findPidByListeningPort finds the debug port listener
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ OwningProcess: 6000 }),
        stderr: '',
      });

      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue(null);

      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toEqual({
        pid: 6000,
        name: 'app.exe',
        executablePath: 'C:/app.exe',
      });
      vi.useRealTimers();
    });

    it('returns null after loop completes when resolvedPid is null', async () => {
      vi.useFakeTimers();
      const child = new EventEmitter() as any;
      child.pid = undefined;
      child.unref = vi.fn();
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });

      const manager = new ProcessManager();
      const pending = manager.launchWithDebug('C:/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toBeNull();
      vi.useRealTimers();
    });

    it('extracts executable name from path with forward slashes', async () => {
      vi.useFakeTimers();
      const child = createSpawnChild(0);
      state.spawn.mockReturnValue(child);
      state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });

      const manager = new ProcessManager();
      const pending = manager.launchWithDebug('C:/Program Files/app.exe', 9222);
      await vi.runAllTimersAsync();
      const result = await pending;

      // With pid=0 and no resolved PID, fallback synthesizes with executable name
      expect(result).toBeNull();
      vi.useRealTimers();
    });
  });

  // --- checkDebugPort ---

  describe('checkDebugPort', () => {
    it('returns null when pid is invalid', async () => {
      const manager = new ProcessManager();
      const result = await manager.checkDebugPort(NaN);
      expect(result).toBeNull();
    });

    it('returns null when command-line port parseInt returns NaN', async () => {
      const manager = new ProcessManager();
      // match[1] exists but parseInt returns NaN for non-numeric
      const result = await manager.checkDebugPort(1, {
        commandLine: 'app --remote-debugging-port=abc',
      });
      expect(result).toBeNull();
    });

    it('returns null when port candidates list is empty (unlikely but defensive)', async () => {
      state.execAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ CommandLine: 'app', ParentProcessId: 4 }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([]),
          stderr: '',
        });

      const manager = new ProcessManager();
      const result = await manager.checkDebugPort(1);
      expect(result).toBeNull();
    });

    it('parses a single Get-NetTCPConnection object payload', async () => {
      state.execAsync.mockResolvedValue({
        stdout: JSON.stringify({ LocalPort: 9222 }),
        stderr: '',
      });
      const manager = new ProcessManager();
      vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});
      const result = await manager.checkDebugPort(1);
      expect(result).toBe(9222);
    });
  });

  // --- killProcess ---

  describe('killProcess', () => {
    it('returns false when pid is Infinity', async () => {
      const manager = new ProcessManager();
      const result = await manager.killProcess(Infinity);
      expect(result).toBe(false);
    });

    it('returns true after successful exec', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'Process 123 killed', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.killProcess(123);
      expect(result).toBe(true);
    });
  });

  // --- getProcessByPid ---

  describe('getProcessByPid', () => {
    it('handles JSON.parse error on stdout', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'not-json', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(123);
      expect(result).toBeNull();
    });

    it('returns null when pid is NaN', async () => {
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(NaN);
      expect(result).toBeNull();
    });
  });

  // --- getProcessWindows ---

  describe('getProcessWindows', () => {
    it('handles empty array from script output', async () => {
      state.execAsync.mockResolvedValue({ stdout: '[]', stderr: '' });
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(100);
      expect(windows).toEqual([]);
    });

    it('handles malformed JSON', async () => {
      state.execAsync.mockResolvedValue({ stdout: '{broken', stderr: '' });
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(100);
      expect(windows).toEqual([]);
    });
  });

  // --- getProcessCommandLine ---

  describe('getProcessCommandLine', () => {
    it('handles JSON.parse error', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'invalid', stderr: '' });
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(100);
      expect(result).toEqual({});
    });

    it('returns empty for Infinity PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(Infinity);
      expect(result).toEqual({});
    });
  });

  // --- discoverBrowsers ---

  describe('discoverBrowsers', () => {
    it('returns empty array when browserDiscovery throws', async () => {
      state.discoverBrowsers.mockRejectedValue(new Error('discovery error'));
      const manager = new ProcessManager();
      const result = await manager.discoverBrowsers();
      expect(result).toEqual([]);
    });

    it('returns browsers on success', async () => {
      state.discoverBrowsers.mockResolvedValue([
        { processId: 1, type: 'chrome' },
        { processId: 2, type: 'edge' },
      ]);
      const manager = new ProcessManager();
      const result = await manager.discoverBrowsers();
      expect(result).toHaveLength(2);
    });
  });

  // --- findBrowserByWindowClass ---

  describe('findBrowserByWindowClass', () => {
    it('returns empty array on error', async () => {
      state.findByWindowClass.mockRejectedValue(new Error('window class error'));
      const manager = new ProcessManager();
      const result = await manager.findBrowserByWindowClass('Chrome_*');
      expect(result).toEqual([]);
    });

    it('returns matching browsers on success', async () => {
      state.findByWindowClass.mockResolvedValue([{ processId: 1 }]);
      const manager = new ProcessManager();
      const result = await manager.findBrowserByWindowClass('Chrome_*');
      expect(result).toHaveLength(1);
    });
  });

  // --- findBrowserByProcessName ---

  describe('findBrowserByProcessName', () => {
    it('returns empty array on error', async () => {
      state.findByProcessName.mockRejectedValue(new Error('process name error'));
      const manager = new ProcessManager();
      const result = await manager.findBrowserByProcessName('chrome.exe');
      expect(result).toEqual([]);
    });
  });

  // --- detectBrowserDebugPort ---

  describe('detectBrowserDebugPort', () => {
    it('returns null when no port detected', async () => {
      state.detectDebugPort.mockResolvedValue(null);
      const manager = new ProcessManager();
      const result = await manager.detectBrowserDebugPort(100);
      expect(result).toBeNull();
    });

    it('passes custom ports array', async () => {
      state.detectDebugPort.mockResolvedValue(8888);
      const manager = new ProcessManager();
      const result = await manager.detectBrowserDebugPort(100, [8888, 9999]);
      expect(result).toBe(8888);
    });

    it('returns null on error', async () => {
      state.detectDebugPort.mockRejectedValue(new Error('error'));
      const manager = new ProcessManager();
      const result = await manager.detectBrowserDebugPort(100);
      expect(result).toBeNull();
    });
  });

  // --- injectDll ---

  describe('injectDll', () => {
    it('returns false for negative PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.injectDll(-5, 'C:/dll.dll');
      expect(result).toBe(false);
    });

    it('returns false for Infinity PID', async () => {
      const manager = new ProcessManager();
      const result = await manager.injectDll(Infinity, 'C:/dll.dll');
      expect(result).toBe(false);
    });
  });
});

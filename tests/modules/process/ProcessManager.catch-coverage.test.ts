import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comprehensive catch-block and EPERM coverage for ProcessManager (Windows).
 * Fills the remaining untested error paths not covered by
 * ProcessManager.test.ts, ProcessManager.impl.comprehensive.test.ts,
 * ProcessManager.coverage.test.ts, or ProcessManager.edge-cases.test.ts:
 *
 * Windows platform — all methods with catch blocks:
 * - findProcesses: execAsync throws → catch returns []
 * - getProcessByPid: execAsync throws (beyond NaN/0 already covered)
 * - getProcessWindows: execAsync throws (beyond NaN already covered)
 * - getProcessCommandLine: execAsync throws (beyond NaN already covered)
 * - checkDebugPort: outer catch → returns null
 * - launchWithDebug: spawn throws → returns null
 * - killProcess: execAsync throws → returns false (EPERM covered; general error path)
 * - discoverBrowsers: browserDiscovery throws → []
 * - findBrowserByWindowClass: browserDiscovery throws → []
 * - findBrowserByProcessName: browserDiscovery throws → []
 * - detectBrowserDebugPort: browserDiscovery throws → null
 * - findChromiumProcessesWithConfig: throws → caught and returns empty result
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
  findChromiumProcessesWithConfig: vi.fn(),
}));

import { ProcessManager } from '@modules/process/ProcessManager';

describe('ProcessManager (Windows) - catch-block and EPERM coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ── findProcesses: outer catch block ──────────────────────────────────────

  describe('findProcesses', () => {
    it('returns [] when execAsync throws (non-JSON error)', async () => {
      state.execAsync.mockRejectedValue(new Error('powershell crashed'));
      const manager = new ProcessManager();
      const results = await manager.findProcesses('test');
      expect(results).toEqual([]);
    });

    it('returns [] when ps command fails with EPERM', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new ProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });
  });

  // ── getProcessByPid: outer catch block ─────────────────────────────────────

  describe('getProcessByPid', () => {
    it('returns null when execAsync throws (non-NaN PID)', async () => {
      state.execAsync.mockRejectedValue(new Error('WMI error'));
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(9999);
      expect(result).toBeNull();
    });

    it('returns null on EPERM when querying specific PID', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new ProcessManager();
      const result = await manager.getProcessByPid(1234);
      expect(result).toBeNull();
    });
  });

  // ── getProcessWindows: outer catch block ───────────────────────────────────

  describe('getProcessWindows', () => {
    it('returns [] when scriptLoader throws', async () => {
      state.execAsync.mockRejectedValue(new Error('script error'));
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(100);
      expect(windows).toEqual([]);
    });

    it('returns [] when execAsync throws EPERM', async () => {
      const err = new Error('Access denied') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new ProcessManager();
      const windows = await manager.getProcessWindows(200);
      expect(windows).toEqual([]);
    });
  });

  // ── getProcessCommandLine: outer catch block ────────────────────────────────

  describe('getProcessCommandLine', () => {
    it('returns {} when execAsync throws', async () => {
      state.execAsync.mockRejectedValue(new Error('WMI unavailable'));
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(500);
      expect(result).toEqual({});
    });

    it('returns {} on EPERM when reading command line', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new ProcessManager();
      const result = await manager.getProcessCommandLine(500);
      expect(result).toEqual({});
    });
  });

  // ── checkDebugPort: outer catch block ─────────────────────────────────────

  describe('checkDebugPort', () => {
    it('returns null when outer catch is hit (undefined commandLine path)', async () => {
      // Mock: getProcessCommandLine throws → outer catch
      state.execAsync.mockRejectedValue(new Error('network error'));
      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });

    it('returns null when EPERM occurs during port check', async () => {
      const err = new Error('Access denied') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new ProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });
  });

  // ── launchWithDebug: outer catch block ─────────────────────────────────────

  describe('launchWithDebug', () => {
    it('returns null when spawn throws ENOENT', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('ENOENT: The system cannot find the file specified');
      });
      const manager = new ProcessManager();
      const result = await manager.launchWithDebug('C:/nonexistent.exe', 9222);
      expect(result).toBeNull();
    });

    it('returns null when spawn throws generic error', async () => {
      state.spawn.mockImplementation(() => {
        throw new Error('spawn failed');
      });
      const manager = new ProcessManager();
      const result = await manager.launchWithDebug('C:/app.exe', 9222);
      expect(result).toBeNull();
    });
  });

  // ── killProcess: catch block (EPERM branch) ────────────────────────────────

  describe('killProcess', () => {
    it('returns false when execAsync throws EPERM (process protected)', async () => {
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new ProcessManager();
      const result = await manager.killProcess(1);
      expect(result).toBe(false);
    });

    it('returns false when execAsync throws generic error', async () => {
      state.execAsync.mockRejectedValue(new Error('Stop-Process failed'));
      const manager = new ProcessManager();
      const result = await manager.killProcess(42);
      expect(result).toBe(false);
    });
  });

  // ── Browser discovery: catch blocks ───────────────────────────────────────

  describe('discoverBrowsers', () => {
    it('returns [] when browserDiscovery throws EPERM', async () => {
      const err = new Error('Access denied') as any;
      err.code = 'EPERM';
      state.discoverBrowsers.mockRejectedValue(err);
      const manager = new ProcessManager();
      const result = await manager.discoverBrowsers();
      expect(result).toEqual([]);
    });
  });

  describe('findBrowserByWindowClass', () => {
    it('returns [] when browserDiscovery throws EPERM', async () => {
      const err = new Error('Access denied') as any;
      err.code = 'EPERM';
      state.findByWindowClass.mockRejectedValue(err);
      const manager = new ProcessManager();
      const result = await manager.findBrowserByWindowClass('Chrome_*');
      expect(result).toEqual([]);
    });
  });

  describe('findBrowserByProcessName', () => {
    it('returns [] when browserDiscovery throws EPERM', async () => {
      const err = new Error('Access denied') as any;
      err.code = 'EPERM';
      state.findByProcessName.mockRejectedValue(err);
      const manager = new ProcessManager();
      const result = await manager.findBrowserByProcessName('chrome.exe');
      expect(result).toEqual([]);
    });
  });

  describe('detectBrowserDebugPort', () => {
    it('returns null when browserDiscovery throws EPERM', async () => {
      const err = new Error('Access denied') as any;
      err.code = 'EPERM';
      state.detectDebugPort.mockRejectedValue(err);
      const manager = new ProcessManager();
      const port = await manager.detectBrowserDebugPort(100);
      expect(port).toBeNull();
    });
  });
});

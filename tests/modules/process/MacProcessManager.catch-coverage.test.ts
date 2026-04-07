import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comprehensive catch-block and EPERM coverage for MacProcessManager.
 * Fills remaining untested error paths not covered by
 * MacProcessManager.test.ts, MacProcessManager.edge-cases.test.ts,
 * or MacProcessManager.coverage.test.ts:
 *
 * macOS platform — remaining untested catch blocks:
 * - findProcesses: execAsync throws → []
 * - findProcesses: execAsync throws EPERM → []
 * - getProcessByPid: execAsync throws → null
 * - getProcessByPid: execAsync throws EPERM → null
 * - getProcessWindows: getProcessByPid returns null (already covered)
 * - getProcessWindows: execAsync throws AppleScript error → []
 * - getProcessWindowsCG: execFileAsync throws → []
 * - findChromeProcesses: catch → returns empty result
 * - getProcessCommandLine: execAsync throws → {}
 * - checkDebugPort: execAsync throws → null
 * - launchWithDebug: spawn throws → null (covered)
 * - killProcess: catch → false
 * - killProcess: EPERM → false
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

function setupExecByCommand(
  map: Record<string, { stdout: string; stderr?: string; error?: Error }>,
) {
  state.execAsync.mockImplementation(async (cmd: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (cmd.includes(key)) {
        if (value.error) throw value.error;
        return { stdout: value.stdout, stderr: value.stderr ?? '' };
      }
    }
    return { stdout: '', stderr: '' };
  });
}

describe('MacProcessManager - catch-block and EPERM coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ── findProcesses: outer catch block ──────────────────────────────────────

  describe('findProcesses', () => {
    it('returns [] when execAsync throws (generic error)', async () => {
      state.execAsync.mockRejectedValue(new Error('ps failed'));
      const manager = new MacProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });

    it('returns [] when execAsync throws EPERM', async () => {
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new MacProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });
  });

  // ── getProcessByPid: outer catch block ────────────────────────────────────

  describe('getProcessByPid', () => {
    it('returns null when execAsync throws ENOENT', async () => {
      state.execAsync.mockRejectedValue(new Error('ENOENT: No such process'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(99999);
      expect(result).toBeNull();
    });

    it('returns null when EPERM prevents ps query', async () => {
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new MacProcessManager();
      const result = await manager.getProcessByPid(99999);
      expect(result).toBeNull();
    });
  });

  // ── getProcessWindows ─────────────────────────────────────────────────────

  describe('getProcessWindows', () => {
    it('returns [] when osascript throws generic error', async () => {
      setupExecByCommand({
        'ps -p 501': {
          stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0     0    App  App\n',
        },
        'ps -p 501 -o comm=': { stdout: 'App\n' },
        'osascript -e': { error: new Error('osascript failed') },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(501);
      expect(result).toEqual([]);
    });

    it('returns [] when osascript throws EPERM', async () => {
      setupExecByCommand({
        'ps -p 501': {
          stdout: '  PID  PPID  %CPU  %MEM  COMM  ARGS\n  501     1   0     0    App  App\n',
        },
        'ps -p 501 -o comm=': { stdout: 'App\n' },
        'osascript -e': { error: new Error('Automation untrusted') },
      });
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindows(501);
      expect(result).toEqual([]);
    });
  });

  // ── getProcessWindowsCG: outer catch block ────────────────────────────────

  describe('getProcessWindowsCG', () => {
    it('returns [] when ScriptLoader.loadScript throws', async () => {
      state.loadScript.mockRejectedValue(new Error('script not found'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });

    it('returns [] when execFileAsync throws (python not installed)', async () => {
      state.loadScript.mockResolvedValue('template');
      state.execFileAsync.mockRejectedValue(new Error('python3 not found'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });

    it('returns [] when execFileAsync throws EPERM', async () => {
      state.loadScript.mockResolvedValue('template');
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execFileAsync.mockRejectedValue(err);
      const manager = new MacProcessManager();
      const result = await manager.getProcessWindowsCG(123);
      expect(result).toEqual([]);
    });
  });

  // ── findChromeProcesses: outer catch block ────────────────────────────────

  describe('findChromeProcesses', () => {
    it('returns empty result when findProcesses throws', async () => {
      state.execAsync.mockRejectedValue(new Error('ps failed'));
      const manager = new MacProcessManager();
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess).toBeUndefined();
      expect(result.rendererProcesses).toEqual([]);
    });
  });

  // ── getProcessCommandLine: outer catch block ──────────────────────────────

  describe('getProcessCommandLine', () => {
    it('returns {} when execAsync throws ENOENT', async () => {
      state.execAsync.mockRejectedValue(new Error('ENOENT'));
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(123);
      expect(result).toEqual({});
    });

    it('returns {} on EPERM when reading command line', async () => {
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new MacProcessManager();
      const result = await manager.getProcessCommandLine(123);
      expect(result).toEqual({});
    });
  });

  // ── checkDebugPort: outer catch block ─────────────────────────────────────

  describe('checkDebugPort', () => {
    it('returns null when getProcessCommandLine throws', async () => {
      state.execAsync.mockRejectedValue(new Error('ENOENT'));
      const manager = new MacProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });

    it('returns null when EPERM occurs during lsof scan', async () => {
      state.execAsync.mockRejectedValue(new Error('Operation not permitted') as any);
      const manager = new MacProcessManager();
      const port = await manager.checkDebugPort(100);
      expect(port).toBeNull();
    });
  });

  // ── launchWithDebug: spawn throws ─────────────────────────────────────────
  // (covered in MacProcessManager.coverage.test.ts)

  // ── killProcess: catch block ──────────────────────────────────────────────

  describe('killProcess', () => {
    it('returns false when execAsync throws EPERM (process protected)', async () => {
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new MacProcessManager();
      const result = await manager.killProcess(1234);
      expect(result).toBe(false);
    });

    it('returns false when both kill -9 and kill -15 throw', async () => {
      state.execAsync.mockRejectedValue(new Error('kill failed'));
      const manager = new MacProcessManager();
      const result = await manager.killProcess(1234);
      expect(result).toBe(false);
    });
  });
});

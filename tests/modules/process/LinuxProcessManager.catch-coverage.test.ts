import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comprehensive catch-block and EPERM coverage for LinuxProcessManager.
 * Fills remaining untested error paths not covered by
 * LinuxProcessManager.test.ts, LinuxProcessManager.edge-cases.test.ts,
 * or LinuxProcessManager.coverage.test.ts:
 *
 * Linux platform — remaining untested catch blocks:
 * - detectDisplayServer: catch (isWayland = false) — already covered in edge-cases
 * - findProcesses: execAsync throws → catch returns []
 * - findProcesses: execAsync throws EPERM → []
 * - getProcessByPid: execAsync throws → null
 * - getProcessWindows: Wayland → warn + []
 * - getProcessWindows: execAsync throws → []
 * - getProcessWindows: inner try-catch (skip unqueryable window) — already covered
 * - findChromeProcesses: catch → returns empty result
 * - getProcessCommandLine: execAsync throws → {}
 * - checkDebugPort: execAsync throws → null
 * - launchWithDebug: spawn throws → null (covered)
 * - killProcess: execAsync throws → false
 * - killProcess: EPERM → false
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

describe('LinuxProcessManager - catch-block and EPERM coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ── detectDisplayServer: catch sets isWayland = false ──────────────────────
  // (covered in edge-cases.test.ts)

  // ── findProcesses: outer catch block ──────────────────────────────────────

  describe('findProcesses', () => {
    it('returns [] when execAsync throws (generic error)', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      state.execAsync.mockRejectedValue(new Error('ps failed'));
      const manager = new LinuxProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });

    it('returns [] when execAsync throws EPERM', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new LinuxProcessManager();
      const results = await manager.findProcesses('chrome');
      expect(results).toEqual([]);
    });
  });

  // ── getProcessByPid: outer catch block ────────────────────────────────────

  describe('getProcessByPid', () => {
    it('returns null when reading /proc/pid/status throws', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      state.execAsync.mockRejectedValue(new Error('ENOENT: No such process'));
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(99999);
      expect(result).toBeNull();
    });

    it('returns null when EPERM prevents reading /proc/pid', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessByPid(99999);
      expect(result).toBeNull();
    });
  });

  // ── getProcessWindows ───────────────────────────────────────────────────────

  describe('getProcessWindows', () => {
    it('returns [] when running on Wayland', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'wayland\n' },
      });
      const manager = new LinuxProcessManager();
      // Wayland detection is async; give it a tick
      await new Promise(setImmediate);
      const result = await manager.getProcessWindows(123);
      expect(result).toEqual([]);
    });

    it('returns [] when xdotool check throws', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        // @ts-expect-error
        'which xdotool': { error: new Error('which failed') },
      });
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toEqual([]);
    });

    it('returns [] when xdotool search throws EPERM', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
        'which xdotool': { stdout: '/usr/bin/xdotool' },
      });
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessWindows(123);
      expect(result).toEqual([]);
    });
  });

  // ── findChromeProcesses: catch block ───────────────────────────────────────

  describe('findChromeProcesses', () => {
    it('returns empty result when findProcesses throws', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      state.execAsync.mockRejectedValue(new Error('ps failed'));
      const manager = new LinuxProcessManager();
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess).toBeUndefined();
      expect(result.rendererProcesses).toEqual([]);
    });

    it('returns partial result when getProcessWindows throws (mainProcess still set, targetWindow undefined)', async () => {
      const manager = new LinuxProcessManager();
      // Use spies to avoid dependency on execAsync mock ordering
      vi.spyOn(manager, 'findProcesses').mockResolvedValue([
        { pid: 1, name: 'chrome', commandLine: 'chrome' },
      ]);
      vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
        pid: 1,
        name: 'chrome',
        commandLine: 'chrome',
      });
      vi.spyOn(manager, 'getProcessWindows').mockRejectedValue(new Error('xdotool failed'));
      const result = await manager.findChromeProcesses();
      expect(result.mainProcess?.pid).toBe(1);
      expect(result.targetWindow).toBeUndefined();
    });
  });

  // ── getProcessCommandLine: outer catch block ───────────────────────────────

  describe('getProcessCommandLine', () => {
    it('returns {} when reading cmdline throws', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      state.execAsync.mockRejectedValue(new Error('ENOENT'));
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessCommandLine(123);
      expect(result).toEqual({});
    });

    it('returns {} on EPERM when reading cmdline', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new LinuxProcessManager();
      const result = await manager.getProcessCommandLine(123);
      expect(result).toEqual({});
    });
  });

  // ── checkDebugPort: outer catch block ─────────────────────────────────────

  describe('checkDebugPort', () => {
    it('returns null when getProcessCommandLine throws', async () => {
      state.execAsync.mockRejectedValue(new Error('ENOENT'));
      const manager = new LinuxProcessManager();
      const port = await manager.checkDebugPort(123);
      expect(port).toBeNull();
    });

    it('returns null when EPERM occurs during port scan', async () => {
      state.execAsync.mockRejectedValue(new Error('Operation not permitted') as any);
      const manager = new LinuxProcessManager();
      const port = await manager.checkDebugPort(123);
      expect(port).toBeNull();
    });
  });

  // ── launchWithDebug: spawn throws (covered in coverage.test.ts) ───────────

  // ── killProcess: catch block ──────────────────────────────────────────────

  describe('killProcess', () => {
    it('returns false when execAsync throws EPERM (process protected)', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const manager = new LinuxProcessManager();
      const result = await manager.killProcess(1234);
      expect(result).toBe(false);
    });

    it('returns false when execAsync throws generic error', async () => {
      setupExecByCommand({
        'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      });
      state.execAsync.mockRejectedValue(new Error('kill failed'));
      const manager = new LinuxProcessManager();
      const result = await manager.killProcess(1234);
      expect(result).toBe(false);
    });

    it('returns false on NaN PID (before hitting exec)', async () => {
      const manager = new LinuxProcessManager();
      const result = await manager.killProcess(NaN);
      expect(result).toBe(false);
    });
  });
});

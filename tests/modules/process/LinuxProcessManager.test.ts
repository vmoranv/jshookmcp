import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => {
  const execAsync = vi.fn();
  const promisify = vi.fn(() => execAsync);
  const spawn = vi.fn();
  return { execAsync, promisify, spawn };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: state.spawn,
}));

vi.mock('util', () => ({
  promisify: state.promisify,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { LinuxProcessManager } from '../../../src/modules/process/LinuxProcessManager.js';

function setupExecByCommand(map: Record<string, { stdout: string; stderr?: string }>) {
  state.execAsync.mockImplementation(async (cmd: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (cmd.includes(key)) return { stdout: value.stdout, stderr: value.stderr ?? '' };
    }
    return { stdout: '', stderr: '' };
  });
}

describe('LinuxProcessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses processes from ps output', async () => {
    setupExecByCommand({
      'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      'ps aux': {
        stdout:
          'user 123 1.0 2.0 0 0 ? S 00:00 00:00 /usr/bin/chrome --flag\n',
      },
    });
    const manager = new LinuxProcessManager();
    const list = await manager.findProcesses('chro"me`');

    expect(list).toHaveLength(1);
    expect(list[0]?.pid).toBe(123);
    expect(list[0]?.name).toContain('/usr/bin/chrome');
  });

  it('getProcessByPid parses /proc status/cmdline/stat data', async () => {
    setupExecByCommand({
      'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
      '/status': { stdout: 'Name:\tchrome\nPPid:\t1\nVmRSS:\t2048 kB\n' },
      '/cmdline': { stdout: '/usr/bin/chrome --remote-debugging-port=9222 ' },
      '/stat': { stdout: '0 0 0 0 0 0 0 0 0 0 0 0 0 10 20' },
      'readlink -f /proc/123/exe': { stdout: '/usr/bin/chrome\n' },
    });
    const manager = new LinuxProcessManager();
    const proc = await manager.getProcessByPid(123);

    expect(proc?.name).toBe('chrome');
    expect(proc?.parentPid).toBe(1);
    expect(proc?.memoryUsage).toBe(2048 * 1024);
    expect(proc?.cpuUsage).toBe(30);
    expect(proc?.executablePath).toBe('/usr/bin/chrome');
  });

  it('returns empty windows list under Wayland mode', async () => {
    setupExecByCommand({
      'echo $XDG_SESSION_TYPE': { stdout: 'wayland\n' },
    });
    const manager = new LinuxProcessManager() as any;
    manager.isWayland = true;

    const windows = await manager.getProcessWindows(100);
    expect(windows).toEqual([]);
  });

  it('checkDebugPort prefers command-line argument', async () => {
    setupExecByCommand({
      'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
    });
    const manager = new LinuxProcessManager();
    vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({
      commandLine: '--remote-debugging-port=9333',
    });

    const port = await manager.checkDebugPort(200);
    expect(port).toBe(9333);
  });

  it('launchWithDebug spawns process and returns resolved process info', async () => {
    vi.useFakeTimers();
    setupExecByCommand({
      'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
    });
    const child = new EventEmitter() as any;
    child.pid = 444;
    child.unref = vi.fn();
    state.spawn.mockReturnValue(child);
    const manager = new LinuxProcessManager();
    vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
      pid: 444,
      name: 'chrome',
      executablePath: '/usr/bin/chrome',
    });

    const pending = manager.launchWithDebug('/usr/bin/chrome', 9222, ['--foo']);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(state.spawn).toHaveBeenCalledWith('/usr/bin/chrome', ['--remote-debugging-port=9222', '--foo'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(result?.pid).toBe(444);
    vi.useRealTimers();
  });

  it('killProcess rejects invalid pid', async () => {
    setupExecByCommand({
      'echo $XDG_SESSION_TYPE': { stdout: 'x11\n' },
    });
    const manager = new LinuxProcessManager();
    const ok = await manager.killProcess(-1);

    expect(ok).toBe(false);
  });
});

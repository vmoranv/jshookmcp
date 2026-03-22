import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => {
  const execAsync = vi.fn();
  const execFileAsync = vi.fn();
  const promisify = vi.fn(() => execAsync);
  const spawn = vi.fn();
  return { execAsync, execFileAsync, promisify, spawn };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: state.spawn,
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn: unknown) => {
    if (fn === (require('child_process') as { execFile: unknown }).execFile) {
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

import { MacProcessManager } from '@modules/process/MacProcessManager';

function setupExecByCommand(map: Record<string, { stdout: string; stderr?: string }>) {
  state.execAsync.mockImplementation(async (cmd: string) => {
    for (const [key, value] of Object.entries(map)) {
      if (cmd.includes(key)) return { stdout: value.stdout, stderr: value.stderr ?? '' };
    }
    return { stdout: '', stderr: '' };
  });
}

describe('MacProcessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findProcesses parses ps output and skips invalid PID rows', async () => {
    setupExecByCommand({
      'ps aux': {
        stdout: [
          'USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND',
          'user 321 1.0 2.0 0 0 ?? S 00:00 00:00 /Applications/Primary Browser.app/Contents/MacOS/primary-browser',
        ].join('\n'),
      },
    });
    const manager = new MacProcessManager();
    const list = await manager.findProcesses('primary-browser');

    expect(list).toHaveLength(1);
    expect(list[0]?.pid).toBe(321);
  });

  it('getProcessByPid parses ps -p output correctly', async () => {
    setupExecByCommand({
      'ps -p 123 -o pid,ppid,pcpu,pmem,comm,args': {
        stdout:
          'PID PPID %CPU %MEM COMM ARGS\n123 1 2.5 3.5 /usr/bin/primary-browser /usr/bin/primary-browser --test\n',
      },
      'ps -p 123 -o comm=': { stdout: '/usr/bin/primary-browser\n' },
    });
    const manager = new MacProcessManager();
    const proc = await manager.getProcessByPid(123);

    expect(proc?.pid).toBe(123);
    expect(proc?.parentPid).toBe(1);
    expect(proc?.commandLine).toContain('--test');
    expect(proc?.executablePath).toBe('/usr/bin/primary-browser');
  });

  it('getProcessWindows returns empty when process lookup fails', async () => {
    setupExecByCommand({
      'ps -p 999 -o pid,ppid,pcpu,pmem,comm,args': { stdout: '' },
    });
    const manager = new MacProcessManager();
    const windows = await manager.getProcessWindows(999);

    expect(windows).toEqual([]);
  });

  it('getProcessWindows parses AppleScript window title output', async () => {
    setupExecByCommand({
      'ps -p 500 -o pid,ppid,pcpu,pmem,comm,args': {
        stdout: 'PID PPID %CPU %MEM COMM ARGS\n500 1 0.1 0.2 Browser Browser\n',
      },
      'ps -p 500 -o comm=': { stdout: 'Browser\n' },
      'osascript -e': { stdout: '{title:Page A, title:Page B}' },
    });
    const manager = new MacProcessManager();
    const windows = await manager.getProcessWindows(500);

    expect(windows).toHaveLength(2);
    expect(windows[0]?.title).toBe('Page A');
    expect(windows[1]?.title).toBe('Page B');
  });

  it('checkDebugPort reads debug port from command-line first', async () => {
    setupExecByCommand({});
    const manager = new MacProcessManager();
    vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({
      commandLine: '--remote-debugging-port=9229',
    });

    const port = await manager.checkDebugPort(600);
    expect(port).toBe(9229);
  });

  it('launchWithDebug spawns detached process and returns info', async () => {
    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const child = new EventEmitter() as any;
    child.pid = 777;
    child.unref = vi.fn();
    state.spawn.mockReturnValue(child);
    setupExecByCommand({});
    const manager = new MacProcessManager();
    vi.spyOn(manager, 'getProcessByPid').mockResolvedValue({
      pid: 777,
      name: 'primary-browser',
      executablePath: '/Applications/Primary Browser.app/Contents/MacOS/primary-browser',
    });

    const pending = manager.launchWithDebug(
      '/Applications/Primary Browser.app/Contents/MacOS/primary-browser'
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(state.spawn).toHaveBeenCalled();
    expect(result?.pid).toBe(777);
    vi.useRealTimers();
  });

  it('killProcess returns false for invalid pid', async () => {
    setupExecByCommand({});
    const manager = new MacProcessManager();
    const ok = await manager.killProcess(0);

    expect(ok).toBe(false);
  });

  it('launchWithDebug returns null when spawn returns undefined PID', async () => {
    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const child = new EventEmitter() as any;
    child.pid = undefined;
    child.unref = vi.fn();
    state.spawn.mockReturnValue(child);
    setupExecByCommand({});
    const manager = new MacProcessManager();

    const pending = manager.launchWithDebug(
      '/Applications/Primary Browser.app/Contents/MacOS/primary-browser'
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toBeNull();
    vi.useRealTimers();
  });
});

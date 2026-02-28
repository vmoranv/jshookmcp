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

vi.mock('../../../src/native/ScriptLoader.js', () => ({
  ScriptLoader: class {
    getScriptPath = state.getScriptPath;
  },
}));

vi.mock('../../../src/modules/browser/BrowserDiscovery.js', () => ({
  BrowserDiscovery: class {
    discoverBrowsers = state.discoverBrowsers;
    findByWindowClass = state.findByWindowClass;
    findByProcessName = state.findByProcessName;
    detectDebugPort = state.detectDebugPort;
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ProcessManager } from '../../../src/modules/process/ProcessManager.js';

function createSpawnChild(pid = 9999) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('ProcessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findProcesses sanitizes pattern and parses process list', async () => {
    state.execAsync.mockResolvedValue({
      stdout: JSON.stringify([
        { Id: 101, ProcessName: 'chrome', Path: 'C:/Chrome/chrome.exe' },
      ]),
      stderr: '',
    });
    const manager = new ProcessManager();
    const results = await manager.findProcesses('chro"me`$()');

    expect(results).toEqual([{ pid: 101, name: 'chrome', executablePath: 'C:/Chrome/chrome.exe' }]);
    const cmd = state.execAsync.mock.calls[0]?.[0] as string;
    expect(cmd).toContain('*chrome*');
    expect(cmd).not.toContain('`');
    expect(cmd).not.toContain('$');
  });

  it('getProcessByPid returns null when process is not found', async () => {
    state.execAsync.mockResolvedValue({ stdout: 'null', stderr: '' });
    const manager = new ProcessManager();
    const result = await manager.getProcessByPid(1234);

    expect(result).toBeNull();
  });

  it('getProcessWindows loads external script and parses single window object', async () => {
    state.execAsync.mockResolvedValue({
      stdout: JSON.stringify({
        Handle: '0x100',
        Title: 'My Window',
        ClassName: 'Chrome_WidgetWin_1',
        ProcessId: 88,
      }),
      stderr: '',
    });
    const manager = new ProcessManager();
    const windows = await manager.getProcessWindows(88);

    expect(state.getScriptPath).toHaveBeenCalledWith('enum-windows.ps1');
    expect(windows).toEqual([
      {
        handle: '0x100',
        title: 'My Window',
        className: 'Chrome_WidgetWin_1',
        processId: 88,
        threadId: 0,
      },
    ]);
  });

  it('checkDebugPort returns port from command-line argument when present', async () => {
    const manager = new ProcessManager();
    vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({
      commandLine: '--remote-debugging-port=9333',
    });

    const port = await manager.checkDebugPort(77);

    expect(port).toBe(9333);
    expect(state.execAsync).not.toHaveBeenCalled();
  });

  it('killProcess rejects invalid PID values early', async () => {
    const manager = new ProcessManager();
    const ok = await manager.killProcess(0);

    expect(ok).toBe(false);
    expect(state.execAsync).not.toHaveBeenCalled();
  });

  it('launchWithDebug returns process details from resolved listener PID', async () => {
    vi.useFakeTimers();
    state.spawn.mockReturnValue(createSpawnChild(5000));
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

    const pending = manager.launchWithDebug('C:/app.exe', 9222, []);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(state.spawn).toHaveBeenCalledWith('C:/app.exe', ['--remote-debugging-port=9222'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(result?.pid).toBe(5000);
    vi.useRealTimers();
  });

  it('delegates browser discovery APIs', async () => {
    state.discoverBrowsers.mockResolvedValue([{ type: 'chrome', pid: 1 }]);
    state.findByWindowClass.mockResolvedValue([{ type: 'edge', pid: 2 }]);
    state.findByProcessName.mockResolvedValue([{ type: 'firefox', pid: 3 }]);
    state.detectDebugPort.mockResolvedValue(9222);
    const manager = new ProcessManager();

    const all = await manager.discoverBrowsers();
    const byClass = await manager.findBrowserByWindowClass('Chrome_WidgetWin_*');
    const byName = await manager.findBrowserByProcessName('chrome.exe');
    const port = await manager.detectBrowserDebugPort(1);

    expect(all).toHaveLength(1);
    expect(byClass[0]?.pid).toBe(2);
    expect(byName[0]?.pid).toBe(3);
    expect(port).toBe(9222);
  });
});

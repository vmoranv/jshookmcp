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
import { PROCESS_EXEC_MAX_BUFFER_BYTES } from '@src/constants';
import { mockAs } from '../../test-utils';

function createSpawnChild(pid = 9999) {
  const child = mockAs<any>(new EventEmitter());
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
        { Id: 101, ProcessName: 'browser-bin', Path: 'C:/Browser/browser-bin.exe' },
      ]),
      stderr: '',
    });
    const manager = new ProcessManager();
    const results = await manager.findProcesses('browse"r-bin`$()');

    expect(results).toEqual([
      { pid: 101, name: 'browser-bin', executablePath: 'C:/Browser/browser-bin.exe' },
    ]);
    const cmd = state.execAsync.mock.calls[0]?.[0] as string;
    expect(cmd).toContain('*browser-bin*');
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
        ClassName: 'Browser_WidgetWin_1',
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
        className: 'Browser_WidgetWin_1',
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
      windowsHide: true,
    });
    expect(result?.pid).toBe(5000);

    // Listener-PID lookup must be a syntactically valid PowerShell pipeline
    // (a missing space would concatenate the -ErrorAction value with Select-Object).
    const [command, options] = state.execAsync.mock.calls[0] as [string, unknown];
    expect(command).toContain('-State Listen -ErrorAction SilentlyContinue Select-Object -First 1');
    expect(options).toEqual({ maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true });
    vi.useRealTimers();
  });

  it('checkDebugPort port scan builds a valid Get-NetTCPConnection pipeline', async () => {
    state.execAsync.mockResolvedValue({
      stdout: JSON.stringify([{ LocalPort: 9222 }]),
      stderr: '',
    });
    const manager = new ProcessManager();
    vi.spyOn(manager, 'getProcessCommandLine').mockResolvedValue({});

    const port = await manager.checkDebugPort(77);

    expect(port).toBe(9222);
    const [command, options] = state.execAsync.mock.calls[0] as [string, unknown];
    expect(command).toContain('-ErrorAction SilentlyContinue Select-Object LocalPort');
    expect(command).toContain('Get-NetTCPConnection -OwningProcess 77');
    expect(options).toEqual({ maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true });
  });

  it.each([
    {
      operation: 'process listing',
      run: (manager: ProcessManager) => manager.findProcesses('app'),
      stdout: '[{"Id":1234,"ProcessName":"app","Path":"C:/app.exe"}]',
      expected: [{ pid: 1234, name: 'app', executablePath: 'C:/app.exe' }],
    },
    {
      operation: 'PID lookup',
      run: (manager: ProcessManager) => manager.getProcessByPid(1234),
      stdout: '{"Id":1234,"ProcessName":"app","Path":"C:/app.exe"}',
      expected: { pid: 1234, name: 'app', executablePath: 'C:/app.exe' },
    },
    {
      operation: 'window enumeration',
      run: (manager: ProcessManager) => manager.getProcessWindows(1234),
      stdout: '{"Handle":"0x100","Title":"App","ClassName":"AppWindow","ProcessId":1234}',
      expected: [
        { handle: '0x100', title: 'App', className: 'AppWindow', processId: 1234, threadId: 0 },
      ],
    },
    {
      operation: 'command-line lookup',
      run: (manager: ProcessManager) => manager.getProcessCommandLine(1234),
      stdout: '{"CommandLine":"app.exe","ParentProcessId":12}',
      expected: { commandLine: 'app.exe', parentPid: 12 },
    },
    {
      operation: 'process termination',
      run: (manager: ProcessManager) => manager.killProcess(1234),
      stdout: 'Process 1234 killed',
      expected: true,
    },
  ])('hides the PowerShell console during $operation', async ({ run, stdout, expected }) => {
    state.execAsync.mockResolvedValue({ stdout, stderr: '' });
    const result = await run(new ProcessManager());

    expect(result).toEqual(expected);
    expect(state.execAsync).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('powershell.exe -NoProfile'),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('delegates browser discovery APIs', async () => {
    state.discoverBrowsers.mockResolvedValue([{ type: 'chrome', pid: 1 }]);
    state.findByWindowClass.mockResolvedValue([{ type: 'edge', pid: 2 }]);
    state.findByProcessName.mockResolvedValue([{ type: 'firefox', pid: 3 }]);
    state.detectDebugPort.mockResolvedValue(9222);
    const manager = new ProcessManager();

    const all = await manager.discoverBrowsers();
    const byClass = await manager.findBrowserByWindowClass('Browser_WidgetWin_*');
    const byName = await manager.findBrowserByProcessName('browser-bin.exe');
    const port = await manager.detectBrowserDebugPort(1);

    expect(all).toHaveLength(1);
    expect(byClass[0]?.pid).toBe(2);
    expect(byName[0]?.pid).toBe(3);
    expect(port).toBe(9222);
  });
});

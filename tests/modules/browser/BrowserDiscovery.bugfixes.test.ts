import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('util', () => ({ promisify: () => execFileMock }));
vi.mock('@src/native/ScriptLoader', () => ({
  ScriptLoader: class {
    getScriptPath(name: string) {
      return `C:/scripts/${name}`;
    }
  },
}));

import { BrowserDiscovery } from '@modules/browser/BrowserDiscovery';

class TestBrowserDiscovery extends BrowserDiscovery {
  public async testCheckPort(pid: number, port: number): Promise<boolean> {
    return (
      this as unknown as {
        checkPort: (pid: number, port: number) => Promise<boolean>;
      }
    ).checkPort(pid, port);
  }
}

describe('BrowserDiscovery PowerShell command construction', () => {
  let discovery: TestBrowserDiscovery;

  beforeEach(() => {
    vi.clearAllMocks();
    discovery = new TestBrowserDiscovery();
  });

  it('separates Get-Process tokens with whitespace in findByProcessName', async () => {
    execFileMock.mockResolvedValue({ stdout: '' });

    await discovery.findByProcessName('chrome');

    const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    const command = args.join(' ');
    expect(command).toContain('SilentlyContinue');
    expect(command).toContain('Select-Object Id');
    expect(command).not.toContain('ContinueSelect-Object');
    expect(command).not.toContain('WorkingSet64ConvertTo-Json');
  });

  it('separates checkPort pipeline tokens with whitespace', async () => {
    execFileMock.mockResolvedValue({ stdout: 'null' });

    await discovery.testCheckPort(100, 9222);

    const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    const command = args.join(' ');
    expect(command).toContain('SilentlyContinue');
    expect(command).toContain('Select-Object LocalPort');
    expect(command).not.toContain('ContinueSelect-Object');
    expect(command).not.toContain('LocalPort|ConvertTo-Json');
  });
});

describe('BrowserDiscovery hardening', () => {
  class ParseDiscovery extends BrowserDiscovery {
    public parseWindows(stdout: string): unknown[] {
      return (
        this as unknown as {
          parseWindowsResult: (stdout: string, pattern: string) => unknown[];
        }
      ).parseWindowsResult(stdout, '*');
    }

    public parseProcess(stdout: string): unknown[] {
      return (
        this as unknown as {
          parseProcessResult: (stdout: string, name: string) => unknown[];
        }
      ).parseProcessResult(stdout, 'chrome');
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounds every PowerShell spawn with a timeout and hides the console window', async () => {
    execFileMock.mockResolvedValue({ stdout: 'null' });

    const discovery = new ParseDiscovery();
    await discovery.findByProcessName('chrome');

    const [, , options] = execFileMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(options.windowsHide).toBe(true);
    expect(typeof options.timeout).toBe('number');
    expect(options.timeout).toBeGreaterThan(0);
  });

  it('drops window rows whose ProcessId is not a usable PID', () => {
    const discovery = new ParseDiscovery();
    const stdout = JSON.stringify([
      { ProcessId: 42, Handle: '0x1', Title: 'A - Google Chrome', ClassName: 'Chrome_WidgetWin_1' },
      { ProcessId: 0, Handle: '0x2', Title: 'bad', ClassName: 'Chrome_WidgetWin_1' },
      { ProcessId: 'nope', Handle: '0x3', Title: 'bad', ClassName: 'Chrome_WidgetWin_1' },
      { Handle: '0x4', Title: 'bad', ClassName: 'Chrome_WidgetWin_1' },
    ]);

    expect(discovery.parseWindows(stdout)).toHaveLength(1);
    expect(discovery.parseWindows(stdout)[0]).toMatchObject({ pid: 42 });
  });

  it('drops process rows whose Id is not a usable PID', () => {
    const discovery = new ParseDiscovery();
    const stdout = JSON.stringify([
      { Id: 7, ProcessName: 'chrome', MainWindowTitle: 'A - Google Chrome' },
      { Id: -1, ProcessName: 'chrome' },
      { ProcessName: 'chrome' },
    ]);

    expect(discovery.parseProcess(stdout)).toHaveLength(1);
    expect(discovery.parseProcess(stdout)[0]).toMatchObject({ pid: 7, type: 'chrome' });
  });
});

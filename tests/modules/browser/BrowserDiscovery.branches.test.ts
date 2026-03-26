import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserDiscovery,
  type BrowserSignature,
  type BrowserInfo,
} from '@modules/browser/BrowserDiscovery';

const getScriptPathMock = vi.fn((name: string) => `C:/scripts/${name}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@native/ScriptLoader', () => ({
  ScriptLoader: class {
    getScriptPath(name: string) {
      return getScriptPathMock(name);
    }
  },
}));

const execFileMock = vi.hoisted(() => vi.fn());
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('child_process', () => ({ execFile: execFileMock }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('util', () => ({ promisify: () => execFileMock }));

interface BrowserDiscoveryMirror {
  browserSignatures: Map<string, BrowserSignature>;
  sanitizePsInput(value: string): string;
  escapePowerShellSingleQuoted(value: string): string;
  parseWindowsResult(stdout: string, classNamePattern: string): BrowserInfo[];
  parseProcessResult(stdout: string, name: string): BrowserInfo[];
  checkDebugPortFromCommandLine(pid: number): Promise<number | null>;
  checkPort(pid: number, port: number): Promise<boolean>;
  findBySignature(type: string, signature: BrowserSignature): Promise<BrowserInfo[]>;
}

describe('BrowserDiscovery additional branch coverage', () => {
  let discovery: BrowserDiscovery;
  let mirror: BrowserDiscoveryMirror;

  beforeEach(() => {
    vi.clearAllMocks();
    discovery = new BrowserDiscovery();
    mirror = discovery as unknown as BrowserDiscoveryMirror;
  });

  describe('sanitizePsInput', () => {
    it('strips dangerous characters', () => {
      const sanitize = mirror.sanitizePsInput.bind(mirror);
      expect(sanitize('`$"\'{}();|<>@#%!\\\ntest\r')).toBe('test');
    });
    it('returns normal strings unchanged', () => {
      const sanitize = mirror.sanitizePsInput.bind(mirror);
      expect(sanitize('chrome.exe')).toBe('chrome.exe');
    });
    it('handles empty string', () => {
      const sanitize = mirror.sanitizePsInput.bind(mirror);
      expect(sanitize('')).toBe('');
    });
  });

  describe('escapePowerShellSingleQuoted', () => {
    it('sanitizes and escapes quotes', () => {
      const esc = mirror.escapePowerShellSingleQuoted.bind(mirror);
      expect(esc("test'value")).toBe('testvalue');
    });
    it('returns clean strings unchanged', () => {
      const esc = mirror.escapePowerShellSingleQuoted.bind(mirror);
      expect(esc('chrome.exe')).toBe('chrome.exe');
    });
  });

  describe('parseWindowsResult', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const parse = (m: BrowserDiscoveryMirror, stdout: string, pattern: string) =>
      m.parseWindowsResult.call(m, stdout, pattern);

    it('returns empty for empty stdout', () => {
      expect(parse(mirror, '', '*')).toEqual([]);
    });
    it('returns empty for null stdout', () => {
      expect(parse(mirror, 'null', '*')).toEqual([]);
    });
    it('returns empty for whitespace', () => {
      expect(parse(mirror, '   \n  ', '*')).toEqual([]);
    });
    it('parses single object', () => {
      const s = JSON.stringify({
        ProcessId: 100,
        Handle: '0xABC',
        Title: 'Test - Google Chrome',
        ClassName: 'Chrome_WidgetWin_0',
      });
      const r = parse(mirror, s, '*');
      expect(r).toHaveLength(1);
      expect(r[0]?.type).toBe('chrome');
      expect(r[0]?.pid).toBe(100);
    });
    it('parses array', () => {
      const s = JSON.stringify([
        {
          ProcessId: 1,
          Handle: '0x1',
          Title: 'P - Google Chrome',
          ClassName: 'Chrome_WidgetWin_0',
        },
        { ProcessId: 2, Handle: '0x2', Title: 'P - Microsoft Edge', ClassName: 'Edge_WidgetWin_0' },
      ]);
      const r = parse(mirror, s, '*');
      expect(r).toHaveLength(2);
      expect(r[0]?.type).toBe('chrome');
      expect(r[1]?.type).toBe('edge');
    });
    it('identifies firefox by title', () => {
      const s = JSON.stringify({
        ProcessId: 3,
        Handle: '0x3',
        Title: 'P - Mozilla Firefox',
        ClassName: 'MozillaWindowClass',
      });
      expect(parse(mirror, s, '*')[0]?.type).toBe('firefox');
    });
    it('falls back to class name matching', () => {
      const s = JSON.stringify({
        ProcessId: 4,
        Handle: '0x4',
        Title: 'Unknown',
        ClassName: 'Edge_WidgetWin_1',
      });
      expect(parse(mirror, s, '*')[0]?.type).toBe('edge');
    });
    it('returns unknown for unmatched', () => {
      const s = JSON.stringify({
        ProcessId: 5,
        Handle: '0x5',
        Title: 'Notepad',
        ClassName: 'NotepadWin',
      });
      expect(parse(mirror, s, '*')[0]?.type).toBe('unknown');
    });
    it('handles missing Title and ClassName', () => {
      const s = JSON.stringify({ ProcessId: 6, Handle: '0x6' });
      const r = parse(mirror, s, '*');
      expect(r[0]?.type).toBe('unknown');
      expect(r[0]?.title).toBeUndefined();
    });
    it('returns empty for invalid JSON', () => {
      expect(parse(mirror, 'not json', '*')).toEqual([]);
    });
    it('matches wildcard class name pattern', () => {
      const s = JSON.stringify({
        ProcessId: 7,
        Handle: '0x7',
        Title: 'Win',
        ClassName: 'Chrome_WidgetWin_99',
      });
      expect(parse(mirror, s, '*')[0]?.type).toBe('chrome');
    });
  });

  describe('parseProcessResult', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const parse = (m: BrowserDiscoveryMirror, stdout: string, name: string) =>
      m.parseProcessResult.call(m, stdout, name);

    it('returns empty for empty stdout', () => {
      expect(parse(mirror, '', 'c')).toEqual([]);
    });
    it('returns empty for null stdout', () => {
      expect(parse(mirror, 'null', 'c')).toEqual([]);
    });
    it('identifies chrome', () => {
      const s = JSON.stringify({
        Id: 10,
        ProcessName: 'chrome',
        MainWindowHandle: 123,
        MainWindowTitle: 'CW',
      });
      const r = parse(mirror, s, 'chrome');
      expect(r[0]?.type).toBe('chrome');
      expect(r[0]?.hwnd).toBe('123');
    });
    it('identifies edge by msedge', () => {
      const s = JSON.stringify({
        Id: 20,
        ProcessName: 'msedge',
        MainWindowHandle: 456,
        MainWindowTitle: 'E',
      });
      expect(parse(mirror, s, 'msedge')[0]?.type).toBe('edge');
    });
    it('identifies edge by edge', () => {
      const s = JSON.stringify({
        Id: 21,
        ProcessName: 'Microsoft Edge',
        MainWindowHandle: 457,
        MainWindowTitle: 'E',
      });
      expect(parse(mirror, s, 'edge')[0]?.type).toBe('edge');
    });
    it('identifies firefox', () => {
      const s = JSON.stringify({
        Id: 30,
        ProcessName: 'firefox',
        MainWindowHandle: 789,
        MainWindowTitle: 'F',
      });
      expect(parse(mirror, s, 'ff')[0]?.type).toBe('firefox');
    });
    it('returns unknown for unrecognized', () => {
      const s = JSON.stringify({
        Id: 40,
        ProcessName: 'notepad',
        MainWindowHandle: 0,
        MainWindowTitle: '',
      });
      expect(parse(mirror, s, 'np')[0]?.type).toBe('unknown');
    });
    it('handles array', () => {
      const s = JSON.stringify([
        { Id: 50, ProcessName: 'chrome', MainWindowHandle: 1, MainWindowTitle: 'a' },
        { Id: 51, ProcessName: 'firefox', MainWindowHandle: 2, MainWindowTitle: 'b' },
      ]);
      const r = parse(mirror, s, '*');
      expect(r).toHaveLength(2);
      expect(r[0]?.type).toBe('chrome');
      expect(r[1]?.type).toBe('firefox');
    });
    it('handles missing ProcessName', () => {
      const s = JSON.stringify({ Id: 60, MainWindowHandle: 0 });
      expect(parse(mirror, s, 'x')[0]?.type).toBe('unknown');
    });
    it('handles missing MainWindowHandle', () => {
      const s = JSON.stringify({ Id: 70, ProcessName: 'chrome' });
      expect(parse(mirror, s, 'chrome')[0]?.hwnd).toBeUndefined();
    });
    it('returns empty for invalid JSON', () => {
      expect(parse(mirror, '{broken!', 'x')).toEqual([]);
    });
  });

  describe('findByWindowClass', () => {
    it('calls powershell and returns results', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({
          ProcessId: 100,
          Handle: '0x1',
          Title: 'T',
          ClassName: 'Chrome_WidgetWin_0',
        }),
      });
      const r = await discovery.findByWindowClass('Chrome_WidgetWin_0');
      expect(r).toHaveLength(1);
      expect(getScriptPathMock).toHaveBeenCalledWith('enum-windows-by-class.ps1');
    });
    it('returns empty on error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockRejectedValue(new Error('PS failed'));
      expect(await discovery.findByWindowClass('Chrome_WidgetWin_0')).toEqual([]);
    });
  });

  describe('findByProcessName', () => {
    it('calls powershell and parses', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({
          Id: 200,
          ProcessName: 'chrome',
          MainWindowHandle: 1,
          MainWindowTitle: 'x',
        }),
      });
      const r = await discovery.findByProcessName('chrome');
      expect(r).toHaveLength(1);
      expect(r[0]?.type).toBe('chrome');
    });
    it('returns empty on error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockRejectedValue(new Error('PS failed'));
      expect(await discovery.findByProcessName('chrome')).toEqual([]);
    });
  });

  describe('checkDebugPortFromCommandLine', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const check = (m: BrowserDiscoveryMirror, pid: number) =>
      m.checkDebugPortFromCommandLine.call(m, pid);

    it('returns debug port from cmdline', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({
          CommandLine: 'chrome.exe --remote-debugging-port=9222',
          ParentProcessId: 1,
        }),
      });
      expect(await check(mirror, 100)).toBe(9222);
    });
    it('returns null when no debug port', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ CommandLine: 'chrome.exe --no-sandbox', ParentProcessId: 1 }),
      });
      expect(await check(mirror, 100)).toBeNull();
    });
    it('returns null for empty stdout', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: '' });
      expect(await check(mirror, 100)).toBeNull();
    });
    it('returns null for null stdout', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: 'null' });
      expect(await check(mirror, 100)).toBeNull();
    });
    it('returns null when CommandLine empty', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: JSON.stringify({ CommandLine: '' }) });
      expect(await check(mirror, 100)).toBeNull();
    });
    it('returns null on error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockRejectedValue(new Error('fail'));
      expect(await check(mirror, 100)).toBeNull();
    });
    it('returns null for negative pid', async () => {
      expect(await check(mirror, -1)).toBeNull();
    });
    it('returns null for NaN pid', async () => {
      expect(await check(mirror, NaN)).toBeNull();
    });
    it('returns null for Infinity pid', async () => {
      expect(await check(mirror, Infinity)).toBeNull();
    });
    it('returns null for zero pid', async () => {
      expect(await check(mirror, 0)).toBeNull();
    });
    it('truncates fractional pid', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ CommandLine: 'chrome.exe --remote-debugging-port=9333' }),
      });
      expect(await check(mirror, 100.9)).toBe(9333);
    });
  });

  describe('checkPort', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const checkPortFn = (m: BrowserDiscoveryMirror, pid: number, port: number) =>
      m.checkPort.call(m, pid, port);

    it('returns true when port found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify([{ LocalPort: 9222 }, { LocalPort: 443 }]),
      });
      expect(await checkPortFn(mirror, 100, 9222)).toBe(true);
    });
    it('returns false when port not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: JSON.stringify([{ LocalPort: 443 }]) });
      expect(await checkPortFn(mirror, 100, 9222)).toBe(false);
    });
    it('returns false for empty stdout', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: '' });
      expect(await checkPortFn(mirror, 100, 9222)).toBe(false);
    });
    it('returns false for null stdout', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: 'null' });
      expect(await checkPortFn(mirror, 100, 9222)).toBe(false);
    });
    it('handles single connection object', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockResolvedValue({ stdout: JSON.stringify({ LocalPort: 9222 }) });
      expect(await checkPortFn(mirror, 100, 9222)).toBe(true);
    });
    it('returns false on error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      execFileMock.mockRejectedValue(new Error('fail'));
      expect(await checkPortFn(mirror, 100, 9222)).toBe(false);
    });
    it('returns false for invalid pid', async () => {
      expect(await checkPortFn(mirror, -1, 9222)).toBe(false);
    });
    it('returns false for invalid port', async () => {
      expect(await checkPortFn(mirror, 100, -1)).toBe(false);
    });
    it('returns false for NaN pid', async () => {
      expect(await checkPortFn(mirror, NaN, 9222)).toBe(false);
    });
    it('returns false for NaN port', async () => {
      expect(await checkPortFn(mirror, 100, NaN)).toBe(false);
    });
    it('returns false for Infinity pid', async () => {
      expect(await checkPortFn(mirror, Infinity, 9222)).toBe(false);
    });
    it('returns false for zero pid', async () => {
      expect(await checkPortFn(mirror, 0, 9222)).toBe(false);
    });
    it('returns false for zero port', async () => {
      expect(await checkPortFn(mirror, 100, 0)).toBe(false);
    });
  });

  describe('findBySignature private', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const findSig = (m: BrowserDiscoveryMirror, type: string, sig: BrowserSignature) =>
      m.findBySignature.call(m, type, sig);

    it('deduplicates by pid', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'findByProcessName').mockResolvedValue([
        { type: 'chrome', pid: 100, hwnd: '0x1' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'findByWindowClass').mockResolvedValue([
        { type: 'chrome', pid: 100, hwnd: '0x2' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'detectDebugPort').mockResolvedValue(null);
      const sig: BrowserSignature = {
        windowClasses: ['C_0'],
        processNames: ['chrome.exe'],
        debugPorts: [9222],
      };
      const r = await findSig(mirror, 'chrome', sig);
      expect(r).toHaveLength(1);
    });
    it('includes different pids', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'findByProcessName').mockResolvedValue([{ type: 'chrome', pid: 100 }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'findByWindowClass').mockResolvedValue([{ type: 'chrome', pid: 200 }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'detectDebugPort').mockResolvedValue(null);
      const sig: BrowserSignature = {
        windowClasses: ['C_0'],
        processNames: ['chrome.exe'],
        debugPorts: [9222],
      };
      expect(await findSig(mirror, 'chrome', sig)).toHaveLength(2);
    });
    it('attaches debug port', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'findByProcessName').mockResolvedValue([{ type: 'chrome', pid: 100 }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'findByWindowClass').mockResolvedValue([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(discovery, 'detectDebugPort').mockResolvedValue(9222);
      const sig: BrowserSignature = {
        windowClasses: [],
        processNames: ['chrome.exe'],
        debugPorts: [9222],
      };
      const r = await findSig(mirror, 'chrome', sig);
      expect(r[0]?.debugPort).toBe(9222);
    });
  });

  describe('discoverBrowsers', () => {
    it('aggregates all signatures', async () => {
      vi.spyOn(mirror, 'findBySignature')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce([{ type: 'chrome', pid: 1 }])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce([{ type: 'edge', pid: 2 }])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce([{ type: 'firefox', pid: 3 }]);
      const r = await discovery.discoverBrowsers();
      expect(r).toHaveLength(3);
    });
    it('returns empty when no browsers', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'findBySignature').mockResolvedValue([]);
      expect(await discovery.discoverBrowsers()).toEqual([]);
    });
  });

  describe('detectDebugPort', () => {
    it('returns cmdline port when available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'checkDebugPortFromCommandLine').mockResolvedValue(9555);
      expect(await discovery.detectDebugPort(100, [9222])).toBe(9555);
    });
    it('probes ports in order', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'checkDebugPortFromCommandLine').mockResolvedValue(null);
      vi.spyOn(mirror, 'checkPort')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce(false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        .mockResolvedValueOnce(true);
      expect(await discovery.detectDebugPort(100, [9222, 9333])).toBe(9333);
    });
    it('returns null when no match', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'checkDebugPortFromCommandLine').mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'checkPort').mockResolvedValue(false);
      expect(await discovery.detectDebugPort(100, [9222])).toBeNull();
    });
    it('returns null for empty ports', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'checkDebugPortFromCommandLine').mockResolvedValue(null);
      expect(await discovery.detectDebugPort(100, [])).toBeNull();
    });
    it('returns first matching port', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(mirror, 'checkDebugPortFromCommandLine').mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const cp = vi.spyOn(mirror, 'checkPort').mockResolvedValue(true);
      expect(await discovery.detectDebugPort(100, [9222, 9333])).toBe(9222);
      expect(cp).toHaveBeenCalledTimes(1);
    });
  });

  describe('browserSignatures', () => {
    it('has chrome edge firefox', () => {
      const sigs = mirror.browserSignatures;
      expect(sigs.has('chrome')).toBe(true);
      expect(sigs.has('edge')).toBe(true);
      expect(sigs.has('firefox')).toBe(true);
    });
    it('each signature has required fields', () => {
      const sigs = mirror.browserSignatures;
      for (const [, sig] of sigs) {
        expect(sig.windowClasses.length).toBeGreaterThan(0);
        expect(sig.processNames.length).toBeGreaterThan(0);
        expect(sig.debugPorts.length).toBeGreaterThan(0);
      }
    });
    it('chrome title regex works', () => {
      const sigs = mirror.browserSignatures;
      expect(sigs.get('chrome')?.mainWindowTitle?.test('Page - Google Chrome')).toBe(true);
      expect(sigs.get('chrome')?.mainWindowTitle?.test('Not Chrome')).toBe(false);
    });
  });
});

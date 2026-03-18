import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSignature } from '@modules/browser/BrowserDiscovery';

const getScriptPathMock = vi.fn((name: string) => `C:/scripts/${name}`);

vi.mock('@src/native/ScriptLoader', () => ({
  ScriptLoader: class {
    getScriptPath(name: string) {
      return getScriptPathMock(name);
    }
  },
}));

import { BrowserDiscovery } from '@modules/browser/BrowserDiscovery';

describe('BrowserDiscovery', () => {
  let discovery: BrowserDiscovery;

  beforeEach(() => {
    vi.clearAllMocks();
    discovery = new BrowserDiscovery();
  });

  it('discovers browsers by aggregating signatures', async () => {
    const findBySignature = vi
      .spyOn(discovery as any, 'findBySignature')
      .mockResolvedValueOnce([{ type: 'chrome', pid: 1 }])
      .mockResolvedValueOnce([{ type: 'edge', pid: 2 }])
      .mockResolvedValueOnce([{ type: 'firefox', pid: 3 }]);

    const result = await discovery.discoverBrowsers();
    expect(findBySignature).toHaveBeenCalledTimes(3);
    expect(result.map((r) => r.pid)).toEqual([1, 2, 3]);
  });

  it('parses windows result and infers browser type by title/class', () => {
    const parse = (discovery as any).parseWindowsResult.bind(discovery);
    const signatures = Array.from((discovery as any).browserSignatures.entries()) as [
      string,
      BrowserSignature,
    ][];
    const primary = signatures.find(
      ([, signature]) =>
        Array.isArray(signature.windowClasses) && signature.windowClasses.length > 0
    )!;
    const secondary = signatures.find(
      ([browserName, signature]) =>
        browserName !== primary[0] &&
        Array.isArray(signature.windowClasses) &&
        signature.windowClasses.length > 0
    )!;
    const payload = JSON.stringify([
      {
        ProcessId: 11,
        Handle: '0x1',
        Title: 'Docs - Primary Browser',
        ClassName: primary[1].windowClasses[0],
      },
      { ProcessId: 12, Handle: '0x2', Title: 'Unknown', ClassName: secondary[1].windowClasses[0] },
    ]);

    const result = parse(payload, '*');
    expect(result[0].type).toBe(primary[0]);
    expect(result[1].type).toBe(secondary[0]);
  });

  it('parses process results and infers browser type by process name', () => {
    const parse = (discovery as any).parseProcessResult.bind(discovery);
    const signatures = Array.from((discovery as any).browserSignatures.entries()) as [
      string,
      BrowserSignature,
    ][];
    const payload = JSON.stringify([
      {
        Id: 21,
        ProcessName: signatures[0]![1].processNames[0],
        MainWindowHandle: 3,
        MainWindowTitle: 'a',
      },
      {
        Id: 22,
        ProcessName: signatures[1]![1].processNames[0],
        MainWindowHandle: 4,
        MainWindowTitle: 'b',
      },
      {
        Id: 23,
        ProcessName: signatures[2]![1].processNames[0],
        MainWindowHandle: 5,
        MainWindowTitle: 'c',
      },
    ]);

    const result = parse(payload, 'x');
    expect(result.map((r: any) => r.type)).toEqual(
      signatures.slice(0, 3).map(([name]: any) => name)
    );
  });

  it('detectDebugPort prioritizes command-line detected port', async () => {
    vi.spyOn(discovery as any, 'checkDebugPortFromCommandLine').mockResolvedValue(9555);
    const checkPort = vi.spyOn(discovery as any, 'checkPort').mockResolvedValue(true);

    const port = await discovery.detectDebugPort(100, [9222, 9333]);
    expect(port).toBe(9555);
    expect(checkPort).not.toHaveBeenCalled();
  });

  it('detectDebugPort falls back to probing known ports', async () => {
    vi.spyOn(discovery as any, 'checkDebugPortFromCommandLine').mockResolvedValue(null);
    vi.spyOn(discovery as any, 'checkPort')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const port = await discovery.detectDebugPort(100, [9222, 9333]);
    expect(port).toBe(9333);
  });

  it('detectDebugPort returns null when no port is found', async () => {
    vi.spyOn(discovery as any, 'checkDebugPortFromCommandLine').mockResolvedValue(null);
    vi.spyOn(discovery as any, 'checkPort').mockResolvedValue(false);

    const port = await discovery.detectDebugPort(100, [9222]);
    expect(port).toBeNull();
  });
});

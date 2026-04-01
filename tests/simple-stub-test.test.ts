import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
const puppeteerState = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('@utils/logger', () => ({ logger: loggerState }));
vi.mock('rebrowser-puppeteer-core', () => ({
  default: { launch: puppeteerState.launch },
  launch: puppeteerState.launch,
}));

describe('simple stubGlobal test', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('checks if stubGlobal persists property assignments', async () => {
    const myWindow = { foo: 'bar', chrome: undefined as unknown };
    vi.stubGlobal('window', myWindow);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('performance', { now: () => 1 });
    vi.stubGlobal('Notification', {});

    let capturedWindow: unknown;
    const mockPage = {
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      evaluateOnNewDocument: vi.fn().mockImplementation((fn: () => void) => {
        capturedWindow = (globalThis as any).window;
        fn(); // run the callback
      }),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({}),
    };
    const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage) };
    puppeteerState.launch.mockResolvedValue(mockBrowser as any);

    // Import and call the function
    const { fetchRealEnvironmentData } = await import('@modules/emulator/EnvironmentEmulatorFetch');
    await fetchRealEnvironmentData({
      url: 'https://example.com',
      detected: { window: [], document: [], navigator: [], location: [], screen: [], other: [] },
      depth: 1,
      resolveExecutablePath: vi.fn(),
      buildManifestFromTemplate: vi.fn(),
    });

    console.log('capturedWindow === myWindow:', capturedWindow === myWindow);
    console.log('capturedWindow.chrome:', (capturedWindow as any)?.chrome);
    console.log('myWindow.chrome:', myWindow.chrome);
    expect(capturedWindow).toBe(myWindow);
    expect(myWindow.chrome).toBeDefined();
  });
});

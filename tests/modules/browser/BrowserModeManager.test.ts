import { beforeEach, describe, expect, it, vi } from 'vitest';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const existsSyncMock = vi.fn();
const findBrowserExecutableMock = vi.fn();
const launchMock = vi.fn();
const detectMock = vi.fn();
const waitForCompletionMock = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => existsSyncMock(...args),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: (...args: any[]) => launchMock(...args),
  },
}));

vi.mock('@src/utils/browserExecutable', () => ({
  findBrowserExecutable: (...args: any[]) => findBrowserExecutableMock(...args),
}));

vi.mock('@src/modules/captcha/CaptchaDetector', () => ({
  CaptchaDetector: class {
    detect = detectMock;
    waitForCompletion = waitForCompletionMock;
  },
}));

import { BrowserModeManager } from '@modules/browser/BrowserModeManager';

describe('BrowserModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves configured executable path when file exists', () => {
    existsSyncMock.mockReturnValue(true);
    const manager = new BrowserModeManager({}, { executablePath: '/my/browser-bin' as any });
    const path = (manager as any).resolveExecutablePath();
    expect(path).toBe('/my/browser-bin');
  });

  it('throws when configured executable path does not exist', () => {
    existsSyncMock.mockReturnValue(false);
    const manager = new BrowserModeManager({}, { executablePath: '/missing/browser-bin' as any });
    expect(() => (manager as any).resolveExecutablePath()).toThrow(/not found/i);
  });

  it('uses detected executable path when not explicitly configured', () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    const manager = new BrowserModeManager();
    const path = (manager as any).resolveExecutablePath();
    expect(path).toBe('/detected/browser-bin');
  });

  it('launches browser with hardened args', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    const fakeBrowser = { newPage: vi.fn(), close: vi.fn() };
    launchMock.mockResolvedValue(fakeBrowser);

    const manager = new BrowserModeManager({ defaultHeadless: true }, { args: ['--foo'] as any });
    const browser = await manager.launch();

    expect(browser).toBe(fakeBrowser);
    expect(launchMock).toHaveBeenCalledOnce();
    const options = launchMock.mock.calls[0]?.[0];
    expect(options.headless).toBe(true);
    expect(options.args).toContain('--foo');
    expect(options.args).toContain('--disable-extensions');
    expect(options.executablePath).toBe('/detected/browser-bin');
  });

  it('goto throws when no active page is available', async () => {
    const manager = new BrowserModeManager();
    await expect(manager.goto('https://example.com')).rejects.toThrow(/newPage/i);
  });

  it('waits for manual completion when captcha detected and no auto switch', async () => {
    detectMock.mockResolvedValue({
      detected: true,
      type: 'slider',
      confidence: 90,
      providerHint: 'regional_service',
    });
    waitForCompletionMock.mockResolvedValue(true);

    const manager = new BrowserModeManager({
      autoSwitchHeadless: false,
      autoDetectCaptcha: true,
      defaultHeadless: true,
    });

    const page = {} as any;
    await manager.checkAndHandleCaptcha(page, 'https://example.com');
    expect(waitForCompletionMock).toHaveBeenCalledOnce();
  });

  it('reuses the same launch promise for concurrent newPage calls', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const firstPage = {
      evaluateOnNewDocument: vi.fn(async () => {}),
      setCookie: vi.fn(async () => {}),
    };
    const secondPage = {
      evaluateOnNewDocument: vi.fn(async () => {}),
      setCookie: vi.fn(async () => {}),
    };
    const fakeBrowser = {
      newPage: vi.fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    const deferred = createDeferred<any>();
    launchMock.mockReturnValue(deferred.promise);

    const manager = new BrowserModeManager({ defaultHeadless: true });
    const firstNewPage = manager.newPage();
    const secondNewPage = manager.newPage();

    expect(launchMock).toHaveBeenCalledTimes(1);

    deferred.resolve(fakeBrowser);

    await expect(Promise.all([firstNewPage, secondNewPage])).resolves.toEqual([
      firstPage,
      secondPage,
    ]);
    expect(fakeBrowser.newPage).toHaveBeenCalledTimes(2);
  });

  it('returns from close while launch is still pending and closes once launch settles', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const deferred = createDeferred<any>();
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    launchMock.mockReturnValue(deferred.promise);

    const manager = new BrowserModeManager({ defaultHeadless: true });
    const launchPromise = manager.launch();

    const closeResult = await Promise.race([
      manager.close().then(() => 'closed'),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
    ]);

    expect(closeResult).toBe('closed');

    deferred.resolve(fakeBrowser);

    await expect(launchPromise).rejects.toThrow(/close/i);
    await vi.waitFor(() => {
      expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
    });
  });
});


import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'rebrowser-puppeteer-core';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const existsSyncMock = vi.hoisted(() => vi.fn());
const findBrowserExecutableMock = vi.hoisted(() => vi.fn());
const launchMock = vi.hoisted(() => vi.fn());
const assessMock = vi.hoisted(() => vi.fn());
const waitForCompletionMock = vi.hoisted(() => vi.fn());
const determineCaptchaResolutionMock = vi.hoisted(() => vi.fn());

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: launchMock,
  },
  launch: launchMock,
}));

vi.mock('@utils/browserExecutable', () => ({
  findBrowserExecutable: findBrowserExecutableMock,
}));

vi.mock('@modules/captcha/CaptchaDetector', () => ({
  CaptchaDetector: class {
    assess = assessMock;
    waitForCompletion = waitForCompletionMock;
  },
}));

vi.mock('@modules/captcha/CaptchaPolicy', () => ({
  determineCaptchaResolution: determineCaptchaResolutionMock,
}));

import { BrowserModeManager } from '@modules/browser/BrowserModeManager';

async function withPatchedGlobals<T>(
  context: Record<string, unknown>,
  callback: () => Promise<T> | T,
): Promise<T> {
  const globalObj = globalThis as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(context)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalObj, key));
    Object.defineProperty(globalObj, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor) {
        Object.defineProperty(globalObj, key, descriptor);
      } else {
        delete globalObj[key];
      }
    }
  }
}

describe('BrowserModeManager coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReset();
    findBrowserExecutableMock.mockReset();
    launchMock.mockReset();
    assessMock.mockReset();
    waitForCompletionMock.mockReset();
    determineCaptchaResolutionMock.mockReset();
    assessMock.mockResolvedValue({
      signals: [],
      candidates: [],
      score: 0,
      excludeScore: 0,
      confidence: 0,
      likelyCaptcha: false,
      recommendedNextStep: 'ignore',
      primaryDetection: { detected: false, type: 'none', confidence: 0 },
    });
    determineCaptchaResolutionMock.mockReturnValue({
      action: 'ignore',
      reason: 'default ignore',
    });
  });

  it('falls back to Puppeteer-managed executable resolution when no browser is found', async () => {
    existsSyncMock.mockReturnValue(false);
    findBrowserExecutableMock.mockReturnValue(undefined);

    const browser = {
      newPage: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 1111 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager();
    await manager.launch();

    const options = launchMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.executablePath).toBeUndefined();
    expect(options.headless).toBe(true);
  });

  it('reuses a connected browser on repeated launch calls', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const browser = {
      newPage: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 2222 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager();
    await manager.launch();
    const second = await manager.launch();

    expect(second).toBe(browser);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent launch calls with a shared promise', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const deferred = createDeferred<Browser>();
    launchMock.mockReturnValue(deferred.promise);
    const browser = {
      newPage: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 3333 }),
    } as unknown as Browser;

    const manager = new BrowserModeManager();
    const first = manager.launch();
    const second = manager.launch();

    expect(launchMock).toHaveBeenCalledTimes(1);
    deferred.resolve(browser);

    await expect(Promise.all([first, second])).resolves.toEqual([browser, browser]);
  });

  it('aborts launch when close is requested during startup', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const deferred = createDeferred<Browser>();
    launchMock.mockReturnValue(deferred.promise);
    const browser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 7777 }),
    } as unknown as Browser;

    const manager = new BrowserModeManager();
    const launchPromise = manager.launch();
    const closePromise = manager.close();

    deferred.resolve(browser);

    await expect(closePromise).resolves.toBeUndefined();
    await expect(launchPromise).rejects.toThrow(/aborted/i);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('throws while closing before launch starts', async () => {
    const manager = new BrowserModeManager();
    Reflect.set(manager as object, 'isClosing', true);

    await expect(manager.launch()).rejects.toThrow(/closing/i);
  });

  it('returns early when captcha handling is ignored', async () => {
    const manager = new BrowserModeManager();
    const page = {} as unknown as Page;

    await manager.checkAndHandleCaptcha(page, 'https://example.com');

    expect(waitForCompletionMock).not.toHaveBeenCalled();
  });

  it('skips captcha handling when auto detection is disabled', async () => {
    const manager = new BrowserModeManager({ autoDetectCaptcha: false });
    const page = {
      goto: vi.fn(async () => undefined),
    } as unknown as Page;

    await manager.goto('https://example.com', page);

    expect(assessMock).not.toHaveBeenCalled();
  });

  it('invokes captcha handling after goto when auto detection is enabled', async () => {
    const manager = new BrowserModeManager({ autoDetectCaptcha: true });
    const page = {
      goto: vi.fn(async () => undefined),
    } as unknown as Page;
    const captchaSpy = vi.spyOn(manager, 'checkAndHandleCaptcha').mockResolvedValueOnce(undefined);

    await expect(manager.goto('https://example.com', page)).resolves.toBe(page);

    expect(page.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'networkidle2' });
    expect(captchaSpy).toHaveBeenCalledWith(page, 'https://example.com');
  });

  it('restores session data only for the same origin', async () => {
    const manager = new BrowserModeManager();
    Reflect.set(manager as object, 'sessionData', {
      origin: 'https://a.example',
      localStorage: { token: 'abc' },
      sessionStorage: { theme: 'dark' },
    });

    const page = {
      url: vi.fn(() => 'https://b.example/path'),
      evaluate: vi.fn(async () => undefined),
    } as unknown as Page;

    await (manager as any).restoreSessionData(page);

    expect((page as any).evaluate).not.toHaveBeenCalled();
  });

  it('captures session data errors without throwing', async () => {
    const manager = new BrowserModeManager();
    const page = {
      url: vi.fn(() => 'https://example.com'),
      cookies: vi.fn(async () => [{ name: 'sid', value: 'abc' }]),
      evaluate: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as Page;

    await expect((manager as any).saveSessionData(page)).resolves.toBeUndefined();
  });

  it('does not restore session data when none is stored', async () => {
    const manager = new BrowserModeManager();
    const page = {
      url: vi.fn(() => 'https://example.com'),
      evaluate: vi.fn(async () => undefined),
    } as unknown as Page;

    await (manager as any).restoreSessionData(page);

    expect((page as any).evaluate).not.toHaveBeenCalled();
  });

  it('prints a provider hint in the CAPTCHA prompt', () => {
    const manager = new BrowserModeManager();
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      (manager as any).showCaptchaPrompt({
        type: 'slider',
        confidence: 88,
        providerHint: 'regional_service',
      });

      expect(writeSpy.mock.calls.flat().join('\n')).toContain('Provider hint: regional_service');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('omits provider hint when the CAPTCHA prompt has no provider hint', () => {
    const manager = new BrowserModeManager();
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      (manager as any).showCaptchaPrompt({
        type: 'widget',
        confidence: 91,
      });

      const output = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(output).not.toContain('Provider hint:');
      expect(output).toContain('Type: widget');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('captures and restores session data for same-origin mode switches', async () => {
    const manager = new BrowserModeManager();
    const page = {
      url: vi.fn(() => 'https://example.com/path'),
      cookies: vi.fn(async () => [{ name: 'sid', value: 'abc' }]),
      evaluate: vi.fn(async () => ({
        local: { token: '1' },
        session: { theme: 'dark' },
      })),
    } as unknown as Page;

    await (manager as any).saveSessionData(page);

    const stored = Reflect.get(manager as object, 'sessionData') as Record<string, unknown>;
    expect(stored.origin).toBe('https://example.com');
    expect(stored.cookies).toEqual([{ name: 'sid', value: 'abc' }]);
    expect(stored.localStorage).toEqual({ token: '1' });
    expect(stored.sessionStorage).toEqual({ theme: 'dark' });

    const restorePage = {
      url: vi.fn(() => 'https://example.com/other'),
      evaluate: vi.fn(async () => undefined),
    } as unknown as Page;

    await (manager as any).restoreSessionData(restorePage);

    expect((restorePage as any).evaluate).toHaveBeenCalledWith(expect.any(Function), {
      local: { token: '1' },
      session: { theme: 'dark' },
    });
  });

  it('skips restoring session data across origins', async () => {
    const manager = new BrowserModeManager();
    Reflect.set(manager as object, 'sessionData', {
      origin: 'https://a.example',
      localStorage: { token: 'abc' },
      sessionStorage: { theme: 'dark' },
    });

    const page = {
      url: vi.fn(() => 'https://b.example/path'),
      evaluate: vi.fn(async () => undefined),
    } as unknown as Page;

    await (manager as any).restoreSessionData(page);

    expect((page as any).evaluate).not.toHaveBeenCalled();
  });

  it('swallows session capture and restore failures', async () => {
    const manager = new BrowserModeManager();
    const capturePage = {
      url: vi.fn(() => 'https://example.com'),
      cookies: vi.fn(async () => {
        throw new Error('cookie failure');
      }),
      evaluate: vi.fn(async () => undefined),
    } as unknown as Page;

    await expect((manager as any).saveSessionData(capturePage)).resolves.toBeUndefined();

    Reflect.set(manager as object, 'sessionData', {
      origin: 'https://example.com',
      localStorage: { token: 'abc' },
    });

    const restorePage = {
      url: vi.fn(() => 'https://example.com'),
      evaluate: vi.fn(async () => {
        throw new Error('restore failure');
      }),
    } as unknown as Page;

    await expect((manager as any).restoreSessionData(restorePage)).resolves.toBeUndefined();
  });

  it('force kills the chrome process when browser.close times out', async () => {
    vi.useFakeTimers();

    const manager = new BrowserModeManager();
    const browser = {
      close: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as Browser;

    Reflect.set(manager as object, 'browser', browser);
    Reflect.set(manager as object, 'chromePid', 4242);
    Reflect.set(manager as object, 'isClosing', true);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const closePromise = (manager as any).finalizeClose();
    await vi.advanceTimersByTimeAsync(5100);

    await expect(closePromise).resolves.toBeUndefined();
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGKILL');
    expect(Reflect.get(manager as object, 'chromePid')).toBeNull();
    expect(Reflect.get(manager as object, 'browser')).toBeNull();

    killSpy.mockRestore();
    vi.useRealTimers();
  });

  it('ignores null PIDs and ESRCH errors when force-killing', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('gone') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });

    expect(() => BrowserModeManager.forceKillPid(null)).not.toThrow();
    expect(killSpy).not.toHaveBeenCalled();

    expect(() => BrowserModeManager.forceKillPid(1234)).not.toThrow();
    expect(killSpy).toHaveBeenCalledWith(1234, 'SIGKILL');

    killSpy.mockImplementationOnce(() => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    expect(() => BrowserModeManager.forceKillPid(5678)).not.toThrow();
    expect(loggerState.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to force-kill Chrome PID 5678:'),
      expect.any(Error),
    );

    killSpy.mockRestore();
  });

  it('forces a kill when browser.close times out', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const browser = {
      newPage: vi.fn(),
      close: vi.fn(async () => new Promise<void>(() => {})),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 4444 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager();
    await manager.launch();

    try {
      const closePromise = manager.close();
      await vi.advanceTimersByTimeAsync(5000);
      await closePromise;

      expect(killSpy).toHaveBeenCalledWith(4444, 'SIGKILL');
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('closes cleanly when no browser has been launched', async () => {
    const manager = new BrowserModeManager();

    await expect(manager.close()).resolves.toBeUndefined();
  });

  it('honors explicit headless false configuration', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const browser = {
      newPage: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 5555 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager({ defaultHeadless: false }, {});
    await manager.launch();

    const options = launchMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.headless).toBe(false);
  });

  it('uses a configured executable path when it exists', async () => {
    existsSyncMock.mockReturnValue(true);

    const browser = {
      newPage: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 6666 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager({}, { executablePath: 'C:\\Chrome\\chrome.exe' });
    await manager.launch();

    const options = launchMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.executablePath).toBe('C:\\Chrome\\chrome.exe');
  });

  it('rejects a missing configured executable path before launching', async () => {
    existsSyncMock.mockReturnValue(false);

    const manager = new BrowserModeManager({}, { executablePath: 'C:\\missing\\chrome.exe' });

    await expect(manager.launch()).rejects.toThrow(/Configured browser executable was not found/);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('switches to headed mode, restores session data, and reloads after captcha handling', async () => {
    existsSyncMock.mockReturnValue(false);
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const currentPage = {
      url: vi.fn(() => 'https://example.com/path'),
      cookies: vi.fn(async () => [{ name: 'sid', value: 'abc' }]),
      evaluate: vi.fn(async () => ({
        local: { token: '1' },
        session: { theme: 'dark' },
      })),
    } as unknown as Page;

    let oldBrowserConnected = true;
    const oldBrowser = {
      close: vi.fn(async () => {
        oldBrowserConnected = false;
      }),
      isConnected: vi.fn(() => oldBrowserConnected),
      newPage: vi.fn(),
      process: vi.fn().mockReturnValue({ pid: 1111 }),
    } as unknown as Browser;

    const newPage = {
      url: vi.fn(() => 'https://example.com/path'),
      goto: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      setCookie: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      evaluateOnNewDocument: vi.fn(async () => undefined),
    } as unknown as Page;

    const headedBrowser = {
      newPage: vi.fn(async () => newPage),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 2222 }),
    } as unknown as Browser;

    launchMock.mockResolvedValue(headedBrowser);
    assessMock.mockResolvedValue({
      signals: [
        {
          source: 'url',
          kind: 'captcha',
          value: 'challenge',
          confidence: 95,
          typeHint: 'slider',
          providerHint: 'test',
        },
      ],
      candidates: [
        {
          source: 'url',
          value: 'challenge',
          confidence: 95,
          type: 'slider',
          providerHint: 'test',
        },
      ],
      score: 95,
      excludeScore: 0,
      confidence: 95,
      likelyCaptcha: true,
      recommendedNextStep: 'manual',
      primaryDetection: {
        detected: true,
        type: 'slider',
        confidence: 95,
        providerHint: 'test',
        url: 'https://example.com/challenge',
      },
    });
    determineCaptchaResolutionMock.mockReturnValue({
      action: 'switch_to_headed',
      reason: 'manual solve required',
    });
    waitForCompletionMock.mockResolvedValue(true);

    const manager = new BrowserModeManager();
    Reflect.set(manager as object, 'browser', oldBrowser);
    Reflect.set(manager as object, 'currentPage', currentPage);
    Reflect.set(manager as object, 'isHeadless', true);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(
        manager.checkAndHandleCaptcha(currentPage, 'https://example.com/path'),
      ).resolves.toBeUndefined();
    } finally {
      stderrSpy.mockRestore();
    }

    expect(oldBrowser.close).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(headedBrowser.newPage).toHaveBeenCalledTimes(1);
    expect(newPage.goto).toHaveBeenCalledWith('https://example.com/path', {
      waitUntil: 'networkidle2',
    });
    expect(newPage.setCookie).toHaveBeenCalledWith({ name: 'sid', value: 'abc' });
    expect(newPage.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    expect(newPage.evaluate).toHaveBeenCalledTimes(1);
    expect(newPage.reload).toHaveBeenCalledWith({ waitUntil: 'networkidle2' });
    expect(waitForCompletionMock).toHaveBeenCalledWith(newPage, 300000);
  });

  it('throws when headed CAPTCHA solving times out', async () => {
    existsSyncMock.mockReturnValue(false);
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const currentPage = {
      url: vi.fn(() => 'https://example.com/path'),
      cookies: vi.fn(async () => []),
      evaluate: vi.fn(async () => ({
        local: {},
        session: {},
      })),
    } as unknown as Page;

    let oldBrowserConnected = true;
    const oldBrowser = {
      close: vi.fn(async () => {
        oldBrowserConnected = false;
      }),
      isConnected: vi.fn(() => oldBrowserConnected),
      newPage: vi.fn(),
      process: vi.fn().mockReturnValue({ pid: 3333 }),
    } as unknown as Browser;

    const newPage = {
      url: vi.fn(() => 'https://example.com/path'),
      goto: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      setCookie: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      evaluateOnNewDocument: vi.fn(async () => undefined),
    } as unknown as Page;

    const headedBrowser = {
      newPage: vi.fn(async () => newPage),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 4444 }),
    } as unknown as Browser;

    launchMock.mockResolvedValue(headedBrowser);
    assessMock.mockResolvedValue({
      signals: [],
      candidates: [
        {
          source: 'url',
          value: 'challenge',
          confidence: 95,
          type: 'slider',
        },
      ],
      score: 95,
      excludeScore: 0,
      confidence: 95,
      likelyCaptcha: true,
      recommendedNextStep: 'manual',
      primaryDetection: {
        detected: true,
        type: 'slider',
        confidence: 95,
        url: 'https://example.com/challenge',
      },
    });
    determineCaptchaResolutionMock.mockReturnValue({
      action: 'switch_to_headed',
      reason: 'manual solve required',
    });
    waitForCompletionMock.mockResolvedValue(false);

    const manager = new BrowserModeManager();
    Reflect.set(manager as object, 'browser', oldBrowser);
    Reflect.set(manager as object, 'currentPage', currentPage);
    Reflect.set(manager as object, 'isHeadless', true);

    await expect(
      manager.checkAndHandleCaptcha(currentPage, 'https://example.com/path'),
    ).rejects.toThrow(/Captcha completion timeout/);
    expect(newPage.reload).toHaveBeenCalledWith({ waitUntil: 'networkidle2' });
    expect(waitForCompletionMock).toHaveBeenCalledWith(newPage, 300000);
  });

  it('injects anti-detection scripts and rewrites browser-facing globals', async () => {
    const manager = new BrowserModeManager();
    let injectedCallback: (() => void) | undefined;
    const page = {
      evaluateOnNewDocument: vi.fn(async (fn: () => void) => {
        injectedCallback = fn;
      }),
    } as unknown as Page;

    await (manager as any).injectAntiDetectionScripts(page);
    expect(injectedCallback).toEqual(expect.any(Function));

    const originalQuery = vi.fn(async (input: { name: string }) => ({
      state: `${input.name}-fallback`,
    }));
    const navigator = {
      permissions: { query: originalQuery },
    } as any;
    const window = { navigator } as any;
    const Notification = { permission: 'granted' } as any;

    await withPatchedGlobals(
      {
        navigator,
        window,
        Notification,
      },
      () => (injectedCallback as () => void)(),
    );

    expect(Object.getOwnPropertyDescriptor(navigator, 'webdriver')?.get).toEqual(
      expect.any(Function),
    );
    expect(navigator.webdriver).toBeUndefined();
    expect(window.chrome.runtime.connect).toEqual(expect.any(Function));
    expect(window.chrome.runtime.sendMessage).toEqual(expect.any(Function));
    expect(window.chrome.runtime.onMessage.addListener).toEqual(expect.any(Function));
    expect(window.chrome.runtime.onMessage.removeListener).toEqual(expect.any(Function));
    expect(() => window.chrome.runtime.connect()).not.toThrow();
    expect(() => window.chrome.runtime.sendMessage()).not.toThrow();
    expect(() => window.chrome.runtime.onMessage.addListener()).not.toThrow();
    expect(() => window.chrome.runtime.onMessage.removeListener()).not.toThrow();
    expect(window.chrome.loadTimes()).toMatchObject({
      connectionInfo: 'http/1.1',
      navigationType: 'Other',
    });
    expect(window.chrome.csi()).toMatchObject({ tran: 15 });
    expect(navigator.plugins).toHaveLength(3);
    expect(navigator.plugins[0].name).toBe('Chrome PDF Plugin');
    expect(navigator.plugins[1][0].type).toBe('application/x-google-chrome-pdf');
    expect(navigator.plugins[2][1].description).toContain('Portable Native Client');
    expect(navigator.languages).toEqual(['en-US', 'en']);
    await expect(navigator.permissions.query({ name: 'notifications' })).resolves.toMatchObject({
      state: 'granted',
    });
    await expect(navigator.permissions.query({ name: 'geolocation' })).resolves.toMatchObject({
      state: 'geolocation-fallback',
    });
    expect(originalQuery).toHaveBeenCalledWith({ name: 'geolocation' });
  });

  it('exposes internal state through public getters', () => {
    const manager = new BrowserModeManager({ defaultHeadless: false });
    const browser = { id: 'browser' } as unknown as Browser;
    const page = { id: 'page' } as unknown as Page;

    Reflect.set(manager as object, 'browser', browser);
    Reflect.set(manager as object, 'currentPage', page);
    Reflect.set(manager as object, 'chromePid', 4321);

    expect(manager.getBrowser()).toBe(browser);
    expect(manager.getCurrentPage()).toBe(page);
    expect(manager.isHeadlessMode()).toBe(false);
    expect(manager.getChromePid()).toBe(4321);
  });

  it('finalizes close after a rejected pending launch promise', async () => {
    const manager = new BrowserModeManager();
    const finalizeCloseSpy = vi.spyOn(manager as any, 'finalizeClose').mockResolvedValue(undefined);
    const pendingLaunch = Promise.reject(new Error('launch failed'));
    Reflect.set(manager as object, 'launchPromise', pendingLaunch);

    await expect(manager.close()).resolves.toBeUndefined();
    await pendingLaunch.catch(() => undefined);
    await vi.waitFor(() => {
      expect(finalizeCloseSpy).toHaveBeenCalledTimes(1);
    });
  });
});

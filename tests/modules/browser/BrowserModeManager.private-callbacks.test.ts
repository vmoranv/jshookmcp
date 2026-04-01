import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Browser, Page } from 'rebrowser-puppeteer-core';

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

describe('BrowserModeManager private callback coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as Mock).mockReset?.());
    existsSyncMock.mockReset();
    findBrowserExecutableMock.mockReset();
    launchMock.mockReset();
    assessMock.mockReset();
    waitForCompletionMock.mockReset();
    determineCaptchaResolutionMock.mockReset();
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    determineCaptchaResolutionMock.mockReturnValue({ action: 'ignore', reason: 'default ignore' });
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
  });

  it('covers doLaunch abort cleanup when shutdown is requested and browser.close fails', async () => {
    const manager = new BrowserModeManager();
    const browser = {
      close: vi.fn(async () => {
        throw new Error('close failed');
      }),
      process: vi.fn().mockReturnValue({ pid: 9001 }),
    } as unknown as Browser;
    launchMock.mockImplementation(async () => {
      Reflect.set(manager as object, 'isClosing', true);
      return browser;
    });
    const killSpy = vi.spyOn(BrowserModeManager, 'forceKillPid').mockImplementation(() => {});

    await expect((manager as any).doLaunch()).rejects.toThrow(
      /aborted because close was requested/i,
    );
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(loggerState.warn).toHaveBeenCalledWith(
      'Failed to close browser launched during shutdown',
      expect.any(Error),
    );
    expect(killSpy).toHaveBeenCalledWith(9001);
  });

  it('covers finalizeClose success path without force-kill', async () => {
    const manager = new BrowserModeManager();
    const browser = {
      close: vi.fn(async () => undefined),
    } as unknown as Browser;
    Reflect.set(manager as object, 'browser', browser);
    Reflect.set(manager as object, 'chromePid', 321);
    Reflect.set(manager as object, 'isClosing', true);
    const killSpy = vi.spyOn(BrowserModeManager, 'forceKillPid').mockImplementation(() => {});

    await expect((manager as any).finalizeClose()).resolves.toBeUndefined();
    expect(loggerState.info).toHaveBeenCalledWith('Browser closed');
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('covers observe resolution branch in captcha handling', async () => {
    const manager = new BrowserModeManager();
    determineCaptchaResolutionMock.mockReturnValue({ action: 'observe', reason: 'monitor only' });
    assessMock.mockResolvedValue({
      signals: [],
      candidates: [],
      score: 0,
      excludeScore: 0,
      confidence: 0,
      likelyCaptcha: false,
      recommendedNextStep: 'observe',
      primaryDetection: { detected: false, type: 'none', confidence: 0 },
    });

    await expect(
      manager.checkAndHandleCaptcha({} as Page, 'https://example.com'),
    ).resolves.toBeUndefined();
    expect(loggerState.info).toHaveBeenCalledWith('CAPTCHA auto-handling skipped: monitor only');
  });

  it('covers switchToHeaded old-browser close failure path', async () => {
    const manager = new BrowserModeManager({
      askBeforeSwitchBack: false,
      defaultHeadless: false,
    });
    let oldBrowserConnected = true;
    const currentPage = {
      url: vi.fn(() => 'about:blank'),
      cookies: vi.fn(async () => []),
      evaluate: vi.fn(async (fn: (...args: any[]) => unknown) =>
        withPatchedGlobals(
          {
            localStorage: { length: 0, key: () => null, getItem: () => null },
            sessionStorage: { length: 0, key: () => null, getItem: () => null },
          },
          () => fn(),
        ),
      ),
    } as unknown as Page;
    const oldBrowser = {
      close: vi.fn(async () => {
        oldBrowserConnected = false;
        throw new Error('old browser close failed');
      }),
      isConnected: vi.fn(() => oldBrowserConnected),
    } as unknown as Browser;
    const newPage = {
      goto: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      setCookie: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      evaluateOnNewDocument: vi.fn(async () => undefined),
      url: vi.fn(() => 'about:blank'),
    } as unknown as Page;
    const newBrowser = {
      newPage: vi.fn(async () => newPage),
      process: vi.fn().mockReturnValue({ pid: 4444 }),
      isConnected: vi.fn(() => true),
    } as unknown as Browser;
    launchMock.mockResolvedValue(newBrowser);
    waitForCompletionMock.mockResolvedValue(true);
    const killSpy = vi.spyOn(BrowserModeManager, 'forceKillPid').mockImplementation(() => {});

    Reflect.set(manager as object, 'browser', oldBrowser);
    Reflect.set(manager as object, 'chromePid', 1234);

    await expect(
      (manager as any).switchToHeaded(currentPage, 'https://example.com', {
        type: 'slider',
        confidence: 90,
      }),
    ).resolves.toBeUndefined();

    expect(loggerState.warn).toHaveBeenCalledWith(
      'Failed to close old browser during mode switch:',
      expect.any(Error),
    );
    expect(killSpy).toHaveBeenCalledWith(1234);
  });

  it('executes saveSessionData and restoreSessionData browser callbacks', async () => {
    const manager = new BrowserModeManager();
    const localEntries = new Map([
      ['token', 'abc'],
      ['theme', 'dark'],
    ]);
    const sessionEntries = new Map([['tab', '1']]);
    const savePage = {
      url: vi.fn(() => 'https://example.com/path'),
      cookies: vi.fn(async () => [{ name: 'sid', value: 'cookie' }]),
      evaluate: vi.fn(async (fn: (...args: any[]) => unknown) =>
        withPatchedGlobals(
          {
            localStorage: {
              length: localEntries.size,
              key: (index: number) => Array.from(localEntries.keys())[index] ?? null,
              getItem: (key: string) => localEntries.get(key) ?? null,
            },
            sessionStorage: {
              length: sessionEntries.size,
              key: (index: number) => Array.from(sessionEntries.keys())[index] ?? null,
              getItem: (key: string) => sessionEntries.get(key) ?? null,
            },
          },
          () => fn(),
        ),
      ),
    } as unknown as Page;

    await expect((manager as any).saveSessionData(savePage)).resolves.toBeUndefined();

    const setLocal = vi.fn();
    const setSession = vi.fn();
    const restorePage = {
      url: vi.fn(() => 'https://example.com/other'),
      evaluate: vi.fn(async (fn: (...args: any[]) => unknown, arg: unknown) =>
        withPatchedGlobals(
          {
            localStorage: { setItem: setLocal },
            sessionStorage: { setItem: setSession },
          },
          () => fn(arg),
        ),
      ),
    } as unknown as Page;

    await expect((manager as any).restoreSessionData(restorePage)).resolves.toBeUndefined();
    expect(setLocal).toHaveBeenCalledWith('token', 'abc');
    expect(setLocal).toHaveBeenCalledWith('theme', 'dark');
    expect(setSession).toHaveBeenCalledWith('tab', '1');
  });

  it('executes injectAntiDetectionScripts callback in-place', async () => {
    const manager = new BrowserModeManager();
    const originalQuery = vi.fn(async (payload: { name: string }) => ({
      state: `${payload.name}-fallback`,
    }));
    const navigator = {
      permissions: { query: originalQuery },
    } as any;
    const window = { navigator } as any;
    const Notification = { permission: 'granted' } as any;

    const page = {
      evaluateOnNewDocument: vi.fn(async (fn: () => void) =>
        withPatchedGlobals(
          {
            navigator,
            window,
            Notification,
          },
          () => fn(),
        ),
      ),
    } as unknown as Page;

    await expect((manager as any).injectAntiDetectionScripts(page)).resolves.toBeUndefined();
    expect(navigator.webdriver).toBeUndefined();
    expect(window.chrome.runtime.connect).toEqual(expect.any(Function));
    expect(window.chrome.loadTimes().navigationType).toBe('Other');
    expect(window.chrome.csi().tran).toBe(15);
    await expect(navigator.permissions.query({ name: 'notifications' })).resolves.toEqual({
      state: 'granted',
    });
    await expect(navigator.permissions.query({ name: 'midi' })).resolves.toEqual({
      state: 'midi-fallback',
    });
  });
});

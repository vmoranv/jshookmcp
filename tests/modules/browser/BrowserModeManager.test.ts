import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Browser } from 'rebrowser-puppeteer-core';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const {
  existsSyncMock,
  findBrowserExecutableMock,
  launchMock,
  detectMock,
  assessMock,
  waitForCompletionMock,
  determineCaptchaResolutionMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  findBrowserExecutableMock: vi.fn(),
  launchMock: vi.fn(),
  detectMock: vi.fn(),
  assessMock: vi.fn(),
  waitForCompletionMock: vi.fn(),
  determineCaptchaResolutionMock: vi.fn(),
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

vi.mock('@src/utils/browserExecutable', () => ({
  findBrowserExecutable: findBrowserExecutableMock,
}));

vi.mock('@src/modules/captcha/CaptchaDetector', () => ({
  CaptchaDetector: class {
    detect = detectMock;
    assess = assessMock;
    waitForCompletion = waitForCompletionMock;
  },
}));

vi.mock('@modules/captcha/CaptchaPolicy', () => ({
  determineCaptchaResolution: determineCaptchaResolutionMock,
}));

import { BrowserModeManager } from '@modules/browser/BrowserModeManager';

interface BrowserModeManagerMirror {
  resolveExecutablePath(): string;
}

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

describe('BrowserModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('resolves configured executable path when file exists', () => {
    existsSyncMock.mockReturnValue(true);
    const manager = new BrowserModeManager({}, { executablePath: '/my/browser-bin' });
    const mirror = manager as unknown as BrowserModeManagerMirror;
    const path = mirror.resolveExecutablePath();
    expect(path).toBe('/my/browser-bin');
  });

  it('throws when configured executable path does not exist', () => {
    existsSyncMock.mockReturnValue(false);
    const manager = new BrowserModeManager({}, { executablePath: '/missing/browser-bin' });
    const mirror = manager as unknown as BrowserModeManagerMirror;
    expect(() => mirror.resolveExecutablePath()).toThrow(/not found/i);
  });

  it('uses detected executable path when not explicitly configured', () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    const manager = new BrowserModeManager();
    const mirror = manager as unknown as BrowserModeManagerMirror;
    const path = mirror.resolveExecutablePath();
    expect(path).toBe('/detected/browser-bin');
  });

  it('launches browser with hardened args', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(fakeBrowser);

    const manager = new BrowserModeManager({ defaultHeadless: true }, { args: ['--foo'] });
    const browser = await manager.launch();

    expect(browser).toBe(fakeBrowser);
    expect(launchMock).toHaveBeenCalledOnce();
    const options = launchMock.mock.calls[0]?.[0];
    expect(options?.headless).toBe(true);
    expect(options?.args).toContain('--foo');
    expect(options?.args).toContain('--disable-extensions');
    expect(options?.executablePath).toBe('/detected/browser-bin');
  });

  it('goto throws when no active page is available', async () => {
    const manager = new BrowserModeManager();
    await expect(manager.goto('https://vmoranv.github.io/jshookmcp')).rejects.toThrow(/newPage/i);
  });

  it('waits for manual completion when captcha detected and no auto switch', async () => {
    assessMock.mockResolvedValue({
      signals: [],
      candidates: [
        {
          source: 'dom',
          value: '.captcha-slider',
          confidence: 90,
          type: 'slider',
          providerHint: 'regional_service',
        },
      ],
      score: 90,
      excludeScore: 0,
      confidence: 90,
      likelyCaptcha: true,
      recommendedNextStep: 'manual',
      primaryDetection: {
        detected: true,
        type: 'slider',
        confidence: 90,
        providerHint: 'regional_service',
      },
    });
    waitForCompletionMock.mockResolvedValue(true);
    determineCaptchaResolutionMock.mockReturnValue({
      action: 'manual',
      reason: 'stay in current mode',
    });

    const manager = new BrowserModeManager({
      autoSwitchHeadless: false,
      autoDetectCaptcha: true,
      defaultHeadless: true,
    });

    const page = {} as unknown as Page;
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await manager.checkAndHandleCaptcha(page, 'https://vmoranv.github.io/jshookmcp');
    } finally {
      stderrWrite.mockRestore();
    }
    expect(waitForCompletionMock).toHaveBeenCalledOnce();
  });

  it('does not auto-act when assessment recommends AI review', async () => {
    assessMock.mockResolvedValue({
      signals: [
        {
          source: 'url',
          kind: 'captcha',
          value: 'https://vmoranv.github.io/jshookmcp/challenge',
          confidence: 70,
          typeHint: 'url_redirect',
        },
        {
          source: 'text',
          kind: 'exclude',
          value: 'Text exclusion: Enter verification code',
          confidence: 75,
        },
      ],
      candidates: [
        {
          source: 'url',
          value: 'https://vmoranv.github.io/jshookmcp/challenge',
          confidence: 70,
          type: 'url_redirect',
        },
      ],
      score: 70,
      excludeScore: 75,
      confidence: 70,
      likelyCaptcha: false,
      recommendedNextStep: 'ask_ai',
      primaryDetection: { detected: false, type: 'none', confidence: 0 },
    });

    const manager = new BrowserModeManager({
      autoSwitchHeadless: true,
      autoDetectCaptcha: true,
      defaultHeadless: true,
    });

    const page = {} as unknown as Page;
    await manager.checkAndHandleCaptcha(page, 'https://vmoranv.github.io/jshookmcp');

    expect(waitForCompletionMock).not.toHaveBeenCalled();
    expect(detectMock).not.toHaveBeenCalled();
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
      newPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;
    const deferred = createDeferred<Browser>();
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

    const deferred = createDeferred<Browser>();
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;
    launchMock.mockReturnValue(deferred.promise);

    const manager = new BrowserModeManager({ defaultHeadless: true });
    const launchPromise = manager.launch();

    const closeResult = await Promise.race([
      manager.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);

    expect(closeResult).toBe('closed');

    deferred.resolve(fakeBrowser);

    await expect(launchPromise).rejects.toThrow(/close/i);
    await vi.waitFor(() => {
      expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
    });
  });

  it('injects anti-detection scripts into a new page and rewrites browser signals', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const page = {
      evaluateOnNewDocument: vi.fn(async () => {}),
      setCookie: vi.fn(async () => {}),
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;

    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager({ defaultHeadless: true });
    await manager.newPage();

    const injected = page.evaluateOnNewDocument.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(injected).toBeTypeOf('function');

    const permissionsQuery = vi.fn(async () => ({ state: 'denied' as const }));
    const navigator = {
      permissions: { query: permissionsQuery },
    } as unknown as Navigator;
    const window = { navigator } as Record<string, unknown>;
    await withPatchedGlobals(
      {
        window,
        navigator,
        Notification: { permission: 'granted' },
      },
      () => injected!(),
    );

    expect((navigator as any).webdriver).toBeUndefined();
    expect((window as any).chrome).toBeDefined();
    expect((navigator as any).plugins).toHaveLength(3);
    expect((navigator as any).languages).toEqual(['en-US', 'en']);
    await expect(
      (navigator as any).permissions.query({ name: 'notifications' } as PermissionDescriptor),
    ).resolves.toEqual({ state: 'granted' });
  });

  it('switches to headed mode when CAPTCHA policy requests it and restores session data', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    determineCaptchaResolutionMock.mockReturnValue({
      action: 'switch_to_headed',
      reason: 'manual solve required',
    });
    waitForCompletionMock.mockResolvedValue(true);

    const firstPage = {
      url: vi.fn(() => 'https://example.com'),
      cookies: vi.fn(async () => [{ name: 'sid', value: 'abc' }]),
      evaluate: vi.fn(async () => ({
        local: { token: '1' },
        session: { theme: 'dark' },
      })),
    } as unknown as Page;

    const headedPage = {
      url: vi.fn(() => 'https://example.com'),
      goto: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      evaluateOnNewDocument: vi.fn(async () => {}),
      setCookie: vi.fn(async () => {}),
    } as unknown as Page;

    const browser = {
      newPage: vi.fn(async () => headedPage),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      process: vi.fn().mockReturnValue({ pid: 54321 }),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserModeManager({
      autoDetectCaptcha: true,
      autoSwitchHeadless: true,
      defaultHeadless: true,
      askBeforeSwitchBack: true,
    });

    Reflect.set(manager as object, 'browser', browser);
    Reflect.set(manager as object, 'currentPage', firstPage);
    Reflect.set(manager as object, 'isHeadless', true);
    Reflect.set(manager as object, 'chromePid', 54321);

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await manager.checkAndHandleCaptcha(firstPage, 'https://example.com');

    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(headedPage.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'networkidle2',
    });
    expect(headedPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      local: { token: '1' },
      session: { theme: 'dark' },
    });
    expect(headedPage.reload).toHaveBeenCalledWith({ waitUntil: 'networkidle2' });
    expect(waitForCompletionMock).toHaveBeenCalledWith(headedPage, 300000);
    expect(stderrWrite).toHaveBeenCalled();
    stderrWrite.mockRestore();
  });
});

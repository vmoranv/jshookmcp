import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Browser } from 'rebrowser-puppeteer-core';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  findBrowserExecutableMock: vi.fn(),
  launchMock: vi.fn(),
  detectMock: vi.fn(),
  assessMock: vi.fn(),
  waitForCompletionMock: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: launchMock,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/browserExecutable', () => ({
  findBrowserExecutable: findBrowserExecutableMock,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/captcha/CaptchaDetector', () => ({
  CaptchaDetector: class {
    detect = detectMock;
    assess = assessMock;
    waitForCompletion = waitForCompletionMock;
  },
}));

import { BrowserModeManager } from '@modules/browser/BrowserModeManager';

interface BrowserModeManagerMirror {
  resolveExecutablePath(): string;
}

describe('BrowserModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

  it('resolves configured executable path when file exists', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockReturnValue(true);
    const manager = new BrowserModeManager({}, { executablePath: '/my/browser-bin' });
    const mirror = manager as unknown as BrowserModeManagerMirror;
    const path = mirror.resolveExecutablePath();
    expect(path).toBe('/my/browser-bin');
  });

  it('throws when configured executable path does not exist', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockReturnValue(false);
    const manager = new BrowserModeManager({}, { executablePath: '/missing/browser-bin' });
    const mirror = manager as unknown as BrowserModeManagerMirror;
    expect(() => mirror.resolveExecutablePath()).toThrow(/not found/i);
  });

  it('uses detected executable path when not explicitly configured', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    const manager = new BrowserModeManager();
    const mirror = manager as unknown as BrowserModeManagerMirror;
    const path = mirror.resolveExecutablePath();
    expect(path).toBe('/detected/browser-bin');
  });

  it('launches browser with hardened args', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    launchMock.mockResolvedValue(fakeBrowser);

    const manager = new BrowserModeManager({ defaultHeadless: true }, { args: ['--foo'] });
    const browser = await manager.launch();

    expect(browser).toBe(fakeBrowser);
    expect(launchMock).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const options = launchMock.mock.calls[0]?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(options?.headless).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(options?.args).toContain('--foo');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(options?.args).toContain('--disable-extensions');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(options?.executablePath).toBe('/detected/browser-bin');
  });

  it('goto throws when no active page is available', async () => {
    const manager = new BrowserModeManager();
    await expect(manager.goto('https://vmoranv.github.io/jshookmcp')).rejects.toThrow(/newPage/i);
  });

  it('waits for manual completion when captcha detected and no auto switch', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    waitForCompletionMock.mockResolvedValue(true);

    const manager = new BrowserModeManager({
      autoSwitchHeadless: false,
      autoDetectCaptcha: true,
      defaultHeadless: true,
    });

    const page = {} as unknown as Page;
    await manager.checkAndHandleCaptcha(page, 'https://vmoranv.github.io/jshookmcp');
    expect(waitForCompletionMock).toHaveBeenCalledOnce();
  });

  it('does not auto-act when assessment recommends AI review', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      newPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;
    const deferred = createDeferred<Browser>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    findBrowserExecutableMock.mockReturnValue('/detected/browser-bin');

    const deferred = createDeferred<Browser>();
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      process: vi.fn().mockReturnValue({ pid: 12345 }),
    } as unknown as Browser;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
});

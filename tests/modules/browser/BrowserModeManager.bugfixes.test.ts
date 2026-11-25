import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'rebrowser-puppeteer-core';
import { TEST_URLS } from '@tests/shared/test-urls';

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
  findBrowserExecutableAsync: findBrowserExecutableMock,
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

function createPage(url = 'about:blank') {
  return {
    goto: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    setCookie: vi.fn(async () => undefined),
    cookies: vi.fn(async () => []),
    url: vi.fn(() => url),
    evaluate: vi.fn(async () => ({
      local: {},
      session: {},
      userAgent: 'TestAgent',
      platform: 'Win32',
      acceptLanguage: 'en-US',
    })),
    evaluateOnNewDocument: vi.fn(async () => undefined),
  } as unknown as Page;
}

describe('BrowserModeManager mode-switch reference handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBrowserExecutableMock.mockResolvedValue('/detected/chrome');
    assessMock.mockResolvedValue({
      candidates: [],
      primaryDetection: { type: 'slider', confidence: 90 },
    });
    waitForCompletionMock.mockResolvedValue(true);
  });

  it('goto() returns the live page after switching to headed mode', async () => {
    const oldPage = createPage();
    const newPage = createPage();
    const oldBrowser = {
      newPage: vi.fn(async () => oldPage),
      close: vi.fn(async () => {}),
      connected: true,
      process: vi.fn(() => ({ pid: 111 })),
    } as unknown as Browser;
    const newBrowser = {
      newPage: vi.fn(async () => newPage),
      close: vi.fn(async () => {}),
      connected: true,
      process: vi.fn(() => ({ pid: 222 })),
    } as unknown as Browser;
    launchMock.mockResolvedValueOnce(oldBrowser).mockResolvedValueOnce(newBrowser);
    determineCaptchaResolutionMock.mockReturnValue({
      action: 'switch_to_headed',
      reason: 'captcha detected',
    });

    const manager = new BrowserModeManager({ autoDetectCaptcha: true });
    const initialPage = await manager.newPage();

    const returned = await manager.goto(TEST_URLS.root, initialPage);

    // The CAPTCHA path closed the old browser and created a new page; returning
    // the original reference would hand the caller a detached page.
    expect(returned).toBe(newPage);
    expect(manager.getCurrentPage()).toBe(newPage);
    expect(manager.isHeadlessMode()).toBe(false);
  });

  it('goto() returns the given page when no mode switch happens', async () => {
    const page = createPage(TEST_URLS.root);
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => {}),
      connected: true,
      process: vi.fn(() => ({ pid: 333 })),
    } as unknown as Browser;
    launchMock.mockResolvedValue(browser);
    determineCaptchaResolutionMock.mockReturnValue({ action: 'observe', reason: 'low confidence' });

    const manager = new BrowserModeManager({ autoDetectCaptcha: true });
    const initialPage = await manager.newPage();

    await expect(manager.goto(TEST_URLS.root, initialPage)).resolves.toBe(initialPage);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });
});

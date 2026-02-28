import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../src/utils/browserExecutable.js', () => ({
  findBrowserExecutable: (...args: any[]) => findBrowserExecutableMock(...args),
}));

vi.mock('../../../src/modules/captcha/CaptchaDetector.js', () => ({
  CaptchaDetector: class {
    detect = detectMock;
    waitForCompletion = waitForCompletionMock;
  },
}));

import { BrowserModeManager } from '../../../src/modules/browser/BrowserModeManager.js';

describe('BrowserModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves configured executable path when file exists', () => {
    existsSyncMock.mockReturnValue(true);
    const manager = new BrowserModeManager({}, { executablePath: '/my/chrome' as any });
    const path = (manager as any).resolveExecutablePath();
    expect(path).toBe('/my/chrome');
  });

  it('throws when configured executable path does not exist', () => {
    existsSyncMock.mockReturnValue(false);
    const manager = new BrowserModeManager({}, { executablePath: '/missing/chrome' as any });
    expect(() => (manager as any).resolveExecutablePath()).toThrow(/not found/i);
  });

  it('uses detected executable path when not explicitly configured', () => {
    findBrowserExecutableMock.mockReturnValue('/detected/chrome');
    const manager = new BrowserModeManager();
    const path = (manager as any).resolveExecutablePath();
    expect(path).toBe('/detected/chrome');
  });

  it('launches browser with hardened args', async () => {
    findBrowserExecutableMock.mockReturnValue('/detected/chrome');
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
    expect(options.executablePath).toBe('/detected/chrome');
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
      vendor: 'test',
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
});


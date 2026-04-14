import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'rebrowser-puppeteer-core';
import type { PuppeteerConfig, CodeFile } from '@internal-types/index';

const launchMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const connectPlaywrightCdpFallbackMock = vi.hoisted(() => vi.fn());
const findBrowserExecutableMock = vi.hoisted(() => vi.fn());

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: launchMock,
    connect: connectMock,
  },
  launch: launchMock,
  connect: connectMock,
}));

vi.mock('@src/utils/browserExecutable', () => ({
  findBrowserExecutable: findBrowserExecutableMock,
}));

vi.mock('@modules/collector/playwright-cdp-fallback', () => ({
  connectPlaywrightCdpFallback: connectPlaywrightCdpFallbackMock,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CodeCollector } from '@modules/collector/CodeCollector';

class TestCodeCollector extends CodeCollector {
  public getCollectedFilesCache(): Map<string, CodeFile> {
    return this.collectedFilesCache;
  }
}

interface BrowserMock extends Browser {
  on: any;
  pages: any;
  targets: any;
  newPage: any;
  close: any;
  disconnect: any;
  version: any;
  process: any;
}

function createBrowserMock(): BrowserMock {
  return {
    on: vi.fn(),
    pages: vi.fn().mockResolvedValue([]),
    targets: vi.fn().mockReturnValue([]),
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    version: vi.fn().mockResolvedValue('Chrome/123'),
    process: vi.fn().mockReturnValue({ pid: 12345 }),
  } as unknown as BrowserMock;
}

const defaultConfig: PuppeteerConfig = { headless: true, timeout: 1000 };

describe('CodeCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBrowserExecutableMock.mockReturnValue(undefined);
  });

  it('initializes browser and reports running status', async () => {
    const browser = createBrowserMock();
    launchMock.mockResolvedValue(browser);

    const collector = new CodeCollector(defaultConfig);
    await collector.init();

    expect(launchMock).toHaveBeenCalledTimes(1);
    await expect(collector.getStatus()).resolves.toMatchObject({
      running: true,
      pagesCount: 0,
      effectiveHeadless: true,
    });
  });

  it('throws when configured executablePath does not exist', async () => {
    const collector = new CodeCollector({
      ...defaultConfig,
      executablePath: 'C:\\definitely-not-existing\\browser.exe',
    });

    await expect(collector.init()).rejects.toThrow('Configured browser executable was not found');
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('does not auto-relaunch after an explicit close until init is called again', async () => {
    const browser = createBrowserMock();
    const relaunchedBrowser = createBrowserMock();
    launchMock.mockResolvedValueOnce(browser).mockResolvedValueOnce(relaunchedBrowser);

    const collector = new CodeCollector(defaultConfig);
    await collector.init();
    await collector.close();

    await expect(collector.getActivePage()).rejects.toThrow(
      'Browser was explicitly closed. Call browser_launch or browser_attach first.',
    );
    expect(launchMock).toHaveBeenCalledTimes(1);

    await collector.init();
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to Playwright CDP compatibility mode when rebrowser attach fails', async () => {
    const fallbackBrowser = createBrowserMock();
    connectMock.mockRejectedValue(new Error('Target closed during CDP handshake'));
    connectPlaywrightCdpFallbackMock.mockResolvedValue(fallbackBrowser);

    const collector = new CodeCollector(defaultConfig);
    await collector.connect('http://127.0.0.1:9222');

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectPlaywrightCdpFallbackMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9222',
      expect.any(Number),
    );
    await expect(collector.getStatus()).resolves.toMatchObject({
      running: true,
      pagesCount: 0,
    });
  });

  it('filters URLs against wildcard rules', () => {
    const collector = new CodeCollector(defaultConfig);

    expect(
      collector.shouldCollectUrl('https://vmoranv.github.io/jshookmcp/app.js', [
        '*vmoranv.github.io/jshookmcp/*',
      ]),
    ).toBe(true);
    expect(
      collector.shouldCollectUrl('https://cdn.other.com/lib.js', [
        '*vmoranv.github.io/jshookmcp/*',
      ]),
    ).toBe(false);
  });

  it('retries navigation until success', async () => {
    const collector = new CodeCollector(defaultConfig);
    const page = {
      goto: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined),
    } as unknown as Page;

    await expect(
      collector.navigateWithRetry(
        page,
        'https://vmoranv.github.io/jshookmcp',
        { waitUntil: 'load' },
        3,
      ),
    ).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('throws last navigation error after max retries', async () => {
    const collector = new CodeCollector(defaultConfig);
    const page = { goto: vi.fn().mockRejectedValue(new Error('fatal')) } as unknown as Page;

    await expect(
      collector.navigateWithRetry(
        page,
        'https://vmoranv.github.io/jshookmcp',
        { waitUntil: 'load' },
        2,
      ),
    ).rejects.toThrow('fatal');
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('returns pattern-matched files with size limits and truncation flag', () => {
    const collector = new TestCodeCollector(defaultConfig);
    collector.getCollectedFilesCache().set('https://site/a.js', {
      url: 'https://site/a.js',
      content: 'a'.repeat(10),
      size: 10,
      type: 'external',
    });
    collector.getCollectedFilesCache().set('https://site/b.js', {
      url: 'https://site/b.js',
      content: 'b'.repeat(10),
      size: 10,
      type: 'external',
    });
    collector.getCollectedFilesCache().set('https://site/c.css', {
      url: 'https://site/c.css',
      content: 'c',
      size: 1,
      type: 'external',
    });

    const result = collector.getFilesByPattern('\\.js$', 3, 15);
    expect(result.matched).toBe(2);
    expect(result.returned).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.totalSize).toBe(10);
  });

  it('returns top priority files ordered by scoring helper', () => {
    const collector = new TestCodeCollector(defaultConfig);
    collector.getCollectedFilesCache().set('https://site/vendor.js', {
      url: 'https://site/vendor.js',
      content: 'noop',
      size: 2000,
      type: 'external',
    });
    collector.getCollectedFilesCache().set('https://site/crypto-api-main.js', {
      url: 'https://site/crypto-api-main.js',
      content: 'fetch("/x"); const cipher = "aes";',
      size: 800,
      type: 'inline',
    });

    const result = collector.getTopPriorityFiles(1, 100_000);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.url).toContain('crypto-api-main.js');
  });
});

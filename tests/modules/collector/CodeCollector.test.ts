import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'rebrowser-puppeteer-core';
import type { PuppeteerConfig, CodeFile } from '@internal-types/index';
import * as testUrls from '@tests/shared/test-urls';

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
  findBrowserExecutableAsync: findBrowserExecutableMock,
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
import {
  buildTestUrl,
  E2E_DEFAULT_TARGET_GLOB,
  E2E_DEFAULT_TARGET_URL,
  TEST_URLS,
} from '@tests/shared/test-urls';

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
    connected: true,
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
    findBrowserExecutableMock.mockResolvedValue(undefined);
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

  it('coalesces ten concurrent Chrome auto-connect requests into one approval', async () => {
    const browser = createBrowserMock();
    connectMock.mockResolvedValue(browser);

    const userDataDir = await mkdtemp(join(tmpdir(), 'jshookmcp-code-collector-'));
    try {
      await writeFile(
        join(userDataDir, 'DevToolsActivePort'),
        '9222\n/devtools/browser/test-browser\n',
      );

      const collector = new CodeCollector(defaultConfig);
      await Promise.all(
        Array.from({ length: 10 }, async () => await collector.connect({ userDataDir })),
      );

      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(browser.disconnect).not.toHaveBeenCalled();
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  });

  it('isolates collected file indexes across ten MCP sessions', () => {
    const collector = new TestCodeCollector(defaultConfig);
    const current = { sessionId: 'default' };
    collector.setSessionIdResolver(() => current.sessionId);
    const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index}`);

    for (const [index, sessionId] of sessionIds.entries()) {
      current.sessionId = sessionId;
      const url = `${testUrls.TEST_URLS.root}/session-${index}.js`;
      collector.getCollectedFilesCache().set(url, {
        url,
        content: `const owner = ${index};`,
        size: 16,
        type: 'external',
      });
    }

    for (const [index, sessionId] of sessionIds.entries()) {
      current.sessionId = sessionId;
      expect(collector.getCollectedFilesSummary()).toEqual([
        expect.objectContaining({ url: `${testUrls.TEST_URLS.root}/session-${index}.js` }),
      ]);
    }
    expect(collector.dropSessionState('session-4')).toBe(true);
    current.sessionId = 'session-4';
    expect(collector.getCollectedFilesSummary()).toEqual([]);
  });

  it('prunes the files cache in lockstep with collected URLs when the cap is exceeded', () => {
    const collector = new TestCodeCollector({ ...defaultConfig, maxCollectedUrls: 4 });
    const urls = Array.from({ length: 10 }, (_, i) => `${testUrls.TEST_URLS.root}/prune-${i}.js`);
    (collector as any).collectedUrls = new Set(urls);
    for (const url of urls) {
      collector.getCollectedFilesCache().set(url, {
        url,
        content: 'x',
        size: 1,
        type: 'external',
      });
    }

    collector.cleanupCollectedUrls();

    // cleanupCollectedUrls keeps the last floor(4/2)=2 URLs; the files cache
    // must shrink to the same retained set instead of growing unbounded (b1-05).
    expect((collector as any).collectedUrls.size).toBe(2);
    expect(collector.getCollectedFilesCache().size).toBe(2);
    expect(collector.getCollectedFilesCache().has(urls[8]!)).toBe(true);
    expect(collector.getCollectedFilesCache().has(urls[9]!)).toBe(true);
    expect(collector.getCollectedFilesCache().has(urls[0]!)).toBe(false);
  });

  it('filters URLs against wildcard rules', () => {
    const collector = new CodeCollector(defaultConfig);

    expect(
      collector.shouldCollectUrl(E2E_DEFAULT_TARGET_URL + 'app.js', [E2E_DEFAULT_TARGET_GLOB]),
    ).toBe(true);
    expect(
      collector.shouldCollectUrl(buildTestUrl('cdn.other', { path: 'lib.js' }), [
        E2E_DEFAULT_TARGET_GLOB,
        E2E_DEFAULT_TARGET_URL,
      ]),
    ).toBe(false);
  });

  it('retries navigation until success', async () => {
    const collector = new CodeCollector(defaultConfig);
    const page = {
      goto: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined),
    } as unknown as Page;

    await expect(
      collector.navigateWithRetry(page, TEST_URLS.root, { waitUntil: 'load' }, 3),
    ).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('throws last navigation error after max retries', async () => {
    const collector = new CodeCollector(defaultConfig);
    const page = { goto: vi.fn().mockRejectedValue(new Error('fatal')) } as unknown as Page;

    await expect(
      collector.navigateWithRetry(page, TEST_URLS.root, { waitUntil: 'load' }, 2),
    ).rejects.toThrow('fatal');
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('returns pattern-matched files with size limits and truncation flag', () => {
    const collector = new TestCodeCollector(defaultConfig);
    collector.getCollectedFilesCache().set(`${testUrls.TEST_URLS.root}/a.js`, {
      url: `${testUrls.TEST_URLS.root}/a.js`,
      content: 'a'.repeat(10),
      size: 10,
      type: 'external',
    });
    collector.getCollectedFilesCache().set(`${testUrls.TEST_URLS.root}/b.js`, {
      url: `${testUrls.TEST_URLS.root}/b.js`,
      content: 'b'.repeat(10),
      size: 10,
      type: 'external',
    });
    collector.getCollectedFilesCache().set(`${testUrls.TEST_URLS.root}/c.css`, {
      url: `${testUrls.TEST_URLS.root}/c.css`,
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
    collector.getCollectedFilesCache().set(`${testUrls.TEST_URLS.root}/vendor.js`, {
      url: `${testUrls.TEST_URLS.root}/vendor.js`,
      content: 'noop',
      size: 2000,
      type: 'external',
    });
    collector.getCollectedFilesCache().set(`${testUrls.TEST_URLS.root}/crypto-api-main.js`, {
      url: `${testUrls.TEST_URLS.root}/crypto-api-main.js`,
      content: 'fetch("/x"); const cipher = "aes";',
      size: 800,
      type: 'inline',
    });

    const result = collector.getTopPriorityFiles(1, 100_000);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.url).toContain('crypto-api-main.js');
  });
});

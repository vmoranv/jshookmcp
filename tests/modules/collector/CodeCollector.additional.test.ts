import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuppeteerConfig, CodeFile } from '@internal-types/index';
import { CodeCollector } from '@modules/collector/CodeCollector';

class TestCodeCollector extends CodeCollector {
  public getProtectedCollectedUrls() {
    return this.collectedUrls;
  }
  public getProtectedCollectedFilesCache() {
    return this.collectedFilesCache;
  }
  public setProtectedCollectedFilesCache(files: Map<string, CodeFile>) {
    this.collectedFilesCache = files;
  }
  public getProtectedMaxCollectedUrls() {
    return this.MAX_COLLECTED_URLS;
  }
  public getProtectedMaxFilesPerCollect() {
    return this.MAX_FILES_PER_COLLECT;
  }
  public getProtectedMaxResponseSize() {
    return this.MAX_RESPONSE_SIZE;
  }
  public getProtectedMaxSingleFileSize() {
    return this.MAX_SINGLE_FILE_SIZE;
  }
  public getProtectedViewport() {
    return this.viewport;
  }
  public getProtectedUserAgent() {
    return this.userAgent;
  }
}

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  connectPlaywrightCdpFallback: vi.fn(),
  findBrowserExecutable: vi.fn(),
  collectInnerImpl: vi.fn(),
  shouldCollectUrlImpl: vi.fn(),
  navigateWithRetryImpl: vi.fn(),
  getPerformanceMetricsImpl: vi.fn(),
  collectPageMetadataImpl: vi.fn(),
  calculatePriorityScore: vi.fn(),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: mocks.launch,
    connect: mocks.connect,
  },
  launch: mocks.launch,
  connect: mocks.connect,
}));

vi.mock('@utils/browserExecutable', () => ({
  findBrowserExecutable: mocks.findBrowserExecutable,
}));

vi.mock('@modules/collector/playwright-cdp-fallback', () => ({
  connectPlaywrightCdpFallback: mocks.connectPlaywrightCdpFallback,
}));

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@modules/collector/CodeCollectorCollectInternal', () => ({
  collectInnerImpl: mocks.collectInnerImpl,
}));

vi.mock('@modules/collector/CodeCollectorUtilsInternal', () => ({
  shouldCollectUrlImpl: mocks.shouldCollectUrlImpl,
  navigateWithRetryImpl: mocks.navigateWithRetryImpl,
  getPerformanceMetricsImpl: mocks.getPerformanceMetricsImpl,
  collectPageMetadataImpl: mocks.collectPageMetadataImpl,
}));

vi.mock('@modules/collector/PageScriptCollectors', () => ({
  calculatePriorityScore: mocks.calculatePriorityScore,
}));

function createBrowserMock() {
  return {
    on: vi.fn(),
    pages: vi.fn().mockResolvedValue([]),
    targets: vi.fn().mockReturnValue([]),
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    version: vi.fn().mockResolvedValue('Chrome/123'),
    process: vi.fn().mockReturnValue({ pid: 12345 }),
  } as any;
}

function createTargetMock(url = 'https://example.com', type = 'page', page = createPageMock(url)) {
  return {
    type: vi.fn().mockReturnValue(type),
    url: vi.fn().mockReturnValue(url),
    page: vi.fn().mockResolvedValue(page),
  } as any;
}

function createPageMock(url = 'https://example.com') {
  return {
    url: vi.fn().mockReturnValue(url),
    title: vi.fn().mockResolvedValue('Example'),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn(),
  } as any;
}

describe('CodeCollector – additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBrowserExecutable.mockReturnValue(undefined);
    mocks.connectPlaywrightCdpFallback.mockRejectedValue(new Error('fallback unavailable'));
  });

  // ── constructor defaults ───────────────────────────────────────────
  describe('constructor', () => {
    it('applies custom config limits', () => {
      const config: PuppeteerConfig = {
        headless: true,
        timeout: 5000,
        maxCollectedUrls: 500,
        maxFilesPerCollect: 50,
        maxTotalContentSize: 1024,
        maxSingleFileSize: 512,
        viewport: { width: 800, height: 600 },
        userAgent: 'TestBot/1.0',
      };
      const collector = new TestCodeCollector(config);

      expect(collector.getProtectedMaxCollectedUrls()).toBe(500);
      expect(collector.getProtectedMaxFilesPerCollect()).toBe(50);
      expect(collector.getProtectedMaxResponseSize()).toBe(1024);
      expect(collector.getProtectedMaxSingleFileSize()).toBe(512);
      expect(collector.getProtectedViewport()).toEqual({ width: 800, height: 600 });
      expect(collector.getProtectedUserAgent()).toBe('TestBot/1.0');
    });

    it('uses sensible defaults when config omits optional fields', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

      expect(collector.getProtectedMaxCollectedUrls()).toBe(10000);
      expect(collector.getProtectedMaxFilesPerCollect()).toBe(200);
      expect(collector.getProtectedViewport()).toEqual({ width: 1920, height: 1080 });
    });
  });

  // ── cache management ──────────────────────────────────────────────
  describe('cache management', () => {
    it('setCacheEnabled toggles the flag', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

      collector.setCacheEnabled(false);
      expect(collector.cacheEnabled).toBe(false);

      collector.setCacheEnabled(true);
      expect(collector.cacheEnabled).toBe(true);
    });

    it('clearCache resets collected URLs', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.getProtectedCollectedUrls().add('https://site.com/a.js');

      collector.clearCache();
      expect(collector.getCollectionStats().totalCollected).toBe(0);
    });

    it('clearCollectedFilesCache empties the files map', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector
        .getProtectedCollectedFilesCache()
        .set('url1', { url: 'url1', size: 10, content: '', type: 'external' });

      collector.clearCollectedFilesCache();
      expect(collector.getCollectedFilesSummary()).toHaveLength(0);
    });
  });

  // ── cleanupCollectedUrls ──────────────────────────────────────────
  describe('cleanupCollectedUrls', () => {
    it('trims URLs when exceeding MAX_COLLECTED_URLS', () => {
      const collector = new TestCodeCollector({
        headless: true,
        timeout: 1000,
        maxCollectedUrls: 4,
      } as PuppeteerConfig);

      const urls = collector.getProtectedCollectedUrls();
      for (let i = 0; i < 5; i++) {
        urls.add(`https://site.com/${i}.js`);
      }

      collector.cleanupCollectedUrls();
      // Should keep last half of MAX (4/2 = 2)
      expect(urls.size).toBe(2);
    });

    it('does nothing when URLs are under the limit', () => {
      const collector = new TestCodeCollector({
        headless: true,
        timeout: 1000,
        maxCollectedUrls: 100,
      } as PuppeteerConfig);

      collector.getProtectedCollectedUrls().add('https://site.com/a.js');
      collector.cleanupCollectedUrls();
      expect(collector.getCollectionStats().totalCollected).toBe(1);
    });
  });

  // ── init deduplication ─────────────────────────────────────────────
  describe('init', () => {
    it('does not launch twice when browser is already set', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();
      await collector.init();

      expect(mocks.launch).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent init calls', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const [r1, r2] = await Promise.all([collector.init(), collector.init()]);

      expect(r1).toBeUndefined();
      expect(r2).toBeUndefined();
      expect(mocks.launch).toHaveBeenCalledTimes(1);
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────
  describe('getStatus', () => {
    it('returns not running when no browser', async () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const status = await collector.getStatus();

      expect(status.running).toBe(false);
      expect(status.pagesCount).toBe(0);
    });

    it('returns running with page count when browser exists', async () => {
      const browser = createBrowserMock() as any;
      browser.targets.mockReturnValue([createTargetMock(), createTargetMock('https://site.com/2')]);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      const status = await collector.getStatus();
      expect(status.running).toBe(true);
      expect(status.pagesCount).toBe(2);
      expect(status.version).toBe('Chrome/123');
    });

    it('returns not running when browser throws', async () => {
      const browser = createBrowserMock() as any;
      browser.version.mockRejectedValue(new Error('disconnected'));
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      const status = await collector.getStatus();
      expect(status.running).toBe(false);
    });
  });

  // ── getActivePage ─────────────────────────────────────────────────
  describe('getActivePage', () => {
    it('returns the last page when no active index is set', async () => {
      const page1 = createPageMock('https://site.com/1');
      const page2 = createPageMock('https://site.com/2');
      const browser = createBrowserMock() as any;
      browser.targets.mockReturnValue([
        createTargetMock('https://site.com/1', 'page', page1),
        createTargetMock('https://site.com/2', 'page', page2),
      ]);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      const active = await collector.getActivePage();
      expect(active).toBe(page2);
    });

    it('returns the selected page when activePageIndex is set', async () => {
      const page1 = createPageMock('https://site.com/1');
      const page2 = createPageMock('https://site.com/2');
      const browser = createBrowserMock() as any;
      browser.targets.mockReturnValue([
        createTargetMock('https://site.com/1', 'page', page1),
        createTargetMock('https://site.com/2', 'page', page2),
      ]);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();
      await collector.selectPage(0);

      const active = await collector.getActivePage();
      expect(active).toBe(page1);
    });

    it('creates a new page when pages array is empty', async () => {
      const newPage = createPageMock();
      const browser = createBrowserMock() as any;
      browser.targets.mockReturnValue([]);
      browser.newPage.mockResolvedValue(newPage);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      const active = await collector.getActivePage();
      expect(active).toBe(newPage);
    });
  });

  // ── selectPage ────────────────────────────────────────────────────
  describe('selectPage', () => {
    it('throws when browser is not connected', async () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await expect(collector.selectPage(0)).rejects.toThrow('Browser not connected');
    });

    it('throws on out-of-range index', async () => {
      const browser = createBrowserMock() as any;
      browser.targets.mockReturnValue([createTargetMock()]);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      await expect(collector.selectPage(5)).rejects.toThrow('out of range');
    });
  });

  // ── listPages ─────────────────────────────────────────────────────
  describe('listPages', () => {
    it('returns empty when no browser', async () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const pages = await collector.listPages();
      expect(pages).toEqual([]);
    });

    it('returns page metadata', async () => {
      const target = createTargetMock('https://example.com');
      const browser = createBrowserMock();
      browser.targets.mockReturnValue([target]);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      const pages = await collector.listPages();
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        index: 0,
        url: 'https://example.com',
        title: '',
      });
    });
  });

  // ── createPage ────────────────────────────────────────────────────
  describe('createPage', () => {
    it('creates a page without navigating when no URL provided', async () => {
      const page = createPageMock();
      const browser = createBrowserMock();
      browser.newPage.mockResolvedValue(page);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 5000 } as PuppeteerConfig);
      await collector.init();

      const newPage = await collector.createPage();
      expect(newPage).toBe(page);
      expect(page.setUserAgent).toHaveBeenCalled();
      expect(page.goto).not.toHaveBeenCalled();
    });

    it('creates a page and navigates when URL is provided', async () => {
      const page = createPageMock();
      const browser = createBrowserMock();
      browser.newPage.mockResolvedValue(page);
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 5000 } as PuppeteerConfig);
      await collector.init();

      await collector.createPage('https://target.com');
      expect(page.goto).toHaveBeenCalledWith('https://target.com', expect.any(Object));
    });
  });

  // ── connect ───────────────────────────────────────────────────────
  describe('connect', () => {
    it('connects via WebSocket endpoint', async () => {
      const browser = createBrowserMock();
      mocks.connect.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.connect('ws://127.0.0.1:9222');

      expect(mocks.connect).toHaveBeenCalledWith({
        browserWSEndpoint: 'ws://127.0.0.1:9222',
        defaultViewport: null,
      });
    });

    it('connects via HTTP URL endpoint', async () => {
      const browser = createBrowserMock();
      mocks.connect.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.connect('http://127.0.0.1:9222');

      expect(mocks.connect).toHaveBeenCalledWith({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null,
      });
    });

    it('disconnects existing browser before connecting', async () => {
      const oldBrowser = createBrowserMock();
      const newBrowser = createBrowserMock();
      mocks.launch.mockResolvedValue(oldBrowser);
      mocks.connect.mockResolvedValue(newBrowser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();
      await collector.connect('ws://127.0.0.1:9222');

      expect(oldBrowser.disconnect).toHaveBeenCalled();
    });

    it('fails fast when connect handshake never completes', async () => {
      mocks.connect.mockImplementation(() => new Promise(() => {}));

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      (collector as any).CONNECT_TIMEOUT_MS = 10;
      const connectPromise = collector.connect({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
        autoConnect: true,
        channel: 'stable',
      });

      await expect(connectPromise).rejects.toThrow(
        /Timed out after 10ms while connecting to existing browser/,
      );
    });

    it('honors the configured timeout for local debug endpoints', async () => {
      vi.useFakeTimers();
      mocks.connect.mockImplementation(() => new Promise(() => {}));

      try {
        const collector = new TestCodeCollector({
          headless: true,
          timeout: 1000,
        } as PuppeteerConfig);
        (collector as any).CONNECT_TIMEOUT_MS = 6001;

        let settled = false;
        const connectPromise = collector.connect({
          wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
          autoConnect: true,
          channel: 'stable',
        });
        void connectPromise.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        const rejection = expect(connectPromise).rejects.toThrow(
          /Timed out after 6001ms while connecting to existing browser/,
        );

        await vi.advanceTimersByTimeAsync(5000);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await rejection;
      } finally {
        vi.useRealTimers();
      }
    });

    it('disconnects stale browser if connect resolves after timeout', async () => {
      let resolveConnect!: (browser: any) => void;
      mocks.connect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          }),
      );

      const browser = createBrowserMock();
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      (collector as any).CONNECT_TIMEOUT_MS = 10;
      const connectPromise = collector.connect({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
        autoConnect: true,
        channel: 'stable',
      });

      await expect(connectPromise).rejects.toThrow(/Timed out after 10ms/);

      resolveConnect(browser);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(browser.disconnect).toHaveBeenCalled();
      expect(collector.getBrowser()).toBeNull();
    });

    it('normalizes non-Error connect failures for autoConnect', async () => {
      mocks.connect.mockRejectedValue({
        message: 'connect ECONNREFUSED 127.0.0.1:9222',
      });

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

      await expect(
        collector.connect({
          wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
          autoConnect: true,
          channel: 'stable',
        }),
      ).rejects.toThrow(/DevToolsActivePort may be stale/);
    });
  });

  // ── close ─────────────────────────────────────────────────────────
  describe('close', () => {
    it('closes browser and clears data', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();
      await collector.close();

      expect(browser.close).toHaveBeenCalled();
      expect(collector.getBrowser()).toBeNull();
    });

    it('disconnects instead of closing when attached to an existing browser', async () => {
      const browser = createBrowserMock();
      mocks.connect.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.connect('ws://127.0.0.1:9222/devtools/browser/test');
      await collector.close();

      expect(browser.disconnect).toHaveBeenCalled();
      expect(browser.close).not.toHaveBeenCalled();
    });
  });

  // ── getCollectionStats / getBrowser ────────────────────────────────
  describe('getCollectionStats', () => {
    it('returns zero counts initially', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const stats = collector.getCollectionStats();
      expect(stats.totalCollected).toBe(0);
      expect(stats.uniqueUrls).toBe(0);
    });
  });

  // ── getFileByUrl ──────────────────────────────────────────────────
  describe('getFileByUrl', () => {
    it('returns a cached file by URL', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const file = {
        url: 'https://site.com/a.js',
        size: 100,
        content: 'abc',
        type: 'external' as const,
      };
      collector.getProtectedCollectedFilesCache().set('https://site.com/a.js', file);

      expect(collector.getFileByUrl('https://site.com/a.js')).toBe(file);
    });

    it('returns null for unknown URL', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      expect(collector.getFileByUrl('https://site.com/nonexistent.js')).toBeNull();
    });
  });

  // ── getCollectedFilesSummary ──────────────────────────────────────
  describe('getCollectedFilesSummary', () => {
    it('includes truncated and originalSize metadata when present', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.getProtectedCollectedFilesCache().set('url1', {
        url: 'url1',
        size: 50,
        content: '',
        type: 'external' as const,
        metadata: { truncated: true, originalSize: 500 },
      });

      const summary = collector.getCollectedFilesSummary();
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatchObject({
        url: 'url1',
        truncated: true,
        originalSize: 500,
      });
    });

    it('returns undefined for truncated/originalSize when metadata is absent', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.getProtectedCollectedFilesCache().set('url2', {
        url: 'url2',
        size: 30,
        content: '',
        type: 'inline' as const,
      });

      const summary = collector.getCollectedFilesSummary();
      expect(summary[0]?.truncated).toBeUndefined();
      expect(summary[0]?.originalSize).toBeUndefined();
    });
  });

  // ── getFilesByPattern ─────────────────────────────────────────────
  describe('getFilesByPattern', () => {
    it('returns all matching files within limits', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.setProtectedCollectedFilesCache(
        new Map([
          [
            'https://site/a.js',
            { url: 'https://site/a.js', content: 'a', size: 5, type: 'external' },
          ],
          [
            'https://site/b.js',
            { url: 'https://site/b.js', content: 'b', size: 5, type: 'external' },
          ],
        ]),
      );

      const result = collector.getFilesByPattern('\\.js$', 10, 100_000);
      expect(result.matched).toBe(2);
      expect(result.returned).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it('limits returned files to count limit even when more match', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.setProtectedCollectedFilesCache(
        new Map([
          [
            'https://site/a.js',
            { url: 'https://site/a.js', content: 'a', size: 1, type: 'external' },
          ],
          [
            'https://site/b.js',
            { url: 'https://site/b.js', content: 'b', size: 1, type: 'external' },
          ],
          [
            'https://site/c.js',
            { url: 'https://site/c.js', content: 'c', size: 1, type: 'external' },
          ],
        ]),
      );

      const result = collector.getFilesByPattern('\\.js$', 2, 100_000);
      expect(result.matched).toBe(3);
      expect(result.returned).toBe(2);
    });

    it('sets truncated true when size limit prevents all files from being returned', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.setProtectedCollectedFilesCache(
        new Map([
          [
            'https://site/a.js',
            { url: 'https://site/a.js', content: 'a'.repeat(10), size: 10, type: 'external' },
          ],
          [
            'https://site/b.js',
            { url: 'https://site/b.js', content: 'b'.repeat(10), size: 10, type: 'external' },
          ],
        ]),
      );

      const result = collector.getFilesByPattern('\\.js$', 10, 15);
      expect(result.returned).toBe(1);
      expect(result.truncated).toBe(true);
    });
  });

  // ── getTopPriorityFiles ──────────────────────────────────────────
  describe('getTopPriorityFiles', () => {
    it('returns empty when cache is empty', () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const result = collector.getTopPriorityFiles(5, 100_000);
      expect(result.files).toHaveLength(0);
      expect(result.totalFiles).toBe(0);
    });

    it('respects max total size constraint', () => {
      mocks.calculatePriorityScore.mockReturnValue(10);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      collector.setProtectedCollectedFilesCache(
        new Map([
          ['u1', { url: 'u1', content: 'x'.repeat(100), size: 100, type: 'external' } as CodeFile],
          ['u2', { url: 'u2', content: 'y'.repeat(100), size: 100, type: 'external' } as CodeFile],
        ]),
      );

      const result = collector.getTopPriorityFiles(10, 150);
      expect(result.files).toHaveLength(1);
      expect(result.totalSize).toBe(100);
    });
  });

  // ── getAllStats ─────────────────────────────────────────────────────
  describe('getAllStats', () => {
    it('aggregates cache, compression, and collector stats', async () => {
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      const stats = await collector.getAllStats();

      expect(stats).toHaveProperty('cache');
      expect(stats).toHaveProperty('compression');
      expect(stats).toHaveProperty('collector');
      expect(stats.collector.collectedUrls).toBe(0);
    });
  });

  // ── delegation methods ─────────────────────────────────────────────
  describe('delegation methods', () => {
    it('shouldCollectUrl delegates to implementation', () => {
      mocks.shouldCollectUrlImpl.mockReturnValue(true);
      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

      const result = collector.shouldCollectUrl('https://example.com/script.js');
      expect(result).toBe(true);
      expect(mocks.shouldCollectUrlImpl).toHaveBeenCalledWith(
        'https://example.com/script.js',
        undefined,
      );
    });

    it('collect serializes concurrent calls', async () => {
      mocks.collectInnerImpl.mockResolvedValue({ files: [], totalSize: 0 });
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new TestCodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);
      await collector.init();

      const results = await Promise.all([
        collector.collect({ url: 'https://a.com' } as any),
        collector.collect({ url: 'https://b.com' } as any),
      ]);

      expect(results).toHaveLength(2);
      expect(mocks.collectInnerImpl).toHaveBeenCalledTimes(2);
    });
  });
});

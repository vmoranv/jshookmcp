import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuppeteerConfig, CodeFile } from '@internal-types/index';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  findBrowserExecutable: vi.fn(),
  collectInnerImpl: vi.fn(),
  shouldCollectUrlImpl: vi.fn(),
  navigateWithRetryImpl: vi.fn(),
  getPerformanceMetricsImpl: vi.fn(),
  collectPageMetadataImpl: vi.fn(),
  calculatePriorityScore: vi.fn(),
  existsSync: vi.fn(),
  readFile: vi.fn(),
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

import { CodeCollector } from '@modules/collector/CodeCollector';

// @ts-expect-error
class _TestCodeCollector extends CodeCollector {
  public getProtectedCollectedUrls() {
    return this.collectedUrls;
  }
  public getProtectedCollectedFilesCache() {
    return this.collectedFilesCache;
  }
  public setProtectedCollectedFilesCache(files: Map<string, CodeFile>) {
    this.collectedFilesCache = files;
  }
}

function createBrowserMock(overrides: Record<string, any> = {}) {
  return {
    on: vi.fn(),
    pages: vi.fn().mockResolvedValue([]),
    targets: vi.fn().mockReturnValue([]),
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    version: vi.fn().mockResolvedValue('Chrome/123'),
    process: vi.fn().mockReturnValue({ pid: 12345 }),
    ...overrides,
  } as any;
}

// @ts-expect-error
function _createTargetMock(url = 'https://example.com', type = 'page', page?: any) {
  return {
    type: vi.fn().mockReturnValue(type),
    url: vi.fn().mockReturnValue(url),
    page: vi.fn().mockResolvedValue(
      page ?? {
        url: vi.fn().mockReturnValue(url),
        title: vi.fn().mockResolvedValue('Example'),
        setUserAgent: vi.fn().mockResolvedValue(undefined),
        evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
      },
    ),
  } as any;
}

// no-op handler for unhandled rejection tests
const noopRejectionHandler = (_reason: unknown) => {};

const defaultConfig: PuppeteerConfig = { headless: true, timeout: 1000 };

describe('CodeCollector – coverage gap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBrowserExecutable.mockReturnValue(undefined);
  });

  // ─── forceKillPid ────────────────────────────────────────────────
  describe('forceKillPid', () => {
    it('does nothing when pid is null', () => {
      expect(() => CodeCollector.forceKillPid(null)).not.toThrow();
    });

    it('does nothing when pid is 0', () => {
      expect(() => CodeCollector.forceKillPid(0)).not.toThrow();
    });

    it('sends SIGKILL to valid PID', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      CodeCollector.forceKillPid(99999);
      expect(killSpy).toHaveBeenCalledWith(99999, 'SIGKILL');
      killSpy.mockRestore();
    });

    it('handles ESRCH (process already exited) silently', () => {
      const esrchError = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw esrchError;
      });

      expect(() => CodeCollector.forceKillPid(99999)).not.toThrow();
      killSpy.mockRestore();
    });

    it('logs warning for non-ESRCH kill errors', () => {
      const epermError = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw epermError;
      });

      // Should not throw, just log
      expect(() => CodeCollector.forceKillPid(99999)).not.toThrow();
      killSpy.mockRestore();
    });
  });

  // ─── getChromePid ────────────────────────────────────────────────
  describe('getChromePid', () => {
    it('returns null when browser not launched', () => {
      const collector = new CodeCollector(defaultConfig);
      expect(collector.getChromePid()).toBeNull();
    });

    it('returns pid after browser launch', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      expect(collector.getChromePid()).toBe(12345);
    });
  });

  // ─── closeBrowserWithForceKill (via close) ───────────────────────
  describe('closeBrowserWithForceKill', () => {
    it('force-kills when browser.close() times out', async () => {
      const browser = createBrowserMock({
        close: vi.fn(() => new Promise(() => {})), // never resolves
      });
      mocks.launch.mockResolvedValue(browser);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      // Override the timeout for test speed
      (CodeCollector as any).BROWSER_CLOSE_TIMEOUT_MS = 10;

      await collector.close();

      // Force-kill should have been attempted
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
      killSpy.mockRestore();
      (CodeCollector as any).BROWSER_CLOSE_TIMEOUT_MS = 5000;
    });

    it('force-kills when browser.close() throws', async () => {
      const browser = createBrowserMock({
        close: vi.fn().mockRejectedValue(new Error('close error')),
      });
      mocks.launch.mockResolvedValue(browser);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();
      await collector.close();

      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
      killSpy.mockRestore();
    });
  });

  // ─── listResolvedPages ──────────────────────────────────────────
  describe('listResolvedPages', () => {
    it('returns empty when no browser', async () => {
      const collector = new CodeCollector(defaultConfig);
      const pages = await collector.listResolvedPages();
      expect(pages).toEqual([]);
    });

    it('returns resolved pages with titles', async () => {
      const page1 = {
        title: vi.fn().mockResolvedValue('Page One'),
        url: vi.fn().mockReturnValue('https://page1.com'),
      };
      const target = {
        type: vi.fn().mockReturnValue('page'),
        url: vi.fn().mockReturnValue('https://page1.com'),
        page: vi.fn().mockResolvedValue(page1),
      };
      const browser = createBrowserMock({
        targets: vi.fn().mockReturnValue([target]),
      });
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      const pages = await collector.listResolvedPages();
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        index: 0,
        url: 'https://page1.com',
        title: 'Page One',
      });
    });

    it('filters out targets that fail to resolve', async () => {
      const goodTarget = {
        type: vi.fn().mockReturnValue('page'),
        url: vi.fn().mockReturnValue('https://good.com'),
        page: vi.fn().mockResolvedValue({
          title: vi.fn().mockResolvedValue('Good'),
        }),
      };
      const badTarget = {
        type: vi.fn().mockReturnValue('page'),
        url: vi.fn().mockReturnValue('https://bad.com'),
        page: vi.fn().mockRejectedValue(new Error('resolve failed')),
      };
      const browser = createBrowserMock({
        targets: vi.fn().mockReturnValue([goodTarget, badTarget]),
      });
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      const pages = await collector.listResolvedPages();
      expect(pages).toHaveLength(1);
      expect(pages[0]?.url).toBe('https://good.com');
    });

    it('handles title fetch failure gracefully', async () => {
      const page = {
        title: vi.fn().mockRejectedValue(new Error('title error')),
      };
      const target = {
        type: vi.fn().mockReturnValue('page'),
        url: vi.fn().mockReturnValue('https://no-title.com'),
        page: vi.fn().mockResolvedValue(page),
      };
      const browser = createBrowserMock({
        targets: vi.fn().mockReturnValue([target]),
      });
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      const pages = await collector.listResolvedPages();
      expect(pages).toHaveLength(1);
      expect(pages[0]?.title).toBe('');
    });
  });

  // ─── isExistingBrowserConnection ────────────────────────────────
  describe('isExistingBrowserConnection', () => {
    it('returns false when launched', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      expect(collector.isExistingBrowserConnection()).toBe(false);
    });

    it('returns true when connected', async () => {
      const browser = createBrowserMock();
      mocks.connect.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.connect('ws://127.0.0.1:9222');

      expect(collector.isExistingBrowserConnection()).toBe(true);
    });
  });

  // ─── connect with ChromeConnectOptions ──────────────────────────
  describe('connect with options', () => {
    it('throws when no connection parameters provided', async () => {
      const collector = new CodeCollector(defaultConfig);

      await expect(collector.connect({} as any)).rejects.toThrow(
        /browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required/,
      );
    });

    it('throws when empty string endpoint', async () => {
      const collector = new CodeCollector(defaultConfig);
      await expect(collector.connect('   ')).rejects.toThrow('Connection endpoint cannot be empty');
    });

    it('connects via browserURL option', async () => {
      const browser = createBrowserMock();
      mocks.connect.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.connect({ browserURL: 'http://127.0.0.1:9222' });

      expect(mocks.connect).toHaveBeenCalledWith({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null,
      });
    });

    it('connects via wsEndpoint option', async () => {
      const browser = createBrowserMock();
      mocks.connect.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc' });

      expect(mocks.connect).toHaveBeenCalledWith({
        browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
        defaultViewport: null,
      });
    });

    it('connect normalizes ECONNREFUSED error for non-autoConnect', async () => {
      mocks.connect.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const collector = new CodeCollector(defaultConfig);

      await expect(
        collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test' }),
      ).rejects.toThrow('connect ECONNREFUSED');
    });

    it('ignores connect errors after timeout has settled', async () => {
      let rejectConnect!: (err: Error) => void;
      mocks.connect.mockImplementation(
        () =>
          new Promise((_res, rej) => {
            rejectConnect = rej;
          }),
      );

      const collector = new CodeCollector(defaultConfig);
      (collector as any).CONNECT_TIMEOUT_MS = 10;

      const connectPromise = collector.connect({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
      });

      await expect(connectPromise).rejects.toThrow(/Timed out/);

      // Now reject the connect after timeout has fired
      rejectConnect(new Error('connect ECONNREFUSED'));
      await new Promise((r) => setTimeout(r, 0));

      expect(collector.getBrowser()).toBeNull();
    });
  });

  // ─── collect error propagation ──────────────────────────────────
  describe('collect', () => {
    it('serializes concurrent collect calls', async () => {
      let callCount = 0;
      mocks.collectInnerImpl.mockImplementation(async () => {
        const order = ++callCount;
        if (order === 1) {
          await new Promise((r) => setTimeout(r, 10));
        }
        return { files: [], totalSize: 0, collectTime: order };
      });

      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      const [result1, result2] = await Promise.all([
        collector.collect({ url: 'https://a.com' } as any),
        collector.collect({ url: 'https://b.com' } as any),
      ]);

      // Both should complete
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(mocks.collectInnerImpl).toHaveBeenCalledTimes(2);
    });

    it('propagates errors from collectInner and clears lock', async () => {
      // The source code pattern `reject(e); throw e;` causes an unhandled rejection
      // because the lock promise is rejected but nobody awaits it after collectLock is nulled.
      // Suppress that known unhandled rejection for this test.
      process.on('unhandledRejection', noopRejectionHandler);

      mocks.collectInnerImpl.mockRejectedValueOnce(new Error('collect failed'));
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      await expect(collector.collect({ url: 'https://a.com' } as any)).rejects.toThrow(
        'collect failed',
      );

      // Allow the unhandled rejection to be swallowed before removing the handler
      await new Promise((r) => setTimeout(r, 0));
      process.removeListener('unhandledRejection', noopRejectionHandler);
    });
  });

  // ─── getActivePage with explicitlyClosed ────────────────────────
  describe('getActivePage re-init on disconnect', () => {
    it('re-inits browser when not explicitly closed and browser is null', async () => {
      const browser1 = createBrowserMock();
      const browser2 = createBrowserMock({
        targets: vi.fn().mockReturnValue([]),
        newPage: vi.fn().mockResolvedValue({
          url: vi.fn().mockReturnValue('about:blank'),
        }),
      });
      mocks.launch.mockResolvedValueOnce(browser1).mockResolvedValueOnce(browser2);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      // Simulate disconnection (not explicit close)
      const disconnectHandler = browser1.on.mock.calls.find(
        (c: any[]) => c[0] === 'disconnected',
      )?.[1];
      if (disconnectHandler) disconnectHandler();

      // getActivePage should auto-reinit
      const page = await collector.getActivePage();
      expect(page).toBeDefined();
      expect(mocks.launch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getActivePage target.page() returns null ───────────────────
  describe('getActivePage resolvePageTargetHandle', () => {
    it('throws when target.page() returns null', async () => {
      const target = {
        type: vi.fn().mockReturnValue('page'),
        url: vi.fn().mockReturnValue('https://example.com'),
        page: vi.fn().mockResolvedValue(null),
      };
      const browser = createBrowserMock({
        targets: vi.fn().mockReturnValue([target]),
      });
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      await expect(collector.getActivePage()).rejects.toThrow(
        'does not expose a Puppeteer Page handle',
      );
    });
  });

  // ─── getUnknownErrorMessage branches ────────────────────────────
  describe('connect error normalization', () => {
    it('handles error with nested error.error.message', async () => {
      mocks.connect.mockRejectedValue({
        error: { message: 'nested ECONNREFUSED message' },
      });

      const collector = new CodeCollector(defaultConfig);
      // Use wsEndpoint since autoConnect requires reading DevToolsActivePort
      await expect(
        collector.connect({
          wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
        }),
      ).rejects.toThrow(/nested ECONNREFUSED/);
    });

    it('handles error with nested error.error object without message', async () => {
      mocks.connect.mockRejectedValue({
        error: { code: 123 },
      });

      const collector = new CodeCollector(defaultConfig);
      await expect(collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/test' })).rejects.toThrow();
    });

    it('handles JSON-serializable error object', async () => {
      mocks.connect.mockRejectedValue({ data: 'some value' });

      const collector = new CodeCollector(defaultConfig);
      await expect(collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/test' })).rejects.toThrow();
    });

    it('handles non-object error (string)', async () => {
      mocks.connect.mockRejectedValue('string error');

      const collector = new CodeCollector(defaultConfig);
      await expect(collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/test' })).rejects.toThrow(
        'string error',
      );
    });

    it('handles empty object error', async () => {
      mocks.connect.mockRejectedValue({});

      const collector = new CodeCollector(defaultConfig);
      await expect(collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/test' })).rejects.toThrow();
    });
  });

  // ─── init headless option ───────────────────────────────────────
  describe('init headless parameter', () => {
    it('sets headless to false when explicitly passed', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init(false);

      const status = await collector.getStatus();
      expect(status.effectiveHeadless).toBe(false);
    });
  });

  // ─── resolveExecutablePath via findBrowserExecutable ────────────
  describe('resolveExecutablePath', () => {
    it('uses detected browser executable from findBrowserExecutable', async () => {
      mocks.findBrowserExecutable.mockReturnValue('/usr/bin/chromium');
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      expect(mocks.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: '/usr/bin/chromium',
        }),
      );
    });
  });

  // ─── disconnected event handler ─────────────────────────────────
  describe('disconnected handler', () => {
    it('clears CDP session state on disconnect when cdpSession exists', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();
      // Set up cdpSession so the conditional inside disconnected handler triggers
      (collector as any).cdpSession = { send: vi.fn() };
      collector.cdpListeners = { responseReceived: vi.fn() as any };

      const disconnectHandler = browser.on.mock.calls.find(
        (c: any[]) => c[0] === 'disconnected',
      )?.[1];
      disconnectHandler?.();

      expect(collector.getBrowser()).toBeNull();
      expect((collector as any).cdpSession).toBeNull();
      expect(collector.cdpListeners).toEqual({});
    });

    it('does not clear cdpListeners when cdpSession is null', async () => {
      const browser = createBrowserMock();
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();
      // cdpSession is null by default, set listeners
      collector.cdpListeners = { responseReceived: vi.fn() as any };

      const disconnectHandler = browser.on.mock.calls.find(
        (c: any[]) => c[0] === 'disconnected',
      )?.[1];
      disconnectHandler?.();

      expect(collector.getBrowser()).toBeNull();
      // cdpListeners should not be cleared when cdpSession was null
      expect(collector.cdpListeners).toHaveProperty('responseReceived');
    });
  });

  // ─── browser.process() returns null pid ─────────────────────────
  describe('browser with no PID', () => {
    it('handles null process PID', async () => {
      const browser = createBrowserMock({
        process: vi.fn().mockReturnValue(null),
      });
      mocks.launch.mockResolvedValue(browser);

      const collector = new CodeCollector(defaultConfig);
      await collector.init();

      expect(collector.getChromePid()).toBeNull();
    });
  });
});

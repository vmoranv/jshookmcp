import { existsSync } from 'fs';
import { launch } from 'rebrowser-puppeteer-core';
import type { Browser, Page, CDPSession, Target } from 'rebrowser-puppeteer-core';
import type {
  CollectCodeOptions,
  CollectCodeResult,
  CodeFile,
  PuppeteerConfig,
} from '@internal-types/index';
import { logger } from '@utils/logger';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { CodeCache } from '@modules/collector/CodeCache';
import { SmartCodeCollector } from '@modules/collector/SmartCodeCollector';
import { CodeCompressor } from '@modules/collector/CodeCompressor';
import { BrowserTargetSessionManager } from '@modules/browser/BrowserTargetSessionManager';
import type { BrowserTargetInfo } from '@modules/browser/BrowserTargetSessionManager';
import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import { findBrowserExecutable } from '@utils/browserExecutable';
import { collectInnerImpl } from '@modules/collector/CodeCollectorCollectInternal';
import {
  shouldCollectUrlImpl,
  navigateWithRetryImpl,
  getPerformanceMetricsImpl,
  collectPageMetadataImpl,
} from '@modules/collector/CodeCollectorUtilsInternal';
import {
  resolveConnectOptionsImpl,
  connectWithTimeoutImpl,
} from '@modules/collector/CodeCollectorConnectionInternal';
import {
  getCollectedFilesSummaryImpl,
  getFileByUrlImpl,
  getFilesByPatternImpl,
  getTopPriorityFilesImpl,
} from '@modules/collector/CodeCollectorFileQueryInternal';
import {
  resolveChromeLaunchOptions,
  sameChromeLaunchOptions,
} from '@modules/collector/CodeCollectorLaunchOptions';
import type {
  ChromeLaunchOverrides,
  CodeCollectorLaunchResult,
  ResolvedChromeLaunchOptions,
} from '@modules/collector/CodeCollectorLaunchOptions';

interface ChromeLike {
  runtime: Record<string, unknown>;
  loadTimes: () => void;
  csi: () => void;
  app: Record<string, unknown>;
}

interface WindowWithChrome extends Window {
  chrome?: ChromeLike;
}

export interface ChromeConnectOptions {
  browserURL?: string;
  wsEndpoint?: string;
  autoConnect?: boolean;
  channel?: 'stable' | 'beta' | 'dev' | 'canary';
  userDataDir?: string;
}

export interface ResolvedPageDescriptor {
  index: number;
  url: string;
  title: string;
  page: Page;
}

export class CodeCollector {
  protected config: PuppeteerConfig;
  private browser: Browser | null = null;
  protected collectedUrls: Set<string> = new Set();
  private initPromise: Promise<void> | null = null;
  private collectLock: Promise<CollectCodeResult> | null = null;
  private connectAttemptRef = { current: 0 };
  protected readonly MAX_COLLECTED_URLS: number;
  protected readonly MAX_FILES_PER_COLLECT: number;
  protected readonly MAX_RESPONSE_SIZE: number;
  protected readonly MAX_SINGLE_FILE_SIZE: number;
  private readonly CONNECT_TIMEOUT_MS: number;
  protected readonly viewport: { width: number; height: number };
  protected readonly userAgent: string;
  protected collectedFilesCache: Map<string, CodeFile> = new Map();
  private cache: CodeCache;
  public cacheEnabled: boolean = true;
  public smartCollector: SmartCodeCollector;
  private compressor: CodeCompressor;
  private cdpSession: CDPSession | null = null;
  private browserTargetSessionManager: BrowserTargetSessionManager | null = null;
  public cdpListeners: {
    responseReceived?: (params: unknown) => void;
  } = {};
  private activePageIndex: number | null = null;
  private currentHeadless: boolean | null = null;
  private currentLaunchOptions: ResolvedChromeLaunchOptions | null = null;
  private explicitlyClosed: boolean = false;
  private connectedToExistingBrowser: boolean = false;
  /** PID of the Chrome child process launched by puppeteer, used for force-kill fallback. */
  private chromePid: number | null = null;
  private static readonly BROWSER_CLOSE_TIMEOUT_MS = 5000;
  constructor(config: PuppeteerConfig) {
    this.config = config;
    this.MAX_COLLECTED_URLS = config.maxCollectedUrls ?? 10000;
    this.MAX_FILES_PER_COLLECT = config.maxFilesPerCollect ?? 200;
    this.MAX_RESPONSE_SIZE = config.maxTotalContentSize ?? 512 * 1024;
    this.MAX_SINGLE_FILE_SIZE = config.maxSingleFileSize ?? 200 * 1024;
    this.CONNECT_TIMEOUT_MS = Number(process.env.JSHOOK_CONNECT_TIMEOUT_MS) || 60000;
    this.viewport = config.viewport ?? { width: 1920, height: 1080 };
    this.userAgent =
      config.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.cache = new CodeCache();
    this.smartCollector = new SmartCodeCollector();
    this.compressor = new CodeCompressor();
    logger.info(
      ` CodeCollector limits: maxCollect=${this.MAX_FILES_PER_COLLECT} files, maxResponse=${(this.MAX_RESPONSE_SIZE / 1024).toFixed(0)}KB, maxSingle=${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(0)}KB`,
    );
    logger.info(
      ` Strategy: Collect ALL files -> Cache -> Return summary/partial data to fit MCP limits`,
    );
  }
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    logger.info(`Code cache ${enabled ? 'enabled' : 'disabled'}`);
  }
  async clearFileCache(): Promise<void> {
    await this.cache.clear();
  }
  async getFileCacheStats() {
    return await this.cache.getStats();
  }
  async clearAllData(): Promise<void> {
    logger.info('Clearing all collected data...');
    await this.cache.clear();
    this.compressor.clearCache();
    this.compressor.resetStats();
    this.collectedUrls.clear();
    this.collectedFilesCache.clear();
    logger.success('All data cleared');
  }
  async getAllStats() {
    const cacheStats = await this.cache.getStats();
    const compressionStats = this.compressor.getStats();
    return {
      cache: cacheStats,
      compression: {
        ...compressionStats,
        cacheSize: this.compressor.getCacheSize(),
      },
      collector: {
        collectedUrls: this.collectedUrls.size,
        maxCollectedUrls: this.MAX_COLLECTED_URLS,
      },
    };
  }
  public getCache(): CodeCache {
    return this.cache;
  }
  public getCompressor(): CodeCompressor {
    return this.compressor;
  }
  public cleanupCollectedUrls(): void {
    if (this.collectedUrls.size > this.MAX_COLLECTED_URLS) {
      logger.warn(`Collected URLs exceeded ${this.MAX_COLLECTED_URLS}, clearing...`);
      const urls = Array.from(this.collectedUrls);
      this.collectedUrls.clear();
      urls
        .slice(-Math.floor(this.MAX_COLLECTED_URLS / 2))
        .forEach((url) => this.collectedUrls.add(url));
    }
  }
  async init(headless?: boolean): Promise<void> {
    await this.launch(headless === undefined ? undefined : { headless });
  }

  async launch(overrides?: ChromeLaunchOverrides): Promise<CodeCollectorLaunchResult> {
    if (this.initPromise) {
      await this.initPromise;
    }

    const executablePath = this.resolveExecutablePath();
    const launchOptions = resolveChromeLaunchOptions(
      this.config,
      overrides,
      executablePath,
      this.viewport,
    );

    if (
      this.browser &&
      !this.connectedToExistingBrowser &&
      sameChromeLaunchOptions(this.currentLaunchOptions, launchOptions)
    ) {
      this.explicitlyClosed = false;
      return {
        action: 'reused',
        launchOptions,
      };
    }

    const action: CodeCollectorLaunchResult['action'] = this.browser ? 'relaunched' : 'launched';
    const reason = this.browser
      ? this.connectedToExistingBrowser
        ? 'replacing-existing-browser-connection'
        : 'launch-options-changed'
      : undefined;

    this.explicitlyClosed = false;
    this.initPromise = this.launchInner(launchOptions);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }

    return {
      action,
      launchOptions,
      ...(reason ? { reason } : {}),
    };
  }

  private async launchInner(launchOptions: ResolvedChromeLaunchOptions): Promise<void> {
    if (this.browser) {
      await this.disposeCurrentBrowser(false);
    }

    const browserLaunchOptions: Parameters<typeof launch>[0] = {
      headless: launchOptions.headless,
      args: launchOptions.args,
      defaultViewport: this.viewport,
      protocolTimeout: 60000,
    };
    if (launchOptions.executablePath) {
      browserLaunchOptions.executablePath = launchOptions.executablePath;
    }
    logger.info('Initializing browser with anti-detection...');
    this.browser = await launch(browserLaunchOptions);
    this.connectedToExistingBrowser = false;
    this.chromePid = this.browser.process()?.pid ?? null;
    if (this.chromePid) {
      logger.debug(`Chrome child process PID: ${this.chromePid}`);
    }
    this.currentHeadless = launchOptions.headless;
    this.currentLaunchOptions = launchOptions;
    this.browser.on('disconnected', () => {
      this.handleBrowserDisconnected();
    });
    logger.success('Browser initialized with enhanced anti-detection');
  }
  private resolveExecutablePath(): string | undefined {
    const configuredPath = this.config.executablePath?.trim();
    if (configuredPath) {
      if (existsSync(configuredPath)) {
        return configuredPath;
      }
      throw new Error(
        `Configured browser executable was not found: ${configuredPath}. ` +
          'Set a valid executablePath or configure CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / BROWSER_EXECUTABLE_PATH.',
      );
    }
    const detectedPath = findBrowserExecutable();
    if (detectedPath) {
      return detectedPath;
    }
    logger.info(
      'No explicit browser executable configured. Falling back to Puppeteer-managed browser resolution.',
    );
    return undefined;
  }

  private handleBrowserDisconnected(): void {
    logger.warn('Browser disconnected');
    this.browser = null;
    this.currentHeadless = null;
    this.currentLaunchOptions = null;
    this.connectedToExistingBrowser = false;
    this.chromePid = null;
    void this.browserTargetSessionManager?.dispose();
    this.browserTargetSessionManager = null;
    if (this.cdpSession) {
      this.cdpSession = null;
      this.cdpListeners = {};
    }
  }

  private async disposeCurrentBrowser(markExplicitlyClosed: boolean): Promise<void> {
    await this.clearAllData();
    this.explicitlyClosed = markExplicitlyClosed;
    this.activePageIndex = null;

    const browser = this.browser;
    const disconnectOnly = this.connectedToExistingBrowser;
    const pid = this.chromePid;
    this.browser = null;
    this.currentHeadless = null;
    this.currentLaunchOptions = null;
    this.connectedToExistingBrowser = false;
    this.chromePid = null;
    await this.browserTargetSessionManager?.dispose();
    this.browserTargetSessionManager = null;
    if (this.cdpSession) {
      this.cdpSession = null;
      this.cdpListeners = {};
    }

    if (browser) {
      if (disconnectOnly) {
        await browser.disconnect();
      } else {
        await this.closeBrowserWithForceKill(browser, pid);
      }
    }
  }

  async close(): Promise<void> {
    await this.disposeCurrentBrowser(true);
    logger.info('Browser closed and all data cleared');
  }

  /**
   * Close browser with a timeout guard. If browser.close() hangs or fails,
   * force-kill the Chrome child process by PID to prevent zombie processes.
   */
  private async closeBrowserWithForceKill(browser: Browser, pid: number | null): Promise<void> {
    try {
      await Promise.race([
        browser.close(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('browser.close() timed out')),
            CodeCollector.BROWSER_CLOSE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (error) {
      logger.warn('browser.close() failed or timed out, attempting force-kill:', error);
      CodeCollector.forceKillPid(pid);
    }
  }

  /** Force-kill a process by PID. Safe to call with null/invalid PIDs. */
  static forceKillPid(pid: number | null): void {
    if (!pid) return;
    try {
      process.kill(pid, 'SIGKILL');
      logger.info(`Force-killed Chrome process PID ${pid}`);
    } catch (error) {
      // ESRCH = process already exited, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        logger.warn(`Failed to force-kill Chrome PID ${pid}:`, error);
      }
    }
  }

  /** Get the tracked Chrome child process PID (null if not launched or already closed). */
  getChromePid(): number | null {
    return this.chromePid;
  }
  private getPageTargets(): Target[] {
    if (!this.browser) {
      return [];
    }
    return this.browser.targets().filter((target) => target.type() === 'page');
  }
  private async resolvePageTargetHandle(target: Target, timeoutMs = 5000): Promise<Page> {
    const page = await Promise.race<Page | null>([
      target.page(),
      new Promise<null>((_, reject) => {
        setTimeout(() => {
          reject(
            new PrerequisiteError(
              `Timed out after ${timeoutMs}ms while resolving a Puppeteer Page handle from the attached Chrome target.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);

    if (!page) {
      throw new PrerequisiteError(
        'Attached browser target does not expose a Puppeteer Page handle in the current Chrome remote debugging mode.',
      );
    }

    return page;
  }
  isExistingBrowserConnection(): boolean {
    return this.connectedToExistingBrowser;
  }
  async getActivePage(): Promise<Page> {
    if (!this.browser) {
      if (this.explicitlyClosed) {
        throw new PrerequisiteError(
          'Browser was explicitly closed. Call browser_launch or browser_attach first.',
        );
      }
      try {
        await this.init();
      } catch (error) {
        throw new PrerequisiteError(
          `Browser not available: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const pageTargets = this.getPageTargets();
    if (pageTargets.length === 0) {
      return await this.browser!.newPage();
    }
    if (this.activePageIndex !== null && this.activePageIndex < pageTargets.length) {
      return await this.resolvePageTargetHandle(pageTargets[this.activePageIndex]!);
    }
    const lastTarget = pageTargets[pageTargets.length - 1];
    if (!lastTarget) {
      throw new Error('Failed to get active page');
    }
    return await this.resolvePageTargetHandle(lastTarget);
  }
  async listPages(): Promise<Array<{ index: number; url: string; title: string }>> {
    if (!this.browser) {
      return [];
    }
    const targets = this.getPageTargets();
    return targets.map((target, index) => ({
      index,
      url: target.url(),
      title: '',
    }));
  }
  async listResolvedPages(timeoutMs = 1500): Promise<ResolvedPageDescriptor[]> {
    if (!this.browser) {
      return [];
    }

    const targets = this.getPageTargets();
    const pages = await Promise.all(
      targets.map(async (target, index) => {
        try {
          const page = await this.resolvePageTargetHandle(target, timeoutMs);
          let title = '';
          try {
            title = await Promise.race<string>([
              page.title(),
              new Promise<string>((resolve) => {
                setTimeout(() => resolve(''), timeoutMs);
              }),
            ]);
          } catch {
            title = '';
          }

          return {
            index,
            url: target.url(),
            title,
            page,
          } satisfies ResolvedPageDescriptor;
        } catch {
          return null;
        }
      }),
    );

    return pages.filter((page): page is ResolvedPageDescriptor => page !== null);
  }
  async selectPage(index: number): Promise<void> {
    if (!this.browser) {
      throw new Error('Browser not connected');
    }
    const pages = await this.listPages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Page index ${index} out of range (0-${pages.length - 1})`);
    }
    this.activePageIndex = index;
    logger.info(`Active page set to index ${index}: ${pages[index]!.url}`);
  }
  async createPage(url?: string): Promise<Page> {
    if (!this.browser) {
      await this.init();
    }
    const page = await this.browser!.newPage();
    await page.setUserAgent(this.userAgent);
    await this.applyAntiDetection(page);
    if (url) {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout,
      });
    }
    logger.info(`New page created${url ? `: ${url}` : ''}`);
    return page;
  }
  private async applyAntiDetection(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      const win = window as WindowWithChrome;
      if (!win.chrome) {
        win.chrome = {
          runtime: {},
          loadTimes: function () {},
          csi: function () {},
          app: {},
        };
      }
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: 'denied' } as PermissionStatus);
        }
        return originalQuery(parameters);
      };
    });
  }
  async getStatus(): Promise<{
    running: boolean;
    pagesCount: number;
    version?: string;
    effectiveHeadless?: boolean;
    launchSource?: 'launched' | 'attached';
    v8NativeSyntaxEnabled?: boolean;
    launchArgs?: string[];
  }> {
    if (!this.browser) {
      return {
        running: false,
        pagesCount: 0,
      };
    }
    try {
      const version = await this.browser.version();
      const pages = this.getPageTargets();
      return {
        running: true,
        pagesCount: pages.length,
        version,
        effectiveHeadless: this.currentHeadless ?? undefined,
        launchSource: this.connectedToExistingBrowser ? 'attached' : 'launched',
        v8NativeSyntaxEnabled: this.currentLaunchOptions?.v8NativeSyntaxEnabled,
        launchArgs: this.currentLaunchOptions?.args ? [...this.currentLaunchOptions.args] : [],
      };
    } catch (error) {
      logger.debug('Browser not running or disconnected:', error);
      return {
        running: false,
        pagesCount: 0,
      };
    }
  }
  async collect(options: CollectCodeOptions): Promise<CollectCodeResult> {
    // Serialize concurrent collect calls to avoid cdpSession race conditions
    while (this.collectLock) {
      try {
        await this.collectLock;
      } catch {
        /* ignore predecessor failures */
      }
    }
    let resolve!: (v: CollectCodeResult) => void;
    let reject!: (e: unknown) => void;
    this.collectLock = new Promise<CollectCodeResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    try {
      const result = await this.collectInner(options);
      resolve(result);
      return result;
    } catch (e) {
      reject(e);
      throw e;
    } finally {
      this.collectLock = null;
    }
  }
  private async collectInner(options: CollectCodeOptions): Promise<CollectCodeResult> {
    return collectInnerImpl(this, options);
  }
  shouldCollectUrl(url: string, filterRules?: string[]): boolean {
    return shouldCollectUrlImpl(url, filterRules);
  }
  async navigateWithRetry(
    page: Page,
    url: string,
    options: NonNullable<Parameters<Page['goto']>[1]>,
    maxRetries = 3,
  ): Promise<void> {
    return navigateWithRetryImpl(page, url, options, maxRetries);
  }
  async getPerformanceMetrics(page: Page): Promise<Record<string, number>> {
    return getPerformanceMetricsImpl(page);
  }
  async collectPageMetadata(page: Page): Promise<Record<string, unknown>> {
    return collectPageMetadataImpl(page);
  }
  private async resolveConnectOptions(
    endpointOrOptions: string | ChromeConnectOptions,
  ): Promise<{ browserWSEndpoint?: string; browserURL?: string }> {
    return resolveConnectOptionsImpl(endpointOrOptions);
  }

  private async connectWithTimeout(
    connectOptions: { browserWSEndpoint?: string; browserURL?: string },
    target: string,
    endpointOrOptions: string | ChromeConnectOptions,
  ): Promise<Browser> {
    return connectWithTimeoutImpl(
      connectOptions,
      target,
      endpointOrOptions,
      this.CONNECT_TIMEOUT_MS,
      this.connectAttemptRef,
    );
  }

  async connect(endpointOrOptions: string | ChromeConnectOptions): Promise<void> {
    this.explicitlyClosed = false;
    if (this.browser || this.browserTargetSessionManager || this.cdpSession) {
      await this.disposeCurrentBrowser(false);
    }
    const connectOptions = await this.resolveConnectOptions(endpointOrOptions);
    const target =
      connectOptions.browserWSEndpoint ??
      connectOptions.browserURL ??
      'auto-detected Chrome debugging endpoint';
    logger.info(`Connecting to existing browser: ${target}`);
    this.browser = await this.connectWithTimeout(connectOptions, target, endpointOrOptions);
    this.connectedToExistingBrowser = true;
    this.currentLaunchOptions = null;
    this.browser.on('disconnected', () => {
      this.handleBrowserDisconnected();
    });
    logger.success('Connected to existing browser successfully');
  }
  getBrowser(): Browser | null {
    return this.browser;
  }

  getBrowserTargetSessionManager(): BrowserTargetSessionManager {
    if (!this.browserTargetSessionManager) {
      this.browserTargetSessionManager = new BrowserTargetSessionManager(() => this.browser);
    }
    return this.browserTargetSessionManager;
  }

  async listCdpTargets(filters?: {
    type?: string;
    types?: string[];
    targetId?: string;
    urlPattern?: string;
    titlePattern?: string;
    attachedOnly?: boolean;
    discoverOOPIF?: boolean;
  }): Promise<BrowserTargetInfo[]> {
    return await this.getBrowserTargetSessionManager().listTargets(filters);
  }

  async attachCdpTarget(targetId: string): Promise<BrowserTargetInfo> {
    return await this.getBrowserTargetSessionManager().attach(targetId);
  }

  async detachCdpTarget(): Promise<boolean> {
    return await this.getBrowserTargetSessionManager().detach();
  }

  getAttachedTargetSession(): CDPSessionLike | null {
    return this.browserTargetSessionManager?.getAttachedTargetSession() ?? null;
  }

  getAttachedTargetInfo(): BrowserTargetInfo | null {
    return this.browserTargetSessionManager?.getAttachedTargetInfo() ?? null;
  }
  getCollectionStats(): {
    totalCollected: number;
    uniqueUrls: number;
  } {
    return {
      totalCollected: this.collectedUrls.size,
      uniqueUrls: this.collectedUrls.size,
    };
  }
  clearCache(): void {
    this.collectedUrls.clear();
    logger.info('Collection cache cleared');
  }
  getCollectedFilesSummary(): Array<{
    url: string;
    size: number;
    type: string;
    truncated?: boolean;
    originalSize?: number;
  }> {
    return getCollectedFilesSummaryImpl(this.collectedFilesCache);
  }
  getFileByUrl(url: string): CodeFile | null {
    return getFileByUrlImpl(this.collectedFilesCache, url);
  }
  getFilesByPattern(
    pattern: string,
    limit: number = 20,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE,
  ): {
    files: CodeFile[];
    totalSize: number;
    matched: number;
    returned: number;
    truncated: boolean;
  } {
    return getFilesByPatternImpl(this.collectedFilesCache, pattern, limit, maxTotalSize);
  }
  getTopPriorityFiles(
    topN: number = 10,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE,
  ): {
    files: CodeFile[];
    totalSize: number;
    totalFiles: number;
  } {
    return getTopPriorityFilesImpl(this.collectedFilesCache, topN, maxTotalSize);
  }
  clearCollectedFilesCache(): void {
    const count = this.collectedFilesCache.size;
    this.collectedFilesCache.clear();
    logger.info(`Cleared collected files cache (${count} files)`);
  }
}

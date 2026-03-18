import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import puppeteer from 'rebrowser-puppeteer-core';
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
import { calculatePriorityScore } from '@modules/collector/PageScriptCollectors';
import { findBrowserExecutable } from '@utils/browserExecutable';
import { collectInnerImpl } from '@modules/collector/CodeCollectorCollectInternal';
import {
  shouldCollectUrlImpl,
  navigateWithRetryImpl,
  getPerformanceMetricsImpl,
  collectPageMetadataImpl,
} from '@modules/collector/CodeCollectorUtilsInternal';

interface ChromeLike {
  runtime: Record<string, unknown>;
  loadTimes: () => void;
  csi: () => void;
  app: Record<string, unknown>;
}

interface WindowWithChrome extends Window {
  chrome?: ChromeLike;
}

type ChromeReleaseChannel = 'stable' | 'beta' | 'dev' | 'canary';

export interface ChromeConnectOptions {
  browserURL?: string;
  wsEndpoint?: string;
  autoConnect?: boolean;
  channel?: ChromeReleaseChannel;
  userDataDir?: string;
}

export interface ResolvedPageDescriptor {
  index: number;
  url: string;
  title: string;
  page: Page;
}

export class CodeCollector {
  private config: PuppeteerConfig;
  private browser: Browser | null = null;
  private collectedUrls: Set<string> = new Set();
  private initPromise: Promise<void> | null = null;
  private collectLock: Promise<CollectCodeResult> | null = null;
  private connectAttemptId = 0;
  private readonly MAX_COLLECTED_URLS: number;
  private readonly MAX_FILES_PER_COLLECT: number;
  private readonly MAX_RESPONSE_SIZE: number;
  private readonly MAX_SINGLE_FILE_SIZE: number;
  private readonly CONNECT_TIMEOUT_MS: number;
  private readonly viewport: { width: number; height: number };
  private readonly userAgent: string;
  private collectedFilesCache: Map<string, CodeFile> = new Map();
  private cache: CodeCache;
  public cacheEnabled: boolean = true;
  public smartCollector: SmartCodeCollector;
  private compressor: CodeCompressor;
  private cdpSession: CDPSession | null = null;
  public cdpListeners: {
    responseReceived?: (params: unknown) => void;
  } = {};
  private activePageIndex: number | null = null;
  private currentHeadless: boolean | null = null;
  private explicitlyClosed: boolean = false;
  private connectedToExistingBrowser: boolean = false;
  constructor(config: PuppeteerConfig) {
    this.config = config;
    this.MAX_COLLECTED_URLS = config.maxCollectedUrls ?? 10000;
    this.MAX_FILES_PER_COLLECT = config.maxFilesPerCollect ?? 200;
    this.MAX_RESPONSE_SIZE = config.maxTotalContentSize ?? 512 * 1024;
    this.MAX_SINGLE_FILE_SIZE = config.maxSingleFileSize ?? 200 * 1024;
    this.CONNECT_TIMEOUT_MS = 15000;
    this.viewport = config.viewport ?? { width: 1920, height: 1080 };
    this.userAgent =
      config.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.cache = new CodeCache();
    this.smartCollector = new SmartCodeCollector();
    this.compressor = new CodeCompressor();
    logger.info(
      ` CodeCollector limits: maxCollect=${this.MAX_FILES_PER_COLLECT} files, maxResponse=${(this.MAX_RESPONSE_SIZE / 1024).toFixed(0)}KB, maxSingle=${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(0)}KB`
    );
    logger.info(
      ` Strategy: Collect ALL files -> Cache -> Return summary/partial data to fit MCP limits`
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
    if (this.browser) {
      return;
    }
    this.explicitlyClosed = false;
    // Deduplicate concurrent init calls
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.initInner(headless);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }
  private async initInner(headless?: boolean): Promise<void> {
    const useHeadless = headless ?? this.config.headless;
    const executablePath = this.resolveExecutablePath();
    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
      headless: useHeadless,
      args: [
        ...(this.config.args || []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        `--window-size=${this.viewport.width},${this.viewport.height}`,
        '--ignore-certificate-errors',
      ],
      defaultViewport: this.viewport,
      protocolTimeout: 60000,
    };
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    logger.info('Initializing browser with anti-detection...');
    this.browser = await puppeteer.launch(launchOptions);
    this.connectedToExistingBrowser = false;
    this.currentHeadless = useHeadless === undefined ? true : useHeadless !== false;
    this.browser.on('disconnected', () => {
      logger.warn('Browser disconnected');
      this.browser = null;
      this.currentHeadless = null;
      this.connectedToExistingBrowser = false;
      if (this.cdpSession) {
        this.cdpSession = null;
        this.cdpListeners = {};
      }
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
          'Set a valid executablePath or configure CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / BROWSER_EXECUTABLE_PATH.'
      );
    }
    const detectedPath = findBrowserExecutable();
    if (detectedPath) {
      return detectedPath;
    }
    logger.info(
      'No explicit browser executable configured. Falling back to Puppeteer-managed browser resolution.'
    );
    return undefined;
  }
  async close(): Promise<void> {
    await this.clearAllData();
    this.explicitlyClosed = true;
    this.activePageIndex = null;

    const browser = this.browser;
    const disconnectOnly = this.connectedToExistingBrowser;
    this.browser = null;
    this.currentHeadless = null;
    this.connectedToExistingBrowser = false;
    if (this.cdpSession) {
      this.cdpSession = null;
      this.cdpListeners = {};
    }

    if (browser) {
      if (disconnectOnly) {
        await browser.disconnect();
      } else {
        await browser.close();
      }
    }

    logger.info('Browser closed and all data cleared');
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
              `Timed out after ${timeoutMs}ms while resolving a Puppeteer Page handle from the attached Chrome target.`
            )
          );
        }, timeoutMs);
      }),
    ]);

    if (!page) {
      throw new PrerequisiteError(
        'Attached browser target does not expose a Puppeteer Page handle in the current Chrome remote debugging mode.'
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
          'Browser was explicitly closed. Call browser_launch or browser_attach first.'
        );
      }
      try {
        await this.init();
      } catch (error) {
        throw new PrerequisiteError(
          `Browser not available: ${error instanceof Error ? error.message : String(error)}`
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
      })
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
    maxRetries = 3
  ): Promise<void> {
    return navigateWithRetryImpl(page, url, options, maxRetries);
  }
  async getPerformanceMetrics(page: Page): Promise<Record<string, number>> {
    return getPerformanceMetricsImpl(page);
  }
  async collectPageMetadata(page: Page): Promise<Record<string, unknown>> {
    return collectPageMetadataImpl(page);
  }
  private resolveDefaultChromeUserDataDir(channel: ChromeReleaseChannel = 'stable'): string {
    const home = homedir();

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
      switch (channel) {
        case 'beta':
          return join(localAppData, 'Google', 'Chrome Beta', 'User Data');
        case 'dev':
          return join(localAppData, 'Google', 'Chrome Dev', 'User Data');
        case 'canary':
          return join(localAppData, 'Google', 'Chrome SxS', 'User Data');
        case 'stable':
        default:
          return join(localAppData, 'Google', 'Chrome', 'User Data');
      }
    }

    if (process.platform === 'darwin') {
      const appSupport = join(home, 'Library', 'Application Support');
      switch (channel) {
        case 'beta':
          return join(appSupport, 'Google', 'Chrome Beta');
        case 'dev':
          return join(appSupport, 'Google', 'Chrome Dev');
        case 'canary':
          return join(appSupport, 'Google', 'Chrome Canary');
        case 'stable':
        default:
          return join(appSupport, 'Google', 'Chrome');
      }
    }

    const configHome = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
    switch (channel) {
      case 'beta':
        return join(configHome, 'google-chrome-beta');
      case 'dev':
        return join(configHome, 'google-chrome-unstable');
      case 'canary':
        return join(configHome, 'google-chrome-canary');
      case 'stable':
      default:
        return join(configHome, 'google-chrome');
    }
  }

  private async resolveAutoConnectWsEndpoint(options: ChromeConnectOptions): Promise<string> {
    const channel = options.channel ?? 'stable';
    const userDataDir = options.userDataDir ?? this.resolveDefaultChromeUserDataDir(channel);
    const devToolsActivePortPath = join(userDataDir, 'DevToolsActivePort');

    let fileContent: string;
    try {
      fileContent = await readFile(devToolsActivePortPath, 'utf8');
    } catch (error) {
      throw new Error(
        `Could not read DevToolsActivePort from "${devToolsActivePortPath}". Check if Chrome is running from this profile and remote debugging is enabled at chrome://inspect/#remote-debugging.`,
        { cause: error }
      );
    }

    const [rawPort, rawPath] = fileContent
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!rawPort || !rawPath) {
      throw new Error(`Invalid DevToolsActivePort contents found in "${devToolsActivePortPath}".`);
    }

    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid remote debugging port "${rawPort}" in "${devToolsActivePortPath}".`);
    }

    return `ws://127.0.0.1:${port}${rawPath}`;
  }

  private async resolveConnectOptions(
    endpointOrOptions: string | ChromeConnectOptions
  ): Promise<{ browserWSEndpoint?: string; browserURL?: string }> {
    if (typeof endpointOrOptions === 'string') {
      const endpoint = endpointOrOptions.trim();
      if (!endpoint) {
        throw new Error('Connection endpoint cannot be empty.');
      }
      return endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
        ? { browserWSEndpoint: endpoint }
        : { browserURL: endpoint };
    }

    if (endpointOrOptions.wsEndpoint) {
      return { browserWSEndpoint: endpointOrOptions.wsEndpoint };
    }

    if (endpointOrOptions.browserURL) {
      return { browserURL: endpointOrOptions.browserURL };
    }

    if (
      endpointOrOptions.autoConnect ||
      endpointOrOptions.userDataDir ||
      endpointOrOptions.channel
    ) {
      return {
        browserWSEndpoint: await this.resolveAutoConnectWsEndpoint(endpointOrOptions),
      };
    }

    throw new Error(
      'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required to connect to an existing browser.'
    );
  }

  private isAutoConnectRequest(endpointOrOptions: string | ChromeConnectOptions): boolean {
    return (
      typeof endpointOrOptions !== 'string' &&
      Boolean(
        endpointOrOptions.autoConnect || endpointOrOptions.userDataDir || endpointOrOptions.channel
      )
    );
  }

  private getUnknownErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null) {
      const directMessage =
        'message' in error && typeof error.message === 'string' ? error.message.trim() : '';
      if (directMessage) {
        return directMessage;
      }

      const nestedError = 'error' in error ? error.error : undefined;
      if (nestedError instanceof Error && nestedError.message) {
        return nestedError.message;
      }

      if (typeof nestedError === 'object' && nestedError !== null) {
        const nestedMessage =
          'message' in nestedError && typeof nestedError.message === 'string'
            ? nestedError.message.trim()
            : '';
        if (nestedMessage) {
          return nestedMessage;
        }
      }

      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    }

    return String(error);
  }

  private normalizeConnectError(
    error: unknown,
    target: string,
    endpointOrOptions: string | ChromeConnectOptions
  ): Error {
    const message = this.getUnknownErrorMessage(error);

    if (this.isAutoConnectRequest(endpointOrOptions) && /ECONNREFUSED/i.test(message)) {
      return new Error(
        `Failed to connect to existing browser: ${message}. ` +
          `Chrome is not currently listening at ${target}. ` +
          'DevToolsActivePort may be stale after a browser restart. ' +
          'Re-open Chrome, confirm remote debugging is enabled at chrome://inspect/#remote-debugging, click Allow if prompted, and retry.'
      );
    }

    return error instanceof Error
      ? error
      : new Error(`Failed to connect to existing browser: ${message}`);
  }

  private buildConnectTimeoutError(
    target: string,
    endpointOrOptions: string | ChromeConnectOptions
  ): Error {
    const baseMessage =
      `Timed out after ${this.CONNECT_TIMEOUT_MS}ms while connecting to existing browser: ${target}. ` +
      'The CDP handshake did not complete in time.';

    if (this.isAutoConnectRequest(endpointOrOptions)) {
      return new Error(
        `${baseMessage} If Chrome prompted for remote debugging approval, click Allow in Chrome and then retry the tool call.`
      );
    }

    return new Error(
      `${baseMessage} Verify that the browser debugging endpoint is reachable and retry.`
    );
  }

  private async connectWithTimeout(
    connectOptions: { browserWSEndpoint?: string; browserURL?: string },
    target: string,
    endpointOrOptions: string | ChromeConnectOptions
  ): Promise<Browser> {
    const attemptId = ++this.connectAttemptId;

    return await new Promise<Browser>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        if (this.connectAttemptId === attemptId) {
          this.connectAttemptId += 1;
        }
        reject(this.buildConnectTimeoutError(target, endpointOrOptions));
      }, this.CONNECT_TIMEOUT_MS);

      void puppeteer
        .connect(connectOptions)
        .then(async (browser) => {
          if (settled || this.connectAttemptId !== attemptId) {
            try {
              await browser.disconnect();
            } catch {
              /* best-effort cleanup for stale connection results */
            }
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(browser);
        })
        .catch((error) => {
          if (settled || this.connectAttemptId !== attemptId) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(this.normalizeConnectError(error, target, endpointOrOptions));
        });
    });
  }

  async connect(endpointOrOptions: string | ChromeConnectOptions): Promise<void> {
    this.explicitlyClosed = false;
    if (this.browser) {
      try {
        await this.browser.disconnect();
      } catch {
        /* best-effort cleanup */
      }
      this.browser = null;
      this.currentHeadless = null;
    }
    this.activePageIndex = null;
    const connectOptions = await this.resolveConnectOptions(endpointOrOptions);
    const target =
      connectOptions.browserWSEndpoint ??
      connectOptions.browserURL ??
      'auto-detected Chrome debugging endpoint';
    logger.info(`Connecting to existing browser: ${target}`);
    this.browser = await this.connectWithTimeout(connectOptions, target, endpointOrOptions);
    this.connectedToExistingBrowser = true;
    this.browser.on('disconnected', () => {
      logger.warn('Browser disconnected');
      this.browser = null;
      this.currentHeadless = null;
      this.connectedToExistingBrowser = false;
      if (this.cdpSession) {
        this.cdpSession = null;
        this.cdpListeners = {};
      }
    });
    logger.success('Connected to existing browser successfully');
  }
  getBrowser(): Browser | null {
    return this.browser;
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
    const summaries = Array.from(this.collectedFilesCache.values()).map((file) => ({
      url: file.url,
      size: file.size,
      type: file.type,
      truncated:
        typeof file.metadata?.truncated === 'boolean' ? file.metadata.truncated : undefined,
      originalSize:
        typeof file.metadata?.originalSize === 'number' ? file.metadata.originalSize : undefined,
    }));
    logger.info(`Returning summary of ${summaries.length} collected files`);
    return summaries;
  }
  getFileByUrl(url: string): CodeFile | null {
    const file = this.collectedFilesCache.get(url);
    if (file) {
      logger.info(`Returning file: ${url} (${(file.size / 1024).toFixed(2)} KB)`);
      return file;
    }
    logger.warn(`File not found: ${url}`);
    return null;
  }
  getFilesByPattern(
    pattern: string,
    limit: number = 20,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE
  ): {
    files: CodeFile[];
    totalSize: number;
    matched: number;
    returned: number;
    truncated: boolean;
  } {
    const regex = new RegExp(pattern);
    const matched: CodeFile[] = [];
    for (const file of this.collectedFilesCache.values()) {
      if (regex.test(file.url)) {
        matched.push(file);
      }
    }
    const returned: CodeFile[] = [];
    let totalSize = 0;
    let truncated = false;
    for (let i = 0; i < matched.length && i < limit; i++) {
      const file = matched[i];
      if (file && totalSize + file.size <= maxTotalSize) {
        returned.push(file);
        totalSize += file.size;
      } else {
        truncated = true;
        break;
      }
    }
    if (truncated || matched.length > limit) {
      logger.warn(
        `Pattern "${pattern}" matched ${matched.length} files, returning ${returned.length} (limited by size/count)`
      );
    }
    logger.info(
      ` Pattern "${pattern}": matched ${matched.length}, returning ${returned.length} files (${(totalSize / 1024).toFixed(2)} KB)`
    );
    return {
      files: returned,
      totalSize,
      matched: matched.length,
      returned: returned.length,
      truncated,
    };
  }
  getTopPriorityFiles(
    topN: number = 10,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE
  ): {
    files: CodeFile[];
    totalSize: number;
    totalFiles: number;
  } {
    const allFiles = Array.from(this.collectedFilesCache.values());
    const scoredFiles = allFiles.map((file) => ({
      file,
      score: calculatePriorityScore(file),
    }));
    scoredFiles.sort((a, b) => b.score - a.score);
    const selected: CodeFile[] = [];
    let totalSize = 0;
    for (let i = 0; i < Math.min(topN, scoredFiles.length); i++) {
      const item = scoredFiles[i];
      if (item && item.file && totalSize + item.file.size <= maxTotalSize) {
        selected.push(item.file);
        totalSize += item.file.size;
      } else {
        break;
      }
    }
    logger.info(
      `Returning top ${selected.length}/${allFiles.length} priority files (${(totalSize / 1024).toFixed(2)} KB)`
    );
    return {
      files: selected,
      totalSize,
      totalFiles: allFiles.length,
    };
  }
  clearCollectedFilesCache(): void {
    const count = this.collectedFilesCache.size;
    this.collectedFilesCache.clear();
    logger.info(`Cleared collected files cache (${count} files)`);
  }
}

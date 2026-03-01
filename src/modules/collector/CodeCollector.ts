import { existsSync } from 'fs';
import puppeteer from 'rebrowser-puppeteer-core';
import type { Browser, Page, CDPSession } from 'rebrowser-puppeteer-core';
import type { CollectCodeOptions, CollectCodeResult, CodeFile, PuppeteerConfig } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { PrerequisiteError } from '../../errors/PrerequisiteError.js';
import { CodeCache } from './CodeCache.js';
import { SmartCodeCollector } from './SmartCodeCollector.js';
import { CodeCompressor } from './CodeCompressor.js';
import { calculatePriorityScore } from './PageScriptCollectors.js';
import { findBrowserExecutable } from '../../utils/browserExecutable.js';
import { collectInnerImpl } from './CodeCollectorCollectInternal.js';
import { shouldCollectUrlImpl, navigateWithRetryImpl, getPerformanceMetricsImpl, collectPageMetadataImpl } from './CodeCollectorUtilsInternal.js';

interface ChromeLike {
  runtime: Record<string, unknown>;
  loadTimes: () => void;
  csi: () => void;
  app: Record<string, unknown>;
}

interface WindowWithChrome extends Window {
  chrome?: ChromeLike;
}

export class CodeCollector {
  private config: PuppeteerConfig;
  private browser: Browser | null = null;
  private collectedUrls: Set<string> = new Set();
  private initPromise: Promise<void> | null = null;
  private collectLock: Promise<CollectCodeResult> | null = null;
  private readonly MAX_COLLECTED_URLS: number;
  private readonly MAX_FILES_PER_COLLECT: number;
  private readonly MAX_RESPONSE_SIZE: number;
  private readonly MAX_SINGLE_FILE_SIZE: number;
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
  constructor(config: PuppeteerConfig) {
    this.config = config;
    this.MAX_COLLECTED_URLS = config.maxCollectedUrls ?? 10000;
    this.MAX_FILES_PER_COLLECT = config.maxFilesPerCollect ?? 200;
    this.MAX_RESPONSE_SIZE = config.maxTotalContentSize ?? 512 * 1024;
    this.MAX_SINGLE_FILE_SIZE = config.maxSingleFileSize ?? 200 * 1024;
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
    logger.info(' Clearing all collected data...');
    await this.cache.clear();
    this.compressor.clearCache();
    this.compressor.resetStats();
    this.collectedUrls.clear();
    this.collectedFilesCache.clear();
    logger.success(' All data cleared');
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
    this.currentHeadless = useHeadless === undefined ? true : useHeadless !== false;
    this.browser.on('disconnected', () => {
      logger.warn('Browser disconnected');
      this.browser = null;
      this.currentHeadless = null;
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
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.currentHeadless = null;
      logger.info('Browser closed and all data cleared');
    }
  }
  async getActivePage(): Promise<Page> {
    if (!this.browser) {
      try {
        await this.init();
      } catch (error) {
        throw new PrerequisiteError(
          `Browser not available: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const pages = await this.browser!.pages();
    if (pages.length === 0) {
      return await this.browser!.newPage();
    }
    if (this.activePageIndex !== null && this.activePageIndex < pages.length) {
      return pages[this.activePageIndex]!;
    }
    const lastPage = pages[pages.length - 1];
    if (!lastPage) {
      throw new Error('Failed to get active page');
    }
    return lastPage;
  }
  async listPages(): Promise<Array<{ index: number; url: string; title: string }>> {
    if (!this.browser) {
      return [];
    }
    const pages = await this.browser.pages();
    const results = await Promise.all(
      pages.map(async (page, index) => {
        let url = '';
        let title = '';
        try { url = page.url(); } catch { /* ignore */ }
        try { title = await page.title(); } catch { /* ignore */ }
        return { index, url, title };
      })
    );
    return results;
  }
  async selectPage(index: number): Promise<void> {
    if (!this.browser) {
      throw new Error('Browser not connected');
    }
    const pages = await this.browser.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Page index ${index} out of range (0-${pages.length - 1})`);
    }
    this.activePageIndex = index;
    logger.info(`Active page set to index ${index}: ${pages[index]!.url()}`);
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
      const pages = await this.browser.pages();
      const version = await this.browser.version();
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
      try { await this.collectLock; } catch { /* ignore predecessor failures */ }
    }
    let resolve!: (v: CollectCodeResult) => void;
    let reject!: (e: unknown) => void;
    this.collectLock = new Promise<CollectCodeResult>((res, rej) => { resolve = res; reject = rej; });
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
  async connect(endpoint: string): Promise<void> {
    if (this.browser) {
      try { await this.browser.disconnect(); } catch { /* ignore */ }
      this.browser = null;
      this.currentHeadless = null;
    }
    this.activePageIndex = null;
    logger.info(`Connecting to existing browser: ${endpoint}`);
    const connectOptions =
      endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
        ? { browserWSEndpoint: endpoint }
        : { browserURL: endpoint };
    this.browser = await puppeteer.connect(connectOptions);
    this.browser.on('disconnected', () => {
      logger.warn('Browser disconnected');
      this.browser = null;
      this.currentHeadless = null;
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
    logger.info(` Returning summary of ${summaries.length} collected files`);
    return summaries;
  }
  getFileByUrl(url: string): CodeFile | null {
    const file = this.collectedFilesCache.get(url);
    if (file) {
      logger.info(` Returning file: ${url} (${(file.size / 1024).toFixed(2)} KB)`);
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
    logger.info(` Cleared collected files cache (${count} files)`);
  }
}

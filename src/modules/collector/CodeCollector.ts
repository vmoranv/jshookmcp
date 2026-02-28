import { existsSync } from 'fs';
import puppeteer from 'rebrowser-puppeteer-core';
import type { Browser, Page, CDPSession } from 'rebrowser-puppeteer-core';
import type {
  CollectCodeOptions,
  CollectCodeResult,
  CodeFile,
  PuppeteerConfig,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { CodeCache } from './CodeCache.js';
import { SmartCodeCollector, type SmartCollectOptions } from './SmartCodeCollector.js';
import { CodeCompressor } from './CodeCompressor.js';
import {
  collectInlineScripts,
  collectServiceWorkers,
  collectWebWorkers,
  analyzeDependencies,
  calculatePriorityScore,
} from './PageScriptCollectors.js';
import { findBrowserExecutable } from '../../utils/browserExecutable.js';


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
  private cacheEnabled: boolean = true;

  private smartCollector: SmartCodeCollector;
  private compressor: CodeCompressor;

  private cdpSession: CDPSession | null = null;
  private cdpListeners: {
    responseReceived?: (params: any) => void;
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

  private cleanupCollectedUrls(): void {
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
      await this.init();
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

      if (!(window as any).chrome) {
        (window as any).chrome = {
          runtime: {},
          loadTimes: function () {},
          csi: function () {},
          app: {},
        };
      }

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => {
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
    const startTime = Date.now();
    logger.info(`Collecting code from: ${options.url}`);

    if (this.cacheEnabled) {
      const cached = await this.cache.get(options.url, options as any);
      if (cached) {
        logger.info(` Cache hit for: ${options.url}`);
        return cached;
      }
    }

    await this.init();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();

    try {
      page.setDefaultTimeout(options.timeout || this.config.timeout);

      await page.setUserAgent(this.userAgent);

      await this.applyAntiDetection(page);

      const files: CodeFile[] = [];

      this.cdpSession = await page.createCDPSession();
      await this.cdpSession.send('Network.enable');
      await this.cdpSession.send('Runtime.enable');

      this.cdpListeners.responseReceived = async (params: any) => {
        const { response, requestId, type } = params;
        const url = response.url;

        if (files.length >= this.MAX_FILES_PER_COLLECT) {
          if (files.length === this.MAX_FILES_PER_COLLECT) {
            logger.warn(
              `Reached max files limit (${this.MAX_FILES_PER_COLLECT}), will skip remaining files`
            );
          }
          return;
        }

        this.cleanupCollectedUrls();

        if (type === 'Script' || response.mimeType?.includes('javascript') || url.endsWith('.js')) {
          try {
            const { body, base64Encoded } = await this.cdpSession!.send('Network.getResponseBody', {
              requestId,
            });

            const content = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

            const contentSize = content.length;

            let finalContent = content;
            let truncated = false;

            if (contentSize > this.MAX_SINGLE_FILE_SIZE) {
              finalContent = content.substring(0, this.MAX_SINGLE_FILE_SIZE);
              truncated = true;
              logger.warn(
                `[CDP] Large file truncated: ${url} (${(contentSize / 1024).toFixed(2)} KB -> ${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(2)} KB)`
              );
            }

            if (!this.collectedUrls.has(url)) {
              this.collectedUrls.add(url);
              const file: CodeFile = {
                url,
                content: finalContent,
                size: finalContent.length,
                type: 'external',
                metadata: truncated
                  ? {
                      truncated: true,
                      originalSize: contentSize,
                      truncatedSize: finalContent.length,
                    }
                  : undefined,
              };
              files.push(file);
              this.collectedFilesCache.set(url, file);

              logger.debug(
                `[CDP] Collected (${files.length}/${this.MAX_FILES_PER_COLLECT}): ${url} (${(finalContent.length / 1024).toFixed(2)} KB)${truncated ? ' [TRUNCATED]' : ''}`
              );
            }
          } catch (error) {
            logger.warn(`[CDP] Failed to get response body for: ${url}`, error);
          }
        }
      };

      this.cdpSession.on('Network.responseReceived', this.cdpListeners.responseReceived);

      logger.info(`Navigating to: ${options.url}`);
      await page.goto(options.url, {
        waitUntil: 'networkidle2',
        timeout: options.timeout || this.config.timeout,
      });

      if (options.includeInline !== false) {
        logger.info('Collecting inline scripts...');
        const inlineScripts = await collectInlineScripts(
          page,
          this.MAX_SINGLE_FILE_SIZE,
          this.MAX_FILES_PER_COLLECT
        );
        files.push(...inlineScripts);
      }

      if (options.includeServiceWorker !== false) {
        logger.info('Collecting Service Workers...');
        const serviceWorkerFiles = await collectServiceWorkers(page);
        files.push(...serviceWorkerFiles);
      }

      if (options.includeWebWorker !== false) {
        logger.info('Collecting Web Workers...');
        const webWorkerFiles = await collectWebWorkers(page);
        files.push(...webWorkerFiles);
      }

      if (options.includeDynamic) {
        logger.info('Waiting for dynamic scripts...');
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      if (this.cdpSession) {
        if (this.cdpListeners.responseReceived) {
          this.cdpSession.off('Network.responseReceived', this.cdpListeners.responseReceived);
        }
        await this.cdpSession.detach();
        this.cdpSession = null;
        this.cdpListeners = {};
      }

      const collectTime = Date.now() - startTime;
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);

      const truncatedFiles = files.filter((f) => f.metadata?.truncated);
      if (truncatedFiles.length > 0) {
        logger.warn(`${truncatedFiles.length} files were truncated due to size limits`);
        truncatedFiles.forEach((f) => {
          logger.warn(
            `  - ${f.url}: ${((f.metadata?.originalSize as number) / 1024).toFixed(2)} KB -> ${(f.size / 1024).toFixed(2)} KB`
          );
        });
      }

      let processedFiles = files;

      if (options.smartMode && options.smartMode !== 'full') {
        try {
          logger.info(` Applying smart collection mode: ${options.smartMode}`);

          const smartOptions: SmartCollectOptions = {
            mode: options.smartMode,
            maxTotalSize: options.maxTotalSize,
            maxFileSize: options.maxFileSize,
            priorities: options.priorities,
          };

          const smartResult = await this.smartCollector.smartCollect(page, files, smartOptions);

          if (options.smartMode === 'summary') {
            logger.info(` Returning ${smartResult.length} code summaries`);

            if (
              Array.isArray(smartResult) &&
              smartResult.length > 0 &&
              smartResult[0] &&
              'hasEncryption' in smartResult[0]
            ) {
              return {
                files: [],
                summaries: smartResult as Array<{
                  url: string;
                  size: number;
                  type: string;
                  hasEncryption: boolean;
                  hasAPI: boolean;
                  hasObfuscation: boolean;
                  functions: string[];
                  imports: string[];
                  preview: string;
                }>,
                dependencies: { nodes: [], edges: [] },
                totalSize: 0,
                collectTime: Date.now() - startTime,
              };
            }
          }

          if (
            Array.isArray(smartResult) &&
            (smartResult.length === 0 || (smartResult[0] && 'content' in smartResult[0]))
          ) {
            processedFiles = smartResult as CodeFile[];
          } else {
            logger.warn('Smart collection returned unexpected type, using original files');
            processedFiles = files;
          }
        } catch (error) {
          logger.error('Smart collection failed, using original files:', error);
          processedFiles = files;
        }
      }

      if (options.compress) {
        try {
          logger.info(`Compressing ${processedFiles.length} files with enhanced compressor...`);

          const filesToCompress = processedFiles
            .filter((file) => this.compressor.shouldCompress(file.content))
            .map((file) => ({
              url: file.url,
              content: file.content,
            }));

          if (filesToCompress.length === 0) {
            logger.info('No files need compression (all below threshold)');
          } else {
            const compressedResults = await this.compressor.compressBatch(filesToCompress, {
              level: undefined,
              useCache: true,
              maxRetries: 3,
              concurrency: 5,
              onProgress: (progress) => {
                if (progress % 25 === 0) {
                  logger.debug(`Compression progress: ${progress.toFixed(0)}%`);
                }
              },
            });

            const compressedMap = new Map(compressedResults.map((r) => [r.url, r]));

            for (const file of processedFiles) {
              const compressed = compressedMap.get(file.url);
              if (compressed) {
                file.metadata = {
                  ...file.metadata,
                  compressed: true,
                  originalSize: compressed.originalSize,
                  compressedSize: compressed.compressedSize,
                  compressionRatio: compressed.compressionRatio,
                };
              }
            }

            const stats = this.compressor.getStats();
            logger.info(` Compressed ${compressedResults.length}/${processedFiles.length} files`);
            logger.info(
              ` Compression stats: ${(stats.totalOriginalSize / 1024).toFixed(2)} KB -> ${(stats.totalCompressedSize / 1024).toFixed(2)} KB (${stats.averageRatio.toFixed(1)}% reduction)`
            );
            logger.info(
              ` Cache: ${stats.cacheHits} hits, ${stats.cacheMisses} misses (${stats.cacheHits > 0 ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) : 0}% hit rate)`
            );
          }
        } catch (error) {
          logger.error('Compression failed:', error);
        }
      }

      const dependencies = analyzeDependencies(processedFiles);

      logger.success(
        `Collected ${processedFiles.length} files (${(totalSize / 1024).toFixed(2)} KB) in ${collectTime}ms`
      );

      const result: CollectCodeResult = {
        files: processedFiles,
        dependencies,
        totalSize,
        collectTime,
      };

      if (this.cacheEnabled) {
        await this.cache.set(options.url, result, options as any);
        logger.debug(` Saved to cache: ${options.url}`);
      }

      return result;
    } catch (error) {
      logger.error('Code collection failed', error);
      throw error;
    } finally {
      if (this.cdpSession) {
        try {
          if (this.cdpListeners.responseReceived) {
            this.cdpSession.off('Network.responseReceived', this.cdpListeners.responseReceived);
          }
          await this.cdpSession.detach();
        } catch {
          // CDP session may already be disconnected
        }
        this.cdpSession = null;
        this.cdpListeners = {};
      }
      await page.close();
    }
  }

  shouldCollectUrl(url: string, filterRules?: string[]): boolean {
    if (!filterRules || filterRules.length === 0) {
      return true;
    }

    for (const rule of filterRules) {
      const regex = new RegExp(rule.replace(/\*/g, '.*'));
      if (regex.test(url)) {
        return true;
      }
    }

    return false;
  }

  async navigateWithRetry(
    page: Page,
    url: string,
    options: { waitUntil?: any; timeout?: number },
    maxRetries = 3
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.goto(url, options);
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Navigation attempt ${i + 1}/${maxRetries} failed: ${error}`);
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }

    throw lastError || new Error('Navigation failed after retries');
  }

  async getPerformanceMetrics(page: Page): Promise<Record<string, number>> {
    try {
      const metrics = await page.evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
          loadComplete: perf.loadEventEnd - perf.loadEventStart,
          domInteractive: perf.domInteractive - perf.fetchStart,
          totalTime: perf.loadEventEnd - perf.fetchStart,
        };
      });
      return metrics;
    } catch (error) {
      logger.warn('Failed to get performance metrics', error);
      return {};
    }
  }

  async collectPageMetadata(page: Page): Promise<Record<string, unknown>> {
    try {
      const metadata = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          cookies: document.cookie,
          localStorage: Object.keys(localStorage).length,
          sessionStorage: Object.keys(sessionStorage).length,
        };
      });
      return metadata;
    } catch (error) {
      logger.warn('Failed to collect page metadata', error);
      return {};
    }
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

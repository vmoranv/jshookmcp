import type { CollectCodeOptions, CollectCodeResult, CodeFile } from '@internal-types/index';
import type { CDPSession, Page } from 'rebrowser-puppeteer-core';
import type { CodeSummary, SmartCollectOptions } from '@modules/collector/SmartCodeCollector';
import { logger } from '@utils/logger';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { toChromeCompatibleWaitUntil } from '@modules/browser/navigation-wait-until';
import {
  collectInlineScripts,
  collectServiceWorkers,
  collectWebWorkers,
  analyzeDependencies,
  setupWebWorkerTracking,
} from '@modules/collector/PageScriptCollectors';
import {
  COLLECTOR_DEFAULT_TIMEOUT_MS,
  COLLECTOR_DYNAMIC_SCRIPT_WAIT_MS,
  COLLECTOR_COMPRESS_MAX_RETRIES,
  COLLECTOR_COMPRESS_CONCURRENCY,
  COLLECTOR_COMPRESS_PROGRESS_LOG_INTERVAL,
} from '@src/constants/browser';

/** Fallback navigation/collection timeout when neither options nor config supply one. */
const DEFAULT_COLLECTION_TIMEOUT_MS = COLLECTOR_DEFAULT_TIMEOUT_MS;
/** How long to wait after navigation for late-loading dynamic scripts. */
const DYNAMIC_SCRIPT_WAIT_MS = COLLECTOR_DYNAMIC_SCRIPT_WAIT_MS;
/** Compression batch tuning (retries per file, parallel files). */
const COMPRESS_MAX_RETRIES = COLLECTOR_COMPRESS_MAX_RETRIES;
const COMPRESS_CONCURRENCY = COLLECTOR_COMPRESS_CONCURRENCY;
/** Log compression progress every N percent. */
const COMPRESS_PROGRESS_LOG_INTERVAL = COLLECTOR_COMPRESS_PROGRESS_LOG_INTERVAL;

interface CDPResponseReceivedParams {
  response: {
    url: string;
    mimeType?: string;
  };
  requestId: string;
  type?: string;
}

interface CDPResponseBody {
  body: string;
  base64Encoded?: boolean;
}

interface CompressionStats {
  totalOriginalSize: number;
  totalCompressedSize: number;
  averageRatio: number;
  cacheHits: number;
  cacheMisses: number;
}

type CompressionResultItem = {
  url: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
};

interface TemporaryBrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface CollectorInternals {
  cacheEnabled: boolean;
  cache: {
    get(url: string, options?: Record<string, unknown>): Promise<CollectCodeResult | null>;
    set(url: string, result: CollectCodeResult, options?: Record<string, unknown>): Promise<void>;
  };
  init: () => Promise<void>;
  getActivePage?: () => Promise<Page>;
  getActivePageIndex?: () => Promise<number | null>;
  listPages?: () => Promise<Array<{ index: number; url: string; title: string }>>;
  selectPage?: (index: number) => Promise<void>;
  browser: {
    newPage(): Promise<Page>;
    createBrowserContext?: () => Promise<TemporaryBrowserContext>;
  } | null;
  config: {
    timeout?: number;
  };
  userAgent: string;
  applyAntiDetection: (page: Page) => Promise<void>;
  cdpSession: CDPSession | null;
  cdpListeners: {
    responseReceived?: (params: unknown) => Promise<void> | void;
  };
  MAX_FILES_PER_COLLECT: number;
  MAX_SINGLE_FILE_SIZE: number;
  collectedUrls: Set<string>;
  cleanupCollectedUrls: () => void;
  shouldCollectUrl: (url: string, filterRules?: string[]) => boolean;
  collectedFilesCache: Map<string, CodeFile>;
  smartCollector: {
    smartCollect(
      page: Page,
      files: CodeFile[],
      options: SmartCollectOptions,
    ): Promise<CodeFile[] | CodeSummary[]>;
  };
  compressor: {
    shouldCompress(content: string): boolean;
    compressBatch(
      files: Array<{ url: string; content: string }>,
      options: {
        level?: number;
        useCache?: boolean;
        maxRetries?: number;
        concurrency?: number;
        onProgress?: (progress: number) => void;
      },
    ): Promise<CompressionResultItem[]>;
    getStats(): CompressionStats;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isCDPResponseReceivedParams(value: unknown): value is CDPResponseReceivedParams {
  if (!isRecord(value) || !isRecord(value.response)) {
    return false;
  }

  return typeof value.response.url === 'string' && typeof value.requestId === 'string';
}

function isCodeSummary(value: unknown): value is CodeSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.url === 'string' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string' &&
    typeof value.hasEncryption === 'boolean' &&
    typeof value.hasAPI === 'boolean' &&
    typeof value.hasObfuscation === 'boolean' &&
    Array.isArray(value.functions) &&
    Array.isArray(value.imports) &&
    typeof value.preview === 'string'
  );
}

function isCodeFile(value: unknown): value is CodeFile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.url === 'string' &&
    typeof value.content === 'string' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string'
  );
}

function assertCollectorInternals(value: unknown): asserts value is CollectorInternals {
  if (!isRecord(value)) {
    throw new Error('Invalid collector context');
  }

  if (
    typeof value.init !== 'function' ||
    typeof value.applyAntiDetection !== 'function' ||
    typeof value.shouldCollectUrl !== 'function'
  ) {
    throw new Error('Invalid collector context');
  }
}

/**
 * Resolve the page to collect from, plus the bookkeeping needed to put the
 * browser back the way it was: an existing active page is reused, otherwise a
 * throwaway context is created, otherwise the browser gets a fresh page.
 */
interface CollectionPageSetup {
  page: Page;
  temporaryContext: TemporaryBrowserContext | null;
  previousActivePageIndex: number | null;
}

async function resolveCollectionPage(self: CollectorInternals): Promise<CollectionPageSetup> {
  // The caller has already rejected a null browser; bind it once so the
  // narrowing survives into the closures below.
  const browser = self.browser;
  if (!browser) {
    throw new Error('Browser not initialized');
  }
  const activePages =
    typeof self.listPages === 'function'
      ? await self
          .listPages()
          .catch(() => [] as Array<{ index: number; url: string; title: string }>)
      : [];
  const activePageContext =
    activePages.length > 0 && typeof self.getActivePage === 'function'
      ? await self
          .getActivePage()
          .then((page) => page.browserContext())
          .catch((error) => {
            logger.debug('Failed to resolve active browser context before code collection:', error);
            return null;
          })
      : null;

  const temporaryContext =
    activePageContext === null && typeof browser.createBrowserContext === 'function'
      ? await browser.createBrowserContext()
      : null;

  let previousActivePageIndex: number | null = null;
  if (
    (activePageContext !== null || !temporaryContext) &&
    typeof self.getActivePageIndex === 'function'
  ) {
    try {
      previousActivePageIndex = await self.getActivePageIndex();
    } catch (error) {
      logger.debug('Failed to capture active page index before code collection:', error);
    }
  }

  const page =
    activePageContext !== null
      ? await activePageContext.newPage()
      : temporaryContext
        ? await temporaryContext.newPage()
        : await browser.newPage();

  return { page, temporaryContext, previousActivePageIndex };
}

/** Resolve the effective timeout: options → instance config → collector config → fallback. */
function resolveCollectionTimeout(self: CollectorInternals, options: CollectCodeOptions): number {
  const collectorConfig = getReverseEngineeringConfig().collector;
  return (
    options.timeout ??
    self.config.timeout ??
    collectorConfig.defaultTimeoutMs ??
    DEFAULT_COLLECTION_TIMEOUT_MS
  );
}

/** Append files without exceeding the per-collection cap, logging any truncation. */
function makeFileAppender(self: CollectorInternals, files: CodeFile[]) {
  return function appendFilesWithinLimit(incoming: CodeFile[], label: string): void {
    const remaining = self.MAX_FILES_PER_COLLECT - files.length;

    if (remaining <= 0) {
      logger.warn(`Reached max files limit (${self.MAX_FILES_PER_COLLECT}), skipping ${label}`);
      return;
    }

    if (incoming.length > remaining) {
      logger.warn(
        `Collected ${incoming.length} ${label}, limiting to remaining ${remaining} files`,
      );
    }

    files.push(...incoming.slice(0, remaining));
  };
}

/**
 * Handle one `Network.responseReceived` event: fetch the body and record the
 * script as a collected file.
 *
 * The quota is re-checked after awaiting the body because concurrent responses
 * can fill it while this one is in flight.
 */
async function handleResponseReceived(
  self: CollectorInternals,
  options: CollectCodeOptions,
  files: CodeFile[],
  appendFilesWithinLimit: (incoming: CodeFile[], label: string) => void,
  params: unknown,
): Promise<void> {
  if (!isCDPResponseReceivedParams(params)) {
    return;
  }

  const { response, requestId, type } = params;
  const url = response.url;

  if (files.length >= self.MAX_FILES_PER_COLLECT) {
    if (files.length === self.MAX_FILES_PER_COLLECT) {
      logger.warn(
        `Reached max files limit (${self.MAX_FILES_PER_COLLECT}), will skip remaining files`,
      );
    }
    return;
  }

  self.cleanupCollectedUrls();

  if (!(type === 'Script' || response.mimeType?.includes('javascript') || url.endsWith('.js'))) {
    return;
  }
  if (options.includeExternal === false) {
    return;
  }
  if (!self.shouldCollectUrl(url, options.filterRules)) {
    return;
  }
  if (self.collectedUrls.has(url)) {
    return;
  }

  try {
    const responseBody = (await self.cdpSession!.send('Network.getResponseBody', {
      requestId,
    })) as CDPResponseBody;

    if (typeof responseBody.body !== 'string') {
      return;
    }

    // Concurrent responses may have filled the quota while we awaited the
    // body — re-check before accepting this file.
    if (files.length >= self.MAX_FILES_PER_COLLECT) {
      return;
    }

    const content = responseBody.base64Encoded
      ? Buffer.from(responseBody.body, 'base64').toString('utf-8')
      : responseBody.body;

    const contentSize = content.length;

    let finalContent = content;
    let truncated = false;

    if (contentSize > self.MAX_SINGLE_FILE_SIZE) {
      finalContent = content.substring(0, self.MAX_SINGLE_FILE_SIZE);
      truncated = true;
      logger.warn(
        `[CDP] Large file truncated: ${url} (${(contentSize / 1024).toFixed(2)} KB -> ` +
          `${(self.MAX_SINGLE_FILE_SIZE / 1024).toFixed(2)} KB)`,
      );
    }

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
    const fileCountBeforeAppend = files.length;
    appendFilesWithinLimit([file], 'external scripts');

    // Only mark the URL as collected once it was actually accepted —
    // otherwise files dropped by the limit would be skipped forever in
    // later collections.
    if (files.length > fileCountBeforeAppend) {
      self.collectedUrls.add(url);
      self.collectedFilesCache.set(url, file);

      logger.debug(
        `[CDP] Collected (${files.length}/${self.MAX_FILES_PER_COLLECT}): ${url} (` +
          `${(finalContent.length / 1024).toFixed(2)} KB)${truncated ? ' [TRUNCATED]' : ''}`,
      );
    }
  } catch (error) {
    logger.warn(`[CDP] Failed to get response body for: ${url}`, error);
  }
}

/** Attach the CDP session and register the response listener that fills `files`. */
async function startCdpCapture(
  self: CollectorInternals,
  options: CollectCodeOptions,
  page: Page,
  files: CodeFile[],
  appendFilesWithinLimit: (incoming: CodeFile[], label: string) => void,
): Promise<void> {
  self.cdpSession = await page.createCDPSession();
  await self.cdpSession.send('Network.enable');
  await self.cdpSession.send('Runtime.enable');

  self.cdpListeners.responseReceived = async (params: unknown) => {
    await handleResponseReceived(self, options, files, appendFilesWithinLimit, params);
  };

  self.cdpSession.on('Network.responseReceived', self.cdpListeners.responseReceived);
}

/** Collect inline scripts, Service Workers and Web Workers according to options. */
async function collectSupplementaryScripts(
  self: CollectorInternals,
  options: CollectCodeOptions,
  page: Page,
  appendFilesWithinLimit: (incoming: CodeFile[], label: string) => void,
): Promise<void> {
  if (options.includeInline !== false) {
    logger.info('Collecting inline scripts...');
    const inlineScripts = await collectInlineScripts(
      page,
      self.MAX_SINGLE_FILE_SIZE,
      self.MAX_FILES_PER_COLLECT,
    );
    appendFilesWithinLimit(inlineScripts, 'inline scripts');
  }

  if (options.includeServiceWorker !== false) {
    logger.info('Collecting Service Workers...');
    const serviceWorkerFiles = await collectServiceWorkers(page, (url) =>
      self.shouldCollectUrl(url, options.filterRules),
    );
    appendFilesWithinLimit(serviceWorkerFiles, 'service workers');
  }

  if (options.includeWebWorker !== false) {
    logger.info('Collecting Web Workers...');
    const webWorkerFiles = await collectWebWorkers(page, (url) =>
      self.shouldCollectUrl(url, options.filterRules),
    );
    appendFilesWithinLimit(webWorkerFiles, 'web workers');
  }
}

/** Detach the CDP session and drop its listener registrations. */
async function stopCdpCapture(self: CollectorInternals): Promise<void> {
  if (!self.cdpSession) {
    return;
  }
  if (self.cdpListeners.responseReceived) {
    self.cdpSession.off('Network.responseReceived', self.cdpListeners.responseReceived);
  }
  await self.cdpSession.detach();
  self.cdpSession = null;
  self.cdpListeners = {};
}

/** Log every file that had to be truncated at collection time. */
function reportTruncatedFiles(files: CodeFile[]): void {
  const truncatedFiles = files.filter((f) => f.metadata?.truncated);
  if (truncatedFiles.length === 0) {
    return;
  }
  logger.warn(`${truncatedFiles.length} files were truncated due to size limits`);
  truncatedFiles.forEach((f) => {
    const originalSize =
      typeof f.metadata?.originalSize === 'number' ? f.metadata.originalSize : f.size;
    logger.warn(
      `  - ${f.url}: ${(originalSize / 1024).toFixed(2)} KB -> ${(f.size / 1024).toFixed(2)} KB`,
    );
  });
}

/**
 * Apply a smart collection mode. Returns the summary result when the mode is
 * `summary` and the collector produced summaries, otherwise the files to carry
 * forward. Every unexpected shape falls back to the original file list.
 */
async function applySmartMode(
  self: CollectorInternals,
  options: CollectCodeOptions,
  page: Page,
  files: CodeFile[],
  startTime: number,
): Promise<{ summary: CollectCodeResult | null; files: CodeFile[] }> {
  if (!options.smartMode || options.smartMode === 'full') {
    return { summary: null, files };
  }

  try {
    logger.info(` Applying smart collection mode: ${options.smartMode}`);

    const smartOptions: SmartCollectOptions = {
      mode: options.smartMode,
      maxTotalSize: options.maxTotalSize,
      maxFileSize: options.maxFileSize,
      priorities: options.priorities,
    };

    const smartResult = await self.smartCollector.smartCollect(page, files, smartOptions);

    if (options.smartMode === 'summary') {
      logger.info(` Returning ${smartResult.length} code summaries`);

      if (Array.isArray(smartResult) && smartResult.every((item) => isCodeSummary(item))) {
        return {
          summary: {
            files: [],
            summaries: smartResult,
            dependencies: { nodes: [], edges: [] },
            totalSize: 0,
            collectTime: Date.now() - startTime,
          },
          files,
        };
      }
    }

    if (Array.isArray(smartResult) && smartResult.every((item) => isCodeFile(item))) {
      return { summary: null, files: smartResult };
    }
    logger.warn('Smart collection returned unexpected type, using original files');
    return { summary: null, files };
  } catch (error) {
    logger.error('Smart collection failed, using original files:', error);
    return { summary: null, files };
  }
}

/** Compress the collected files in place and log the resulting statistics. */
async function applyCompression(self: CollectorInternals, files: CodeFile[]): Promise<void> {
  try {
    logger.info(`Compressing ${files.length} files with enhanced compressor...`);

    const filesToCompress = files
      .filter((file) => self.compressor.shouldCompress(file.content))
      .map((file) => ({
        url: file.url,
        content: file.content,
      }));

    if (filesToCompress.length === 0) {
      logger.info('No files need compression (all below threshold)');
      return;
    }

    const compressedResults = await self.compressor.compressBatch(filesToCompress, {
      level: undefined,
      useCache: true,
      maxRetries: COMPRESS_MAX_RETRIES,
      concurrency: COMPRESS_CONCURRENCY,
      onProgress: (progress: number) => {
        if (progress % COMPRESS_PROGRESS_LOG_INTERVAL === 0) {
          logger.debug(`Compression progress: ${progress.toFixed(0)}%`);
        }
      },
    });

    const compressedMap = new Map<string, CompressionResultItem>(
      compressedResults.map((r) => [r.url, r] as [string, CompressionResultItem]),
    );

    for (const file of files) {
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

    const stats = self.compressor.getStats();
    logger.info(` Compressed ${compressedResults.length}/${files.length} files`);
    logger.info(
      ` Compression stats: ${(stats.totalOriginalSize / 1024).toFixed(2)} KB -> ` +
        `${(stats.totalCompressedSize / 1024).toFixed(2)} KB (${stats.averageRatio.toFixed(1)}% reduction)`,
    );
    logger.info(
      ` Cache: ${stats.cacheHits} hits, ${stats.cacheMisses} misses (${stats.cacheHits > 0 ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) : 0}% hit rate)`,
    );
  } catch (error) {
    logger.error('Compression failed:', error);
  }
}

/** Detach CDP and restore the page/context the collector borrowed. */
async function releaseCollectionPage(
  self: CollectorInternals,
  setup: CollectionPageSetup,
): Promise<void> {
  if (self.cdpSession) {
    try {
      await stopCdpCapture(self);
    } catch {
      // CDP session may already be disconnected
    }
    self.cdpSession = null;
    self.cdpListeners = {};
  }
  if (setup.temporaryContext) {
    try {
      await setup.temporaryContext.close();
    } catch (error) {
      logger.debug('Failed to close temporary browser context after code collection:', error);
    }
    return;
  }
  await setup.page.close();
  if (setup.previousActivePageIndex !== null && typeof self.selectPage === 'function') {
    try {
      await self.selectPage(setup.previousActivePageIndex);
    } catch (error) {
      logger.debug('Failed to restore active page after code collection:', error);
    }
  }
}

export async function collectInnerImpl(
  self: unknown,
  options: CollectCodeOptions,
): Promise<CollectCodeResult> {
  assertCollectorInternals(self);

  const startTime = Date.now();
  logger.info(`Collecting code from: ${options.url}`);
  const cacheOptions = toRecord(options);

  if (self.cacheEnabled) {
    const cached = await self.cache.get(options.url, cacheOptions);
    if (cached) {
      logger.info(` Cache hit for: ${options.url}`);
      return cached;
    }
  }

  await self.init();

  if (!self.browser) {
    throw new Error('Browser not initialized');
  }

  const setup = await resolveCollectionPage(self);
  const { page } = setup;

  try {
    const collectorConfig = getReverseEngineeringConfig().collector;
    const timeoutMs = resolveCollectionTimeout(self, options);
    page.setDefaultTimeout(timeoutMs);

    await page.setUserAgent(self.userAgent);
    await self.applyAntiDetection(page);

    if (options.includeWebWorker !== false) {
      await setupWebWorkerTracking(page);
    }

    const files: CodeFile[] = [];
    const appendFilesWithinLimit = makeFileAppender(self, files);

    await startCdpCapture(self, options, page, files, appendFilesWithinLimit);

    logger.info(`Navigating to: ${options.url}`);
    await page.goto(options.url, {
      waitUntil: toChromeCompatibleWaitUntil(),
      // Reuse the resolved timeoutMs (options → config → collector config →
      // fallback) instead of re-deriving it with `||` semantics, which would
      // ignore an explicit options.timeout of 0 and diverge from the
      // setDefaultTimeout above.
      timeout: timeoutMs,
    });

    await collectSupplementaryScripts(self, options, page, appendFilesWithinLimit);

    if (options.includeDynamic) {
      logger.info('Waiting for dynamic scripts...');
      await new Promise((resolve) =>
        setTimeout(resolve, collectorConfig.dynamicScriptWaitMs ?? DYNAMIC_SCRIPT_WAIT_MS),
      );
    }

    await stopCdpCapture(self);

    const collectTime = Date.now() - startTime;
    reportTruncatedFiles(files);

    const smart = await applySmartMode(self, options, page, files, startTime);
    if (smart.summary) {
      return smart.summary;
    }
    const processedFiles = smart.files;

    if (options.compress) {
      await applyCompression(self, processedFiles);
    }

    const dependencies = analyzeDependencies(processedFiles);
    const totalSize = processedFiles.reduce((sum, file) => sum + file.size, 0);

    logger.success(
      `Collected ${processedFiles.length} files (${(totalSize / 1024).toFixed(2)} KB) in ${collectTime}ms`,
    );

    const result: CollectCodeResult = {
      files: processedFiles,
      dependencies,
      totalSize,
      collectTime,
    };

    if (self.cacheEnabled) {
      await self.cache.set(options.url, result, cacheOptions);
      logger.debug(` Saved to cache: ${options.url}`);
    }

    return result;
  } catch (error) {
    logger.error('Code collection failed', error);
    throw error;
  } finally {
    await releaseCollectionPage(self, setup);
  }
}

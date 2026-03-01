import type { CollectCodeOptions, CollectCodeResult, CodeFile } from '../../types/index.js';
import type { CDPSession, Page } from 'rebrowser-puppeteer-core';
import type { CodeSummary, SmartCollectOptions } from './SmartCodeCollector.js';
import { logger } from '../../utils/logger.js';
import {
  collectInlineScripts,
  collectServiceWorkers,
  collectWebWorkers,
  analyzeDependencies,
} from './PageScriptCollectors.js';

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

interface CollectorInternals {
  cacheEnabled: boolean;
  cache: {
    get(url: string, options?: Record<string, unknown>): Promise<CollectCodeResult | null>;
    set(
      url: string,
      result: CollectCodeResult,
      options?: Record<string, unknown>
    ): Promise<void>;
  };
  init: () => Promise<void>;
  browser: {
    newPage(): Promise<Page>;
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
  collectedFilesCache: Map<string, CodeFile>;
  smartCollector: {
    smartCollect(
      page: Page,
      files: CodeFile[],
      options: SmartCollectOptions
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
      }
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

  if (typeof value.init !== 'function' || typeof value.applyAntiDetection !== 'function') {
    throw new Error('Invalid collector context');
  }
}

export async function collectInnerImpl(
  self: unknown,
  options: CollectCodeOptions
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

  const page = await self.browser.newPage();

  try {
    const timeoutMs = options.timeout ?? self.config.timeout ?? 30000;
    page.setDefaultTimeout(timeoutMs);

    await page.setUserAgent(self.userAgent);

    await self.applyAntiDetection(page);

    const files: CodeFile[] = [];

    self.cdpSession = await page.createCDPSession();
    await self.cdpSession.send('Network.enable');
    await self.cdpSession.send('Runtime.enable');

    self.cdpListeners.responseReceived = async (params: unknown) => {
      if (!isCDPResponseReceivedParams(params)) {
        return;
      }

      const { response, requestId, type } = params;
      const url = response.url;

      if (files.length >= self.MAX_FILES_PER_COLLECT) {
        if (files.length === self.MAX_FILES_PER_COLLECT) {
          logger.warn(
            `Reached max files limit (${self.MAX_FILES_PER_COLLECT}), will skip remaining files`
          );
        }
        return;
      }

      self.cleanupCollectedUrls();

      if (type === 'Script' || response.mimeType?.includes('javascript') || url.endsWith('.js')) {
        try {
          const responseBody = (await self.cdpSession!.send('Network.getResponseBody', {
            requestId,
          })) as CDPResponseBody;

          if (typeof responseBody.body !== 'string') {
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
              `[CDP] Large file truncated: ${url} (${(contentSize / 1024).toFixed(2)} KB -> ${(self.MAX_SINGLE_FILE_SIZE / 1024).toFixed(2)} KB)`
            );
          }

          if (!self.collectedUrls.has(url)) {
            self.collectedUrls.add(url);
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
            self.collectedFilesCache.set(url, file);

            logger.debug(
              `[CDP] Collected (${files.length}/${self.MAX_FILES_PER_COLLECT}): ${url} (${(finalContent.length / 1024).toFixed(2)} KB)${truncated ? ' [TRUNCATED]' : ''}`
            );
          }
        } catch (error) {
          logger.warn(`[CDP] Failed to get response body for: ${url}`, error);
        }
      }
    };

    self.cdpSession.on('Network.responseReceived', self.cdpListeners.responseReceived);

    logger.info(`Navigating to: ${options.url}`);
    await page.goto(options.url, {
      waitUntil: 'networkidle2',
      timeout: options.timeout || self.config.timeout,
    });

    if (options.includeInline !== false) {
      logger.info('Collecting inline scripts...');
      const inlineScripts = await collectInlineScripts(
        page,
        self.MAX_SINGLE_FILE_SIZE,
        self.MAX_FILES_PER_COLLECT
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

    if (self.cdpSession) {
      if (self.cdpListeners.responseReceived) {
        self.cdpSession.off('Network.responseReceived', self.cdpListeners.responseReceived);
      }
      await self.cdpSession.detach();
      self.cdpSession = null;
      self.cdpListeners = {};
    }

    const collectTime = Date.now() - startTime;
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    const truncatedFiles = files.filter((f) => f.metadata?.truncated);
    if (truncatedFiles.length > 0) {
      logger.warn(`${truncatedFiles.length} files were truncated due to size limits`);
      truncatedFiles.forEach((f) => {
        const originalSize =
          typeof f.metadata?.originalSize === 'number' ? f.metadata.originalSize : f.size;
        logger.warn(
          `  - ${f.url}: ${(originalSize / 1024).toFixed(2)} KB -> ${(f.size / 1024).toFixed(2)} KB`
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

        const smartResult = await self.smartCollector.smartCollect(page, files, smartOptions);

        if (options.smartMode === 'summary') {
          logger.info(` Returning ${smartResult.length} code summaries`);

          if (Array.isArray(smartResult) && smartResult.every((item) => isCodeSummary(item))) {
            return {
              files: [],
              summaries: smartResult,
              dependencies: { nodes: [], edges: [] },
              totalSize: 0,
              collectTime: Date.now() - startTime,
            };
          }
        }

        if (Array.isArray(smartResult) && smartResult.every((item) => isCodeFile(item))) {
          processedFiles = smartResult;
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
          .filter((file) => self.compressor.shouldCompress(file.content))
          .map((file) => ({
            url: file.url,
            content: file.content,
          }));

        if (filesToCompress.length === 0) {
          logger.info('No files need compression (all below threshold)');
        } else {
          const compressedResults = await self.compressor.compressBatch(filesToCompress, {
            level: undefined,
            useCache: true,
            maxRetries: 3,
            concurrency: 5,
            onProgress: (progress: number) => {
              if (progress % 25 === 0) {
                logger.debug(`Compression progress: ${progress.toFixed(0)}%`);
              }
            },
          });

          const compressedMap = new Map<string, CompressionResultItem>(
            compressedResults.map((r) => [r.url, r] as [string, CompressionResultItem])
          );

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

          const stats = self.compressor.getStats();
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

    if (self.cacheEnabled) {
      await self.cache.set(options.url, result, cacheOptions);
      logger.debug(` Saved to cache: ${options.url}`);
    }

    return result;
  } catch (error) {
    logger.error('Code collection failed', error);
    throw error;
  } finally {
    if (self.cdpSession) {
      try {
        if (self.cdpListeners.responseReceived) {
          self.cdpSession.off('Network.responseReceived', self.cdpListeners.responseReceived);
        }
        await self.cdpSession.detach();
      } catch {
        // CDP session may already be disconnected
      }
      self.cdpSession = null;
      self.cdpListeners = {};
    }
    await page.close();
  }
}

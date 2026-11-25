import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { logger } from '@utils/logger';
import {
  CODE_COMPRESSOR_RETRY_BACKOFF_MS,
  CODE_COMPRESSOR_MIN_THRESHOLD_BYTES,
  CODE_COMPRESSOR_MAX_RECURSION_DEPTH,
} from '@src/constants/browser';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Chunked-envelope format name used by compressStream. */
const CHUNKED_FORMAT = 'code-compressor-chunks';
/** JSON envelope marker used by compressStream to wrap per-chunk payloads. */
const CHUNKED_FORMAT_PREFIX = `{"format":"${CHUNKED_FORMAT}"`;
/** Base (ms) for the linear retry backoff: `base * attempt`. */
const RETRY_BACKOFF_BASE_MS = CODE_COMPRESSOR_RETRY_BACKOFF_MS;
/** Compression-level selection tiers (bytes). */
const LEVEL_SMALL_THRESHOLD_BYTES = 10 * 1024;
const LEVEL_MEDIUM_THRESHOLD_BYTES = 100 * 1024;
const LEVEL_LARGE_THRESHOLD_BYTES = 1024 * 1024;
/** gzip levels chosen per size tier. */
const LEVEL_SMALL = 1;
const LEVEL_MEDIUM = 6;
const LEVEL_LARGE = 9;
/** Default compression level for compress() when no tier applies. */
const DEFAULT_LEVEL = LEVEL_MEDIUM;
/** Default `shouldCompress` threshold (bytes) — content below this is kept raw. */
const COMPRESS_MIN_THRESHOLD_BYTES = CODE_COMPRESSOR_MIN_THRESHOLD_BYTES;
/** Max nesting depth for chunked payloads — guards decompress() recursion
 *  against adversarial deeply-nested `{"format":"code-compressor-chunks"}` envelopes. */
const MAX_RECURSION_DEPTH = CODE_COMPRESSOR_MAX_RECURSION_DEPTH;

export interface CompressedCode {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  level?: number;
  chunks?: number;
  metadata?: {
    hash: string;
    timestamp: number;
    compressionTime: number;
  };
}

export interface CompressOptions {
  level?: number;
  chunkSize?: number;
  useCache?: boolean;
  maxRetries?: number;
  onProgress?: (progress: number) => void;
}

export interface BatchCompressOptions extends CompressOptions {
  concurrency?: number;
  onFileProgress?: (file: string, progress: number) => void;
}

export interface CompressionStats {
  totalCompressed: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  averageRatio: number;
  cacheHits: number;
  cacheMisses: number;
  totalTime: number;
}

interface CacheEntry {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  timestamp: number;
}

export class CodeCompressor {
  private readonly DEFAULT_CHUNK_SIZE = 100 * 1024;
  private readonly DEFAULT_CONCURRENCY = 5;
  private readonly DEFAULT_MAX_RETRIES = 3;
  private readonly CACHE_MAX_SIZE = 100;
  private readonly CACHE_TTL = 3600 * 1000;

  private cache: Map<string, CacheEntry> = new Map();

  private stats: CompressionStats = {
    totalCompressed: 0,
    totalOriginalSize: 0,
    totalCompressedSize: 0,
    averageRatio: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTime: 0,
  };

  async compress(code: string, options: CompressOptions = {}): Promise<CompressedCode> {
    const startTime = Date.now();
    const level = options.level ?? DEFAULT_LEVEL;
    const useCache = options.useCache ?? true;
    const maxRetries = options.maxRetries ?? this.DEFAULT_MAX_RETRIES;

    const cacheKey = this.generateCacheKey(code, level);

    if (useCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.stats.cacheHits++;
        logger.debug(`Cache hit for compression (${code.length} bytes)`);
        return {
          compressed: cached.compressed,
          originalSize: cached.originalSize,
          compressedSize: cached.compressedSize,
          compressionRatio: cached.compressionRatio,
          level,
        };
      } else {
        this.cache.delete(cacheKey);
      }
    }

    this.stats.cacheMisses++;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const buffer = Buffer.from(code, 'utf-8');
        const compressed = await gzipAsync(buffer, { level });
        const base64 = compressed.toString('base64');

        const originalSize = buffer.length;
        const compressedSize = compressed.length;
        const compressionRatio = (1 - compressedSize / originalSize) * 100;
        const compressionTime = Date.now() - startTime;

        this.stats.totalCompressed++;
        this.stats.totalOriginalSize += originalSize;
        this.stats.totalCompressedSize += compressedSize;
        this.stats.averageRatio =
          (1 - this.stats.totalCompressedSize / this.stats.totalOriginalSize) * 100;
        this.stats.totalTime += compressionTime;

        const result: CompressedCode = {
          compressed: base64,
          originalSize,
          compressedSize,
          compressionRatio,
          level,
          metadata: {
            hash: cacheKey,
            timestamp: Date.now(),
            compressionTime,
          },
        };

        if (useCache) {
          this.addToCache(cacheKey, {
            compressed: base64,
            originalSize,
            compressedSize,
            compressionRatio,
            timestamp: Date.now(),
          });
        }

        logger.debug(
          `Compressed code: ${originalSize} -> ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction, ` +
            `level ${level}, ${compressionTime}ms)`,
        );

        return result;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Compression attempt ${attempt + 1}/${maxRetries} failed:`, error);

        if (attempt < maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BACKOFF_BASE_MS * (attempt + 1)),
          );
        }
      }
    }

    logger.error('Failed to compress code after retries:', lastError);
    throw lastError || new Error('Compression failed');
  }

  async decompress(compressed: string, maxRetries?: number, depth = 0): Promise<string> {
    const retries = maxRetries ?? this.DEFAULT_MAX_RETRIES;
    // Multi-chunk payload produced by compressStream: a JSON envelope whose
    // chunks are individually gzip+base64 compressed.
    if (compressed.startsWith(CHUNKED_FORMAT_PREFIX)) {
      try {
        if (depth >= MAX_RECURSION_DEPTH) {
          throw new Error(
            `Nested chunked payload exceeds max recursion depth ${MAX_RECURSION_DEPTH}`,
          );
        }
        const parsed = JSON.parse(compressed) as { chunks?: string[] };
        if (parsed.chunks) {
          const parts = await Promise.all(
            parsed.chunks.map((chunk) => this.decompress(chunk, retries, depth + 1)),
          );
          return parts.join('');
        }
      } catch (error) {
        logger.error('Failed to decompress chunked payload:', error);
        throw new Error('Failed to decompress chunked payload', { cause: error });
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const buffer = Buffer.from(compressed, 'base64');
        const decompressed = await gunzipAsync(buffer);
        return decompressed.toString('utf-8');
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Decompression attempt ${attempt + 1}/${retries} failed:`, error);

        if (attempt < retries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BACKOFF_BASE_MS * (attempt + 1)),
          );
        }
      }
    }

    logger.error('Failed to decompress code after retries:', lastError);
    throw lastError || new Error('Decompression failed');
  }

  async compressBatch(
    files: Array<{ url: string; content: string }>,
    options: BatchCompressOptions = {},
  ): Promise<
    Array<{
      url: string;
      compressed: string;
      originalSize: number;
      compressedSize: number;
      compressionRatio: number;
    }>
  > {
    const requestedConcurrency = options.concurrency ?? this.DEFAULT_CONCURRENCY;
    // `concurrency` is the loop step: 0/NaN/negative would never terminate.
    const concurrency =
      Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
        ? Math.floor(requestedConcurrency)
        : this.DEFAULT_CONCURRENCY;
    const results: Array<{
      url: string;
      compressed: string;
      originalSize: number;
      compressedSize: number;
      compressionRatio: number;
    }> = [];

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            const result = await this.compress(file.content, options);

            if (options.onFileProgress) {
              options.onFileProgress(file.url, 100);
            }

            return {
              url: file.url,
              compressed: result.compressed,
              originalSize: result.originalSize,
              compressedSize: result.compressedSize,
              compressionRatio: result.compressionRatio,
            };
          } catch (error) {
            logger.error(`Failed to compress ${file.url}:`, error);
            return {
              url: file.url,
              compressed: Buffer.from(file.content).toString('base64'),
              originalSize: file.content.length,
              compressedSize: file.content.length,
              compressionRatio: 0,
            };
          }
        }),
      );

      results.push(...batchResults);

      if (options.onProgress) {
        options.onProgress((results.length / files.length) * 100);
      }
    }

    const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
    const totalCompressed = results.reduce((sum, r) => sum + r.compressedSize, 0);
    const totalRatio = totalOriginal > 0 ? (1 - totalCompressed / totalOriginal) * 100 : 0;

    logger.info(
      `Batch compression: ${results.length} files, ${(totalOriginal / 1024).toFixed(2)} KB -> ` +
        `${(totalCompressed / 1024).toFixed(2)} KB (${totalRatio.toFixed(1)}% reduction)`,
    );

    return results;
  }

  shouldCompress(code: string, threshold: number = COMPRESS_MIN_THRESHOLD_BYTES): boolean {
    return code.length > threshold;
  }

  selectCompressionLevel(size: number): number {
    if (size < LEVEL_SMALL_THRESHOLD_BYTES) {
      return LEVEL_SMALL;
    } else if (size < LEVEL_MEDIUM_THRESHOLD_BYTES) {
      return LEVEL_MEDIUM;
    } else if (size < LEVEL_LARGE_THRESHOLD_BYTES) {
      return LEVEL_LARGE;
    } else {
      return LEVEL_MEDIUM;
    }
  }

  async compressStream(code: string, options: CompressOptions = {}): Promise<CompressedCode> {
    const chunkSize = options.chunkSize ?? this.DEFAULT_CHUNK_SIZE;

    if (code.length <= chunkSize) {
      return this.compress(code, options);
    }

    const startTime = Date.now();
    const chunks: string[] = [];

    for (let i = 0; i < code.length; i += chunkSize) {
      const chunk = code.substring(i, i + chunkSize);
      const compressed = await this.compress(chunk, { ...options, useCache: false });
      chunks.push(compressed.compressed);

      if (options.onProgress) {
        options.onProgress((i / code.length) * 100);
      }
    }

    const combined = JSON.stringify({ format: CHUNKED_FORMAT, chunks });
    // Emit the JSON envelope as-is (not re-base64'd): decompress() recognises
    // the chunked format and restores each chunk individually.
    const finalCompressed = combined;

    const originalSize = code.length;
    const compressedSize = Buffer.byteLength(finalCompressed, 'utf-8');
    const compressionRatio = (1 - compressedSize / originalSize) * 100;
    const compressionTime = Date.now() - startTime;

    logger.info(
      `Stream compression: ${chunks.length} chunks, ${(originalSize / 1024).toFixed(2)} KB -> ` +
        `${(compressedSize / 1024).toFixed(2)} KB (${compressionRatio.toFixed(1)}% reduction, ${compressionTime}ms)`,
    );

    return {
      compressed: finalCompressed,
      originalSize,
      compressedSize,
      compressionRatio,
      chunks: chunks.length,
      metadata: {
        hash: this.generateCacheKey(code, options.level ?? DEFAULT_LEVEL),
        timestamp: Date.now(),
        compressionTime,
      },
    };
  }

  getStats(): CompressionStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalCompressed: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      averageRatio: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalTime: 0,
    };
  }

  clearCache(): void {
    this.cache.clear();
    logger.info('Compression cache cleared');
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  private generateCacheKey(code: string, level: number): string {
    const hash = createHash('md5').update(code).digest('hex');
    return `${hash}-${level}`;
  }

  private addToCache(key: string, entry: CacheEntry): void {
    if (this.cache.size >= this.CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }
}

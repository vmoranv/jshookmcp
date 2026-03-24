import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { logger } from '@utils/logger';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

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
  private readonly DEFAULT_LEVEL = 6;
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
    const level = options.level ?? this.DEFAULT_LEVEL;
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
          `Compressed code: ${originalSize} -> ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction, level ${level}, ${compressionTime}ms)`,
        );

        return result;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Compression attempt ${attempt + 1}/${maxRetries} failed:`, error);

        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }

    logger.error('Failed to compress code after retries:', lastError);
    throw lastError || new Error('Compression failed');
  }

  async decompress(compressed: string, maxRetries: number = 3): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const buffer = Buffer.from(compressed, 'base64');
        const decompressed = await gunzipAsync(buffer);
        return decompressed.toString('utf-8');
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Decompression attempt ${attempt + 1}/${maxRetries} failed:`, error);

        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
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
    const concurrency = options.concurrency ?? this.DEFAULT_CONCURRENCY;
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
      `Batch compression: ${results.length} files, ${(totalOriginal / 1024).toFixed(2)} KB -> ${(totalCompressed / 1024).toFixed(2)} KB (${totalRatio.toFixed(1)}% reduction)`,
    );

    return results;
  }

  shouldCompress(code: string, threshold: number = 1024): boolean {
    return code.length > threshold;
  }

  selectCompressionLevel(size: number): number {
    if (size < 10 * 1024) {
      return 1;
    } else if (size < 100 * 1024) {
      return 6;
    } else if (size < 1024 * 1024) {
      return 9;
    } else {
      return 6;
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

    const combined = JSON.stringify(chunks);
    const finalCompressed = Buffer.from(combined).toString('base64');

    const originalSize = code.length;
    const compressedSize = finalCompressed.length;
    const compressionRatio = (1 - compressedSize / originalSize) * 100;
    const compressionTime = Date.now() - startTime;

    logger.info(
      `Stream compression: ${chunks.length} chunks, ${(originalSize / 1024).toFixed(2)} KB -> ${(compressedSize / 1024).toFixed(2)} KB (${compressionRatio.toFixed(1)}% reduction, ${compressionTime}ms)`,
    );

    return {
      compressed: finalCompressed,
      originalSize,
      compressedSize,
      compressionRatio,
      chunks: chunks.length,
      metadata: {
        hash: this.generateCacheKey(code, options.level ?? this.DEFAULT_LEVEL),
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

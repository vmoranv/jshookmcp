import { logger } from './logger.js';

export interface DataSummary {
  type: string;
  size: number;
  sizeKB: string;
  preview: string;
  structure?: {
    keys?: string[];
    methods?: string[];
    properties?: string[];
    length?: number;
  };
}

export interface DetailedDataResponse {
  summary: DataSummary;
  detailId: string;
  hint: string;
  expiresAt: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  size: number;
}

export class DetailedDataManager {
  private static instance: DetailedDataManager | undefined;
  private cache = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private readonly DEFAULT_TTL = 30 * 60 * 1000;
  private readonly MAX_TTL = 60 * 60 * 1000;
  private readonly MAX_CACHE_SIZE = 100;

  private readonly AUTO_EXTEND_ON_ACCESS = true;
  private readonly EXTEND_DURATION = 15 * 60 * 1000;

  /** Memo cache to avoid re-serializing the same object within a single call chain */
  private serializationMemo = new WeakMap<object, { json: string; size: number }>();

  private constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  static getInstance(): DetailedDataManager {
    if (!this.instance) {
      this.instance = new DetailedDataManager();
    }
    return this.instance;
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    // Reset singleton so next getInstance() creates a fresh instance with interval
    DetailedDataManager.instance = undefined;
    logger.info('DetailedDataManager shut down');
  }

  /**
   * Serialize data with memoization to avoid redundant JSON.stringify calls.
   * Objects are cached in a WeakMap so the memo is automatically GC'd.
   */
  private serializeWithMemo(data: unknown): { json: string; size: number } {
    if (data !== null && typeof data === 'object') {
      const cached = this.serializationMemo.get(data);
      if (cached) return cached;
    }

    const json = JSON.stringify(data);
    const result = { json, size: json.length };

    if (data !== null && typeof data === 'object') {
      this.serializationMemo.set(data, result);
    }

    return result;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  private readPathSegment(value: unknown, key: string): unknown {
    return (Object(value) as Record<string, unknown>)[key];
  }

  smartHandle<T>(data: T, threshold = 50 * 1024): T | DetailedDataResponse {
    const { json: jsonStr, size } = this.serializeWithMemo(data);

    if (size <= threshold) {
      return data;
    }

    logger.info(`Data too large (${(size / 1024).toFixed(1)}KB), returning summary with detailId`);
    return this.createDetailedResponseWithSize(data, jsonStr, size);
  }

  private createDetailedResponseWithSize(
    data: unknown,
    jsonStr: string,
    size: number
  ): DetailedDataResponse {
    const detailId = this.storeWithSize(data, size);
    const summary = this.generateSummaryFromJson(data, jsonStr, size);

    return {
      summary,
      detailId,
      hint: `Data too large. Use get_detailed_data("${detailId}") to retrieve full data, or get_detailed_data("${detailId}", path="key.subkey") for specific part.`,
      expiresAt: Date.now() + this.DEFAULT_TTL,
    };
  }

  store<T>(data: T, customTTL?: number): string {
    const { size } = this.serializeWithMemo(data);
    return this.storeWithSize(data, size, customTTL);
  }

  private storeWithSize(data: unknown, size: number, customTTL?: number): string {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }

    const detailId = `detail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    const ttl = customTTL || this.DEFAULT_TTL;
    const expiresAt = now + ttl;

    const entry: CacheEntry = {
      data,
      expiresAt,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      size,
    };

    this.cache.set(detailId, entry);
    logger.debug(
      `Stored detailed data: ${detailId}, size: ${(size / 1024).toFixed(1)}KB, expires in ${ttl / 1000}s`
    );

    return detailId;
  }

  retrieve<T = unknown>(detailId: string, path?: string): T {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found or expired: ${detailId}`);
    }

    const now = Date.now();

    if (now > cached.expiresAt) {
      this.cache.delete(detailId);
      throw new Error(`DetailId expired: ${detailId}`);
    }

    cached.lastAccessedAt = now;
    cached.accessCount++;

    if (this.AUTO_EXTEND_ON_ACCESS) {
      const remainingTime = cached.expiresAt - now;
      if (remainingTime < 5 * 60 * 1000) {
        cached.expiresAt = Math.min(now + this.EXTEND_DURATION, now + this.MAX_TTL);
        logger.debug(
          `Auto-extended detailId ${detailId}, new expiry: ${new Date(cached.expiresAt).toISOString()}`
        );
      }
    }

    if (path) {
      return this.getByPath(cached.data, path) as T;
    }

    return cached.data as T;
  }

  private getByPath(obj: unknown, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        throw new Error(`Path not found: ${path} (stopped at ${key})`);
      }
      current = this.readPathSegment(current, key);
    }

    return current;
  }

  private generateSummaryFromJson(data: unknown, jsonStr: string, size: number): DataSummary {
    const type = Array.isArray(data) ? 'array' : typeof data;

    const summary: DataSummary = {
      type,
      size,
      sizeKB: (size / 1024).toFixed(1) + 'KB',
      preview: jsonStr.substring(0, 200) + (size > 200 ? '...' : ''),
    };

    if (this.isRecord(data)) {
      const keys = Object.keys(data);
      summary.structure = {
        keys: keys.slice(0, 50),
      };

      if (!Array.isArray(data)) {
        const methods = keys.filter((k) => typeof data[k] === 'function');
        const properties = keys.filter((k) => typeof data[k] !== 'function');

        summary.structure.methods = methods.slice(0, 30);
        summary.structure.properties = properties.slice(0, 30);
      } else {
        summary.structure.length = data.length;
      }
    }

    return summary;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired detailed data entries`);
    }
  }

  private evictLRU(): void {
    if (this.cache.size === 0) return;

    let oldestId: string | null = null;
    let oldestAccessTime = Infinity;

    for (const [id, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccessTime) {
        oldestAccessTime = entry.lastAccessedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      const entry = this.cache.get(oldestId)!;
      this.cache.delete(oldestId);
      logger.info(
        `Evicted LRU entry: ${oldestId}, last accessed: ${new Date(entry.lastAccessedAt).toISOString()}, access count: ${entry.accessCount}`
      );
    }
  }

  extend(detailId: string, additionalTime?: number): void {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found: ${detailId}`);
    }

    const now = Date.now();
    if (now > cached.expiresAt) {
      throw new Error(`DetailId already expired: ${detailId}`);
    }

    const extendBy = additionalTime || this.EXTEND_DURATION;
    const newExpiresAt = Math.min(cached.expiresAt + extendBy, now + this.MAX_TTL);
    cached.expiresAt = newExpiresAt;

    logger.info(
      `Extended detailId ${detailId} by ${extendBy / 1000}s, new expiry: ${new Date(newExpiresAt).toISOString()}`
    );
  }

  getStats() {
    let totalSize = 0;
    let totalAccessCount = 0;
    const entries = Array.from(this.cache.values());

    for (const entry of entries) {
      totalSize += entry.size;
      totalAccessCount += entry.accessCount;
    }

    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.MAX_CACHE_SIZE,
      defaultTTLSeconds: this.DEFAULT_TTL / 1000,
      maxTTLSeconds: this.MAX_TTL / 1000,
      totalSizeKB: (totalSize / 1024).toFixed(1),
      avgAccessCount: entries.length > 0 ? (totalAccessCount / entries.length).toFixed(1) : '0',
      autoExtendEnabled: this.AUTO_EXTEND_ON_ACCESS,
      extendDurationSeconds: this.EXTEND_DURATION / 1000,
    };
  }

  getDetailedStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([id, entry]) => ({
      detailId: id,
      sizeKB: (entry.size / 1024).toFixed(1),
      createdAt: new Date(entry.createdAt).toISOString(),
      lastAccessedAt: new Date(entry.lastAccessedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      remainingSeconds: Math.max(0, Math.floor((entry.expiresAt - now) / 1000)),
      accessCount: entry.accessCount,
      isExpired: now > entry.expiresAt,
    }));

    entries.sort(
      (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
    );

    return entries;
  }

  clear(): void {
    this.cache.clear();
    logger.info('Cleared all detailed data cache');
  }
}

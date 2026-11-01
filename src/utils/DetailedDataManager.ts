import { logger } from '@utils/logger';
import { sanitizeForCache } from '@utils/sanitizeForCache';
import {
  DETAILED_DATA_DEFAULT_TTL_MS,
  DETAILED_DATA_MAX_TTL_MS,
  DETAILED_DATA_SMART_THRESHOLD_BYTES,
} from '@src/constants';
import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getArtifactDir } from '@utils/artifacts';
import { gzip, gunzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { ioLimit } from '@utils/concurrency';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Whether to compress persisted entries with gzip (saves ~70-90% disk). */
const ENABLE_GZIP = true;
/** Compress entries larger than this many bytes. */
const GZIP_THRESHOLD_BYTES = 1024;

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
  contentHash?: string;
}

export interface SliceOptions {
  path?: string;
  offset?: number;
  limit?: number;
}

export interface SlicedDataResult<T = unknown> {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  contentHash?: string;
  data: T;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  size: number;
  persistPath?: string; // Disk path for persisted entries
  compressed?: boolean; // Whether the persisted file is gzip-compressed
  contentHash?: string; // 16-hex content-addressed digest for CAS deduplication
}

interface PersistedMetadata {
  detailId: string;
  expiresAt: number;
  createdAt: number;
  size: number;
  compressed?: boolean;
  contentHash?: string;
}

/** Monitoring counters emitted via getStats(). */
interface PersistenceMetrics {
  diskWriteCount: number;
  diskWriteFailCount: number;
  diskReadCount: number;
  diskReadFailCount: number;
  diskReadLazyCount: number;
  gzipCompressCount: number;
  gzipDecompressCount: number;
  evictedBySizeCount: number;
  evictedByLRUCount: number;
  totalBytesWritten: number;
  totalBytesRead: number;
  persistDeferredCount: number;
  dedupHitCount: number;
}

/**
 * Snapshot returned by getStats(). All numeric metrics are plain numbers —
 * consumers must not need to parse formatted strings.
 */
export interface DetailedDataManagerStats {
  cacheSize: number;
  maxCacheSize: number;
  totalMemoryMB: number;
  maxMemoryMB: number;
  memoryUtilization: number;
  defaultTTLSeconds: number;
  maxTTLSeconds: number;
  totalSizeKB: number;
  avgAccessCount: number;
  autoExtendEnabled: boolean;
  extendDurationSeconds: number;
  persistence: {
    enabled: boolean;
    persistedCount: number;
    compressedCount: number;
    gzipEnabled: boolean;
    gzipThresholdKB: number;
  };
  metrics: PersistenceMetrics;
}

export class DetailedDataManager {
  private static instance: DetailedDataManager | undefined;
  private cache = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private persistDir: string;
  private metadataPath: string;
  private persistenceEnabled = true;
  private disposed = false;

  /** Max in-flight disk writes before new persists degrade to memory-only (a3-06). */
  private static readonly MAX_PENDING_PERSISTS = 8;
  private pendingPersistCount = 0;
  /** Serializes whole-file metadata rewrites so concurrent rebuilds cannot interleave. */
  private metadataRebuildChain: Promise<void> = Promise.resolve();
  /** Set when a rebuild is requested but not yet flushed (coalesces same-tick bursts). */
  private metadataDirty = false;
  /** Guards against appending more than one flush per synchronous burst. */
  private metadataRebuildScheduled = false;

  private readonly DEFAULT_TTL = DETAILED_DATA_DEFAULT_TTL_MS;
  private readonly MAX_TTL = DETAILED_DATA_MAX_TTL_MS;
  private readonly MAX_CACHE_SIZE = 100;
  /** Soft limit on total in-memory data (bytes). Triggers LRU eviction when exceeded. */
  private readonly MAX_TOTAL_MEMORY_BYTES = 50 * 1024 * 1024; // 50 MB

  private readonly AUTO_EXTEND_ON_ACCESS = true;
  private readonly EXTEND_DURATION = 15 * 60 * 1000;

  private contentHashIndex = new Map<string, string>();

  /** Monitoring metrics for observability. */
  private metrics: PersistenceMetrics = {
    diskWriteCount: 0,
    diskWriteFailCount: 0,
    diskReadCount: 0,
    diskReadFailCount: 0,
    diskReadLazyCount: 0,
    gzipCompressCount: 0,
    gzipDecompressCount: 0,
    evictedBySizeCount: 0,
    evictedByLRUCount: 0,
    totalBytesWritten: 0,
    totalBytesRead: 0,
    persistDeferredCount: 0,
    dedupHitCount: 0,
  };

  /**
   * Handle for the constructor's background initialisation.
   *
   * `init()` is started from the constructor and must not block it, but a
   * caller that shuts the manager down immediately still has to be able to
   * wait for that work to finish. Without a handle the async chain outlives
   * `shutdown()`: its `logger` writes then land after the surrounding worker
   * has begun tearing down (vitest reports that as
   * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
   * pending`). `shutdownAsync()` awaits this.
   */
  private initialization: Promise<void> = Promise.resolve();

  constructor() {
    this.persistDir = join(getArtifactDir('tmp'), 'detailed-data');
    this.metadataPath = join(this.persistDir, '.metadata.jsonl');
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref();
    }
    this.initialization = this.init();
  }

  /** @deprecated Use constructor injection. Kept for backward compatibility. */
  static getInstance(): DetailedDataManager {
    if (!this.instance) {
      this.instance = new DetailedDataManager();
    }
    return this.instance;
  }

  /**
   * Synchronous shutdown: stop timers and drop state immediately.
   *
   * The constructor's `init()` may still be running. Callers that need to
   * guarantee no background work remains afterwards (tests, worker teardown)
   * must use {@link shutdownAsync} instead — this method cannot wait.
   */
  shutdown(): void {
    this.disposed = true;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.contentHashIndex.clear();
    // Reset singleton so next getInstance() creates a fresh instance with interval
    DetailedDataManager.instance = undefined;
  }

  /**
   * Shutdown that also waits for the background `init()` to settle.
   *
   * `init()` checks `disposed` between its steps, so flagging it first means
   * the remaining work returns early instead of racing persistence writes.
   * Errors are already swallowed inside `init()`; this only waits.
   */
  async shutdownAsync(): Promise<void> {
    this.shutdown();
    await this.initialization;
  }

  /**
   * Resolve once the constructor's background `init()` has settled.
   *
   * Callers that immediately read persisted state (tests, any code that needs
   * the loaded cache) should await this instead of sleeping a fixed interval.
   */
  whenReady(): Promise<void> {
    return this.initialization;
  }

  private async init(): Promise<void> {
    try {
      await fs.mkdir(this.persistDir, { recursive: true });
      if (this.disposed) return;
      await this.loadPersistedEntries();
      if (this.disposed) return;
      await this.cleanupExpired();
    } catch (error) {
      if (this.disposed) return;
      logger.warn('Failed to initialize persistence, falling back to memory-only', error);
      this.persistenceEnabled = false;
    }
  }

  private async loadPersistedEntries(): Promise<void> {
    try {
      const content = await fs.readFile(this.metadataPath, 'utf-8');
      if (this.disposed) return;
      const lines = content.trim().split('\n').filter(Boolean);
      const now = Date.now();

      for (const line of lines) {
        if (this.disposed) return;
        const meta: PersistedMetadata = JSON.parse(line);
        if (meta.expiresAt > now) {
          this.cache.set(meta.detailId, {
            data: null, // Lazy load on retrieve
            expiresAt: meta.expiresAt,
            createdAt: meta.createdAt,
            lastAccessedAt: now,
            accessCount: 0,
            size: meta.size,
            persistPath: join(
              this.persistDir,
              `${meta.detailId}${meta.compressed ? '.gz' : '.json'}`,
            ),
            compressed: meta.compressed,
            contentHash: meta.contentHash,
          });
          if (meta.contentHash) {
            this.contentHashIndex.set(meta.contentHash, meta.detailId);
          }
        }
      }
      if (!this.disposed) logger.info(`Loaded ${this.cache.size} persisted detail entries`);
    } catch (error) {
      if (!this.disposed && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load persisted metadata', error);
      }
    }
  }

  private async cleanupExpired(): Promise<void> {
    if (this.disposed) return;
    if (!this.persistenceEnabled) return;

    const now = Date.now();
    const expired: Array<[string, CacheEntry]> = [];

    for (const [detailId, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        expired.push([detailId, entry]);
      }
    }

    if (expired.length > 0) {
      expired.forEach(([id, entry]) => {
        this.cache.delete(id);
        if (entry.contentHash) this.contentHashIndex.delete(entry.contentHash);
      });
      await this.discardPersistedEntries(expired.map(([, entry]) => entry));
      if (!this.disposed) logger.info(`Cleaned up ${expired.length} expired detail entries`);
    }
  }

  private async rebuildMetadata(): Promise<void> {
    if (this.disposed) return;
    if (!this.persistenceEnabled) return;

    const lines: string[] = [];
    for (const [detailId, entry] of this.cache.entries()) {
      if (entry.persistPath) {
        const meta: PersistedMetadata = {
          detailId,
          expiresAt: entry.expiresAt,
          createdAt: entry.createdAt,
          size: entry.size,
          compressed: entry.compressed,
          contentHash: entry.contentHash,
        };
        lines.push(JSON.stringify(meta));
      }
    }

    if (!this.disposed) {
      await fs.writeFile(this.metadataPath, lines.join('\n') + '\n').catch(() => {});
    }
  }

  /**
   * Queue a metadata rebuild behind any in-flight one. Fire-and-forget entry
   * removal (periodic cleanup, LRU eviction) goes through this so concurrent
   * rebuilds cannot interleave their whole-file writes, and a failed rebuild
   * never poisons the chain.
   *
   * High-eviction bursts (many `discardPersistedEntries` calls in one tick)
   * are coalesced via a dirty flag + a single scheduled flush, so N removals
   * produce one whole-file rewrite instead of N consecutive rewrites.
   */
  private queueRebuildMetadata(): Promise<void> {
    this.metadataDirty = true;
    if (!this.metadataRebuildScheduled) {
      this.metadataRebuildScheduled = true;
      this.metadataRebuildChain = this.metadataRebuildChain
        .catch(() => {})
        .then(async () => {
          // Reset the schedule flag before checking dirty: a burst arriving
          // while this flush's rebuild is in flight must schedule its own
          // (serialized) flush rather than being silently dropped.
          this.metadataRebuildScheduled = false;
          if (!this.metadataDirty) {
            return;
          }
          this.metadataDirty = false;
          await this.rebuildMetadata();
        })
        .catch((error) => logger.warn('Failed to rebuild detailed-data metadata', error));
    }
    return this.metadataRebuildChain;
  }

  /**
   * Unlink the persisted files of removed entries and rewrite the metadata
   * index, so neither the files nor their .metadata.jsonl lines outlive the
   * cache entries they describe (a2-03/a3-05).
   */
  private async discardPersistedEntries(entries: CacheEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.contentHash) {
        this.contentHashIndex.delete(entry.contentHash);
      }
    }
    if (this.disposed || !this.persistenceEnabled) return;

    const toUnlink = entries.filter((entry) => entry.persistPath);
    if (toUnlink.length > 0) {
      await Promise.all(toUnlink.map((entry) => fs.unlink(entry.persistPath!).catch(() => {})));
      if (this.disposed) return;
    }
    await this.queueRebuildMetadata();
  }

  /**
   * Serialize data. No memoization: a mutable object serialized once and
   * mutated afterwards would return a stale size, potentially bypassing the
   * smart threshold and leaking large data into the LLM context window.
   * (The smartHandle → createDetailedResponseWithSize → storeWithSize chain
   * already reuses the first serialization's json/size, so there is no
   * redundant-stringify cost to pay.)
   */
  private serializeWithMemo(data: unknown): { json: string; size: number } {
    const json = JSON.stringify(data);
    return { json, size: json.length };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  private readPathSegment(value: unknown, key: string): unknown {
    return (Object(value) as Record<string, unknown>)[key];
  }

  async smartHandle<T>(
    data: T,
    threshold = DETAILED_DATA_SMART_THRESHOLD_BYTES,
  ): Promise<T | DetailedDataResponse> {
    // SECURITY: Check strings against threshold — they can be arbitrarily large.
    // Only skip serialization for true primitives (number, boolean, null, undefined).
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object' && typeof data !== 'string') return data;
    if (typeof data === 'string') {
      if (data.length <= threshold) return data;
      // Large string — fall through to store/summarize
    }

    const { json: jsonStr, size } = this.serializeWithMemo(data);

    if (size <= threshold) {
      return data;
    }

    logger.info(`Data too large (${(size / 1024).toFixed(1)}KB), returning summary with detailId`);
    return this.createDetailedResponseWithSize(data, jsonStr, size);
  }

  private async createDetailedResponseWithSize(
    data: unknown,
    jsonStr: string,
    size: number,
  ): Promise<DetailedDataResponse> {
    const detailId = await this.storeWithSize(data, size, undefined, jsonStr);
    const summary = this.generateSummaryFromJson(data, jsonStr, size);
    const cached = this.cache.get(detailId);

    return {
      summary,
      detailId,
      contentHash: cached?.contentHash,
      hint:
        `Data too large (${(size / 1024).toFixed(1)}KB). Use get_detailed_data("${detailId}", offset=0, limit=20) ` +
        `for sliced retrieval, or get_detailed_data("${detailId}", path="key.subkey") for specific part.`,
      expiresAt: Date.now() + this.DEFAULT_TTL,
    };
  }

  async store<T>(
    data: T,
    customTTL?: number,
    options?: { deduplicate?: boolean },
  ): Promise<string> {
    const { json, size } = this.serializeWithMemo(data);
    return this.storeWithSize(data, size, customTTL, json, options?.deduplicate === true);
  }

  async storeDeduped<T>(data: T, customTTL?: number): Promise<string> {
    return this.store(data, customTTL, { deduplicate: true });
  }

  private async storeWithSize(
    data: unknown,
    size: number,
    customTTL?: number,
    precomputedJson?: string,
    deduplicate = false,
  ): Promise<string> {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }

    // CONTEXT SAFETY (issue #62): strip oversized fields (data: URIs, huge strings)
    // to disk-backed placeholders BEFORE caching, so a later get_detailed_data
    // retrieval can never re-emit multi-MB blobs into the LLM context window.
    // sanitizeForCache returns the same reference when nothing needed offloading,
    // so the common path stays a cheap no-op with no size recomputation.
    const sanitized = await sanitizeForCache(data);
    // Reuse the caller's serialization when sanitization was a no-op (a2-07:
    // persistToDisk used to stringify a second time); only re-serialize when
    // offloading actually rewrote the payload.
    let jsonForDisk: string | undefined;
    let effectiveSize: number;
    if (sanitized === data) {
      jsonForDisk = precomputedJson;
      effectiveSize = size;
    } else {
      const reserialized = this.serializeWithMemo(sanitized);
      jsonForDisk = reserialized.json;
      effectiveSize = reserialized.size;
    }

    // CAS Deduplication: check if an identical non-expired payload is already cached
    const contentHash =
      jsonForDisk !== undefined
        ? createHash('sha256').update(jsonForDisk).digest('hex').slice(0, 16)
        : undefined;

    if (deduplicate && contentHash && this.contentHashIndex.has(contentHash)) {
      const existingId = this.contentHashIndex.get(contentHash)!;
      const existingEntry = this.cache.get(existingId);
      if (existingEntry && existingEntry.expiresAt > Date.now()) {
        const ttl = customTTL || this.DEFAULT_TTL;
        existingEntry.expiresAt = Math.max(existingEntry.expiresAt, Date.now() + ttl);
        existingEntry.lastAccessedAt = Date.now();
        existingEntry.accessCount++;
        this.metrics.dedupHitCount++;
        logger.debug(
          `[DetailedDataManager] CAS deduplication hit: ${existingId} (hash=${contentHash})`,
        );
        return existingId;
      } else {
        this.contentHashIndex.delete(contentHash);
      }
    }

    const detailId = this.generateDetailId();
    const now = Date.now();
    const ttl = customTTL || this.DEFAULT_TTL;
    const expiresAt = now + ttl;

    const shouldCompress = ENABLE_GZIP && effectiveSize > GZIP_THRESHOLD_BYTES;
    const persistPath =
      this.persistenceEnabled && jsonForDisk !== undefined
        ? join(this.persistDir, `${detailId}${shouldCompress ? '.gz' : '.json'}`)
        : undefined;

    const entry: CacheEntry = {
      data: sanitized,
      expiresAt,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      size: effectiveSize,
      persistPath,
      compressed: shouldCompress,
      contentHash,
    };

    this.cache.set(detailId, entry);
    if (contentHash) {
      this.contentHashIndex.set(contentHash, detailId);
    }

    // Persist to disk asynchronously (with optional gzip compression) behind a
    // bounded concurrency gate: when too many writes are already in flight the
    // entry degrades to memory-only instead of queueing unboundedly (a3-06).
    if (persistPath && jsonForDisk !== undefined) {
      if (this.pendingPersistCount >= DetailedDataManager.MAX_PENDING_PERSISTS) {
        this.metrics.persistDeferredCount++;
        entry.persistPath = undefined;
        entry.compressed = false;
        logger.debug(
          `Persist queue saturated (${this.pendingPersistCount} in flight); kept ${detailId} in memory only`,
        );
      } else {
        void this.persistBounded(persistPath, jsonForDisk, shouldCompress)
          .then((bytesWritten) => {
            this.metrics.diskWriteCount++;
            this.metrics.totalBytesWritten += bytesWritten;
            // NIT-5: the entry may have been evicted (LRU/expiry cleanup) while
            // the write was in flight. Appending metadata for a removed entry
            // would leave a ghost line in .metadata.jsonl that rebuilds into an
            // orphaned reference on the next startup.
            if (!this.cache.has(detailId)) {
              logger.debug(
                `Skipped metadata append for evicted entry ${detailId} (persist completed after eviction)`,
              );
              return;
            }
            return this.appendMetadata({
              detailId,
              expiresAt,
              createdAt: now,
              size: effectiveSize,
              compressed: shouldCompress,
              contentHash,
            });
          })
          .catch((err) => {
            this.metrics.diskWriteFailCount++;
            logger.warn(`Failed to persist ${detailId}`, err);
          });
      }
    }

    logger.debug(
      `Stored detailed data: ${detailId}, size: ${(effectiveSize / 1024).toFixed(1)}KB, expires in ${ttl / 1000}s`,
    );

    return detailId;
  }

  /**
   * Generate a unique cache id. Uses crypto.randomUUID so ids stay unique even
   * when many stores land in the same millisecond; if the first draw collides
   * with an existing entry (astronomically unlikely with a UUID), one retry is
   * made before accepting the result (a2-13).
   */
  private generateDetailId(): string {
    const prefix = `detail_${Date.now()}_`;
    let detailId = `${prefix}${randomUUID()}`;
    if (this.cache.has(detailId)) {
      detailId = `${prefix}${randomUUID()}`;
    }
    return detailId;
  }

  private async appendMetadata(meta: PersistedMetadata): Promise<void> {
    try {
      await fs.appendFile(this.metadataPath, JSON.stringify(meta) + '\n');
    } catch (error) {
      logger.warn('Failed to append metadata', error);
    }
  }

  /**
   * Synchronous retrieval — compatibility layer for legacy callers. The
   * in-memory fast path never blocks; entries that are lazy-loaded from disk
   * after a restart fall back to a synchronous read, which blocks the event
   * loop. Prefer retrieveAsync() for disk-backed entries (a2-04).
   */
  retrieve<T = unknown>(detailId: string, path?: string): T {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found or expired: ${detailId}`);
    }

    const now = Date.now();

    if (now > cached.expiresAt) {
      this.cache.delete(detailId);
      void this.discardPersistedEntries([cached]);
      throw new Error(`DetailId expired: ${detailId}`);
    }

    // Lazy load from disk if data is null
    if (cached.data === null && cached.persistPath) {
      this.loadPersistedDataSync(detailId, cached);
    }

    this.touchEntry(detailId, cached, now);

    if (path) {
      return this.getByPath(cached.data, path) as T;
    }

    return cached.data as T;
  }

  /**
   * Asynchronous retrieval. Same semantics as retrieve(), but the lazy disk
   * read uses fs.promises.readFile + promisified gunzip so a multi-MB entry
   * never freezes the event loop (a2-04). This is the path get_detailed_data
   * takes.
   */
  async retrieveAsync<T = unknown>(detailId: string, path?: string): Promise<T> {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found or expired: ${detailId}`);
    }

    const now = Date.now();

    if (now > cached.expiresAt) {
      this.cache.delete(detailId);
      // Fire-and-forget like the sync path: maintenance (unlink + metadata
      // compaction) must never block the access path. The periodic cleanup
      // timer is the guaranteed maintenance driver.
      void this.discardPersistedEntries([cached]);
      throw new Error(`DetailId expired: ${detailId}`);
    }

    // Lazy load from disk if data is null
    if (cached.data === null && cached.persistPath) {
      await this.loadPersistedData(detailId, cached);
    }

    this.touchEntry(detailId, cached, now);

    if (path) {
      return this.getByPath(cached.data, path) as T;
    }

    return cached.data as T;
  }

  /**
   * Retrieve a sliced portion of detailed data (DA slice sampling).
   * Prevents large arrays or long code strings from overwhelming LLM context windows.
   */
  async retrieveSliceAsync<T = unknown>(
    detailId: string,
    options?: SliceOptions,
  ): Promise<SlicedDataResult<T>> {
    const fullData = await this.retrieveAsync(detailId, options?.path);
    const cached = this.cache.get(detailId);
    const contentHash = cached?.contentHash;
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit !== undefined && options.limit > 0 ? options.limit : undefined;

    if (Array.isArray(fullData)) {
      const total = fullData.length;
      const effectiveLimit = limit ?? total;
      const sliced = fullData.slice(offset, offset + effectiveLimit);
      return {
        total,
        offset,
        limit: effectiveLimit,
        hasMore: offset + effectiveLimit < total,
        contentHash,
        data: sliced as unknown as T,
      };
    }

    if (typeof fullData === 'string') {
      const total = fullData.length;
      const effectiveLimit = limit ?? total;
      const sliced = fullData.slice(offset, offset + effectiveLimit);
      return {
        total,
        offset,
        limit: effectiveLimit,
        hasMore: offset + effectiveLimit < total,
        contentHash,
        data: sliced as unknown as T,
      };
    }

    if (fullData !== null && typeof fullData === 'object') {
      const keys = Object.keys(fullData);
      const total = keys.length;
      const effectiveLimit = limit ?? total;
      const slicedKeys = keys.slice(offset, offset + effectiveLimit);
      const rec = fullData as Record<string, unknown>;
      const slicedObj: Record<string, unknown> = {};
      for (const k of slicedKeys) {
        slicedObj[k] = rec[k];
      }
      return {
        total,
        offset,
        limit: effectiveLimit,
        hasMore: offset + effectiveLimit < total,
        contentHash,
        data: slicedObj as unknown as T,
      };
    }

    return {
      total: 1,
      offset: 0,
      limit: 1,
      hasMore: false,
      contentHash,
      data: fullData as T,
    };
  }

  private async loadPersistedData(detailId: string, cached: CacheEntry): Promise<void> {
    try {
      const raw = await fs.readFile(cached.persistPath!);
      if (cached.compressed) {
        const decompressed = (await gunzipAsync(raw)) as Buffer;
        cached.data = JSON.parse(decompressed.toString('utf-8'));
        this.metrics.gzipDecompressCount++;
        this.metrics.totalBytesRead += decompressed.length;
      } else {
        cached.data = JSON.parse(raw.toString('utf-8'));
        this.metrics.totalBytesRead += raw.length;
      }
      this.metrics.diskReadCount++;
      this.metrics.diskReadLazyCount++;
    } catch (error) {
      this.metrics.diskReadFailCount++;
      logger.warn(`Failed to load persisted data for ${detailId}`, error);
      throw new Error(`DetailId not found or expired: ${detailId}`, { cause: error });
    }
  }

  /** Legacy synchronous lazy-load used only by the retrieve() compat path. */
  private loadPersistedDataSync(detailId: string, cached: CacheEntry): void {
    try {
      const raw = readFileSync(cached.persistPath!);
      if (cached.compressed) {
        const decompressed = gunzipSync(raw);
        cached.data = JSON.parse(decompressed.toString('utf-8'));
        this.metrics.gzipDecompressCount++;
        this.metrics.totalBytesRead += decompressed.length;
      } else {
        cached.data = JSON.parse(raw.toString('utf-8'));
        this.metrics.totalBytesRead += raw.length;
      }
      this.metrics.diskReadCount++;
      this.metrics.diskReadLazyCount++;
    } catch (error) {
      this.metrics.diskReadFailCount++;
      logger.warn(`Failed to load persisted data for ${detailId}`, error);
      throw new Error(`DetailId not found or expired: ${detailId}`, { cause: error });
    }
  }

  private touchEntry(detailId: string, cached: CacheEntry, now: number): void {
    cached.lastAccessedAt = now;
    cached.accessCount++;

    if (this.AUTO_EXTEND_ON_ACCESS) {
      const remainingTime = cached.expiresAt - now;
      if (remainingTime < 5 * 60 * 1000) {
        cached.expiresAt = Math.min(now + this.EXTEND_DURATION, now + this.MAX_TTL);
        logger.debug(
          `Auto-extended detailId ${detailId}, new expiry: ${new Date(cached.expiresAt).toISOString()}`,
        );
      }
    }
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
        summary.structure.properties = properties.slice(0, 50);
      } else {
        summary.structure.length = data.length;
      }
    }

    return summary;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    const removed: CacheEntry[] = [];

    for (const [id, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(id);
        removed.push(cached);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired detailed data entries`);
      // Disk cleanup (unlink + metadata compaction) is fire-and-forget; cache
      // removal above stays synchronous so callers see the shrink immediately.
      void this.discardPersistedEntries(removed);
    }
  }

  private evictLRU(): void {
    if (this.cache.size === 0) return;

    // Size-aware eviction: if total memory exceeds soft limit, evict largest LRU entries
    const totalMemory = this.computeTotalMemory();
    if (totalMemory > this.MAX_TOTAL_MEMORY_BYTES) {
      this.evictBySize(totalMemory - this.MAX_TOTAL_MEMORY_BYTES);
      return;
    }

    // Standard LRU eviction by count
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
      this.metrics.evictedByLRUCount++;
      logger.debug(
        `Evicted LRU entry: ${oldestId}, last accessed: ${new Date(entry.lastAccessedAt).toISOString()}, access ` +
          `count: ${entry.accessCount}`,
      );
      void this.discardPersistedEntries([entry]);
    }
  }

  /** Evict entries (starting with least-recently-used) until `bytesToFree` bytes are freed. */
  private evictBySize(bytesToFree: number): void {
    const sorted = Array.from(this.cache.entries()).toSorted(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
    );

    let freed = 0;
    const removed: CacheEntry[] = [];
    for (const [id, entry] of sorted) {
      if (freed >= bytesToFree) break;
      this.cache.delete(id);
      removed.push(entry);
      freed += entry.size;
      this.metrics.evictedBySizeCount++;
      logger.info(`Evicted oversized entry: ${id}, freed: ${(entry.size / 1024).toFixed(1)}KB`);
    }

    if (removed.length > 0) {
      void this.discardPersistedEntries(removed);
    }
  }

  /** Compute total in-memory data size across all cache entries. */
  private computeTotalMemory(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.size;
    }
    return total;
  }

  /**
   * Persist data to disk, optionally gzip-compressed, bounded by the global
   * I/O limiter and the pending-write gate. `json` is the caller's existing
   * serialization — persistToDisk must not stringify again (a2-07).
   * Returns the number of bytes written.
   */
  private persistBounded(filePath: string, json: string, compress: boolean): Promise<number> {
    this.pendingPersistCount++;
    return ioLimit(() => this.persistToDisk(filePath, json, compress)).finally(() => {
      this.pendingPersistCount--;
    });
  }

  /**
   * Write the pre-serialized payload to disk, optionally gzip-compressed.
   * Returns the number of bytes written.
   */
  private async persistToDisk(filePath: string, json: string, compress: boolean): Promise<number> {
    if (compress) {
      const compressed = (await gzipAsync(Buffer.from(json, 'utf-8'))) as Buffer;
      await fs.writeFile(filePath, compressed);
      this.metrics.gzipCompressCount++;
      return compressed.length;
    }
    await fs.writeFile(filePath, json, 'utf-8');
    return json.length;
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
      `Extended detailId ${detailId} by ${extendBy / 1000}s, new expiry: ${new Date(newExpiresAt).toISOString()}`,
    );
  }

  getStats(): DetailedDataManagerStats {
    let totalSize = 0;
    let totalAccessCount = 0;
    let persistedCount = 0;
    let compressedCount = 0;
    const entries = Array.from(this.cache.values());

    for (const entry of entries) {
      totalSize += entry.size;
      totalAccessCount += entry.accessCount;
      if (entry.persistPath) persistedCount++;
      if (entry.compressed) compressedCount++;
    }

    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.MAX_CACHE_SIZE,
      totalMemoryMB: totalSize / (1024 * 1024),
      maxMemoryMB: this.MAX_TOTAL_MEMORY_BYTES / (1024 * 1024),
      memoryUtilization: (totalSize / this.MAX_TOTAL_MEMORY_BYTES) * 100,
      defaultTTLSeconds: this.DEFAULT_TTL / 1000,
      maxTTLSeconds: this.MAX_TTL / 1000,
      totalSizeKB: totalSize / 1024,
      avgAccessCount: entries.length > 0 ? totalAccessCount / entries.length : 0,
      autoExtendEnabled: this.AUTO_EXTEND_ON_ACCESS,
      extendDurationSeconds: this.EXTEND_DURATION / 1000,
      persistence: {
        enabled: this.persistenceEnabled,
        persistedCount,
        compressedCount,
        gzipEnabled: ENABLE_GZIP,
        gzipThresholdKB: GZIP_THRESHOLD_BYTES / 1024,
      },
      metrics: { ...this.metrics },
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
      (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime(),
    );

    return entries;
  }

  clear(): void {
    this.cache.clear();
    logger.info('Cleared all detailed data cache');
  }
}

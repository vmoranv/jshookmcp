/**
 * Disk persistence for DetailedDataManager.
 *
 * Owns the bounded write gate, gzip encode/decode, metadata append/rewrite,
 * and disk counters. Cache/LRU/expiry decisions stay in DetailedDataManager;
 * this module only moves bytes.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { gzip, gunzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { ioLimit } from '@utils/concurrency';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface PersistedMetadata {
  detailId: string;
  expiresAt: number;
  createdAt: number;
  size: number;
  compressed?: boolean;
  contentHash?: string;
}

/** Monitoring counters emitted via getStats(). */
export interface PersistenceMetrics {
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

export function createPersistenceMetrics(): PersistenceMetrics {
  return {
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
}

export class DetailedDataPersistence {
  private pendingPersistCount = 0;
  private readonly metrics: PersistenceMetrics;
  private readonly metadataPath: string;
  private readonly persistDir: string;

  constructor(persistDir: string, metadataPath: string, metrics: PersistenceMetrics) {
    this.persistDir = persistDir;
    this.metadataPath = metadataPath;
    this.metrics = metrics;
  }

  get pendingCount(): number {
    return this.pendingPersistCount;
  }

  get directory(): string {
    return this.persistDir;
  }

  get metadataFile(): string {
    return this.metadataPath;
  }

  async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.persistDir, { recursive: true });
  }

  /** Read the metadata JSONL file; returns [] when it does not exist yet. */
  async readMetadata(): Promise<PersistedMetadata[]> {
    try {
      const content = await fs.readFile(this.metadataPath, 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PersistedMetadata);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async appendMetadata(meta: PersistedMetadata): Promise<void> {
    await fs.appendFile(this.metadataPath, JSON.stringify(meta) + '\n');
  }

  async writeMetadata(lines: string[]): Promise<void> {
    await fs.writeFile(this.metadataPath, lines.join('\n') + '\n').catch(() => {});
  }

  async unlink(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => fs.unlink(path).catch(() => {})));
  }

  /**
   * Persist data behind the global I/O limiter and the pending-write gate.
   * Returns the number of bytes written.
   */
  persistBounded(filePath: string, json: string, compress: boolean): Promise<number> {
    this.pendingPersistCount++;
    return ioLimit(() => this.persist(filePath, json, compress)).finally(() => {
      this.pendingPersistCount--;
    });
  }

  async persist(filePath: string, json: string, compress: boolean): Promise<number> {
    if (compress) {
      const compressed = (await gzipAsync(Buffer.from(json, 'utf-8'))) as Buffer;
      await fs.writeFile(filePath, compressed);
      this.metrics.gzipCompressCount++;
      return compressed.length;
    }
    await fs.writeFile(filePath, json, 'utf-8');
    return json.length;
  }

  async readData(
    detailId: string,
    filePath: string,
    compressed: boolean,
  ): Promise<{ data: unknown; bytes: number }> {
    try {
      const raw = await fs.readFile(filePath);
      if (compressed) {
        const decompressed = (await gunzipAsync(raw)) as Buffer;
        const data: unknown = JSON.parse(decompressed.toString('utf-8'));
        this.metrics.gzipDecompressCount++;
        this.metrics.diskReadCount++;
        this.metrics.diskReadLazyCount++;
        return { data, bytes: decompressed.length };
      }
      const data: unknown = JSON.parse(raw.toString('utf-8'));
      this.metrics.diskReadCount++;
      this.metrics.diskReadLazyCount++;
      return { data, bytes: raw.length };
    } catch (error) {
      this.metrics.diskReadFailCount++;
      throw new Error(`DetailId not found or expired: ${detailId}`, { cause: error });
    }
  }

  /** Legacy synchronous lazy-load used only by the retrieve() compat path. */
  readDataSync(
    detailId: string,
    filePath: string,
    compressed: boolean,
  ): { data: unknown; bytes: number } {
    try {
      const raw = readFileSync(filePath);
      if (compressed) {
        const decompressed = gunzipSync(raw);
        const data: unknown = JSON.parse(decompressed.toString('utf-8'));
        this.metrics.gzipDecompressCount++;
        this.metrics.diskReadCount++;
        this.metrics.diskReadLazyCount++;
        return { data, bytes: decompressed.length };
      }
      const data: unknown = JSON.parse(raw.toString('utf-8'));
      this.metrics.diskReadCount++;
      this.metrics.diskReadLazyCount++;
      return { data, bytes: raw.length };
    } catch (error) {
      this.metrics.diskReadFailCount++;
      throw new Error(`DetailId not found or expired: ${detailId}`, { cause: error });
    }
  }
}

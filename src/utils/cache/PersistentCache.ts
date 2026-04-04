import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { logger } from '@utils/logger';
import { getProjectRoot } from '@utils/outputPaths';

// better-sqlite3 is an optional dependency — lazy-load to fail gracefully
let Database: typeof import('better-sqlite3');
try {
  Database = require('better-sqlite3');
} catch {
  // Will be handled in loadDatabase() method
}

export interface PersistentCacheOptions {
  /** Cache name for logging */
  name?: string;
  /** Database file path (relative to project root or absolute) */
  dbPath?: string;
  /** Default TTL in milliseconds */
  defaultTTL?: number;
  /** Enable/disable cache */
  enabled?: boolean;
}

interface CacheEntry {
  key: string;
  value: string; // JSON stringified wrapped value: { __cached: true, data: actualValue }
  expiresAt: number;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export class PersistentCache {
  private db: import('better-sqlite3').Database | null = null;
  private options: Required<PersistentCacheOptions>;
  private initialized = false;
  private stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };

  constructor(options: PersistentCacheOptions = {}) {
    this.options = {
      name: options.name ?? 'default',
      dbPath: options.dbPath ?? '.jshookmcp/cache.db',
      defaultTTL: options.defaultTTL ?? 24 * 60 * 60 * 1000, // 24 hours
      enabled: options.enabled ?? true,
    };
  }

  /**
   * Initialize the database and create tables if needed
   */
  async init(): Promise<void> {
    if (!this.options.enabled) {
      logger.debug(`PersistentCache[${this.options.name}] is disabled`);
      return;
    }

    if (this.initialized) {
      return;
    }

    try {
      const dbPath = this.resolveDbPath();

      // Ensure directory exists
      const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Dynamically import better-sqlite3 to handle optional dependency
      const DatabaseConstructor = await this.loadDatabase();
      if (!DatabaseConstructor) {
        logger.warn(
          `PersistentCache[${this.options.name}]: better-sqlite3 not available, using no-op cache`,
        );
        return;
      }

      this.db = new DatabaseConstructor(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      this.createTables();
      this.initialized = true;
      logger.info(`PersistentCache[${this.options.name}] initialized at ${dbPath}`);
    } catch (error) {
      logger.error(`Failed to initialize PersistentCache[${this.options.name}]:`, error);
      this.db = null;
      this.initialized = false;
    }
  }

  private async loadDatabase(): Promise<typeof Database | null> {
    // If already loaded via require, use it
    if (Database) {
      return Database;
    }

    // Try dynamic import as fallback (for ESM environments)
    try {
      const mod = await import('better-sqlite3');
      return (mod.default ?? mod) as typeof Database;
    } catch {
      return null;
    }
  }

  private resolveDbPath(): string {
    const { dbPath } = this.options;

    // Absolute path
    if (dbPath.startsWith('/') || /^[A-Z]:\\/i.test(dbPath)) {
      return dbPath;
    }

    // Relative to project root
    const projectRoot = getProjectRoot();
    return join(projectRoot, dbPath);
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        accessCount INTEGER DEFAULT 0,
        lastAccessedAt INTEGER DEFAULT 0
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_expiresAt ON cache_entries(expiresAt)
    `);
  }

  /**
   * Check if a key exists in cache (regardless of value, including null)
   * @param key - Cache key
   * @returns true if key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return false;
    }

    try {
      const now = Date.now();
      const stmt = this.db.prepare(
        'SELECT COUNT(*) as count FROM cache_entries WHERE key = ? AND expiresAt > ?',
      );
      const result = stmt.get(key, now) as { count: number } | undefined;
      return (result?.count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get a cached value by key
   * @param key - Cache key
   * @param ttlMs - Optional minimum remaining TTL requirement (entry must have at least this much time left)
   * @returns Cached value or null if not found/expired
   */
  async get<T>(key: string, ttlMs?: number): Promise<T | null> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return null;
    }

    try {
      const now = Date.now();
      const stmt = this.db.prepare('SELECT * FROM cache_entries WHERE key = ? AND expiresAt > ?');
      const entry = stmt.get(key, now) as CacheEntry | undefined;

      if (!entry) {
        this.stats.misses++;
        return null;
      }

      // Check if custom TTL is provided and entry meets the minimum remaining TTL requirement
      if (ttlMs !== undefined) {
        const remainingTTL = entry.expiresAt - now;
        if (remainingTTL < ttlMs) {
          this.stats.misses++;
          return null;
        }
      }

      // Update access stats
      this.db
        .prepare(
          'UPDATE cache_entries SET accessCount = accessCount + 1, lastAccessedAt = ? WHERE key = ?',
        )
        .run(now, key);

      this.stats.hits++;

      // Unwrap the stored value (values are stored as { __cached: true, data: actualValue })
      const wrapped = JSON.parse(entry.value) as { __cached: boolean; data: T };
      return wrapped.data;
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] get error:`, error);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set a cache value
   * @param key - Cache key
   * @param value - Value to cache (must be JSON-serializable, including null/undefined)
   * @param ttlMs - TTL in milliseconds (uses default if not provided)
   */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<boolean> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return false;
    }

    try {
      const now = Date.now();
      const ttl = ttlMs ?? this.options.defaultTTL;
      const expiresAt = now + ttl;

      // Wrap value to distinguish stored null from cache miss
      const wrappedValue = { __cached: true, data: value };
      const serialized = JSON.stringify(wrappedValue);

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO cache_entries (key, value, expiresAt, createdAt, accessCount, lastAccessedAt)
        VALUES (?, ?, ?, ?, 0, ?)
      `);

      stmt.run(key, serialized, expiresAt, now, now);
      this.stats.sets++;

      return true;
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] set error:`, error);
      return false;
    }
  }

  /**
   * Delete a cache entry
   * @param key - Cache key
   */
  async delete(key: string): Promise<boolean> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return false;
    }

    try {
      const stmt = this.db.prepare('DELETE FROM cache_entries WHERE key = ?');
      const result = stmt.run(key);

      if (result.changes > 0) {
        this.stats.deletes++;
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] delete error:`, error);
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return;
    }

    try {
      this.db.exec('DELETE FROM cache_entries');
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] clear error:`, error);
    }
  }

  /**
   * Clean up expired entries
   * @returns Number of deleted entries
   */
  async cleanup(): Promise<number> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return 0;
    }

    try {
      const now = Date.now();
      const stmt = this.db.prepare('DELETE FROM cache_entries WHERE expiresAt <= ?');
      const result = stmt.run(now);
      return result.changes;
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] cleanup error:`, error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    entries: number;
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    ttl: number;
  }> {
    if (!this.options.enabled || !this.db || !this.initialized) {
      return { entries: 0, size: 0, hits: 0, misses: 0, hitRate: 0, ttl: this.options.defaultTTL };
    }

    try {
      const totalEntries = this.db.prepare('SELECT COUNT(*) as count FROM cache_entries').get() as
        | { count: number }
        | undefined;

      const totalSize = this.db
        .prepare('SELECT SUM(length(value)) as total FROM cache_entries')
        .get() as { total: number } | undefined;

      const totalRequests = this.stats.hits + this.stats.misses;
      const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

      return {
        entries: totalEntries?.count ?? 0,
        size: totalSize?.total ?? 0,
        hits: this.stats.hits,
        misses: this.stats.misses,
        hitRate,
        ttl: this.options.defaultTTL,
      };
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] getStats error:`, error);
      return { entries: 0, size: 0, hits: 0, misses: 0, hitRate: 0, ttl: this.options.defaultTTL };
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (!this.db) return;

    try {
      this.db.close();
      this.db = null;
      this.initialized = false;
    } catch (error) {
      logger.error(`PersistentCache[${this.options.name}] close error:`, error);
    }
  }

  /**
   * Check if cache is initialized and ready
   */
  isReady(): boolean {
    return this.options.enabled && this.initialized && this.db !== null;
  }
}

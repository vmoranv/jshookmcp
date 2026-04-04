import { describe, it, expect, afterEach } from 'vitest';
import { PersistentCache } from '@utils/cache/PersistentCache';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, rmSync } from 'fs';

describe('PersistentCache', () => {
  const testDbPath = join(tmpdir(), `jshook-test-cache-${Date.now()}.db`);

  const cleanup = () => {
    try {
      if (existsSync(testDbPath)) {
        rmSync(testDbPath, { force: true });
      }
      // Clean up WAL files
      if (existsSync(testDbPath + '-wal')) {
        rmSync(testDbPath + '-wal', { force: true });
      }
      if (existsSync(testDbPath + '-shm')) {
        rmSync(testDbPath + '-shm', { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  afterEach(async () => {
    cleanup();
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const cache = new PersistentCache();
      expect(cache).toBeInstanceOf(PersistentCache);
    });

    it('should accept custom options', () => {
      const cache = new PersistentCache({
        name: 'test-cache',
        dbPath: testDbPath,
        defaultTTL: 60000,
        enabled: true,
      });
      expect(cache).toBeInstanceOf(PersistentCache);
    });

    it('should default to disabled when enabled is false', () => {
      const cache = new PersistentCache({ enabled: false });
      expect(cache.isReady()).toBe(false);
    });
  });

  describe('init', () => {
    it('should initialize the database', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'init-test' });
      await cache.init();
      expect(cache.isReady()).toBe(true);
      await cache.close();
    });

    it('should be idempotent', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'idempotent-test' });
      await cache.init();
      const firstReady = cache.isReady();
      await cache.init();
      const secondReady = cache.isReady();
      expect(firstReady).toBe(secondReady);
      await cache.close();
    });

    it('should not initialize when disabled', async () => {
      const cache = new PersistentCache({ enabled: false, dbPath: testDbPath });
      await cache.init();
      expect(cache.isReady()).toBe(false);
    });
  });

  describe('set and get', () => {
    it('should set and retrieve a value', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'set-get-test' });
      await cache.init();

      const testValue = { foo: 'bar', count: 42 };
      await cache.set('test-key', testValue);

      const retrieved = await cache.get<typeof testValue>('test-key');
      expect(retrieved).toEqual(testValue);

      await cache.close();
    });

    it('should return null for non-existent key', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'nonexistent-test' });
      await cache.init();

      const result = await cache.get('non-existent-key');
      expect(result).toBeNull();

      await cache.close();
    });

    it('should handle different value types', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'types-test' });
      await cache.init();

      await cache.set('string', 'hello');
      await cache.set('number', 123);
      await cache.set('boolean', true);
      await cache.set('array', [1, 2, 3]);
      await cache.set('object', { nested: { value: 'deep' } });
      await cache.set('null', null);

      expect(await cache.get<string>('string')).toBe('hello');
      expect(await cache.get<number>('number')).toBe(123);
      expect(await cache.get<boolean>('boolean')).toBe(true);
      expect(await cache.get<number[]>('array')).toEqual([1, 2, 3]);
      expect(await cache.get<{ nested: { value: string } }>('object')).toEqual({
        nested: { value: 'deep' },
      });
      expect(await cache.get('null')).toBeNull();

      await cache.close();
    });

    it('should respect custom TTL on get', async () => {
      const cache = new PersistentCache({
        dbPath: testDbPath,
        name: 'ttl-test',
        defaultTTL: 100000,
      });
      await cache.init();

      await cache.set('short-ttl-key', 'value', 100); // 100ms TTL

      // Should be available immediately
      const immediate = await cache.get('short-ttl-key', 50);
      expect(immediate).toBe('value');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should expire when checking with original TTL requirement
      const expired = await cache.get('short-ttl-key', 100);
      expect(expired).toBeNull();

      await cache.close();
    });
  });

  describe('delete', () => {
    it('should delete an existing key', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'delete-test' });
      await cache.init();

      await cache.set('to-delete', 'value');
      expect(await cache.get('to-delete')).toBe('value');

      const deleted = await cache.delete('to-delete');
      expect(deleted).toBe(true);
      expect(await cache.get('to-delete')).toBeNull();

      await cache.close();
    });

    it('should return false for non-existent key', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'delete-missing-test' });
      await cache.init();

      const result = await cache.delete('non-existent');
      expect(result).toBe(false);

      await cache.close();
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'clear-test' });
      await cache.init();

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');

      await cache.clear();

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
      expect(await cache.get('key3')).toBeNull();

      await cache.close();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'cleanup-test' });
      await cache.init();

      // Add entry with very short TTL
      await cache.set('expires-soon', 'value', 50);
      await cache.set('permanent', 'forever', 1000000);

      // Wait for first entry to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      const cleaned = await cache.cleanup();
      expect(cleaned).toBeGreaterThanOrEqual(1);

      expect(await cache.get('expires-soon')).toBeNull();
      expect(await cache.get('permanent')).toBe('forever');

      await cache.close();
    });

    it('should return 0 when no entries are expired', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'cleanup-none-test' });
      await cache.init();

      await cache.set('long-ttl', 'value', 1000000);

      const cleaned = await cache.cleanup();
      expect(cleaned).toBe(0);

      await cache.close();
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'stats-test' });
      await cache.init();

      await cache.set('stat1', 'value1');
      await cache.set('stat2', 'value2');
      await cache.get('stat1'); // Generate a hit
      await cache.get('nonexistent'); // Generate a miss

      const stats = await cache.getStats();
      expect(stats.entries).toBeGreaterThanOrEqual(2);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.ttl).toBe(24 * 60 * 60 * 1000); // Default TTL

      await cache.close();
    });

    it('should return zero stats when disabled', async () => {
      const cache = new PersistentCache({ enabled: false });
      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('close', () => {
    it('should close the database connection', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'close-test' });
      await cache.init();
      expect(cache.isReady()).toBe(true);

      await cache.close();
      expect(cache.isReady()).toBe(false);
    });

    it('should handle multiple close calls gracefully', async () => {
      const cache = new PersistentCache({ dbPath: testDbPath, name: 'multi-close-test' });
      await cache.init();
      await cache.close();
      await cache.close(); // Should not throw
    });
  });

  describe('disabled cache behavior', () => {
    it('should return null from get when disabled', async () => {
      const cache = new PersistentCache({ enabled: false });
      const result = await cache.get('any-key');
      expect(result).toBeNull();
    });

    it('should return false from set when disabled', async () => {
      const cache = new PersistentCache({ enabled: false });
      const result = await cache.set('key', 'value');
      expect(result).toBe(false);
    });

    it('should return false from delete when disabled', async () => {
      const cache = new PersistentCache({ enabled: false });
      const result = await cache.delete('key');
      expect(result).toBe(false);
    });

    it('should be no-op for clear when disabled', async () => {
      const cache = new PersistentCache({ enabled: false });
      await cache.clear(); // Should not throw
    });

    it('should return 0 from cleanup when disabled', async () => {
      const cache = new PersistentCache({ enabled: false });
      const result = await cache.cleanup();
      expect(result).toBe(0);
    });
  });
});

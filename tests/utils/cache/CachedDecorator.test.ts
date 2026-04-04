import { describe, it, expect, afterEach } from 'vitest';
import { cached, withCache } from '@utils/cache/CachedDecorator';
import { PersistentCache } from '@utils/cache/PersistentCache';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, rmSync } from 'fs';

const applyMethodDecorator = (
  target: object,
  methodName: string,
  decorator: (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => PropertyDescriptor | void,
) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
  if (!descriptor) {
    throw new Error(`Missing descriptor for ${methodName}`);
  }
  const nextDescriptor = decorator(target, methodName, descriptor) ?? descriptor;
  Object.defineProperty(target, methodName, nextDescriptor);
};

describe('CachedDecorator', () => {
  let testCounter = 0;

  const getTestDbPath = (name: string) => {
    return join(tmpdir(), `jshook-test-${name}-${Date.now()}-${++testCounter}.db`);
  };

  const cleanup = (dbPath: string) => {
    try {
      if (existsSync(dbPath)) {
        rmSync(dbPath, { force: true });
      }
      if (existsSync(dbPath + '-wal')) {
        rmSync(dbPath + '-wal', { force: true });
      }
      if (existsSync(dbPath + '-shm')) {
        rmSync(dbPath + '-shm', { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  afterEach(async () => {
    // Cleanup is handled per-test via the cache.close() calls
  });

  describe('@cached decorator', () => {
    it('should cache method results', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('decorator');
      const sharedCache = new PersistentCache({ name: 'test-decorator', dbPath });
      await sharedCache.init();

      class TestService {
        async fetchData(id: number): Promise<{ id: number; data: string }> {
          callCount++;
          return { id, data: `data-${id}` };
        }
      }
      applyMethodDecorator(
        TestService.prototype,
        'fetchData',
        cached({ ttlMs: 5000, cache: sharedCache }),
      );

      const service = new TestService();

      // First call - should execute method
      const result1 = await service.fetchData(1);
      expect(result1).toEqual({ id: 1, data: 'data-1' });
      expect(callCount).toBe(1);

      // Second call with same args - should use cache
      const result2 = await service.fetchData(1);
      expect(result2).toEqual({ id: 1, data: 'data-1' });
      expect(callCount).toBe(1); // Should not increment

      // Call with different args - should execute method
      const result3 = await service.fetchData(2);
      expect(result3).toEqual({ id: 2, data: 'data-2' });
      expect(callCount).toBe(2);

      await sharedCache.close();
      cleanup(dbPath);
    });

    it('should respect TTL', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('ttl');
      const sharedCache = new PersistentCache({ name: 'test-ttl', dbPath });
      await sharedCache.init();

      class TestService {
        async getData(): Promise<string> {
          callCount++;
          return `data-${Date.now()}`;
        }
      }
      applyMethodDecorator(
        TestService.prototype,
        'getData',
        cached({ ttlMs: 100, cache: sharedCache }),
      );

      const service = new TestService();

      await service.getData();
      expect(callCount).toBe(1);

      // Within TTL - should use cache
      const result2 = await service.getData();
      expect(callCount).toBe(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // After TTL - should execute method again
      const result3 = await service.getData();
      expect(callCount).toBe(2);
      expect(result3).not.toBe(result2);

      await sharedCache.close();
      cleanup(dbPath);
    });

    it('should use custom key function', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('keyfn');
      const sharedCache = new PersistentCache({ name: 'test-keyfn', dbPath });
      await sharedCache.init();

      class TestService {
        async getUser(userId: number, _includeDetails: boolean): Promise<{ id: number }> {
          callCount++;
          return { id: userId };
        }
      }
      applyMethodDecorator(
        TestService.prototype,
        'getUser',
        cached({
          ttlMs: 5000,
          cache: sharedCache,
          keyFn: (userId: number, includeDetails: boolean) => `user:${userId}:${includeDetails}`,
        }),
      );

      const service = new TestService();

      await service.getUser(1, true);
      expect(callCount).toBe(1);

      // Same args - cached
      await service.getUser(1, true);
      expect(callCount).toBe(1);

      // Different args - new call
      await service.getUser(1, false);
      expect(callCount).toBe(2);

      await sharedCache.close();
      cleanup(dbPath);
    });

    it('should handle async methods correctly', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('async');
      const sharedCache = new PersistentCache({ name: 'test-async', dbPath });
      await sharedCache.init();

      class TestService {
        async slowOperation(delay: number): Promise<number> {
          callCount++;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return Date.now();
        }
      }
      applyMethodDecorator(
        TestService.prototype,
        'slowOperation',
        cached({ ttlMs: 5000, cache: sharedCache }),
      );

      const service = new TestService();

      // First call - executes method
      const result1 = await service.slowOperation(10);

      // Second call with same args - should use cache
      const result2 = await service.slowOperation(10);

      // Both calls should return same cached value
      expect(result1).toBe(result2);
      expect(callCount).toBe(1);

      await sharedCache.close();
      cleanup(dbPath);
    });
  });

  describe('withCache HOF', () => {
    it('should wrap function with caching', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('hoc');

      const cache = new PersistentCache({ name: 'hoc-test', dbPath });
      await cache.init();

      const compute = withCache(
        async (n: number): Promise<number> => {
          callCount++;
          return n * 2;
        },
        { ttlMs: 5000, cache },
      );

      const result1 = await compute(5);
      expect(result1).toBe(10);
      expect(callCount).toBe(1);

      const result2 = await compute(5);
      expect(result2).toBe(10);
      expect(callCount).toBe(1); // Should not increment

      const result3 = await compute(10);
      expect(result3).toBe(20);
      expect(callCount).toBe(2);

      await cache.close();
      cleanup(dbPath);
    });

    it('should use custom key generator', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('hoc-keyfn');

      const cache = new PersistentCache({ name: 'hoc-keyfn', dbPath });
      await cache.init();

      const fetch = withCache(
        async (url: string, _headers: Record<string, string>): Promise<string> => {
          callCount++;
          return `response-from-${url}`;
        },
        {
          ttlMs: 5000,
          cache,
          keyFn: (url: string) => url, // Ignore headers for cache key
        },
      );

      await fetch('https://api.example.com/data', { Authorization: 'Bearer token1' });
      expect(callCount).toBe(1);

      // Same URL, different headers - should use cache
      await fetch('https://api.example.com/data', { Authorization: 'Bearer token2' });
      expect(callCount).toBe(1);

      // Different URL - new call
      await fetch('https://api.example.com/other', {});
      expect(callCount).toBe(2);

      await cache.close();
      cleanup(dbPath);
    });

    it('should handle complex argument types', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('hoc-complex');

      const cache = new PersistentCache({ name: 'hoc-complex', dbPath });
      await cache.init();

      const process = withCache(
        async (obj: { id: number; name: string }): Promise<string> => {
          callCount++;
          return `${obj.name}-${obj.id}`;
        },
        { ttlMs: 5000, cache },
      );

      const result1 = await process({ id: 1, name: 'test' });
      expect(result1).toBe('test-1');
      expect(callCount).toBe(1);

      const result2 = await process({ id: 1, name: 'test' });
      expect(result2).toBe('test-1');
      expect(callCount).toBe(1);

      await cache.close();
      cleanup(dbPath);
    });
  });

  describe('edge cases', () => {
    it('should handle non-serializable arguments gracefully', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('edge-nonserial');

      const cache = new PersistentCache({ name: 'edge-nonserial', dbPath });
      await cache.init();

      // eslint-disable-next-line unicorn/consistent-function-scoping
      const noop = (): void => {};

      const fn = withCache(
        async (fnArg: Function): Promise<string> => {
          callCount++;
          return fnArg.toString();
        },
        { ttlMs: 5000, cache },
      );

      await fn(noop);
      const result2 = await fn(noop);

      // Should work but may not cache due to function reference
      expect(typeof result2).toBe('string');
      expect(callCount).toBeGreaterThanOrEqual(1);

      await cache.close();
      cleanup(dbPath);
    });

    it('should cache null and undefined values', async () => {
      let callCount = 0;
      const dbPath = getTestDbPath('edge-null');

      const cache = new PersistentCache({ name: 'edge-null', dbPath });
      await cache.init();

      const maybeReturn = withCache(
        async (returnNull: boolean): Promise<null | undefined> => {
          callCount++;
          return returnNull ? null : undefined;
        },
        { ttlMs: 5000, cache },
      );

      const nullResult1 = await maybeReturn(true);
      expect(nullResult1).toBeNull();
      expect(callCount).toBe(1);

      const nullResult2 = await maybeReturn(true);
      expect(nullResult2).toBeNull();
      expect(callCount).toBe(1); // Cached

      const undefResult1 = await maybeReturn(false);
      expect(undefResult1).toBeUndefined();
      expect(callCount).toBe(2);

      const undefResult2 = await maybeReturn(false);
      expect(undefResult2).toBeUndefined();
      expect(callCount).toBe(2); // Cached

      await cache.close();
      cleanup(dbPath);
    });

    it('should handle large objects', async () => {
      const dbPath = getTestDbPath('edge-large');
      const cache = new PersistentCache({ name: 'edge-large', dbPath });
      await cache.init();

      const largeObject = {
        data: Array(1000).fill('x').join(''),
        nested: { array: Array(100).fill({ value: 42 }) },
      };

      const getLarge = withCache(
        async (): Promise<typeof largeObject> => {
          return largeObject;
        },
        { ttlMs: 5000, cache },
      );

      const result1 = await getLarge();
      const result2 = await getLarge();

      expect(result1.data.length).toBe(1000);
      expect(result2.data.length).toBe(1000);
      expect(result1).toEqual(result2);

      await cache.close();
      cleanup(dbPath);
    });
  });
});

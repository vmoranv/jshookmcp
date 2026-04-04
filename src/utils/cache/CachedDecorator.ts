import { PersistentCache } from './PersistentCache';

export interface CachedOptions {
  /** Cache TTL in milliseconds */
  ttlMs?: number;
  /** Custom key generator function */
  keyFn?: (...args: unknown[]) => string;
  /** Cache instance (uses default if not provided) */
  cache?: PersistentCache;
}

/**
 * Generate a cache key from function arguments
 */
function generateDefaultKey(...args: unknown[]): string {
  try {
    return JSON.stringify(args);
  } catch {
    // Fallback for non-serializable args
    return args.map((arg) => String(arg)).join('|');
  }
}

/**
 * Method decorator for caching function results
 *
 * @example
 * ```typescript
 * class MyService {
 *   private cache = new PersistentCache({ name: 'my-service' });
 *
 *   @cached({ ttlMs: 60000 })
 *   async fetchData(url: string) {
 *     // ...
 *   }
 *
 *   @cached({
 *     ttlMs: 3600000,
 *     keyFn: (url: string) => `data:${url}`
 *   })
 *   async getData(url: string) {
 *     // ...
 *   }
 * }
 * ```
 */
export function cached(options: CachedOptions = {}) {
  return function (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    // Use provided cache or create one with a shared default database
    const cache =
      options.cache ??
      new PersistentCache({
        name: `cached-${String(propertyKey)}`,
        dbPath: '.jshookmcp/cache.db',
      });

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      // Generate cache key
      const keyGenerator = options.keyFn ?? generateDefaultKey;
      const key = keyGenerator(...args);

      // Ensure cache is initialized
      if (!cache.isReady()) {
        await cache.init();
      }

      // Check if key exists first (handles null/undefined values correctly)
      const hasKey = await cache.has(key);
      if (hasKey) {
        return await cache.get(key);
      }

      // Execute original method
      const result = await originalMethod.apply(this, args);

      // Store in cache with TTL
      await cache.set(key, result, options.ttlMs);

      return result;
    };

    return descriptor;
  };
}

/**
 * Higher-order function wrapper for caching (alternative to decorator)
 *
 * @example
 * ```typescript
 * const cachedFn = withCache(
 *   async (url: string) => fetch(url),
 *   { ttlMs: 60000, keyFn: (url) => url }
 * );
 * ```
 */
export function withCache<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: CachedOptions = {},
): T {
  const cache =
    options.cache ??
    new PersistentCache({
      name: `withCache-${fn.name}`,
      dbPath: '.jshookmcp/cache.db',
    });
  const keyGenerator = options.keyFn ?? generateDefaultKey;

  return async function (this: unknown, ...args: Parameters<T>) {
    const key = keyGenerator(...args);

    if (!cache.isReady()) {
      await cache.init();
    }

    // Check if key exists first (handles null/undefined values correctly)
    const hasKey = await cache.has(key);
    if (hasKey) {
      return await cache.get(key);
    }

    const result = await fn.apply(this, args);
    await cache.set(key, result, options.ttlMs);

    return result;
  } as T;
}

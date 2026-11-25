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
 * Stable 32-bit FNV-1a hash of a function's source.
 *
 * `withCache` has no class/method identity to namespace by, and an inline
 * arrow's `name` is usually empty. The source text is stable across restarts
 * for the same build, so it disambiguates two anonymous wrappers without
 * sacrificing persistent-cache reuse the way a random per-process id would.
 */
function hashFunctionSource(fn: (...args: never[]) => unknown): string {
  const source = Function.prototype.toString.call(fn);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
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
      });

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      // Namespace by class + method. PersistentCache instances created here all
      // share ~/.jshookmcp/cache.db, and `name` only affects log output — without
      // this prefix, `ServiceA.fetchData('x')` and `ServiceB.fetchData('x')`
      // would collide and return each other's results.
      const keyGenerator = options.keyFn ?? generateDefaultKey;
      const className = (_target.constructor as { name?: string })?.name ?? 'unknown';
      const key = `${className}.${String(propertyKey)}:${keyGenerator(...args)}`;

      // Ensure cache is initialized
      if (!cache.isReady()) {
        await cache.init();
      }

      // Single hit-aware lookup: `has()` + `get()` is a TOCTOU pair and would
      // return a cached null as the method result if the row expired between them.
      const cachedEntry = await cache.getEntry(key);
      if (cachedEntry.hit) {
        return cachedEntry.value;
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
    });
  const keyGenerator = options.keyFn ?? generateDefaultKey;
  // Same shared-DB collision as the decorator; withCache has no class/method
  // identity, so namespace by (name + stable source hash).
  const namespace = `withCache.${fn.name || 'anonymous'}.${hashFunctionSource(fn)}`;

  return async function (this: unknown, ...args: Parameters<T>) {
    const key = `${namespace}:${keyGenerator(...args)}`;

    if (!cache.isReady()) {
      await cache.init();
    }

    // Single hit-aware lookup (see the decorator path above).
    const cachedEntry = await cache.getEntry(key);
    if (cachedEntry.hit) {
      return cachedEntry.value;
    }

    const result = await fn.apply(this, args);
    await cache.set(key, result, options.ttlMs);

    return result;
  } as T;
}

/**
 * ShaderCache — Result caching for WebGPU shader operations.
 *
 * **Motivation**:
 * - Shader compilation is deterministic: same WGSL → same result
 * - Users repeatedly compile the same shader while debugging
 * - Disassembly is CPU-intensive for large shaders
 * - Parsing/validation overhead can be eliminated
 *
 * **Cache Key**: SHA-256 hash of shader code (content-addressed)
 *
 * **TTL**: 30 minutes (configurable). Longer TTL is safe because WGSL spec
 * is stable and results are reproducible.
 *
 * **Eviction**: Time-based only (no LRU). Cache size is bounded by TTL.
 *
 * **Thread Safety**: Not required (JavaScript single-threaded, subagents
 * run in separate processes with separate memory).
 */

import { createHash } from 'node:crypto';

interface CacheEntry<T> {
  result: T;
  timestamp: number;
  hash: string;
}

export class ShaderCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number;

  /**
   * @param ttl - Time-to-live in milliseconds (default: 30 minutes)
   */
  constructor(ttl = 30 * 60 * 1000) {
    this.ttl = ttl;
  }

  /**
   * Get cached result for shader code.
   *
   * @param code - WGSL shader source code
   * @returns Cached result or null if not found/expired
   */
  get(code: string): T | null {
    const hash = this.hashCode(code);
    const entry = this.cache.get(hash);

    if (!entry) {
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(hash);
      return null;
    }

    return entry.result;
  }

  /**
   * Store result in cache.
   *
   * @param code - WGSL shader source code
   * @param result - Result to cache
   */
  set(code: string, result: T): void {
    const hash = this.hashCode(code);
    this.cache.set(hash, {
      result,
      timestamp: Date.now(),
      hash,
    });
  }

  /**
   * Check if shader code is cached and not expired.
   *
   * @param code - WGSL shader source code
   * @returns True if cached and valid
   */
  has(code: string): boolean {
    const hash = this.hashCode(code);
    const entry = this.cache.get(hash);
    if (!entry) {
      return false;
    }
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(hash);
      return false;
    }
    return true;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries (garbage collection).
   *
   * @returns Number of entries removed
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;

    for (const [hash, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > this.ttl) {
        this.cache.delete(hash);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache stats
   */
  getStats(): {
    size: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map((e) => e.timestamp);

    return {
      size: this.cache.size,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  }

  /**
   * Hash shader code using SHA-256.
   *
   * @param code - Shader source code
   * @returns Hex digest
   */
  private hashCode(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }
}

/** Global shader compilation cache */
let compileCache: ShaderCache<any> | undefined;

/**
 * Get the global shader compilation cache.
 *
 * @returns Singleton cache instance
 */
export function getShaderCompileCache(): ShaderCache {
  if (!compileCache) {
    compileCache = new ShaderCache();
  }
  return compileCache;
}

/** Global shader disassembly cache */
let disassemblyCache: ShaderCache<any> | undefined;

/**
 * Get the global shader disassembly cache.
 *
 * @returns Singleton cache instance
 */
export function getShaderDisassemblyCache(): ShaderCache {
  if (!disassemblyCache) {
    disassemblyCache = new ShaderCache();
  }
  return disassemblyCache;
}

/**
 * Reset all caches (for testing only).
 */
export function resetShaderCaches(): void {
  compileCache = undefined;
  disassemblyCache = undefined;
}

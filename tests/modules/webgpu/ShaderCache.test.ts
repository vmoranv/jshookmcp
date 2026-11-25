import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShaderCache,
  getShaderCompileCache,
  getShaderDisassemblyCache,
  resetShaderCaches,
} from '@modules/webgpu/ShaderCache';

describe('ShaderCache', () => {
  let cache: ShaderCache;

  beforeEach(() => {
    cache = new ShaderCache(1000); // 1 second TTL for tests
  });

  describe('Basic Operations', () => {
    it('should store and retrieve results', () => {
      const shader = '@vertex fn main() {}';
      const result = { compiled: true };

      cache.set(shader, result);
      const retrieved = cache.get(shader);

      expect(retrieved).toEqual(result);
    });

    it('should return null for non-existent entry', () => {
      const result = cache.get('@vertex fn main() {}');
      expect(result).toBeNull();
    });

    it('should check if entry exists', () => {
      const shader = '@vertex fn main() {}';

      expect(cache.has(shader)).toBe(false);

      cache.set(shader, { compiled: true });

      expect(cache.has(shader)).toBe(true);
    });

    it('has() is true for a cached null result', () => {
      const shader = '@vertex fn main() {}';
      cache.set(shader, null as unknown as { compiled: boolean });
      expect(cache.has(shader)).toBe(true);
      expect(cache.get(shader)).toBeNull();
    });

    it('should handle different shader codes separately', () => {
      const shader1 = '@vertex fn main() {}';
      const shader2 = '@fragment fn main() {}';

      cache.set(shader1, { result: 'vertex' });
      cache.set(shader2, { result: 'fragment' });

      expect(cache.get(shader1)).toEqual({ result: 'vertex' });
      expect(cache.get(shader2)).toEqual({ result: 'fragment' });
    });

    it('should overwrite existing entry with same key', () => {
      const shader = '@vertex fn main() {}';

      cache.set(shader, { version: 1 });
      cache.set(shader, { version: 2 });

      const result = cache.get(shader);
      expect(result).toEqual({ version: 2 });
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const shader = '@vertex fn main() {}';
      cache.set(shader, { compiled: true });

      expect(cache.has(shader)).toBe(true);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(cache.has(shader)).toBe(false);
      expect(cache.get(shader)).toBeNull();
    });

    it('should not expire entries before TTL', async () => {
      const shader = '@vertex fn main() {}';
      cache.set(shader, { compiled: true });

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(cache.has(shader)).toBe(true);
      expect(cache.get(shader)).toEqual({ compiled: true });
    });

    it('should handle mixed expiration states', async () => {
      const shader1 = '@vertex fn main() {}';
      const shader2 = '@fragment fn main() {}';

      cache.set(shader1, { result: 'vertex' });

      await new Promise((resolve) => setTimeout(resolve, 600));

      cache.set(shader2, { result: 'fragment' });

      await new Promise((resolve) => setTimeout(resolve, 600));

      // shader1 should be expired, shader2 should still be valid
      expect(cache.has(shader1)).toBe(false);
      expect(cache.has(shader2)).toBe(true);
    });
  });

  describe('Cache Management', () => {
    it('should clear all entries', () => {
      cache.set('@vertex fn main() {}', { v: 1 });
      cache.set('@fragment fn main() {}', { v: 2 });

      expect(cache.getStats().size).toBe(2);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.has('@vertex fn main() {}')).toBe(false);
    });

    it('should prune expired entries', async () => {
      cache.set('@vertex fn v1() {}', { v: 1 });
      cache.set('@vertex fn v2() {}', { v: 2 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      cache.set('@vertex fn v3() {}', { v: 3 });

      const removed = cache.prune();

      expect(removed).toBe(2);
      expect(cache.getStats().size).toBe(1);
    });

    it('should not remove non-expired entries during prune', async () => {
      cache.set('@vertex fn v1() {}', { v: 1 });
      cache.set('@vertex fn v2() {}', { v: 2 });

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 500));

      const removed = cache.prune();

      expect(removed).toBe(0);
      expect(cache.getStats().size).toBe(2);
    });
  });

  describe('Statistics', () => {
    it('should report cache size', () => {
      expect(cache.getStats().size).toBe(0);

      cache.set('@vertex fn v1() {}', {});
      expect(cache.getStats().size).toBe(1);

      cache.set('@vertex fn v2() {}', {});
      expect(cache.getStats().size).toBe(2);
    });

    it('should report oldest entry timestamp', () => {
      const stats1 = cache.getStats();
      expect(stats1.oldestEntry).toBeNull();
      expect(stats1.newestEntry).toBeNull();

      cache.set('@vertex fn v1() {}', {});
      const stats2 = cache.getStats();
      expect(stats2.oldestEntry).toBeGreaterThan(0);
      expect(stats2.newestEntry).toBeGreaterThan(0);
    });

    it('should report newest entry timestamp', async () => {
      cache.set('@vertex fn v1() {}', {});
      const stats1 = cache.getStats();

      await new Promise((resolve) => setTimeout(resolve, 100));

      cache.set('@vertex fn v2() {}', {});
      const stats2 = cache.getStats();

      expect(stats2.newestEntry!).toBeGreaterThan(stats1.newestEntry!);
      expect(stats2.oldestEntry).toBe(stats1.oldestEntry);
    });
  });

  describe('Content-Addressed Caching', () => {
    it('should use same hash for identical content', () => {
      const shader = '@vertex fn main() { return; }';

      cache.set(shader, { v: 1 });
      cache.set(shader, { v: 2 });

      expect(cache.getStats().size).toBe(1);
      expect(cache.get(shader)).toEqual({ v: 2 });
    });

    it('should use different hash for different content', () => {
      cache.set('@vertex fn main() {}', { v: 1 });
      cache.set('@vertex fn main2() {}', { v: 2 });

      expect(cache.getStats().size).toBe(2);
    });

    it('should be sensitive to whitespace changes', () => {
      const shader1 = '@vertex fn main(){}';
      const shader2 = '@vertex fn main() {}';

      cache.set(shader1, { v: 1 });
      cache.set(shader2, { v: 2 });

      // Different content → different entries
      expect(cache.getStats().size).toBe(2);
    });
  });

  describe('Bounded Size', () => {
    it('evicts the oldest entry when maxSize is reached', () => {
      const bounded = new ShaderCache(60_000, 2);
      bounded.set('a', { v: 'a' });
      bounded.set('b', { v: 'b' });
      bounded.set('c', { v: 'c' });

      expect(bounded.getStats().size).toBe(2);
      expect(bounded.has('a')).toBe(false);
      expect(bounded.get('b')).toEqual({ v: 'b' });
      expect(bounded.get('c')).toEqual({ v: 'c' });
    });
  });

  describe('Global Instances', () => {
    beforeEach(() => {
      resetShaderCaches();
    });

    it('should return separate compile and disassembly caches', () => {
      const compileCache = getShaderCompileCache();
      const disassemblyCache = getShaderDisassemblyCache();

      expect(compileCache).not.toBe(disassemblyCache);
    });

    it('should return same instance on multiple calls', () => {
      const cache1 = getShaderCompileCache();
      const cache2 = getShaderCompileCache();

      expect(cache1).toBe(cache2);
    });

    it('should isolate compile and disassembly caches', () => {
      const compileCache = getShaderCompileCache();
      const disassemblyCache = getShaderDisassemblyCache();

      const shader = '@vertex fn main() {}';

      compileCache.set(shader, { type: 'compile' });
      disassemblyCache.set(shader, { type: 'disassembly' });

      expect(compileCache.get(shader)).toEqual({ type: 'compile' });
      expect(disassemblyCache.get(shader)).toEqual({ type: 'disassembly' });
    });

    it('should reset instances', () => {
      const cache1 = getShaderCompileCache();
      resetShaderCaches();
      const cache2 = getShaderCompileCache();

      expect(cache1).not.toBe(cache2);
    });
  });
});

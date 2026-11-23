/** LRU cache and entry shape for tool-search query results. */

export interface CachedSearchEntry {
  kind: 'quick' | 'full';
  preAdjust: Array<[number, number]>;
}

class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, V>();

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const firstKey = this.map.keys().next().value!;
      this.map.delete(firstKey);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export class SearchResultCache {
  private readonly cache: LRUCache<string, CachedSearchEntry>;

  constructor(capacity: number) {
    this.cache = new LRUCache(capacity);
  }

  get(key: string): CachedSearchEntry | undefined {
    return this.cache.get(key);
  }

  set(key: string, entry: CachedSearchEntry): void {
    this.cache.set(key, entry);
  }

  // Used by the query-cache invalidation test; keep the public clear surface.
  // fallow-ignore-next-line unused-class-member
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

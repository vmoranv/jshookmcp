/** LRU cache and entry shape for tool-search query results. */

export interface CachedSearchEntry {
  kind: 'quick' | 'full';
  feedbackEpoch: number;
  /**
   * Whether the vector signal existed when this entry was computed.
   *
   * Without it, an entry written while embeddings were absent outlived the
   * readiness transition: the bootstrap clears the cache on completion, but a
   * query that scored BEFORE the clear and wrote its entry AFTER it survived,
   * and `isCachedEntryFresh` (which only compares the feedback epoch) kept
   * replaying lexical-only results with the vector signal already live.
   */
  vectorReady: boolean;
  preAdjust: Array<[number, number]>;
  vectorRanking: Array<[string, number]> | null;
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
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      // Delete oldest (first entry in insertion order)
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

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

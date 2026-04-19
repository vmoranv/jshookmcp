/**
 * Store sub-handler — set, get, delete, list, clear, stats.
 */

import { randomUUID } from 'node:crypto';
import type { StateBoardStore, StateBoardStats } from './shared';
import { matchesKeyPattern } from './shared';

export class StoreHandlers {
  private store: StateBoardStore;

  constructor(store: StateBoardStore) {
    this.store = store;
  }

  async handleSet(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const value = args.value as unknown;
    const namespace = (args.namespace as string) ?? 'default';
    const ttlSeconds = args.ttlSeconds as number | undefined;

    if (!key || typeof key !== 'string') {
      throw new Error('key must be a non-empty string');
    }

    const fullKey = `${namespace}:${key}`;
    const now = Date.now();
    const existing = this.store.state.get(fullKey);
    const oldVersion = existing?.version ?? 0;
    const oldValue = existing?.value;

    const entry = {
      key,
      value,
      namespace,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ttlSeconds,
      expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
      version: oldVersion + 1,
    };

    this.store.state.set(fullKey, entry);

    this.store.recordChange(fullKey, {
      id: randomUUID().slice(0, 8),
      key,
      namespace,
      action: 'set',
      oldValue,
      newValue: value,
      timestamp: now,
    });

    return {
      success: true,
      key,
      namespace,
      version: entry.version,
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : undefined,
    };
  }

  async handleGet(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';

    if (!key || typeof key !== 'string') {
      throw new Error('key must be a non-empty string');
    }

    const fullKey = `${namespace}:${key}`;
    const entry = this.store.state.get(fullKey);

    if (!entry) {
      return { found: false, key, namespace };
    }

    if (this.store.isExpired(entry)) {
      this.store.deleteEntry(fullKey);
      return { found: false, key, namespace, expired: true };
    }

    return {
      found: true,
      key,
      namespace,
      value: entry.value,
      version: entry.version,
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      ttlSeconds: entry.ttlSeconds,
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : undefined,
    };
  }

  async handleDelete(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';

    const fullKey = `${namespace}:${key}`;
    const existing = this.store.state.get(fullKey);

    if (!existing) {
      return { deleted: false, key, namespace, reason: 'not_found' };
    }

    this.store.deleteEntry(fullKey);
    return { deleted: true, key, namespace };
  }

  async handleList(args: Record<string, unknown>): Promise<unknown> {
    const namespace = args.namespace as string | undefined;
    const includeValues = (args.includeValues as boolean) ?? false;

    const entries: Array<{
      key: string;
      namespace: string;
      version: number;
      updatedAt: string;
      value?: unknown;
      expired?: boolean;
    }> = [];

    for (const entry of this.store.state.values()) {
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      const expired = this.store.isExpired(entry);
      if (expired) {
        this.store.deleteEntry(`${entry.namespace}:${entry.key}`);
        continue;
      }

      entries.push({
        key: entry.key,
        namespace: entry.namespace,
        version: entry.version,
        updatedAt: new Date(entry.updatedAt).toISOString(),
        ...(includeValues ? { value: entry.value } : {}),
      });
    }

    entries.sort((a, b) => {
      if (a.namespace !== b.namespace) {
        return a.namespace.localeCompare(b.namespace);
      }
      return a.key.localeCompare(b.key);
    });

    return {
      entries,
      total: entries.length,
      namespaces: [...new Set(entries.map((e) => e.namespace))],
    };
  }

  async handleClear(args: Record<string, unknown>): Promise<unknown> {
    const namespace = args.namespace as string | undefined;
    const keyPattern = args.keyPattern as string | undefined;

    const toDelete: string[] = [];

    for (const [fullKey, entry] of this.store.state.entries()) {
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      if (!matchesKeyPattern(entry.key, keyPattern)) {
        continue;
      }

      toDelete.push(fullKey);
    }

    for (const fullKey of toDelete) {
      this.store.deleteEntry(fullKey);
    }

    return {
      cleared: toDelete.length,
      namespace: namespace ?? 'all',
      pattern: keyPattern,
    };
  }

  async handleStats(): Promise<unknown> {
    const now = Date.now();
    const entriesByNamespace: Record<string, number> = {};
    let expiredCount = 0;

    for (const [, entry] of this.store.state.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expiredCount++;
        continue;
      }
      entriesByNamespace[entry.namespace] = (entriesByNamespace[entry.namespace] ?? 0) + 1;
    }

    let historySize = 0;
    for (const records of this.store.history.values()) {
      historySize += records.length;
    }

    const stats: StateBoardStats = {
      totalEntries: Object.values(entriesByNamespace).reduce((a, b) => a + b, 0),
      entriesByNamespace,
      expiredEntries: expiredCount,
      totalWatches: this.store.watches.size,
      historySize,
    };

    return stats;
  }
}

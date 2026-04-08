/**
 * SharedStateBoard domain handler — cross-agent state synchronization.
 *
 * Features:
 * - In-memory key-value store with optional SQLite persistence
 * - Namespace support for key isolation
 * - TTL-based expiration
 * - Change history tracking
 * - Watch/poll mechanism for state changes
 * - Import/export for state migration
 */

import { randomUUID } from 'node:crypto';
import { escapeRegexStr } from '@utils/escapeForRegex';
export * from './definitions';

// ── Types ──

export interface StateEntry {
  key: string;
  value: unknown;
  namespace: string;
  createdAt: number;
  updatedAt: number;
  ttlSeconds?: number;
  expiresAt?: number;
  version: number;
}

export interface StateChangeRecord {
  id: string;
  key: string;
  namespace: string;
  action: 'set' | 'delete' | 'expire';
  oldValue?: unknown;
  newValue?: unknown;
  timestamp: number;
  source?: string;
}

export interface StateWatch {
  id: string;
  key: string;
  namespace: string;
  pattern: boolean;
  pollIntervalMs: number;
  lastChecked: number;
  lastVersion: Record<string, number>;
  createdAt: number;
}

export interface StateBoardStats {
  totalEntries: number;
  entriesByNamespace: Record<string, number>;
  expiredEntries: number;
  totalWatches: number;
  historySize: number;
}

// ── Handler ──

export class SharedStateBoardHandlers {
  private readonly state = new Map<string, StateEntry>(); // key: namespace:key
  private readonly history = new Map<string, StateChangeRecord[]>(); // key: namespace:key
  private readonly watches = new Map<string, StateWatch>();
  private readonly maxHistoryPerKey = 100;

  // ── state_board_set ──

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
    const existing = this.state.get(fullKey);
    const oldVersion = existing?.version ?? 0;
    const oldValue = existing?.value;

    const entry: StateEntry = {
      key,
      value,
      namespace,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ttlSeconds,
      expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
      version: oldVersion + 1,
    };

    this.state.set(fullKey, entry);

    // Record history
    this.recordChange(fullKey, {
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

  // ── state_board_get ──

  async handleGet(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';

    if (!key || typeof key !== 'string') {
      throw new Error('key must be a non-empty string');
    }

    const fullKey = `${namespace}:${key}`;
    const entry = this.state.get(fullKey);

    if (!entry) {
      return { found: false, key, namespace };
    }

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.handleDelete({ key, namespace });
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

  // ── state_board_delete ──

  async handleDelete(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';

    const fullKey = `${namespace}:${key}`;
    const existing = this.state.get(fullKey);

    if (!existing) {
      return { deleted: false, key, namespace, reason: 'not_found' };
    }

    this.state.delete(fullKey);

    // Record history
    this.recordChange(fullKey, {
      id: randomUUID().slice(0, 8),
      key,
      namespace,
      action: 'delete',
      oldValue: existing.value,
      timestamp: Date.now(),
    });

    return { deleted: true, key, namespace };
  }

  // ── state_board_list ──

  async handleList(args: Record<string, unknown>): Promise<unknown> {
    const namespace = args.namespace as string | undefined;
    const includeValues = (args.includeValues as boolean) ?? false;

    const now = Date.now();
    const entries: Array<{
      key: string;
      namespace: string;
      version: number;
      updatedAt: string;
      value?: unknown;
      expired?: boolean;
    }> = [];

    for (const entry of this.state.values()) {
      // Filter by namespace if specified
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      // Check expiration
      const expired = !!(entry.expiresAt && now > entry.expiresAt);
      if (expired) {
        this.handleDelete({ key: entry.key, namespace: entry.namespace });
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

    // Sort by namespace, then key
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

  // ── state_board_watch ──

  async handleWatch(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';
    const pollIntervalMs = (args.pollIntervalMs as number) ?? 1000;

    if (!key || typeof key !== 'string') {
      throw new Error('key must be a non-empty string');
    }

    const watchId = `watch_${randomUUID().slice(0, 8)}`;
    const isPattern = key.includes('*');

    const watch: StateWatch = {
      id: watchId,
      key,
      namespace,
      pattern: isPattern,
      pollIntervalMs,
      lastChecked: Date.now(),
      lastVersion: {},
      createdAt: Date.now(),
    };

    // Initialize lastVersion for all matching keys
    const prefix = `${namespace}:`;
    for (const [fullKey, entry] of this.state.entries()) {
      if (fullKey.startsWith(prefix)) {
        if (isPattern) {
          const regex = new RegExp(`^${escapeRegexStr(prefix)}${escapeRegexStr(key).replace(/\\\*/g, '.*')}$`);
          if (regex.test(fullKey)) {
            watch.lastVersion[fullKey] = entry.version;
          }
        } else {
          watch.lastVersion[fullKey] = entry.version;
        }
      }
    }

    this.watches.set(watchId, watch);

    return {
      watchId,
      key,
      namespace,
      pattern: isPattern,
      pollIntervalMs,
      initialKeys: Object.keys(watch.lastVersion),
    };
  }

  // ── state_board_unwatch ──

  async handleUnwatch(args: Record<string, unknown>): Promise<unknown> {
    const watchId = args.watchId as string;

    const watch = this.watches.get(watchId);
    if (!watch) {
      return { removed: false, watchId, reason: 'not_found' };
    }

    this.watches.delete(watchId);

    return { removed: true, watchId, wasWatching: watch.key };
  }

  // ── state_board_poll (internal for watch checking) ──

  async handlePoll(args: Record<string, unknown>): Promise<unknown> {
    const watchId = args.watchId as string;

    const watch = this.watches.get(watchId);
    if (!watch) {
      throw new Error(`Watch "${watchId}" not found`);
    }

    const now = Date.now();
    const changes: Array<{
      key: string;
      namespace: string;
      action: 'changed' | 'created' | 'deleted';
    }> = [];

    const prefix = `${watch.namespace}:`;

    if (watch.pattern) {
      const regex = new RegExp(`^${escapeRegexStr(prefix)}${escapeRegexStr(watch.key).replace(/\\\*/g, '.*')}$`);
      for (const [fullKey, entry] of this.state.entries()) {
        if (regex.test(fullKey)) {
          const lastVer = watch.lastVersion[fullKey];
          if (lastVer === undefined) {
            changes.push({ key: entry.key, namespace: entry.namespace, action: 'created' });
          } else if (entry.version > lastVer) {
            changes.push({ key: entry.key, namespace: entry.namespace, action: 'changed' });
          }
          watch.lastVersion[fullKey] = entry.version;
        }
      }
      // Check for deletions
      for (const watchedKey of Object.keys(watch.lastVersion)) {
        if (!this.state.has(watchedKey) && regex.test(watchedKey)) {
          const idx = watchedKey.indexOf(':');
          const key = idx >= 0 ? watchedKey.substring(idx + 1) : watchedKey;
          changes.push({
            key,
            namespace: watch.namespace,
            action: 'deleted',
          });
          delete watch.lastVersion[watchedKey];
        }
      }
    } else {
      const fullKey = `${watch.namespace}:${watch.key}`;
      const entry = this.state.get(fullKey);
      const lastVer = watch.lastVersion[fullKey];

      if (!entry && lastVer !== undefined) {
        changes.push({ key: watch.key, namespace: watch.namespace, action: 'deleted' });
        delete watch.lastVersion[fullKey];
      } else if (entry) {
        if (lastVer === undefined) {
          changes.push({ key: entry.key, namespace: entry.namespace, action: 'created' });
        } else if (entry.version > lastVer) {
          changes.push({ key: entry.key, namespace: entry.namespace, action: 'changed' });
        }
        watch.lastVersion[fullKey] = entry.version;
      }
    }

    watch.lastChecked = now;

    return {
      watchId,
      changes,
      hasChanges: changes.length > 0,
      checkedAt: new Date(now).toISOString(),
    };
  }

  // ── state_board_history ──

  async handleHistory(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';
    const limit = (args.limit as number) ?? 50;

    const fullKey = `${namespace}:${key}`;
    const records = this.history.get(fullKey) ?? [];

    const sorted = [...records].toSorted((a, b) => b.timestamp - a.timestamp);
    const limited = sorted.slice(0, limit);

    return {
      key,
      namespace,
      history: limited.map((r) => ({
        ...r,
        timestamp: new Date(r.timestamp).toISOString(),
      })),
      total: records.length,
      returned: limited.length,
    };
  }

  // ── state_board_export ──

  async handleExport(args: Record<string, unknown>): Promise<unknown> {
    const namespace = args.namespace as string | undefined;
    const keyPattern = args.keyPattern as string | undefined;

    const now = Date.now();
    const data: Record<string, unknown> = {};

    for (const [_fullKey, entry] of this.state.entries()) {
      // Filter by namespace
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      // Filter by key pattern
      if (keyPattern) {
        const regex = new RegExp(`^${escapeRegexStr(keyPattern).replace(/\\\*/g, '.*')}$`);
        if (!regex.test(entry.key)) {
          continue;
        }
      }

      // Skip expired entries
      if (entry.expiresAt && now > entry.expiresAt) {
        continue;
      }

      data[entry.key] = entry.value;
    }

    return {
      data,
      count: Object.keys(data).length,
      namespace: namespace ?? 'all',
      exportedAt: new Date(now).toISOString(),
    };
  }

  // ── state_board_import ──

  async handleImport(args: Record<string, unknown>): Promise<unknown> {
    const data = args.data as Record<string, unknown>;
    const namespace = (args.namespace as string) ?? 'default';
    const overwrite = (args.overwrite as boolean) ?? false;

    if (!data || typeof data !== 'object') {
      throw new Error('data must be an object');
    }

    const imported: string[] = [];
    const skipped: string[] = [];
    const overwritten: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      const fullKey = `${namespace}:${key}`;
      const existing = this.state.get(fullKey);

      if (existing && !overwrite) {
        skipped.push(key);
        continue;
      }

      if (existing && overwrite) {
        overwritten.push(key);
      }

      const now = Date.now();
      const entry: StateEntry = {
        key,
        value,
        namespace,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        version: (existing?.version ?? 0) + 1,
      };

      this.state.set(fullKey, entry);
      imported.push(key);
    }

    return {
      imported: imported.length,
      skipped: skipped.length,
      overwritten: overwritten.length,
      total: Object.keys(data).length,
      keys: imported,
    };
  }

  // ── state_board_clear ──

  async handleClear(args: Record<string, unknown>): Promise<unknown> {
    const namespace = args.namespace as string | undefined;
    const keyPattern = args.keyPattern as string | undefined;

    const toDelete: string[] = [];

    for (const [fullKey, entry] of this.state.entries()) {
      // Filter by namespace
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      // Filter by key pattern
      if (keyPattern) {
        const regex = new RegExp(`^${escapeRegexStr(keyPattern).replace(/\\\*/g, '.*')}$`);
        if (!regex.test(entry.key)) {
          continue;
        }
      }

      toDelete.push(fullKey);
    }

    for (const fullKey of toDelete) {
      const entry = this.state.get(fullKey);
      if (entry) {
        this.state.delete(fullKey);
        this.recordChange(fullKey, {
          id: randomUUID().slice(0, 8),
          key: entry.key,
          namespace: entry.namespace,
          action: 'delete',
          oldValue: entry.value,
          timestamp: Date.now(),
        });
      }
    }

    return {
      cleared: toDelete.length,
      namespace: namespace ?? 'all',
      pattern: keyPattern,
    };
  }

  // ── state_board_stats ──

  async handleStats(): Promise<unknown> {
    const now = Date.now();
    const entriesByNamespace: Record<string, number> = {};
    let expiredCount = 0;

    for (const [, entry] of this.state.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expiredCount++;
        continue;
      }
      entriesByNamespace[entry.namespace] = (entriesByNamespace[entry.namespace] ?? 0) + 1;
    }

    let historySize = 0;
    for (const records of this.history.values()) {
      historySize += records.length;
    }

    const stats: StateBoardStats = {
      totalEntries: Object.values(entriesByNamespace).reduce((a, b) => a + b, 0),
      entriesByNamespace,
      expiredEntries: expiredCount,
      totalWatches: this.watches.size,
      historySize,
    };

    return stats;
  }

  // ── Helpers ──

  private recordChange(fullKey: string, record: StateChangeRecord): void {
    let history = this.history.get(fullKey);
    if (!history) {
      history = [];
      this.history.set(fullKey, history);
    }

    history.push(record);

    // Trim history
    if (history.length > this.maxHistoryPerKey) {
      history.splice(0, history.length - this.maxHistoryPerKey);
    }
  }

  // ── Cleanup expired entries (called periodically) ──

  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [fullKey, entry] of this.state.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.state.delete(fullKey);
        this.recordChange(fullKey, {
          id: randomUUID().slice(0, 8),
          key: entry.key,
          namespace: entry.namespace,
          action: 'expire',
          oldValue: entry.value,
          timestamp: now,
        });
        cleaned++;
      }
    }

    return cleaned;
  }
}

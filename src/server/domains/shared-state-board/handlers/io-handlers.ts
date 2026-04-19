/**
 * IO sub-handler — history, export, import.
 */

import { randomUUID } from 'node:crypto';
import type { StateEntry, StateBoardStore } from './shared';
import { matchesKeyPattern } from './shared';

export class IOHandlers {
  private store: StateBoardStore;

  constructor(store: StateBoardStore) {
    this.store = store;
  }

  async handleHistory(args: Record<string, unknown>): Promise<unknown> {
    const key = args.key as string;
    const namespace = (args.namespace as string) ?? 'default';
    const limit = (args.limit as number) ?? 50;

    const fullKey = `${namespace}:${key}`;
    const records = this.store.history.get(fullKey) ?? [];

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

  async handleExport(args: Record<string, unknown>): Promise<unknown> {
    const namespace = args.namespace as string | undefined;
    const keyPattern = args.keyPattern as string | undefined;

    const now = Date.now();
    const data: Record<string, unknown> = {};

    for (const [_fullKey, entry] of this.store.state.entries()) {
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      if (!matchesKeyPattern(entry.key, keyPattern)) {
        continue;
      }

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
      const existing = this.store.state.get(fullKey);

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

      this.store.state.set(fullKey, entry);
      this.store.recordChange(fullKey, {
        id: randomUUID().slice(0, 8),
        key,
        namespace,
        action: 'set',
        oldValue: existing?.value,
        newValue: value,
        timestamp: now,
        source: 'import',
      });
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
}

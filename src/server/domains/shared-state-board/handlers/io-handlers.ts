/**
 * IO sub-handler — history, export, import.
 */

import { randomUUID } from 'node:crypto';
import type { StateEntry, StateBoardStore } from './shared';
import { matchesKeyPattern } from './shared';
import {
  argString,
  argNumber,
  argBool,
  argStringRequired,
  argObject,
} from '@server/domains/shared/parse-args';

export class IOHandlers {
  private store: StateBoardStore;

  constructor(store: StateBoardStore) {
    this.store = store;
  }

  async handleHistory(args: Record<string, unknown>): Promise<unknown> {
    const key = argStringRequired(args, 'key');
    const namespace = argString(args, 'namespace', 'default');
    const limit = argNumber(args, 'limit', 50);

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
    const namespace = argString(args, 'namespace');
    const keyPattern = argString(args, 'keyPattern');

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
    const data = argObject(args, 'data');
    const namespace = argString(args, 'namespace', 'default');
    const overwrite = argBool(args, 'overwrite', false);

    if (!data) {
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

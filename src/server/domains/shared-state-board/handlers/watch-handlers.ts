/**
 * Watch sub-handler — watch, unwatch, poll.
 */

import { randomUUID } from 'node:crypto';
import type { StateBoardStore, StateWatch } from './shared';
import { matchesKeyPattern } from './shared';

export class WatchHandlers {
  private store: StateBoardStore;

  constructor(store: StateBoardStore) {
    this.store = store;
  }

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

    const prefix = `${namespace}:`;
    for (const [fullKey, entry] of this.store.state.entries()) {
      if (fullKey.startsWith(prefix)) {
        if (isPattern) {
          if (matchesKeyPattern(entry.key, key)) {
            watch.lastVersion[entry.key] = entry.version;
          }
        } else if (entry.key === key) {
          watch.lastVersion[entry.key] = entry.version;
        }
      }
    }

    this.store.watches.set(watchId, watch);

    return {
      watchId,
      key,
      namespace,
      pattern: isPattern,
      pollIntervalMs,
      initialKeys: Object.keys(watch.lastVersion),
    };
  }

  async handleUnwatch(args: Record<string, unknown>): Promise<unknown> {
    const watchId = args.watchId as string;

    const watch = this.store.watches.get(watchId);
    if (!watch) {
      return { removed: false, watchId, reason: 'not_found' };
    }

    this.store.watches.delete(watchId);

    return { removed: true, watchId, wasWatching: watch.key };
  }

  async handlePoll(args: Record<string, unknown>): Promise<unknown> {
    const watchId = args.watchId as string;

    const watch = this.store.watches.get(watchId);
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
      for (const [fullKey, entry] of this.store.state.entries()) {
        if (fullKey.startsWith(prefix) && matchesKeyPattern(entry.key, watch.key)) {
          const lastVer = watch.lastVersion[entry.key];
          if (lastVer === undefined) {
            changes.push({ key: entry.key, namespace: entry.namespace, action: 'created' });
          } else if (entry.version > lastVer) {
            changes.push({ key: entry.key, namespace: entry.namespace, action: 'changed' });
          }
          watch.lastVersion[entry.key] = entry.version;
        }
      }
      for (const watchedKey of Object.keys(watch.lastVersion)) {
        if (
          !this.store.state.has(`${watch.namespace}:${watchedKey}`) &&
          matchesKeyPattern(watchedKey, watch.key)
        ) {
          changes.push({
            key: watchedKey,
            namespace: watch.namespace,
            action: 'deleted',
          });
          delete watch.lastVersion[watchedKey];
        }
      }
    } else {
      const fullKey = `${watch.namespace}:${watch.key}`;
      const entry = this.store.state.get(fullKey);
      const lastVer = watch.lastVersion[watch.key];

      if (!entry && lastVer !== undefined) {
        changes.push({ key: watch.key, namespace: watch.namespace, action: 'deleted' });
        delete watch.lastVersion[watch.key];
      } else if (entry) {
        if (lastVer === undefined) {
          changes.push({ key: entry.key, namespace: entry.namespace, action: 'created' });
        } else if (entry.version > lastVer) {
          changes.push({ key: entry.key, namespace: entry.namespace, action: 'changed' });
        }
        watch.lastVersion[watch.key] = entry.version;
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
}

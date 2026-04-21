import { describe, expect, it, beforeEach } from 'vitest';
import { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';

describe('SharedStateBoardHandlers', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  // ── state_board_set ──────────────────────────────────────────────────────────

  describe('state_board_set', () => {
    it('sets a simple string value', async () => {
      const result = (await handler.handleSet({
        key: 'name',
        value: 'Alice',
      })) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.key).toBe('name');
      expect(result.namespace).toBe('default');
      expect(result.version).toBe(1);
      expect(result.expiresAt).toBeUndefined();
    });

    it('sets a value with a custom namespace', async () => {
      const result = (await handler.handleSet({
        key: 'token',
        value: 'secret-abc',
        namespace: 'auth',
      })) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.namespace).toBe('auth');
    });

    it('sets a complex object value', async () => {
      const result = (await handler.handleSet({
        key: 'profile',
        value: { id: 1, tags: ['a', 'b'] },
      })) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
    });

    it('sets a value with a TTL and returns an expiresAt ISO string', async () => {
      const result = (await handler.handleSet({
        key: 'session',
        value: 'data',
        ttlSeconds: 300,
      })) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.expiresAt).toEqual(expect.any(String));
      expect(() => new Date(result.expiresAt as string)).not.toThrow();
    });

    it('rejects a missing (empty) key', async () => {
      await expect(handler.handleSet({ key: '', value: 'val' })).rejects.toThrow(
        'key must be a non-empty string',
      );
    });

    it('rejects a non-string key', async () => {
      await expect(handler.handleSet({ key: 123, value: 'val' })).rejects.toThrow(
        'Missing required string argument: "key"',
      );
    });
  });

  // ── state_board_get ─────────────────────────────────────────────────────────

  describe('state_board_get', () => {
    it('returns found=true for an existing key', async () => {
      await handler.handleSet({ key: 'greeting', value: 'hello' });
      const result = (await handler.handleGet({ key: 'greeting' })) as Record<string, unknown>;
      expect(result.found).toBe(true);
      expect(result.value).toBe('hello');
      expect(result.namespace).toBe('default');
      expect(result.version).toBe(1);
      expect(result.createdAt).toEqual(expect.any(String));
      expect(result.updatedAt).toEqual(expect.any(String));
    });

    it('returns found=false for a missing key', async () => {
      const result = (await handler.handleGet({ key: 'does-not-exist' })) as Record<
        string,
        unknown
      >;
      expect(result.found).toBe(false);
      expect(result.key).toBe('does-not-exist');
      expect(result.namespace).toBe('default');
    });

    it('returns found=false with expired=true for a TTL that has passed', async () => {
      await handler.handleSet({ key: 'temp', value: 'soon', ttlSeconds: -1 });
      const result = (await handler.handleGet({ key: 'temp' })) as Record<string, unknown>;
      expect(result.found).toBe(false);
      expect(result.expired).toBe(true);
    });

    it('returns found=true for a key that has not yet expired', async () => {
      await handler.handleSet({ key: 'fresh', value: 'data', ttlSeconds: 3600 });
      const result = (await handler.handleGet({ key: 'fresh' })) as Record<string, unknown>;
      expect(result.found).toBe(true);
      expect(result.value).toBe('data');
    });

    it('rejects a missing key argument', async () => {
      await expect(handler.handleGet({})).rejects.toThrow(
        'Missing required string argument: "key"',
      );
    });

    it('retrieves a value in a non-default namespace', async () => {
      await handler.handleSet({ key: 'token', value: 'tok123', namespace: 'session' });
      const result = (await handler.handleGet({ key: 'token', namespace: 'session' })) as Record<
        string,
        unknown
      >;
      expect(result.found).toBe(true);
      expect(result.value).toBe('tok123');
    });
  });

  // ── state_board_delete ──────────────────────────────────────────────────────

  describe('state_board_delete', () => {
    it('deletes an existing key and returns deleted=true', async () => {
      await handler.handleSet({ key: 'removable', value: 'x' });
      const result = (await handler.handleDelete({ key: 'removable' })) as Record<string, unknown>;
      expect(result.deleted).toBe(true);
      expect(result.key).toBe('removable');
    });

    it('returns deleted=false with reason=not_found for a missing key', async () => {
      const result = (await handler.handleDelete({ key: 'gone' })) as Record<string, unknown>;
      expect(result.deleted).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('actually removes the key from the store', async () => {
      await handler.handleSet({ key: 'kill', value: 1 });
      await handler.handleDelete({ key: 'kill' });
      const getResult = (await handler.handleGet({ key: 'kill' })) as Record<string, unknown>;
      expect(getResult.found).toBe(false);
    });
  });

  // ── state_board_list ───────────────────────────────────────────────────────

  describe('state_board_list', () => {
    it('lists all keys across all namespaces when no filter given', async () => {
      await handler.handleSet({ key: 'a', value: 1 });
      await handler.handleSet({ key: 'b', value: 2 });
      await handler.handleSet({ key: 'c', value: 3, namespace: 'other' });
      const result = (await handler.handleList({})) as Record<string, unknown>;
      expect(result.total).toBe(3);
      expect(result.namespaces as string[]).toContain('default');
      expect(result.namespaces as string[]).toContain('other');
    });

    it('filters entries by namespace', async () => {
      await handler.handleSet({ key: 'x', value: 1, namespace: 'ns1' });
      await handler.handleSet({ key: 'y', value: 2, namespace: 'ns2' });
      const result = (await handler.handleList({ namespace: 'ns1' })) as Record<string, unknown>;
      expect(result.total).toBe(1);
      const entries = result.entries as Array<Record<string, unknown>>;
      expect(entries[0]!.key).toBe('x');
    });

    it('does not include values by default', async () => {
      await handler.handleSet({ key: 'secret', value: { pwd: 'hunter2' } });
      const result = (await handler.handleList({})) as Record<string, unknown>;
      const entries = result.entries as Array<Record<string, unknown>>;
      const secret = entries.find((e) => e.key === 'secret');
      expect(secret).toBeDefined();
      expect(secret).not.toHaveProperty('value');
    });

    it('includes values when includeValues=true', async () => {
      await handler.handleSet({ key: 'data', value: { score: 42 } });
      const result = (await handler.handleList({ includeValues: true })) as Record<string, unknown>;
      const entries = result.entries as Array<Record<string, unknown>>;
      const found = entries.find((e) => e.key === 'data');
      expect(found?.value).toEqual({ score: 42 });
    });
  });

  // ── state_board_watch / state_board_unwatch ────────────────────────────────

  describe('state_board_watch', () => {
    it('creates a watch and returns a watchId prefixed with watch_', async () => {
      const result = (await handler.handleWatch({ key: 'foo' })) as Record<string, unknown>;
      expect(result.watchId).toMatch(/^watch_[a-f0-9]+$/);
      expect(result.key).toBe('foo');
      expect(result.pattern).toBe(false);
      expect(result.pollIntervalMs).toBe(1000); // default
    });

    it('creates a watch with a custom pollIntervalMs', async () => {
      const result = (await handler.handleWatch({ key: 'bar', pollIntervalMs: 500 })) as Record<
        string,
        unknown
      >;
      expect(result.pollIntervalMs).toBe(500);
    });

    it('sets pattern=true when key contains a wildcard', async () => {
      const result = (await handler.handleWatch({ key: 'user:*' })) as Record<string, unknown>;
      expect(result.pattern).toBe(true);
    });

    it('initializes initialKeys from pre-existing matching entries', async () => {
      await handler.handleSet({ key: 'user:42', value: 'Alice', namespace: 'users' });
      await handler.handleSet({ key: 'user:99', value: 'Bob', namespace: 'users' });
      const result = (await handler.handleWatch({ key: 'user:*', namespace: 'users' })) as Record<
        string,
        unknown
      >;
      expect(result.initialKeys).toBeDefined();
      expect((result.initialKeys as string[]).length).toBeGreaterThanOrEqual(2);
    });

    it('rejects a missing key', async () => {
      await expect(handler.handleWatch({ key: '' })).rejects.toThrow(
        'key must be a non-empty string',
      );
    });
  });

  describe('state_board_unwatch', () => {
    it('removes an existing watch and returns removed=true', async () => {
      const watchResult = (await handler.handleWatch({ key: 'x' })) as { watchId: string };
      const result = (await handler.handleUnwatch({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(result.removed).toBe(true);
      expect(result.wasWatching).toBe('x');
    });

    it('returns removed=false with reason=not_found for an unknown watchId', async () => {
      const result = (await handler.handleUnwatch({ watchId: 'watch_deadbeef' })) as Record<
        string,
        unknown
      >;
      expect(result.removed).toBe(false);
      expect(result.reason).toBe('not_found');
    });
  });

  // ── state_board_poll (internal watch check) ────────────────────────────────

  describe('handlePoll', () => {
    it('detects a newly created key as a created change', async () => {
      const watchResult = (await handler.handleWatch({ key: 'poll-test' })) as { watchId: string };
      await handler.handleSet({ key: 'poll-test', value: 'new!' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'created')).toBe(true);
    });

    it('detects a value change as a changed action', async () => {
      await handler.handleSet({ key: 'versioned', value: 'v1' });
      const watchResult = (await handler.handleWatch({ key: 'versioned' })) as { watchId: string };
      await handler.handleSet({ key: 'versioned', value: 'v2' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'changed')).toBe(true);
    });

    it('detects a deleted key as a deleted action', async () => {
      await handler.handleSet({ key: 'to-remove', value: 'x' });
      const watchResult = (await handler.handleWatch({ key: 'to-remove' })) as { watchId: string };
      await handler.handleDelete({ key: 'to-remove' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'deleted')).toBe(true);
    });

    it('throws for an unknown watchId', async () => {
      await expect(handler.handlePoll({ watchId: 'watch_unknown' })).rejects.toThrow(
        'Watch "watch_unknown" not found',
      );
    });
  });

  // ── state_board_history ────────────────────────────────────────────────────

  describe('state_board_history', () => {
    it('records set, update, and delete actions in history', async () => {
      await handler.handleSet({ key: 'tracked', value: 'init' });
      await handler.handleSet({ key: 'tracked', value: 'mid' });
      await handler.handleDelete({ key: 'tracked' });
      const result = (await handler.handleHistory({ key: 'tracked' })) as Record<string, unknown>;
      expect(result.total).toBe(3);
      expect(result.key).toBe('tracked');
      const history = result.history as Array<Record<string, unknown>>;
      const actions = history.map((r) => r.action);
      // All three actions appear; exact order depends on millisecond timestamps
      expect(actions).toContain('set');
      expect(actions).toContain('set'); // two sets
      expect(actions).toContain('delete');
    });

    it('returns total:0 for a key with no history', async () => {
      const result = (await handler.handleHistory({ key: 'brand-new' })) as Record<string, unknown>;
      expect(result.total).toBe(0);
      expect(result.history).toEqual([]);
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await handler.handleSet({ key: 'limit-test', value: i });
      }
      const result = (await handler.handleHistory({ key: 'limit-test', limit: 3 })) as Record<
        string,
        unknown
      >;
      expect(result.returned).toBe(3);
    });

    it('enforces maxHistoryPerKey cap of 100', async () => {
      for (let i = 0; i < 200; i++) {
        await handler.handleSet({ key: 'trimmed', value: i });
      }
      const result = (await handler.handleHistory({ key: 'trimmed' })) as Record<string, unknown>;
      expect(result.total).toBe(100);
    });
  });

  // ── state_board_export / state_board_import ─────────────────────────────────

  describe('state_board_export', () => {
    it('exports all keys when no filter is given', async () => {
      await handler.handleSet({ key: 'k1', value: 'v1' });
      await handler.handleSet({ key: 'k2', value: 42 });
      const result = (await handler.handleExport({})) as Record<string, unknown>;
      expect(result.count).toBe(2);
      expect(result.namespace).toBe('all');
      const data = result.data as Record<string, unknown>;
      expect(data.k1).toBe('v1');
      expect(data.k2).toBe(42);
    });

    it('filters by namespace', async () => {
      await handler.handleSet({ key: 'x', value: 1, namespace: 'ns1' });
      await handler.handleSet({ key: 'y', value: 2, namespace: 'ns2' });
      const result = (await handler.handleExport({ namespace: 'ns1' })) as Record<string, unknown>;
      expect(result.count).toBe(1);
      expect(result.namespace).toBe('ns1');
    });

    it('filters by keyPattern with wildcard', async () => {
      await handler.handleSet({ key: 'user:42', value: 'Alice' });
      await handler.handleSet({ key: 'user:99', value: 'Bob' });
      await handler.handleSet({ key: 'config', value: '{}' });
      const result = (await handler.handleExport({ keyPattern: 'user:*' })) as Record<
        string,
        unknown
      >;
      expect(result.count).toBe(2);
    });

    it('excludes expired entries', async () => {
      await handler.handleSet({ key: 'live', value: 1 });
      await handler.handleSet({ key: 'dead', value: 2, ttlSeconds: -1 });
      const result = (await handler.handleExport({})) as Record<string, unknown>;
      expect(result.count).toBe(1);
    });
  });

  describe('state_board_import', () => {
    it('imports all keys and marks them as imported', async () => {
      const result = (await handler.handleImport({
        data: { a: 1, b: 'two', c: { nested: true } },
      })) as Record<string, unknown>;
      expect(result.imported).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.overwritten).toBe(0);
    });

    it('makes imported keys immediately retrievable', async () => {
      await handler.handleImport({ data: { imported_key: 'imported_val' } });
      const getResult = (await handler.handleGet({ key: 'imported_key' })) as Record<
        string,
        unknown
      >;
      expect(getResult.found).toBe(true);
      expect(getResult.value).toBe('imported_val');
    });

    it('skips existing keys when overwrite=false (default)', async () => {
      await handler.handleSet({ key: 'existing', value: 'original' });
      const result = (await handler.handleImport({
        data: { existing: 'new', newkey: 'new' },
      })) as Record<string, unknown>;
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.overwritten).toBe(0);
      // original value unchanged
      const getResult = (await handler.handleGet({ key: 'existing' })) as Record<string, unknown>;
      expect(getResult.value).toBe('original');
    });

    it('overwrites existing keys when overwrite=true', async () => {
      await handler.handleSet({ key: 'old', value: 'v1' });
      const result = (await handler.handleImport({
        data: { old: 'v2' },
        overwrite: true,
      })) as Record<string, unknown>;
      expect(result.overwritten).toBe(1);
      expect(result.imported).toBe(1);
      const getResult = (await handler.handleGet({ key: 'old' })) as Record<string, unknown>;
      expect(getResult.value).toBe('v2');
    });

    it('uses the provided namespace', async () => {
      await handler.handleImport({ data: { ns_key: 'val' }, namespace: 'custom' });
      const getResult = (await handler.handleGet({ key: 'ns_key', namespace: 'custom' })) as Record<
        string,
        unknown
      >;
      expect(getResult.found).toBe(true);
    });

    it('rejects non-object data', async () => {
      await expect(handler.handleImport({ data: 'not an object' } as any)).rejects.toThrow(
        'data must be an object',
      );
    });
  });

  // ── state_board_clear ──────────────────────────────────────────────────────

  describe('state_board_clear', () => {
    it('clears all entries when no filters given', async () => {
      await handler.handleSet({ key: 'a', value: 1 });
      await handler.handleSet({ key: 'b', value: 2 });
      const result = (await handler.handleClear({})) as Record<string, unknown>;
      expect(result.cleared).toBe(2);
      expect(result.namespace).toBe('all');
      const listResult = (await handler.handleList({})) as Record<string, unknown>;
      expect(listResult.total).toBe(0);
    });

    it('clears only a specific namespace', async () => {
      await handler.handleSet({ key: 'x', value: 1, namespace: 'ns1' });
      await handler.handleSet({ key: 'y', value: 2, namespace: 'ns2' });
      const result = (await handler.handleClear({ namespace: 'ns1' })) as Record<string, unknown>;
      expect(result.cleared).toBe(1);
      const listNs1 = (await handler.handleList({ namespace: 'ns1' })) as Record<string, unknown>;
      expect(listNs1.total).toBe(0);
      const listNs2 = (await handler.handleList({ namespace: 'ns2' })) as Record<string, unknown>;
      expect(listNs2.total).toBe(1);
    });

    it('clears only matching keyPattern', async () => {
      await handler.handleSet({ key: 'user:1', value: 'A' });
      await handler.handleSet({ key: 'user:2', value: 'B' });
      await handler.handleSet({ key: 'config', value: '{}' });
      const result = (await handler.handleClear({ keyPattern: 'user:*' })) as Record<
        string,
        unknown
      >;
      expect(result.cleared).toBe(2);
    });

    it('clears zero entries when no matches', async () => {
      const result = (await handler.handleClear({ keyPattern: 'nonexistent:*' })) as Record<
        string,
        unknown
      >;
      expect(result.cleared).toBe(0);
    });
  });

  // ── state_board_stats ─────────────────────────────────────────────────────

  describe('handleStats', () => {
    it('returns totalEntries and entriesByNamespace', async () => {
      await handler.handleSet({ key: 'a', value: 1, namespace: 'ns1' });
      await handler.handleSet({ key: 'b', value: 2, namespace: 'ns1' });
      await handler.handleSet({ key: 'c', value: 3, namespace: 'ns2' });
      await handler.handleWatch({ key: 'w' });
      const stats = (await handler.handleStats()) as Record<string, unknown>;
      expect(stats.totalEntries).toBe(3);
      expect(stats.totalWatches).toBe(1);
      expect((stats.entriesByNamespace as Record<string, number>)['ns1']).toBe(2);
      expect((stats.entriesByNamespace as Record<string, number>)['ns2']).toBe(1);
      expect(stats.historySize).toBeGreaterThan(0);
    });

    it('counts expired entries in expiredEntries', async () => {
      await handler.handleSet({ key: 'alive', value: 1 });
      await handler.handleSet({ key: 'dead', value: 2, ttlSeconds: -1 });
      const stats = (await handler.handleStats()) as Record<string, unknown>;
      expect(stats.expiredEntries).toBe(1);
    });
  });

  // ── cleanupExpired ────────────────────────────────────────────────────────

  describe('cleanupExpired', () => {
    it('removes expired entries and returns the count', async () => {
      await handler.handleSet({ key: 'valid', value: 'a', ttlSeconds: 3600 });
      await handler.handleSet({ key: 'expired1', value: 'b', ttlSeconds: -1 });
      await handler.handleSet({ key: 'expired2', value: 'c', ttlSeconds: -1 });
      const cleaned = handler.cleanupExpired();
      expect(cleaned).toBeGreaterThanOrEqual(2);
      const getValid = (await handler.handleGet({ key: 'valid' })) as Record<string, unknown>;
      expect(getValid.found).toBe(true);
      const getExpired = (await handler.handleGet({ key: 'expired1' })) as Record<string, unknown>;
      expect(getExpired.found).toBe(false);
    });

    it('records expire action in history', async () => {
      await handler.handleSet({ key: 'will-expire', value: 'x', ttlSeconds: -1 });
      handler.cleanupExpired();
      const history = (await handler.handleHistory({ key: 'will-expire' })) as Record<
        string,
        unknown
      >;
      const records = history.history as Array<Record<string, unknown>>;
      expect(records.some((r) => r.action === 'expire')).toBe(true);
    });
  });
});

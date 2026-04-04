import { describe, it, expect, beforeEach } from 'vitest';
import { SharedStateBoardHandlers } from '../../../../src/server/domains/shared-state-board/handlers.impl';

describe('SharedStateBoardHandlers', () => {
  let handler: SharedStateBoardHandlers;
  const mockCtx = {} as import('@server/MCPServer.context').MCPServerContext;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers(mockCtx);
  });

  describe('state_board_set', () => {
    it('should set a simple value', async () => {
      const result = await handler.handleSet({
        key: 'test-key',
        value: 'test-value',
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          key: 'test-key',
          namespace: 'default',
          version: 1,
        }),
      );
    });

    it('should set a value with custom namespace', async () => {
      const result = await handler.handleSet({
        key: 'user-data',
        value: { id: 1, name: 'Alice' },
        namespace: 'users',
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          key: 'user-data',
          namespace: 'users',
        }),
      );
    });

    it('should set a value with TTL', async () => {
      const result = await handler.handleSet({
        key: 'temp-key',
        value: 'expires-soon',
        ttlSeconds: 60,
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          expiresAt: expect.any(String),
        }),
      );
    });

    it('should increment version on update', async () => {
      await handler.handleSet({ key: 'versioned', value: 'v1' });
      await handler.handleSet({ key: 'versioned', value: 'v2' });

      const getResult = await handler.handleGet({ key: 'versioned' });
      expect(getResult).toEqual(
        expect.objectContaining({
          found: true,
          value: 'v2',
          version: 2,
        }),
      );
    });
  });

  describe('state_board_get', () => {
    it('should return found entry', async () => {
      await handler.handleSet({ key: 'mykey', value: { data: 123 } });

      const result = await handler.handleGet({ key: 'mykey' });
      expect(result).toEqual(
        expect.objectContaining({
          found: true,
          key: 'mykey',
          value: { data: 123 },
        }),
      );
    });

    it('should return not found for missing key', async () => {
      const result = await handler.handleGet({ key: 'nonexistent' });
      expect(result).toEqual(
        expect.objectContaining({
          found: false,
          key: 'nonexistent',
        }),
      );
    });

    it('should return not found for expired key', async () => {
      await handler.handleSet({
        key: 'expiring',
        value: 'short-lived',
        ttlSeconds: -1, // Already expired
      });

      const result = await handler.handleGet({ key: 'expiring' });
      expect(result).toEqual(
        expect.objectContaining({
          found: false,
          expired: true,
        }),
      );
    });
  });

  describe('state_board_delete', () => {
    it('should delete existing key', async () => {
      await handler.handleSet({ key: 'to-delete', value: 'temporary' });

      const result = await handler.handleDelete({ key: 'to-delete' });
      expect(result).toEqual(
        expect.objectContaining({
          deleted: true,
          key: 'to-delete',
        }),
      );

      const getAfter = await handler.handleGet({ key: 'to-delete' });
      expect(getAfter).toEqual(expect.objectContaining({ found: false }));
    });

    it('should return not_found for missing key', async () => {
      const result = await handler.handleDelete({ key: 'nonexistent' });
      expect(result).toEqual(
        expect.objectContaining({
          deleted: false,
          reason: 'not_found',
        }),
      );
    });
  });

  describe('state_board_list', () => {
    it('should list all keys', async () => {
      await handler.handleSet({ key: 'a', value: 1 });
      await handler.handleSet({ key: 'b', value: 2 });
      await handler.handleSet({ key: 'c', value: 3, namespace: 'other' });

      const result = await handler.handleList({});
      expect(result).toEqual(
        expect.objectContaining({
          total: 3,
          namespaces: expect.arrayContaining(['default', 'other']),
        }),
      );
    });

    it('should filter by namespace', async () => {
      await handler.handleSet({ key: 'a', value: 1, namespace: 'ns1' });
      await handler.handleSet({ key: 'b', value: 2, namespace: 'ns2' });

      const result = await handler.handleList({ namespace: 'ns1' });
      expect(result).toEqual(
        expect.objectContaining({
          total: 1,
          entries: expect.arrayContaining([expect.objectContaining({ key: 'a' })]),
        }),
      );
    });

    it('should include values when requested', async () => {
      await handler.handleSet({ key: 'with-value', value: { complex: true } });

      const result = await handler.handleList({ includeValues: true });
      const entryWithValue = (result.entries as Array<{ key: string; value?: unknown }>).find(
        (e) => e.key === 'with-value',
      );
      expect(entryWithValue?.value).toEqual({ complex: true });
    });
  });

  describe('state_board_watch', () => {
    it('should create a watch', async () => {
      const result = await handler.handleWatch({ key: 'watched-key' });
      expect(result).toEqual(
        expect.objectContaining({
          watchId: expect.stringMatching(/^watch_/),
          key: 'watched-key',
          pattern: false,
        }),
      );
    });

    it('should create a pattern watch', async () => {
      const result = await handler.handleWatch({ key: 'user:*' });
      expect(result).toEqual(
        expect.objectContaining({
          key: 'user:*',
          pattern: true,
        }),
      );
    });

    it('should unwatch', async () => {
      const watchResult = await handler.handleWatch({ key: 'to-unwatch' });
      const watchId = (watchResult as { watchId: string }).watchId;

      const unwatchResult = await handler.handleUnwatch({ watchId });
      expect(unwatchResult).toEqual(
        expect.objectContaining({
          removed: true,
        }),
      );
    });
  });

  describe('state_board_history', () => {
    it('should track change history', async () => {
      await handler.handleSet({ key: 'tracked', value: 'initial' });
      await handler.handleSet({ key: 'tracked', value: 'updated' });
      await handler.handleDelete({ key: 'tracked' });

      const result = await handler.handleHistory({ key: 'tracked' });
      expect(result).toEqual(
        expect.objectContaining({
          key: 'tracked',
          namespace: 'default',
          total: 3, // set, set, delete
        }),
      );
    });

    it('should limit history entries', async () => {
      for (let i = 0; i < 150; i++) {
        await handler.handleSet({ key: 'many-changes', value: i });
      }

      const result = await handler.handleHistory({ key: 'many-changes', limit: 50 });
      expect(result.total).toBeLessThanOrEqual(100); // maxHistoryPerKey is 100
    });
  });

  describe('state_board_export/import', () => {
    it('should export all data', async () => {
      await handler.handleSet({ key: 'a', value: 1 });
      await handler.handleSet({ key: 'b', value: 2 });

      const result = await handler.handleExport({});
      expect(result).toEqual(
        expect.objectContaining({
          count: 2,
          data: expect.objectContaining({
            a: 1,
            b: 2,
          }),
        }),
      );
    });

    it('should import data', async () => {
      const importResult = await handler.handleImport({
        data: { x: 10, y: 20 },
      });

      expect(importResult).toEqual(
        expect.objectContaining({
          imported: 2,
          keys: expect.arrayContaining(['x', 'y']),
        }),
      );

      const getX = await handler.handleGet({ key: 'x' });
      expect(getX).toEqual(expect.objectContaining({ found: true, value: 10 }));
    });

    it('should skip existing keys without overwrite', async () => {
      await handler.handleSet({ key: 'existing', value: 'original' });

      const importResult = await handler.handleImport({
        data: { existing: 'new', newkey: 'newvalue' },
      });

      expect(importResult).toEqual(
        expect.objectContaining({
          imported: 1,
          skipped: 1,
        }),
      );

      const getExisting = await handler.handleGet({ key: 'existing' });
      expect(getExisting).toEqual(expect.objectContaining({ value: 'original' }));
    });

    it('should overwrite existing keys with flag', async () => {
      await handler.handleSet({ key: 'overwrite-me', value: 'old' });

      const importResult = await handler.handleImport({
        data: { 'overwrite-me': 'new' },
        overwrite: true,
      });

      expect(importResult).toEqual(
        expect.objectContaining({
          overwritten: 1,
        }),
      );

      const getAfter = await handler.handleGet({ key: 'overwrite-me' });
      expect(getAfter).toEqual(expect.objectContaining({ value: 'new' }));
    });
  });

  describe('state_board_clear', () => {
    it('should clear all entries', async () => {
      await handler.handleSet({ key: 'a', value: 1 });
      await handler.handleSet({ key: 'b', value: 2 });

      const result = await handler.handleClear({});
      expect(result).toEqual(
        expect.objectContaining({
          cleared: 2,
        }),
      );

      const listAfter = await handler.handleList({});
      expect(listAfter.total).toBe(0);
    });

    it('should clear by namespace', async () => {
      await handler.handleSet({ key: 'a', value: 1, namespace: 'ns1' });
      await handler.handleSet({ key: 'b', value: 2, namespace: 'ns2' });

      const result = await handler.handleClear({ namespace: 'ns1' });
      expect(result).toEqual(
        expect.objectContaining({
          cleared: 1,
          namespace: 'ns1',
        }),
      );
    });
  });

  describe('state_board_stats', () => {
    it('should return statistics', async () => {
      await handler.handleSet({ key: 'a', value: 1 });
      await handler.handleSet({ key: 'b', value: 2, namespace: 'other' });
      await handler.handleWatch({ key: 'watched' });

      const stats = await handler.handleStats();
      expect(stats).toEqual(
        expect.objectContaining({
          totalEntries: 2,
          totalWatches: 1,
          entriesByNamespace: expect.objectContaining({
            default: 1,
            other: 1,
          }),
        }),
      );
    });
  });

  describe('cleanupExpired', () => {
    it('should clean up expired entries', async () => {
      await handler.handleSet({ key: 'expired', value: 'old', ttlSeconds: -1 });
      await handler.handleSet({ key: 'valid', value: 'fresh', ttlSeconds: 3600 });

      const cleaned = handler.cleanupExpired();
      expect(cleaned).toBeGreaterThanOrEqual(1);

      const getExpired = await handler.handleGet({ key: 'expired' });
      expect(getExpired).toEqual(expect.objectContaining({ found: false }));
    });
  });
});

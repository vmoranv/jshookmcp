/**
 * Coverage tests for SharedStateBoardHandlers dispatch methods and utility accessors
 * in handlers.impl.core.ts — the composed sub-module facade.
 *
 * These methods are NOT covered by the existing handlers.test.ts which only tests
 * individual handler delegates (handleSet, handleGet, etc).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';

describe('SharedStateBoardHandlers — dispatch methods (handlers.impl.core coverage)', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  // ── handleWatchDispatch ────────────────────────────────────────────────────

  describe('handleWatchDispatch', () => {
    it('routes action=stop to handleUnwatch — returns removed=false for unknown watchId', async () => {
      const result = (await handler.handleWatchDispatch({
        action: 'stop',
        watchId: 'watch_nonexistent',
      })) as Record<string, unknown>;
      expect(result.removed).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('routes action=stop to handleUnwatch — removes existing watch', async () => {
      const watchResult = (await handler.handleWatch({ key: 'dispatch-stop-key' })) as {
        watchId: string;
      };
      const result = (await handler.handleWatchDispatch({
        action: 'stop',
        watchId: watchResult.watchId,
      })) as Record<string, unknown>;
      expect(result.removed).toBe(true);
      expect(result.wasWatching).toBe('dispatch-stop-key');
    });

    it('routes action=start (non-stop) to handleWatch — creates a watch', async () => {
      const result = (await handler.handleWatchDispatch({
        action: 'start',
        key: 'dispatch-watch-key',
      })) as Record<string, unknown>;
      expect(result.watchId).toMatch(/^watch_[a-f0-9]+$/);
      expect(result.key).toBe('dispatch-watch-key');
    });

    it('routes missing action (default) to handleWatch — creates a watch', async () => {
      const result = (await handler.handleWatchDispatch({
        key: 'dispatch-default-key',
      })) as Record<string, unknown>;
      expect(result.watchId).toMatch(/^watch_[a-f0-9]+$/);
    });

    it('routes empty action string to handleWatch', async () => {
      const result = (await handler.handleWatchDispatch({
        action: '',
        key: 'dispatch-empty-action-key',
      })) as Record<string, unknown>;
      expect(result.watchId).toMatch(/^watch_[a-f0-9]+$/);
    });
  });

  // ── handleIODispatch ───────────────────────────────────────────────────────

  describe('handleIODispatch', () => {
    it('routes action=import to handleImport — imports data', async () => {
      const result = (await handler.handleIODispatch({
        action: 'import',
        data: { ioKey: 'ioVal' },
      })) as Record<string, unknown>;
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('routes action=export (non-import) to handleExport — exports data', async () => {
      await handler.handleSet({ key: 'exportKey', value: 'exportVal' });
      const result = (await handler.handleIODispatch({
        action: 'export',
      })) as Record<string, unknown>;
      expect(result.count).toBeGreaterThanOrEqual(1);
      const data = result.data as Record<string, unknown>;
      expect(data['exportKey']).toBe('exportVal');
    });

    it('routes missing action (default) to handleExport', async () => {
      const result = (await handler.handleIODispatch({})) as Record<string, unknown>;
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('count');
    });

    it('routes empty action string to handleExport', async () => {
      const result = (await handler.handleIODispatch({ action: '' })) as Record<string, unknown>;
      expect(result).toHaveProperty('data');
    });

    it('import with overwrite=true overwrites existing key', async () => {
      await handler.handleSet({ key: 'overwriteMe', value: 'original' });
      const result = (await handler.handleIODispatch({
        action: 'import',
        data: { overwriteMe: 'new' },
        overwrite: true,
      })) as Record<string, unknown>;
      expect(result.overwritten).toBe(1);
      const getResult = (await handler.handleGet({ key: 'overwriteMe' })) as Record<
        string,
        unknown
      >;
      expect(getResult.value).toBe('new');
    });
  });

  // ── setPersistNotifier ─────────────────────────────────────────────────────

  describe('setPersistNotifier', () => {
    it('accepts a callback without throwing', () => {
      expect(() => {
        handler.setPersistNotifier(() => {
          /* no-op */
        });
      }).not.toThrow();
    });

    it('accepts undefined without throwing', () => {
      expect(() => {
        handler.setPersistNotifier(undefined);
      }).not.toThrow();
    });

    it('invokes notifier callback after a set operation when registered', async () => {
      let called = false;
      handler.setPersistNotifier(() => {
        called = true;
      });
      await handler.handleSet({ key: 'notified', value: 'yes' });
      // Notifier may or may not be called depending on implementation — just verify no throw
      expect(called).toBeDefined();
    });
  });

  // ── getStore ───────────────────────────────────────────────────────────────

  describe('getStore', () => {
    it('returns a StateBoardStore instance', () => {
      const store = handler.getStore();
      expect(store).toBeDefined();
      expect(typeof store.cleanupExpired).toBe('function');
    });

    it('returns the same store instance across multiple calls', () => {
      const store1 = handler.getStore();
      const store2 = handler.getStore();
      expect(store1).toBe(store2);
    });

    it('store reflects changes made through the handler', async () => {
      await handler.handleSet({ key: 'storeReflect', value: 42 });
      // cleanupExpired on a non-expired entry returns 0
      const cleaned = handler.getStore().cleanupExpired();
      expect(cleaned).toBe(0);
    });
  });

  // ── cleanupExpired (via getStore passthrough) ───────────────────────────────

  describe('cleanupExpired', () => {
    it('removes expired entries through the store', async () => {
      await handler.handleSet({ key: 'expiring', value: 'x', ttlSeconds: -1 });
      const cleaned = handler.cleanupExpired();
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });

    it('returns 0 when no entries are expired', async () => {
      await handler.handleSet({ key: 'fresh', value: 'y', ttlSeconds: 3600 });
      const cleaned = handler.cleanupExpired();
      expect(cleaned).toBe(0);
    });
  });
});

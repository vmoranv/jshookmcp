import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@server/ToolCatalog', () => ({
  getToolDomain: vi.fn((name: string) => {
    const map: Record<string, string> = {
      page_navigate: 'browser',
      page_evaluate: 'browser',
      page_click: 'browser',
      debugger_pause: 'debugger',
      debugger_resume: 'debugger',
      network_get_requests: 'network',
    };
    return map[name] ?? null;
  }),
}));

import {
  startDomainTtl,
  refreshDomainTtl,
  refreshDomainTtlForTool,
  clearDomainTtl,
  deactivateDomainOnExpiry,
} from '@server/MCPServer.activation.ttl';
import type { DomainTtlEntry } from '@server/MCPServer.activation.ttl';

type MockCtx = {
  domainTtlEntries: Map<string, DomainTtlEntry>;
  activatedToolNames: Set<string>;
  activatedRegisteredTools: Map<string, { remove: ReturnType<typeof vi.fn> }>;
  extensionToolsByName: Map<string, any>;
  enabledDomains: Set<string>;
  selectedTools: { name: string }[];
  router: { removeHandler: ReturnType<typeof vi.fn> };
  server: { sendToolListChanged: ReturnType<typeof vi.fn> };
};

function createMockCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    domainTtlEntries: new Map(),
    activatedToolNames: new Set(),
    activatedRegisteredTools: new Map(),
    extensionToolsByName: new Map(),
    enabledDomains: new Set(),
    selectedTools: [],
    router: { removeHandler: vi.fn() },
    server: { sendToolListChanged: vi.fn(async () => {}) },
    ...overrides,
  };
}

describe('MCPServer.activation.ttl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startDomainTtl', () => {
    it('creates a TTL entry with correct ttlMs and toolNames', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx as any, 'browser', 30, ['page_navigate', 'page_evaluate']);

      expect(ctx.domainTtlEntries.has('browser')).toBe(true);
      const entry = ctx.domainTtlEntries.get('browser')!;
      expect(entry.ttlMs).toBe(30 * 60 * 1000);
      expect(entry.toolNames).toEqual(new Set(['page_navigate', 'page_evaluate']));
    });

    it('does not create timer when ttlMinutes is 0', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx as any, 'browser', 0, ['page_navigate']);

      expect(ctx.domainTtlEntries.has('browser')).toBe(false);
    });

    it('does not create timer when ttlMinutes is negative', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx as any, 'browser', -1, ['page_navigate']);

      expect(ctx.domainTtlEntries.has('browser')).toBe(false);
    });

    it('replaces existing TTL entry for the same domain', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate']);
      const firstEntry = ctx.domainTtlEntries.get('browser')!;

      startDomainTtl(ctx as any, 'browser', 20, ['page_navigate', 'page_evaluate']);
      const secondEntry = ctx.domainTtlEntries.get('browser')!;

      expect(secondEntry.ttlMs).toBe(20 * 60 * 1000);
      expect(secondEntry.toolNames.size).toBe(2);
      expect(secondEntry.timer).not.toBe(firstEntry.timer);
    });

    it('triggers deactivation on expiry', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: removeFn });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 1, ['page_navigate']);

      // Advance past TTL
      await vi.advanceTimersByTimeAsync(60 * 1000 + 100);

      expect(removeFn).toHaveBeenCalledOnce();
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(false);
      expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
    });
  });

  describe('refreshDomainTtl', () => {
    it('resets the timer keeping the same duration', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: removeFn });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 1, ['page_navigate']);

      // Advance 50 seconds (not yet expired at 60s)
      await vi.advanceTimersByTimeAsync(50 * 1000);
      expect(removeFn).not.toHaveBeenCalled();

      // Refresh — resets the full 60s window
      refreshDomainTtl(ctx as any, 'browser');

      // Advance another 50 seconds (total 100s from start, but only 50s from refresh)
      await vi.advanceTimersByTimeAsync(50 * 1000);
      expect(removeFn).not.toHaveBeenCalled();

      // Now advance past the refreshed TTL
      await vi.advanceTimersByTimeAsync(11 * 1000);
      expect(removeFn).toHaveBeenCalledOnce();
    });

    it('is a no-op for domains without TTL entries', () => {
      const ctx = createMockCtx();

      // Should not throw
      refreshDomainTtl(ctx as any, 'nonexistent');
      expect(ctx.domainTtlEntries.size).toBe(0);
    });
  });

  describe('refreshDomainTtlForTool', () => {
    it('refreshes TTL when tool belongs to a domain with active TTL', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: removeFn });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 1, ['page_navigate']);

      // Advance 50s, then refresh via tool usage
      await vi.advanceTimersByTimeAsync(50 * 1000);
      refreshDomainTtlForTool(ctx as any, 'page_navigate');

      // 50s more — should not have expired (refreshed at 50s)
      await vi.advanceTimersByTimeAsync(50 * 1000);
      expect(removeFn).not.toHaveBeenCalled();

      // Advance past refreshed TTL
      await vi.advanceTimersByTimeAsync(11 * 1000);
      expect(removeFn).toHaveBeenCalledOnce();
    });

    it('refreshes TTL for extension tools', async () => {
      const ctx = createMockCtx();
      ctx.extensionToolsByName.set('custom_ext_tool', { domain: 'browser' });

      startDomainTtl(ctx as any, 'browser', 5, ['custom_ext_tool']);

      const entryBefore = ctx.domainTtlEntries.get('browser')!;
      const timerBefore = entryBefore.timer;

      refreshDomainTtlForTool(ctx as any, 'custom_ext_tool');

      const entryAfter = ctx.domainTtlEntries.get('browser')!;
      expect(entryAfter.timer).not.toBe(timerBefore);
    });

    it('is a no-op for tools without a known domain', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx as any, 'browser', 5, ['page_navigate']);
      const timerBefore = ctx.domainTtlEntries.get('browser')!.timer;

      refreshDomainTtlForTool(ctx as any, 'unknown_tool');

      // Timer should be the same — no refresh occurred
      expect(ctx.domainTtlEntries.get('browser')!.timer).toBe(timerBefore);
    });
  });

  describe('clearDomainTtl', () => {
    it('clears timer and removes entry without deactivating tools', () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate']);
      expect(ctx.domainTtlEntries.has('browser')).toBe(true);

      clearDomainTtl(ctx as any, 'browser');

      expect(ctx.domainTtlEntries.has('browser')).toBe(false);
      // Tools remain activated
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
    });

    it('is a no-op for domains without TTL entries', () => {
      const ctx = createMockCtx();
      clearDomainTtl(ctx as any, 'nonexistent');
      expect(ctx.domainTtlEntries.size).toBe(0);
    });
  });

  describe('deactivateDomainOnExpiry', () => {
    it('removes all domain tools from activated sets', async () => {
      const removeFn1 = vi.fn();
      const removeFn2 = vi.fn();
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedToolNames.add('page_evaluate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: removeFn1 });
      ctx.activatedRegisteredTools.set('page_evaluate', { remove: removeFn2 });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate', 'page_evaluate']);

      await deactivateDomainOnExpiry(ctx as any, 'browser');

      expect(removeFn1).toHaveBeenCalledOnce();
      expect(removeFn2).toHaveBeenCalledOnce();
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(false);
      expect(ctx.activatedToolNames.has('page_evaluate')).toBe(false);
      expect(ctx.activatedRegisteredTools.has('page_navigate')).toBe(false);
      expect(ctx.activatedRegisteredTools.has('page_evaluate')).toBe(false);
      expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_navigate');
      expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_evaluate');
    });

    it('sends toolListChanged notification after deactivation', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx as any, 'browser');

      expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
    });

    it('skips already-deactivated tools', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      // page_navigate is in TTL entry but not in activatedToolNames
      ctx.activatedToolNames.add('page_evaluate');
      ctx.activatedRegisteredTools.set('page_evaluate', { remove: removeFn });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate', 'page_evaluate']);

      await deactivateDomainOnExpiry(ctx as any, 'browser');

      // Only page_evaluate should have been removed
      expect(removeFn).toHaveBeenCalledOnce();
      expect(ctx.router.removeHandler).toHaveBeenCalledTimes(1);
      expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_evaluate');
    });

    it('clears extension tool registration state', async () => {
      const ctx = createMockCtx();
      const extRecord = { domain: 'browser', registeredTool: { remove: vi.fn() } };
      ctx.extensionToolsByName.set('ext_tool', extRecord);
      ctx.activatedToolNames.add('ext_tool');
      ctx.activatedRegisteredTools.set('ext_tool', extRecord.registeredTool as any);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['ext_tool']);

      await deactivateDomainOnExpiry(ctx as any, 'browser');

      expect(extRecord.registeredTool).toBeUndefined();
    });

    it('removes domain from enabledDomains when no tools remain', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx as any, 'browser');

      expect(ctx.enabledDomains.has('browser')).toBe(false);
    });

    it('keeps domain in enabledDomains when base-profile tools remain', async () => {
      const ctx = createMockCtx({
        selectedTools: [{ name: 'page_click' }],
      });
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx as any, 'browser');

      // page_click is in selectedTools and maps to browser domain, so domain should remain
      expect(ctx.enabledDomains.has('browser')).toBe(true);
    });

    it('is a no-op when domain has no TTL entry', async () => {
      const ctx = createMockCtx();

      await deactivateDomainOnExpiry(ctx as any, 'nonexistent');

      expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
    });

    it('handles registeredTool.remove() throwing gracefully', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: vi.fn(() => {
          throw new Error('SDK removal failed');
        }),
      });
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx as any, 'browser', 10, ['page_navigate']);

      // Should not throw
      await deactivateDomainOnExpiry(ctx as any, 'browser');

      // Tool should still be cleaned up from internal state
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(false);
      expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
    });
  });
});

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
import type { MCPServerContext } from '@server/MCPServer.context';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExtensionToolRecord } from '@server/extensions/types';

type MockCtx = MCPServerContext & {
  domainTtlEntries: Map<string, DomainTtlEntry>;
  activatedToolNames: Set<string>;
  activatedRegisteredTools: Map<string, RegisteredTool>;
  extensionToolsByName: Map<string, ExtensionToolRecord>;
  enabledDomains: Set<string>;
  selectedTools: { name: string }[];
  router: { removeHandler: ReturnType<typeof vi.fn> };
  server: { sendToolListChanged: ReturnType<typeof vi.fn> };
};

function createMockCtx(overrides: Partial<MockCtx> = {}): MCPServerContext {
  const ctx = {
    domainTtlEntries: new Map(),
    activatedToolNames: new Set(),
    activatedRegisteredTools: new Map(),
    extensionToolsByName: new Map(),
    enabledDomains: new Set(),
    selectedTools: [],
    router: { removeHandler: vi.fn() },
    server: { sendToolListChanged: vi.fn(async () => {}) },
    ...overrides,
  } as unknown as MCPServerContext;
  return ctx;
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
      startDomainTtl(ctx, 'browser', 30, ['page_navigate', 'page_evaluate']);

      expect(ctx.domainTtlEntries.has('browser')).toBe(true);
      const entry = ctx.domainTtlEntries.get('browser')!;
      expect(entry.ttlMs).toBe(30 * 60 * 1000);
      expect(entry.toolNames).toEqual(new Set(['page_navigate', 'page_evaluate']));
    });

    it('does not create timer when ttlMinutes is 0', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx, 'browser', 0, ['page_navigate']);

      expect(ctx.domainTtlEntries.has('browser')).toBe(false);
    });

    it('does not create timer when ttlMinutes is negative', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx, 'browser', -1, ['page_navigate']);

      expect(ctx.domainTtlEntries.has('browser')).toBe(false);
    });

    it('replaces existing TTL entry for the same domain', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);
      const firstEntry = ctx.domainTtlEntries.get('browser')!;

      startDomainTtl(ctx, 'browser', 20, ['page_navigate', 'page_evaluate']);
      const secondEntry = ctx.domainTtlEntries.get('browser')!;

      expect(secondEntry.ttlMs).toBe(20 * 60 * 1000);
      expect(secondEntry.toolNames.size).toBe(2);
      expect(secondEntry.timer).not.toBe(firstEntry.timer);
    });

    it('triggers deactivation on expiry', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: removeFn,
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 1, ['page_navigate']);

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
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: removeFn,
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 1, ['page_navigate']);

      // Advance 50 seconds (not yet expired at 60s)
      await vi.advanceTimersByTimeAsync(50 * 1000);
      expect(removeFn).not.toHaveBeenCalled();

      // Refresh — resets the full 60s window
      refreshDomainTtl(ctx, 'browser');

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
      refreshDomainTtl(ctx, 'nonexistent');
      expect(ctx.domainTtlEntries.size).toBe(0);
    });
  });

  describe('refreshDomainTtlForTool', () => {
    it('refreshes TTL when tool belongs to a domain with active TTL', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: removeFn,
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 1, ['page_navigate']);

      // Advance 50s, then refresh via tool usage
      await vi.advanceTimersByTimeAsync(50 * 1000);
      refreshDomainTtlForTool(ctx, 'page_navigate');

      // 50s more — should not have expired (refreshed at 50s)
      await vi.advanceTimersByTimeAsync(50 * 1000);
      expect(removeFn).not.toHaveBeenCalled();

      // Advance past refreshed TTL
      await vi.advanceTimersByTimeAsync(11 * 1000);
      expect(removeFn).toHaveBeenCalledOnce();
    });

    it('refreshes TTL for extension tools', async () => {
      const ctx = createMockCtx();
      ctx.extensionToolsByName.set('custom_ext_tool', {
        domain: 'browser',
      } as unknown as ExtensionToolRecord);

      startDomainTtl(ctx, 'browser', 5, ['custom_ext_tool']);

      const entryBefore = ctx.domainTtlEntries.get('browser')!;
      const timerBefore = entryBefore.timer;

      refreshDomainTtlForTool(ctx, 'custom_ext_tool');

      const entryAfter = ctx.domainTtlEntries.get('browser')!;
      expect(entryAfter.timer).not.toBe(timerBefore);
    });

    it('is a no-op for tools without a known domain', () => {
      const ctx = createMockCtx();
      startDomainTtl(ctx, 'browser', 5, ['page_navigate']);
      const timerBefore = ctx.domainTtlEntries.get('browser')!.timer;

      refreshDomainTtlForTool(ctx, 'unknown_tool');

      // Timer should be the same — no refresh occurred
      expect(ctx.domainTtlEntries.get('browser')!.timer).toBe(timerBefore);
    });
  });

  describe('clearDomainTtl', () => {
    it('clears timer and removes entry without deactivating tools', () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);
      expect(ctx.domainTtlEntries.has('browser')).toBe(true);

      clearDomainTtl(ctx, 'browser');

      expect(ctx.domainTtlEntries.has('browser')).toBe(false);
      // Tools remain activated
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
    });

    it('is a no-op for domains without TTL entries', () => {
      const ctx = createMockCtx();
      clearDomainTtl(ctx, 'nonexistent');
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
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: removeFn1,
      } as unknown as RegisteredTool);
      ctx.activatedRegisteredTools.set('page_evaluate', {
        remove: removeFn2,
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate', 'page_evaluate']);

      await deactivateDomainOnExpiry(ctx, 'browser');

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
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: vi.fn(),
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx, 'browser');

      expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
    });

    it('skips already-deactivated tools', async () => {
      const removeFn = vi.fn();
      const ctx = createMockCtx();
      // page_navigate is in TTL entry but not in activatedToolNames
      ctx.activatedToolNames.add('page_evaluate');
      ctx.activatedRegisteredTools.set('page_evaluate', {
        remove: removeFn,
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate', 'page_evaluate']);

      await deactivateDomainOnExpiry(ctx, 'browser');

      // Only page_evaluate should have been removed
      expect(removeFn).toHaveBeenCalledOnce();
      expect(ctx.router.removeHandler).toHaveBeenCalledTimes(1);
      expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_evaluate');
    });

    it('clears extension tool registration state', async () => {
      const ctx = createMockCtx();
      const extRecord = {
        domain: 'browser',
        registeredTool: { remove: vi.fn() },
      } as unknown as ExtensionToolRecord;
      ctx.extensionToolsByName.set('ext_tool', extRecord);
      ctx.activatedToolNames.add('ext_tool');
      ctx.activatedRegisteredTools.set('ext_tool', extRecord.registeredTool!);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['ext_tool']);

      await deactivateDomainOnExpiry(ctx, 'browser');

      expect(extRecord.registeredTool).toBeUndefined();
    });

    it('removes domain from enabledDomains when no tools remain', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: vi.fn(),
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx, 'browser');

      expect(ctx.enabledDomains.has('browser')).toBe(false);
    });

    it('keeps domain in enabledDomains when base-profile tools remain', async () => {
      const ctx = createMockCtx({
        selectedTools: [{ name: 'page_click' }] as unknown as MCPServerContext['selectedTools'],
      });
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: vi.fn(),
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx, 'browser');

      // page_click is in selectedTools and maps to browser domain, so domain should remain
      expect(ctx.enabledDomains.has('browser')).toBe(true);
    });

    it('is a no-op when domain has no TTL entry', async () => {
      const ctx = createMockCtx();

      await deactivateDomainOnExpiry(ctx, 'nonexistent');

      expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
    });

    it('handles registeredTool.remove() throwing gracefully', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', {
        remove: vi.fn(() => {
          throw new Error('SDK removal failed');
        }),
      } as unknown as RegisteredTool);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      // Should not throw
      await deactivateDomainOnExpiry(ctx, 'browser');

      // Tool should still be cleaned up from internal state
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(false);
      expect(ctx.server.sendToolListChanged).toHaveBeenCalled();
    });

    it('keeps domain in enabledDomains when other tools from the domain remain active', async () => {
      const ctx = createMockCtx();
      // add two tools to same domain (browser)
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedToolNames.add('page_click');

      // both registered
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() } as any);
      ctx.activatedRegisteredTools.set('page_click', { remove: vi.fn() } as any);
      ctx.enabledDomains.add('browser');

      // Only TTL for page_navigate
      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      await deactivateDomainOnExpiry(ctx, 'browser');

      // Domain should stay enabled because page_click is still active
      expect(ctx.enabledDomains.has('browser')).toBe(true);
    });

    it('handles sendToolListChanged throwing an error', async () => {
      const ctx = createMockCtx();
      ctx.server.sendToolListChanged = vi.fn().mockRejectedValue(new Error('Send failed'));
      ctx.activatedToolNames.add('page_navigate');
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() } as any);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);
      await deactivateDomainOnExpiry(ctx, 'browser');

      // It should catch the error and log a warning
      // We don't have access to the mocked logger in this scope easily without calling expect on it,
      // but test passes as long as it doesn't throw.
    });

    it('handles deactivateDomainOnExpiry throwing an error during startDomainTtl expiry', async () => {
      const ctx = createMockCtx();
      // Force an error inside deactivateDomainOnExpiry by making activatedToolNames.has throw
      ctx.activatedToolNames.has = vi.fn().mockImplementation(() => {
        throw new Error('Forced error in deactivate');
      });
      ctx.activatedToolNames.add('page_navigate');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      // Let TTL expire
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

      // Should not throw unhandled rejection
    });

    it('handles deactivateDomainOnExpiry throwing an error during refreshDomainTtl expiry', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      refreshDomainTtl(ctx, 'browser');

      // Force an error inside deactivateDomainOnExpiry
      ctx.activatedToolNames.has = vi.fn().mockImplementation(() => {
        throw new Error('Forced error in deactivate');
      });

      // Let TTL expire
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

      // Should not throw unhandled rejection
    });

    it('skips removing SDK registration if registeredTool is missing', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate');
      // Intentionally DO NOT set in activatedRegisteredTools
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);
      await deactivateDomainOnExpiry(ctx, 'browser');

      // Should complete without error and remove routing
      expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_navigate');
      expect(ctx.activatedToolNames.has('page_navigate')).toBe(false);
    });

    it('exits early if removedCount is 0', async () => {
      const ctx = createMockCtx();
      ctx.enabledDomains.add('browser');

      // Start TTL for page_navigate
      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);

      // Manually remove page_navigate before expiry
      ctx.activatedToolNames.delete('page_navigate');

      await deactivateDomainOnExpiry(ctx, 'browser');

      // sendToolListChanged should NOT be called because removedCount was 0
      expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
    });

    it('re-evaluates domains and skips non-matching active tools', async () => {
      const ctx = createMockCtx();
      ctx.activatedToolNames.add('page_navigate'); // browser domain
      ctx.activatedToolNames.add('debugger_pause'); // debugger domain
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() } as any);
      ctx.enabledDomains.add('browser');
      ctx.enabledDomains.add('debugger');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);
      await deactivateDomainOnExpiry(ctx, 'browser');

      // browser should be disabled, debugger tool skipped during re-evaluation
      expect(ctx.enabledDomains.has('browser')).toBe(false);
      expect(ctx.enabledDomains.has('debugger')).toBe(true);
    });

    it('re-evaluates domains and skips non-matching selected tools', async () => {
      const ctx = createMockCtx({
        selectedTools: [{ name: 'debugger_pause' }] as any,
      });
      ctx.activatedToolNames.add('page_navigate'); // browser domain
      ctx.activatedRegisteredTools.set('page_navigate', { remove: vi.fn() } as any);
      ctx.enabledDomains.add('browser');

      startDomainTtl(ctx, 'browser', 10, ['page_navigate']);
      await deactivateDomainOnExpiry(ctx, 'browser');

      // browser domain disabled because selected tool is for debugger domain
      expect(ctx.enabledDomains.has('browser')).toBe(false);
    });
  });
});

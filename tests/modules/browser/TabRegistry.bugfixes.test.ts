import { describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { TabRegistry } from '@modules/browser/TabRegistry';

describe('TabRegistry stale alias cleanup', () => {
  it('drops alias bindings for pruned pageIds instead of reporting them stale forever', () => {
    const registry = new TabRegistry<object>();
    const pageA = { id: 'a' };
    const pageB = { id: 'b' };

    registry.reconcilePages(
      [pageA, pageB],
      [
        { index: 0, url: buildTestUrl('a'), title: 'A' },
        { index: 1, url: buildTestUrl('b'), title: 'B' },
      ],
    );

    const pageAId = registry.getTabByIndex(0)?.pageId;
    expect(pageAId).toBeDefined();
    expect(registry.bindAlias('first', pageAId!)).toBe(true);

    // First reconcile without page A: it becomes stale and the alias is reported.
    registry.reconcilePages([pageB], [{ index: 0, url: buildTestUrl('b'), title: 'B' }]);
    expect(registry.getCurrentTabInfo('chrome').staleAliases).toContain('first');

    // Second reconcile prunes page A; its alias must not outlive the entry.
    registry.reconcilePages([pageB], [{ index: 0, url: buildTestUrl('b'), title: 'B' }]);
    const info = registry.getCurrentTabInfo('chrome');
    expect(info.aliases).toHaveLength(0);
    expect(info.staleAliases).toHaveLength(0);
    expect(registry.resolveAlias('first')).toBeNull();
  });
});

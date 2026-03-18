import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { TabRegistry } from '@modules/browser/TabRegistry';

describe('TabRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a stable page id for the same page handle and updates metadata', () => {
    const registry = new TabRegistry<object>();
    const page = {};

    const firstId = registry.registerPage(page, {
      index: 0,
      url: 'https://example.com/one',
      title: 'One',
    });
    const secondId = registry.registerPage(page, {
      index: 3,
      url: 'https://example.com/updated',
      title: 'Updated',
    });

    expect(secondId).toBe(firstId);
    expect(registry.getTabById(firstId)?.index).toBe(3);
    expect(registry.getTabById(firstId)?.url).toBe('https://example.com/updated');
  });

  it('reconciles pages, marks missing entries stale and clears stale current page', () => {
    const registry = new TabRegistry<object>();
    const pageA = {};
    const pageB = {};

    const pageAId = registry.registerPage(pageA, {
      index: 0,
      url: 'https://example.com/a',
      title: 'A',
    });
    const pageBId = registry.registerPage(pageB, {
      index: 1,
      url: 'https://example.com/b',
      title: 'B',
    });
    registry.bindAlias('secondary', pageBId);
    registry.setCurrentPageId(pageBId);

    const tabs = registry.reconcilePages(
      [pageA],
      [{ index: 0, url: 'https://example.com/a2', title: 'A2' }]
    );

    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.pageId).toBe(pageAId);
    expect(registry.getTabById(pageBId)?.stale).toBe(true);
    expect(registry.resolveAlias('secondary')).toBeNull();
    expect(registry.getCurrentPageId()).toBeNull();
  });

  it('binds aliases by index and reports stale aliases in current tab info', () => {
    const registry = new TabRegistry<object>();
    const pageA = {};
    const pageB = {};

    registry.reconcilePages(
      [pageA, pageB],
      [
        { index: 0, url: 'https://example.com/a', title: 'A' },
        { index: 1, url: 'https://example.com/b', title: 'B' },
      ]
    );

    const boundPageId = registry.bindAliasByIndex('active', 1);
    expect(boundPageId).toBeTruthy();
    expect(registry.setCurrentByIndex(1)?.pageId).toBe(boundPageId);

    registry.reconcilePages([pageA], [{ index: 0, url: 'https://example.com/a', title: 'A' }]);

    const info = registry.getCurrentTabInfo('chrome');
    expect(info.currentPageId).toBeNull();
    expect(info.aliases).toContainEqual({
      alias: 'active',
      pageId: boundPageId!,
      index: 1,
      stale: true,
    });
    expect(info.staleAliases).toContain('active');
  });

  it('stores shared context and clears all registry state on reset', () => {
    const registry = new TabRegistry<object>();
    const page = {};
    const pageId = registry.registerPage(page, {
      index: 0,
      url: 'https://example.com',
      title: 'Example',
    });

    registry.bindAlias('main', pageId);
    registry.setCurrentPageId(pageId);
    registry.setSharedContext('token', 'abc');

    expect(registry.getSharedContext('token')).toEqual({ value: 'abc', found: true });
    expect(registry.getSharedContextMap()).toEqual({ token: 'abc' });

    registry.clear();

    expect(registry.listAllTabs()).toEqual([]);
    expect(registry.getCurrentPageId()).toBeNull();
    expect(registry.getSharedContext('token')).toEqual({ value: null, found: false });
  });
});

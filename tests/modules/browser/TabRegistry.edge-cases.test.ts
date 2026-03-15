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

describe('TabRegistry — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerPage — re-registration after clear', () => {
    it('re-creates entry when tabsById was cleared but WeakMap reference remains', () => {
      const registry = new TabRegistry<object>();
      const page = {};

      const firstId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com/a',
        title: 'A',
      });

      // Clear tabsById but WeakMap reference persists
      registry.clear();

      // Re-register the same page object
      const secondId = registry.registerPage(page, {
        index: 1,
        url: 'https://example.com/b',
        title: 'B',
      });

      // Should get the same pageId from WeakMap
      expect(secondId).toBe(firstId);
      // And the new metadata should be set
      const tab = registry.getTabById(firstId);
      expect(tab).not.toBeNull();
      expect(tab!.index).toBe(1);
      expect(tab!.url).toBe('https://example.com/b');
      expect(tab!.stale).toBe(false);
    });
  });

  describe('bindAlias', () => {
    it('returns false when binding to a non-existent pageId', () => {
      const registry = new TabRegistry<object>();
      const result = registry.bindAlias('missing', 'non-existent-id');
      expect(result).toBe(false);
    });

    it('returns true when binding to a valid pageId', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com',
        title: 'Test',
      });
      const result = registry.bindAlias('main', pageId);
      expect(result).toBe(true);
    });

    it('overwrites existing alias binding', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};
      const id1 = registry.registerPage(page1, {
        index: 0,
        url: 'https://a.com',
        title: 'A',
      });
      const id2 = registry.registerPage(page2, {
        index: 1,
        url: 'https://b.com',
        title: 'B',
      });

      registry.bindAlias('primary', id1);
      registry.bindAlias('primary', id2);

      expect(registry.resolveAlias('primary')).toBe(id2);
    });
  });

  describe('bindAliasByIndex', () => {
    it('returns null when no page matches the index', () => {
      const registry = new TabRegistry<object>();
      const result = registry.bindAliasByIndex('notfound', 99);
      expect(result).toBeNull();
    });

    it('skips stale pages when binding by index', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};

      registry.reconcilePages(
        [page1, page2],
        [
          { index: 0, url: 'https://a.com', title: 'A' },
          { index: 1, url: 'https://b.com', title: 'B' },
        ]
      );

      // Remove page2 by reconciling without it
      registry.reconcilePages([page1], [{ index: 0, url: 'https://a.com', title: 'A' }]);

      // Try to bind alias to index 1 (now stale)
      const result = registry.bindAliasByIndex('staleAlias', 1);
      expect(result).toBeNull();
    });
  });

  describe('unbindAlias', () => {
    it('returns true when removing existing alias', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com',
        title: 'Test',
      });
      registry.bindAlias('test', pageId);
      expect(registry.unbindAlias('test')).toBe(true);
    });

    it('returns false when removing non-existent alias', () => {
      const registry = new TabRegistry<object>();
      expect(registry.unbindAlias('nonexistent')).toBe(false);
    });
  });

  describe('resolveAlias', () => {
    it('returns null for unknown alias', () => {
      const registry = new TabRegistry<object>();
      expect(registry.resolveAlias('unknown')).toBeNull();
    });

    it('returns null when aliased page is stale', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com',
        title: 'Test',
      });
      registry.bindAlias('myAlias', pageId);

      // Make page stale by reconciling without it
      registry.reconcilePages([], []);

      expect(registry.resolveAlias('myAlias')).toBeNull();
    });
  });

  describe('getPageById', () => {
    it('returns null for non-existent pageId', () => {
      const registry = new TabRegistry<object>();
      expect(registry.getPageById('fake-id')).toBeNull();
    });

    it('returns null for stale page', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com',
        title: 'Test',
      });

      // Make stale
      registry.reconcilePages([], []);
      expect(registry.getPageById(pageId)).toBeNull();
    });

    it('returns page for valid non-stale entry', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com',
        title: 'Test',
      });
      expect(registry.getPageById(pageId)).toBe(page);
    });
  });

  describe('getTabById', () => {
    it('returns null for non-existent pageId', () => {
      const registry = new TabRegistry<object>();
      expect(registry.getTabById('nonexistent')).toBeNull();
    });

    it('returns tab with aliases', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://example.com',
        title: 'Test',
      });
      registry.bindAlias('a1', pageId);
      registry.bindAlias('a2', pageId);

      const tab = registry.getTabById(pageId);
      expect(tab!.aliases).toContain('a1');
      expect(tab!.aliases).toContain('a2');
    });
  });

  describe('getTabByIndex', () => {
    it('returns null when no tab has the given index', () => {
      const registry = new TabRegistry<object>();
      expect(registry.getTabByIndex(99)).toBeNull();
    });

    it('returns the correct tab by index', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};
      registry.registerPage(page1, { index: 0, url: 'https://a.com', title: 'A' });
      const id2 = registry.registerPage(page2, { index: 1, url: 'https://b.com', title: 'B' });

      const tab = registry.getTabByIndex(1);
      expect(tab!.pageId).toBe(id2);
      expect(tab!.url).toBe('https://b.com');
    });

    it('skips stale tabs', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      registry.registerPage(page, { index: 5, url: 'https://test.com', title: 'Test' });

      // Make stale
      registry.reconcilePages([], []);
      expect(registry.getTabByIndex(5)).toBeNull();
    });
  });

  describe('findTab', () => {
    it('returns null when no tab matches predicate', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      registry.registerPage(page, { index: 0, url: 'https://a.com', title: 'A' });

      const result = registry.findTab((tab) => tab.url === 'https://nonexistent.com');
      expect(result).toBeNull();
    });

    it('finds tab matching URL predicate', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};
      registry.registerPage(page1, { index: 0, url: 'https://a.com', title: 'A' });
      const id2 = registry.registerPage(page2, { index: 1, url: 'https://b.com', title: 'B' });

      const result = registry.findTab((tab) => tab.url === 'https://b.com');
      expect(result!.pageId).toBe(id2);
    });
  });

  describe('setCurrentPageId', () => {
    it('rejects non-existent pageId', () => {
      const registry = new TabRegistry<object>();
      expect(registry.setCurrentPageId('fake')).toBe(false);
    });

    it('rejects stale pageId', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://test.com',
        title: 'Test',
      });
      registry.reconcilePages([], []);

      expect(registry.setCurrentPageId(pageId)).toBe(false);
    });
  });

  describe('setCurrentByIndex', () => {
    it('returns null when index does not exist', () => {
      const registry = new TabRegistry<object>();
      const result = registry.setCurrentByIndex(99);
      expect(result).toBeNull();
      expect(registry.getCurrentPageId()).toBeNull();
    });

    it('sets current page and returns tab descriptor', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 3,
        url: 'https://test.com',
        title: 'Test',
      });

      const result = registry.setCurrentByIndex(3);
      expect(result!.pageId).toBe(pageId);
      expect(registry.getCurrentPageId()).toBe(pageId);
    });
  });

  describe('getCurrentPage', () => {
    it('returns null when no current page', () => {
      const registry = new TabRegistry<object>();
      expect(registry.getCurrentPage()).toBeNull();
    });

    it('returns page when current is set', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://test.com',
        title: 'Test',
      });
      registry.setCurrentPageId(pageId);
      expect(registry.getCurrentPage()).toBe(page);
    });
  });

  describe('getCurrentTabInfo', () => {
    it('returns null values when no current page', () => {
      const registry = new TabRegistry<object>();
      const info = registry.getCurrentTabInfo('chrome');
      expect(info.driver).toBe('chrome');
      expect(info.currentPageId).toBeNull();
      expect(info.currentIndex).toBeNull();
      expect(info.url).toBeNull();
      expect(info.title).toBeNull();
      expect(info.aliases).toEqual([]);
      expect(info.staleAliases).toEqual([]);
    });

    it('returns current page info when set', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 2,
        url: 'https://current.com',
        title: 'Current',
      });
      registry.setCurrentPageId(pageId);

      const info = registry.getCurrentTabInfo('camoufox');
      expect(info.driver).toBe('camoufox');
      expect(info.currentPageId).toBe(pageId);
      expect(info.currentIndex).toBe(2);
      expect(info.url).toBe('https://current.com');
      expect(info.title).toBe('Current');
    });

    it('reports stale current page as null', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://test.com',
        title: 'Test',
      });
      registry.setCurrentPageId(pageId);
      registry.reconcilePages([], []);

      const info = registry.getCurrentTabInfo('chrome');
      expect(info.currentPageId).toBeNull();
    });
  });

  describe('getContextMeta', () => {
    it('returns all nulls when no current page', () => {
      const registry = new TabRegistry<object>();
      const meta = registry.getContextMeta();
      expect(meta.url).toBeNull();
      expect(meta.title).toBeNull();
      expect(meta.tabIndex).toBeNull();
      expect(meta.pageId).toBeNull();
    });

    it('returns values when current page is set', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 5,
        url: 'https://meta.com',
        title: 'Meta',
      });
      registry.setCurrentPageId(pageId);

      const meta = registry.getContextMeta();
      expect(meta.url).toBe('https://meta.com');
      expect(meta.title).toBe('Meta');
      expect(meta.tabIndex).toBe(5);
      expect(meta.pageId).toBe(pageId);
    });

    it('returns nulls when current page is stale', () => {
      const registry = new TabRegistry<object>();
      const page = {};
      const pageId = registry.registerPage(page, {
        index: 0,
        url: 'https://stale.com',
        title: 'Stale',
      });
      registry.setCurrentPageId(pageId);
      registry.reconcilePages([], []);

      const meta = registry.getContextMeta();
      expect(meta.pageId).toBeNull();
    });
  });

  describe('listTabs', () => {
    it('returns empty array when no pages registered', () => {
      const registry = new TabRegistry<object>();
      expect(registry.listTabs()).toEqual([]);
    });

    it('excludes stale tabs', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};

      registry.registerPage(page1, { index: 0, url: 'https://a.com', title: 'A' });
      registry.registerPage(page2, { index: 1, url: 'https://b.com', title: 'B' });

      // Make page2 stale
      registry.reconcilePages([page1], [{ index: 0, url: 'https://a.com', title: 'A' }]);

      const tabs = registry.listTabs();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.url).toBe('https://a.com');
    });

    it('sorts tabs by index', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};
      const page3 = {};

      registry.registerPage(page3, { index: 2, url: 'https://c.com', title: 'C' });
      registry.registerPage(page1, { index: 0, url: 'https://a.com', title: 'A' });
      registry.registerPage(page2, { index: 1, url: 'https://b.com', title: 'B' });

      const tabs = registry.listTabs();
      expect(tabs[0]!.index).toBe(0);
      expect(tabs[1]!.index).toBe(1);
      expect(tabs[2]!.index).toBe(2);
    });
  });

  describe('listAllTabs', () => {
    it('includes stale tabs', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};

      registry.registerPage(page1, { index: 0, url: 'https://a.com', title: 'A' });
      registry.registerPage(page2, { index: 1, url: 'https://b.com', title: 'B' });

      // Make page2 stale
      registry.reconcilePages([page1], [{ index: 0, url: 'https://a.com', title: 'A' }]);

      const allTabs = registry.listAllTabs();
      expect(allTabs).toHaveLength(2);
      const staleTabs = allTabs.filter((t) => t.stale);
      expect(staleTabs).toHaveLength(1);
      expect(staleTabs[0]!.url).toBe('https://b.com');
    });

    it('sorts by index', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};

      registry.registerPage(page2, { index: 5, url: 'https://b.com', title: 'B' });
      registry.registerPage(page1, { index: 2, url: 'https://a.com', title: 'A' });

      const tabs = registry.listAllTabs();
      expect(tabs[0]!.index).toBe(2);
      expect(tabs[1]!.index).toBe(5);
    });
  });

  describe('reconcilePages', () => {
    it('handles pages array with fewer meta entries (uses defaults)', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};

      // metaList has fewer entries than pages
      const tabs = registry.reconcilePages(
        [page1, page2],
        [{ index: 0, url: 'https://a.com', title: 'A' }]
      );

      expect(tabs).toHaveLength(2);
      // Second page should get default meta with index=1
      expect(tabs[1]!.index).toBe(1);
    });

    it('does not re-mark already stale pages', () => {
      const registry = new TabRegistry<object>();
      const page1 = {};
      const page2 = {};

      registry.reconcilePages(
        [page1, page2],
        [
          { index: 0, url: 'https://a.com', title: 'A' },
          { index: 1, url: 'https://b.com', title: 'B' },
        ]
      );

      // First reconcile without page2 — marks it stale
      registry.reconcilePages([page1], [{ index: 0, url: 'https://a.com', title: 'A' }]);

      // Second reconcile still without page2 — should not re-log
      loggerState.debug.mockClear();
      registry.reconcilePages([page1], [{ index: 0, url: 'https://a.com', title: 'A' }]);

      // Should not log "marked stale" again since it's already stale
      const staleLogCalls = loggerState.debug.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('marked stale')
      );
      expect(staleLogCalls).toHaveLength(0);
    });
  });

  describe('sharedContext', () => {
    it('setSharedContext and getSharedContext work correctly', () => {
      const registry = new TabRegistry<object>();
      registry.setSharedContext('key1', 'value1');
      registry.setSharedContext('key2', { nested: true });

      expect(registry.getSharedContext('key1')).toEqual({ value: 'value1', found: true });
      expect(registry.getSharedContext('key2')).toEqual({
        value: { nested: true },
        found: true,
      });
      expect(registry.getSharedContext('missing')).toEqual({ value: null, found: false });
    });

    it('getSharedContextMap returns all entries', () => {
      const registry = new TabRegistry<object>();
      registry.setSharedContext('a', 1);
      registry.setSharedContext('b', 2);

      const map = registry.getSharedContextMap();
      expect(map).toEqual({ a: 1, b: 2 });
    });

    it('overwriting shared context value', () => {
      const registry = new TabRegistry<object>();
      registry.setSharedContext('key', 'old');
      registry.setSharedContext('key', 'new');
      expect(registry.getSharedContext('key')).toEqual({ value: 'new', found: true });
    });
  });
});

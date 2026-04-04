import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

const unifiedBrowserManagerState = vi.hoisted(() => ({
  instances: [] as any[],
  launchImpl: null as null | ((instance: any) => Promise<any>),
  closeImpl: null as null | ((instance: any) => Promise<void>),
}));

vi.mock('@modules/browser/UnifiedBrowserManager', () => {
  class UnifiedBrowserManager {
    __config: any;
    private browser = { isConnected: vi.fn(() => true) };
    private pages: any[] = [];
    launch = vi.fn(async () => {
      if (unifiedBrowserManagerState.launchImpl) {
        return unifiedBrowserManagerState.launchImpl(this);
      }
      return this.browser;
    });
    close = vi.fn(async () => {
      if (unifiedBrowserManagerState.closeImpl) {
        return unifiedBrowserManagerState.closeImpl(this);
      }
      this.browser.isConnected = vi.fn(() => false);
    });
    getBrowser = vi.fn(() => this.browser);
    getIdleTimeout = vi.fn(() => this.__config?.idleTimeout);
    getMaxTabs = vi.fn(() => this.__config?.maxTabs);

    constructor(config: any) {
      this.__config = config;
      unifiedBrowserManagerState.instances.push(this);
    }
  }

  return { UnifiedBrowserManager };
});

import { BrowserPool, type BrowserProfile } from '@modules/browser/BrowserPool';
import { UnifiedBrowserManager } from '@modules/browser/UnifiedBrowserManager';

describe('BrowserPool', () => {
  let pool: BrowserPool;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();

    unifiedBrowserManagerState.instances.length = 0;
    unifiedBrowserManagerState.launchImpl = null;
    unifiedBrowserManagerState.closeImpl = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquire()', () => {
    it('creates a new browser instance for a new profile', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);

      expect(manager).toBeInstanceOf(UnifiedBrowserManager);
      expect((manager as any).launch).toHaveBeenCalledTimes(1);
      expect(loggerState.info).toHaveBeenCalledWith(
        expect.stringContaining('Creating new browser for profile "default"'),
      );
    });

    it('reuses existing browser instance for same profile', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const firstManager = await pool.acquire(profile);
      const secondManager = await pool.acquire(profile);

      expect(firstManager).toBe(secondManager);
      expect((firstManager as any).launch).toHaveBeenCalledTimes(1);
      expect(loggerState.debug).toHaveBeenCalledWith(
        expect.stringContaining('Reusing browser for profile "default"'),
      );
    });

    it('throws error when pool is disposed', async () => {
      pool = new BrowserPool();
      await pool.dispose();

      const profile: BrowserProfile = { name: 'default' };

      await expect(pool.acquire(profile)).rejects.toThrow('BrowserPool has been disposed');
    });

    it('creates new browser after disposing old one with same profile', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const firstManager = await pool.acquire(profile);
      await pool.disposeProfile('default');
      const secondManager = await pool.acquire(profile);

      expect(firstManager).not.toBe(secondManager);
      expect((secondManager as any).launch).toHaveBeenCalledTimes(1);
    });

    it('passes profile config to UnifiedBrowserManager', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = {
        name: 'custom',
        config: {
          driver: 'chrome',
          headless: true,
          args: ['--no-sandbox'],
        },
      };

      const manager = await pool.acquire(profile);

      expect(manager).toBeInstanceOf(UnifiedBrowserManager);
      expect((manager as any).__config.driver).toBe('chrome');
      expect((manager as any).__config.headless).toBe(true);
      expect((manager as any).__config.args).toContain('--no-sandbox');
    });

    it('marks entry as inUse on acquire', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      await pool.acquire(profile);
      const stats = pool.getStats();

      expect(stats.inUseCount).toBe(1);
      expect(stats.entries[0]?.inUse).toBe(true);
    });

    it('clears idle timer when re-acquiring an idle browser', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      const firstManager = await pool.acquire(profile);
      await pool.release(firstManager);

      // Advance time partially through idle timeout
      await vi.advanceTimersByTimeAsync(3000);

      // Re-acquire should clear idle timer
      const secondManager = await pool.acquire(profile);
      expect(firstManager).toBe(secondManager);

      // Advance past original idle timeout
      await vi.advanceTimersByTimeAsync(3000);

      // Browser should still be in pool (not auto-disposed)
      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe('release()', () => {
    it('releases browser instance back to pool', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      const stats = pool.getStats();
      expect(stats.inUseCount).toBe(0);
      expect(stats.idleCount).toBe(1);
    });

    it('warns when releasing unknown instance', async () => {
      pool = new BrowserPool();
      const fakeManager = new UnifiedBrowserManager({});

      await pool.release(fakeManager);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('Instance not found in pool'),
      );
    });

    it('warns when releasing already released instance', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);
      await pool.release(manager);

      expect(loggerState.warn).toHaveBeenCalledWith(expect.stringContaining('was not in use'));
    });

    it('does nothing when releasing after pool is disposed', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.dispose();

      await pool.release(manager);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot release: pool is disposed'),
      );
    });

    it('starts idle timer after release', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      // Should have idle timer set
      const stats = pool.getStats();
      expect(stats.idleCount).toBe(1);
    });
  });

  describe('createTab()', () => {
    it('creates a new tab in the browser instance', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockPage = { id: 'page-1', on: vi.fn() };
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue(mockPage);

      const page = await pool.createTab(manager);

      expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);
      expect(page).toBe(mockPage);
    });

    it('throws error when instance not in pool', async () => {
      pool = new BrowserPool();
      const fakeManager = new UnifiedBrowserManager({});

      await expect(pool.createTab(fakeManager)).rejects.toThrow(
        'Browser instance not found in pool',
      );
    });

    it('throws error when browser is disposed', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const entry = (pool as any).entries.get('default');
      entry.disposed = true;

      await expect(pool.createTab(manager)).rejects.toThrow('has been disposed');
    });

    it('throws error when browser instance is null', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const entry = (pool as any).entries.get('default');
      entry.browser = null;

      await expect(pool.createTab(manager)).rejects.toThrow('has no browser instance');
    });

    it('enforces max tabs limit', async () => {
      pool = new BrowserPool({ defaultMaxTabs: 2 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'page-1', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-2', on: vi.fn() });

      await pool.createTab(manager);
      await pool.createTab(manager);

      await expect(pool.createTab(manager)).rejects.toThrow(/Maximum tabs \(2\) reached/);
    });

    it('tracks pages and removes them on close', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      let closeCallback: (() => void) | null = null;
      const mockPage = {
        id: 'page-1',
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            closeCallback = cb;
          }
        }),
      };
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue(mockPage);

      await pool.createTab(manager);

      const tabs = pool.getTabs(manager);
      expect(tabs).toHaveLength(1);

      // Simulate page close
      if (closeCallback) {
        closeCallback();
      }

      const tabsAfterClose = pool.getTabs(manager);
      expect(tabsAfterClose).toHaveLength(0);
    });

    it('updates lastAccess timestamp on tab creation', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockPage = { id: 'page-1', on: vi.fn() };
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue(mockPage);

      const beforeAccess = Date.now();
      await pool.createTab(manager);
      const afterAccess = Date.now();

      const entry = (pool as any).entries.get('default');
      expect(entry.lastAccess).toBeGreaterThanOrEqual(beforeAccess);
      expect(entry.lastAccess).toBeLessThanOrEqual(afterAccess);
    });
  });

  describe('closeTab()', () => {
    it('closes a specific tab', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockPage = { id: 'page-1', on: vi.fn(), close: vi.fn() };
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue(mockPage);

      await pool.createTab(manager);
      await pool.closeTab(manager, mockPage);

      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it('throws error when instance not in pool', async () => {
      pool = new BrowserPool();
      const fakeManager = new UnifiedBrowserManager({});
      const mockPage = { id: 'page-1' };

      await expect(pool.closeTab(fakeManager, mockPage)).rejects.toThrow(
        'Browser instance not found in pool',
      );
    });

    it('throws error when browser instance is null', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const entry = (pool as any).entries.get('default');
      entry.browser = null;
      const mockPage = { id: 'page-1' };

      await expect(pool.closeTab(manager, mockPage)).rejects.toThrow('has no browser instance');
    });

    it('throws error when page not found in browser', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const otherPage = { id: 'page-2' };

      await expect(pool.closeTab(manager, otherPage)).rejects.toThrow(
        'Page not found in this browser instance',
      );
    });
  });

  describe('getTabs()', () => {
    it('returns all tabs for a browser instance', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'page-1', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-2', on: vi.fn() });

      await pool.createTab(manager);
      await pool.createTab(manager);

      const tabs = pool.getTabs(manager);
      expect(tabs).toHaveLength(2);
      expect(tabs[0]?.id).toBe('page-1');
      expect(tabs[1]?.id).toBe('page-2');
    });

    it('returns empty array when no tabs', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const tabs = pool.getTabs(manager);

      expect(tabs).toEqual([]);
    });

    it('throws error when instance not in pool', async () => {
      pool = new BrowserPool();
      const fakeManager = new UnifiedBrowserManager({});

      expect(() => pool.getTabs(fakeManager)).toThrow('Browser instance not found in pool');
    });

    it('returns a copy of the tabs array', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const tabs1 = pool.getTabs(manager);
      const tabs2 = pool.getTabs(manager);

      expect(tabs1).not.toBe(tabs2);
    });
  });

  describe('switchTab()', () => {
    it('returns tab at valid index', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'page-1', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-2', on: vi.fn() });

      await pool.createTab(manager);
      await pool.createTab(manager);

      const tab = pool.switchTab(manager, 1);
      expect(tab.id).toBe('page-2');
    });

    it('throws error for invalid index - negative', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);

      expect(() => pool.switchTab(manager, -1)).toThrow(/Invalid tab index/);
    });

    it('throws error for invalid index - out of range', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue({ id: 'page-1', on: vi.fn() });

      await pool.createTab(manager);

      expect(() => pool.switchTab(manager, 5)).toThrow(/Invalid tab index 5/);
    });
  });

  describe('getStats()', () => {
    it('returns correct statistics for empty pool', () => {
      pool = new BrowserPool();
      const stats = pool.getStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.inUseCount).toBe(0);
      expect(stats.idleCount).toBe(0);
      expect(stats.totalPages).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it('returns correct statistics with active browsers', async () => {
      pool = new BrowserPool();
      const profile1: BrowserProfile = { name: 'user1' };
      const profile2: BrowserProfile = { name: 'user2' };

      await pool.acquire(profile1);
      await pool.acquire(profile2);

      const stats = pool.getStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.inUseCount).toBe(2);
      expect(stats.idleCount).toBe(0);
    });

    it('returns correct statistics with mixed idle and active browsers', async () => {
      pool = new BrowserPool();
      const profile1: BrowserProfile = { name: 'user1' };
      const profile2: BrowserProfile = { name: 'user2' };

      const manager1 = await pool.acquire(profile1);
      await pool.acquire(profile2);
      await pool.release(manager1);

      const stats = pool.getStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.inUseCount).toBe(1);
      expect(stats.idleCount).toBe(1);
    });

    it('includes entry details in stats', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      await pool.acquire(profile);

      const stats = pool.getStats();

      expect(stats.entries).toHaveLength(1);
      expect(stats.entries[0]?.profile).toBe('default');
      expect(stats.entries[0]?.inUse).toBe(true);
      expect(stats.entries[0]?.disposed).toBe(false);
      expect(stats.entries[0]?.lastAccess).toBeInstanceOf(Date);
    });

    it('counts total pages across all browsers', async () => {
      pool = new BrowserPool();
      const profile1: BrowserProfile = { name: 'user1' };
      const profile2: BrowserProfile = { name: 'user2' };

      const manager1 = await pool.acquire(profile1);
      const manager2 = await pool.acquire(profile2);

      const mockBrowser1 = (manager1 as any).getBrowser();
      const mockBrowser2 = (manager2 as any).getBrowser();
      mockBrowser1.newPage = vi.fn().mockResolvedValue({ id: 'page-1', on: vi.fn() });
      mockBrowser2.newPage = vi.fn().mockResolvedValue({ id: 'page-2', on: vi.fn() });

      await pool.createTab(manager1);
      await pool.createTab(manager2);

      const stats = pool.getStats();
      expect(stats.totalPages).toBe(2);
    });
  });

  describe('dispose()', () => {
    it('disposes all browser instances', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.dispose();

      expect((manager as any).close).toHaveBeenCalledTimes(1);
      expect(loggerState.info).toHaveBeenCalledWith(
        expect.stringContaining('[BrowserPool] Pool disposed successfully'),
      );
    });

    it('stops cleanup interval on dispose', async () => {
      pool = new BrowserPool();
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      await pool.dispose();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('clears all entries on dispose', async () => {
      pool = new BrowserPool();
      await pool.acquire({ name: 'user1' });
      await pool.acquire({ name: 'user2' });

      await pool.dispose();

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('closes all pages before closing browser', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockPage = {
        id: 'page-1',
        on: vi.fn(),
        close: vi.fn(),
        isClosed: vi.fn(() => false),
      };
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue(mockPage);

      await pool.createTab(manager);
      await pool.dispose();

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect((manager as any).close).toHaveBeenCalledTimes(1);
    });

    it('handles dispose gracefully when pages fail to close', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const mockPage = {
        id: 'page-1',
        on: vi.fn(),
        close: vi.fn().mockRejectedValue(new Error('close failed')),
        isClosed: vi.fn(() => false),
      };
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi.fn().mockResolvedValue(mockPage);

      await pool.createTab(manager);
      await pool.dispose();

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to close page'),
      );
      expect((manager as any).close).toHaveBeenCalledTimes(1);
    });

    it('can acquire new browsers after dispose creates new pool', async () => {
      pool = new BrowserPool();
      await pool.acquire({ name: 'user1' });
      await pool.dispose();

      // Create new pool instance
      pool = new BrowserPool();
      await pool.acquire({ name: 'user2' });

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe('disposeProfile()', () => {
    it('disposes a specific profile', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      const result = await pool.disposeProfile('default');

      expect(result).toBe(true);
      expect((manager as any).close).toHaveBeenCalledTimes(1);

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('returns false for non-existent profile', async () => {
      pool = new BrowserPool();
      const result = await pool.disposeProfile('nonexistent');

      expect(result).toBe(false);
    });

    it('clears idle timer when disposing profile', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      await pool.disposeProfile('default');

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('idle timeout behavior', () => {
    it('auto-disposes idle browser after timeout', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      // Advance past idle timeout
      await vi.advanceTimersByTimeAsync(5000);

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);

      expect(loggerState.info).toHaveBeenCalledWith(
        expect.stringContaining('Auto-disposing idle browser'),
      );
    });

    it('does not dispose browser before idle timeout', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      // Advance to just before timeout
      await vi.advanceTimersByTimeAsync(4999);

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(1);
    });

    it('uses profile-specific idle timeout when configured', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 10000 });
      const profile: BrowserProfile = {
        name: 'custom',
        idleTimeout: 3000,
      };

      const manager = await pool.acquire(profile);
      (manager as any).getIdleTimeout = vi.fn(() => 3000);
      await pool.release(manager);

      // Should dispose after custom timeout
      await vi.advanceTimersByTimeAsync(3000);

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('does not auto-dispose browsers that are in use', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      await pool.acquire(profile);

      // Advance past idle timeout
      await vi.advanceTimersByTimeAsync(5000);

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.inUseCount).toBe(1);
    });

    it('resets idle timer on re-acquire', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      // Advance partway through timeout
      await vi.advanceTimersByTimeAsync(3000);

      // Re-acquire should reset timer
      await pool.acquire(profile);
      await pool.release(manager);

      // Advance another 3000ms (total 6000ms from first release, but only 3000ms from second)
      await vi.advanceTimersByTimeAsync(3000);

      // Browser should still be alive
      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe('max tabs limit enforcement', () => {
    it('uses profile-specific maxTabs when configured', async () => {
      pool = new BrowserPool({ defaultMaxTabs: 10 });
      const profile: BrowserProfile = {
        name: 'limited',
        maxTabs: 2,
      };

      const manager = await pool.acquire(profile);
      (manager as any).getMaxTabs = vi.fn(() => 2);
      const mockBrowser = (manager as any).getBrowser();
      mockBrowser.newPage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'page-1', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-2', on: vi.fn() });

      await pool.createTab(manager);
      await pool.createTab(manager);

      await expect(pool.createTab(manager)).rejects.toThrow(/Maximum tabs \(2\) reached/);
    });

    it('allows different tab limits per profile', async () => {
      pool = new BrowserPool({ defaultMaxTabs: 5 });

      const profile1: BrowserProfile = { name: 'user1', maxTabs: 2 };
      const profile2: BrowserProfile = { name: 'user2', maxTabs: 3 };

      const manager1 = await pool.acquire(profile1);
      const manager2 = await pool.acquire(profile2);

      (manager1 as any).getMaxTabs = vi.fn(() => 2);
      (manager2 as any).getMaxTabs = vi.fn(() => 3);

      const mockBrowser1 = (manager1 as any).getBrowser();
      const mockBrowser2 = (manager2 as any).getBrowser();

      mockBrowser1.newPage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'page-1', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-2', on: vi.fn() });

      mockBrowser2.newPage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'page-3', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-4', on: vi.fn() })
        .mockResolvedValueOnce({ id: 'page-5', on: vi.fn() });

      await pool.createTab(manager1);
      await pool.createTab(manager1);
      await expect(pool.createTab(manager1)).rejects.toThrow();

      await pool.createTab(manager2);
      await pool.createTab(manager2);
      await pool.createTab(manager2);
      await expect(pool.createTab(manager2)).rejects.toThrow();
    });
  });

  describe('cleanup interval', () => {
    it('runs periodic cleanup of idle browsers', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 5000, cleanupInterval: 1000 });
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      // Advance past both idle timeout and cleanup interval
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(1000);

      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);

      // Cleanup logs either "Auto-disposing" or "Cleanup:" messages
      expect(loggerState.info).toHaveBeenCalledWith(expect.stringContaining('idle'));
    });

    it('does not run cleanup when pool is disposed', async () => {
      pool = new BrowserPool({ cleanupInterval: 1000 });
      await pool.dispose();

      await vi.advanceTimersByTimeAsync(1000);

      // Should not throw or cause issues
      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('logs cleanup actions for disposed profiles', async () => {
      pool = new BrowserPool({ defaultIdleTimeout: 2000, cleanupInterval: 1000 });
      const profile: BrowserProfile = { name: 'test-profile' };

      const manager = await pool.acquire(profile);
      await pool.release(manager);

      await vi.advanceTimersByTimeAsync(3000);

      // Check that disposal happened (either auto-dispose or cleanup)
      const stats = pool.getStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles multiple acquires of same profile sequentially', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager1 = await pool.acquire(profile);
      await pool.release(manager1);

      const manager2 = await pool.acquire(profile);
      expect(manager1).toBe(manager2);

      await pool.release(manager2);
      const manager3 = await pool.acquire(profile);
      expect(manager2).toBe(manager3);
    });

    it('handles concurrent acquires of same profile', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const [manager1, manager2] = await Promise.all([
        pool.acquire(profile),
        pool.acquire(profile),
      ]);

      // Both should be valid managers (may or may not be same instance depending on timing)
      expect(manager1).toBeInstanceOf(UnifiedBrowserManager);
      expect(manager2).toBeInstanceOf(UnifiedBrowserManager);
    });

    it('handles release of disposed browser gracefully', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      await pool.disposeProfile('default');

      // Should not throw
      await pool.release(manager);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('Instance not found in pool'),
      );
    });

    it('preserves browser config across acquire/release cycles', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = {
        name: 'configured',
        config: {
          driver: 'chrome',
          headless: true,
          debugPort: 9222,
        },
      };

      const manager = await pool.acquire(profile);
      await pool.release(manager);
      const sameManager = await pool.acquire(profile);

      expect((sameManager as any).__config.driver).toBe('chrome');
      expect((sameManager as any).__config.headless).toBe(true);
      expect((sameManager as any).__config.debugPort).toBe(9222);
    });

    it('handles errors during browser disposal', async () => {
      pool = new BrowserPool();
      const profile: BrowserProfile = { name: 'default' };

      const manager = await pool.acquire(profile);
      (manager as any).close = vi.fn().mockRejectedValue(new Error('forced error'));

      await pool.dispose();

      expect(loggerState.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to dispose entry'),
      );
    });
  });
});

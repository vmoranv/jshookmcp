/**
 * BrowserPool — Browser instance pool for reuse and multi-tab management.
 *
 * Features:
 * - Profile-based browser instances (reuses same instance for same profile)
 * - Lazy instantiation (browser created on first acquire)
 * - TTL-based idle timeout (auto-disconnect unused browsers)
 * - Multi-tab support per browser instance
 * - Graceful shutdown with cleanup
 *
 * Usage:
 *   const pool = new BrowserPool();
 *   const instance = await pool.acquire({ profile: 'default' });
 *   // ... use instance ...
 *   await pool.release(instance);
 *   // ... later ...
 *   await pool.dispose();
 */

import type { Browser as PuppeteerBrowser, Page as PuppeteerPage } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import { UnifiedBrowserManager, type UnifiedBrowserConfig } from './UnifiedBrowserManager';

/**
 * Browser profile configuration
 */
export interface BrowserProfile {
  /** Unique profile identifier (e.g., 'default', 'incognito', 'user-1') */
  name: string;
  /** Browser configuration for this profile */
  config?: UnifiedBrowserConfig;
  /** Maximum idle time in ms before auto-dispose (default: 5 minutes) */
  idleTimeout?: number;
  /** Maximum number of tabs/pages allowed (default: 10) */
  maxTabs?: number;
}

/**
 * Browser pool entry
 */
interface PoolEntry {
  /** Profile name */
  profile: string;
  /** Browser manager instance */
  manager: UnifiedBrowserManager;
  /** Puppeteer browser instance (cached reference) */
  browser: PuppeteerBrowser | null;
  /** List of open pages/tabs (Chrome only) */
  pages: PuppeteerPage[];
  /** Last access timestamp */
  lastAccess: number;
  /** Whether this entry is currently in use */
  inUse: boolean;
  /** Idle timeout handle */
  idleTimer?: NodeJS.Timeout;
  /** Whether the browser is disposed */
  disposed: boolean;
  /** Original profile configuration used to create this entry */
  profileConfig: BrowserProfile;
}

/**
 * Browser pool statistics
 */
export interface BrowserPoolStats {
  /** Total entries in pool */
  totalEntries: number;
  /** Entries currently in use */
  inUseCount: number;
  /** Idle entries count */
  idleCount: number;
  /** Total open pages across all browsers */
  totalPages: number;
  /** Entry details */
  entries: Array<{
    profile: string;
    inUse: boolean;
    pageCount: number;
    lastAccess: Date;
    disposed: boolean;
  }>;
}

/**
 * Default idle timeout: 5 minutes
 */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default max tabs per browser: 10
 */
const DEFAULT_MAX_TABS = 10;

export class BrowserPool {
  private entries = new Map<string, PoolEntry>();
  private defaultIdleTimeout: number;
  private defaultMaxTabs: number;
  private isDisposed = false;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options?: {
    /** Default idle timeout in ms (default: 5 minutes) */
    defaultIdleTimeout?: number;
    /** Default max tabs per browser (default: 10) */
    defaultMaxTabs?: number;
    /** Cleanup interval in ms (default: 1 minute) */
    cleanupInterval?: number;
  }) {
    this.defaultIdleTimeout = options?.defaultIdleTimeout ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.defaultMaxTabs = options?.defaultMaxTabs ?? DEFAULT_MAX_TABS;

    // Start periodic cleanup
    const interval = options?.cleanupInterval ?? 60 * 1000;
    this.cleanupInterval = setInterval(() => this.cleanupIdle(), interval);
  }

  /**
   * Acquire a browser instance for the given profile.
   * - If profile exists and is not disposed, reuses it
   * - Otherwise creates a new browser instance
   * - Marks the entry as in-use
   */
  async acquire(profile: BrowserProfile): Promise<UnifiedBrowserManager> {
    if (this.isDisposed) {
      throw new Error('BrowserPool has been disposed');
    }

    const existing = this.entries.get(profile.name);
    if (existing && !existing.disposed) {
      logger.debug(`[BrowserPool] Reusing browser for profile "${profile.name}"`);
      existing.inUse = true;
      existing.lastAccess = Date.now();
      this.clearIdleTimer(existing);
      return existing.manager;
    }

    // Clean up old entry if it exists but is disposed
    if (existing) {
      this.entries.delete(profile.name);
    }

    logger.info(`[BrowserPool] Creating new browser for profile "${profile.name}"`);

    const config: UnifiedBrowserConfig = {
      // Preserve profile-specific settings
      driver: profile.config?.driver ?? 'chrome',
      headless: profile.config?.headless,
      args: profile.config?.args,
      executablePath: profile.config?.executablePath,
      debugPort: profile.config?.debugPort,
      proxy: profile.config?.proxy,
      os: profile.config?.os,
      geoip: profile.config?.geoip,
    };

    const manager = new UnifiedBrowserManager(config);
    await manager.launch();

    const browser = manager.getBrowser() as PuppeteerBrowser | null;

    const entry: PoolEntry = {
      profile: profile.name,
      manager,
      browser,
      pages: [],
      lastAccess: Date.now(),
      inUse: true,
      disposed: false,
      profileConfig: profile,
    };

    this.entries.set(profile.name, entry);
    logger.debug(`[BrowserPool] Browser acquired for profile "${profile.name}"`);

    return manager;
  }

  /**
   * Release a browser instance back to the pool.
   * - Marks the entry as not in-use
   * - Starts idle timer for auto-disposal
   */
  async release(instance: UnifiedBrowserManager): Promise<void> {
    if (this.isDisposed) {
      logger.warn('[BrowserPool] Cannot release: pool is disposed');
      return;
    }

    const entry = this.findEntryByInstance(instance);
    if (!entry) {
      logger.warn('[BrowserPool] Instance not found in pool, skipping release');
      return;
    }

    if (!entry.inUse) {
      logger.warn(`[BrowserPool] Profile "${entry.profile}" was not in use`);
      return;
    }

    entry.inUse = false;
    entry.lastAccess = Date.now();
    this.startIdleTimer(entry);

    logger.debug(`[BrowserPool] Released browser for profile "${entry.profile}"`);
  }

  /**
   * Create a new tab/page in the given browser instance.
   * Returns the new page object.
   */
  async createTab(instance: UnifiedBrowserManager): Promise<PuppeteerPage> {
    const entry = this.findEntryByInstance(instance);
    if (!entry) {
      throw new Error('Browser instance not found in pool');
    }

    if (entry.disposed) {
      throw new Error(`Browser for profile "${entry.profile}" has been disposed`);
    }

    if (entry.browser === null) {
      throw new Error(`Browser for profile "${entry.profile}" has no browser instance`);
    }

    const maxTabs = this.getMaxTabsForEntry(entry);
    if (entry.pages.length >= maxTabs) {
      throw new Error(
        `Maximum tabs (${maxTabs}) reached for profile "${entry.profile}". Close some tabs first.`,
      );
    }

    const page = await entry.browser.newPage();
    entry.pages.push(page);
    entry.lastAccess = Date.now();

    logger.debug(
      `[BrowserPool] Created new tab in profile "${entry.profile}" (total: ${entry.pages.length})`,
    );

    // Remove page from list when closed
    page.on('close', () => {
      const index = entry.pages.indexOf(page);
      if (index !== -1) {
        entry.pages.splice(index, 1);
        logger.debug(
          `[BrowserPool] Tab closed in profile "${entry.profile}" (remaining: ${entry.pages.length})`,
        );
      }
    });

    return page;
  }

  /**
   * Close a specific tab/page.
   */
  async closeTab(instance: UnifiedBrowserManager, page: PuppeteerPage): Promise<void> {
    const entry = this.findEntryByInstance(instance);
    if (!entry) {
      throw new Error('Browser instance not found in pool');
    }

    if (entry.browser === null) {
      throw new Error(`Browser for profile "${entry.profile}" has no browser instance`);
    }

    const index = entry.pages.indexOf(page);
    if (index === -1) {
      throw new Error('Page not found in this browser instance');
    }

    await page.close();
    // Page close event will remove it from the list
    entry.lastAccess = Date.now();

    logger.debug(`[BrowserPool] Closed tab in profile "${entry.profile}"`);
  }

  /**
   * Get all tabs/pages for a browser instance.
   */
  getTabs(instance: UnifiedBrowserManager): PuppeteerPage[] {
    const entry = this.findEntryByInstance(instance);
    if (!entry) {
      throw new Error('Browser instance not found in pool');
    }
    return [...entry.pages];
  }

  /**
   * Switch to a specific tab by index.
   * Returns the page at the given index.
   */
  switchTab(instance: UnifiedBrowserManager, index: number): PuppeteerPage {
    const tabs = this.getTabs(instance);
    if (index < 0 || index >= tabs.length) {
      throw new Error(
        `Invalid tab index ${index}. Available tabs: 0-${tabs.length - 1} (total: ${tabs.length})`,
      );
    }
    return tabs[index]!;
  }

  /**
   * Get pool statistics.
   */
  getStats(): BrowserPoolStats {
    const entries: BrowserPoolStats['entries'] = [];
    let inUseCount = 0;
    let idleCount = 0;
    let totalPages = 0;

    for (const [, entry] of this.entries) {
      if (entry.inUse) {
        inUseCount++;
      } else {
        idleCount++;
      }
      totalPages += entry.pages.length;

      entries.push({
        profile: entry.profile,
        inUse: entry.inUse,
        pageCount: entry.pages.length,
        lastAccess: new Date(entry.lastAccess),
        disposed: entry.disposed,
      });
    }

    return {
      totalEntries: this.entries.size,
      inUseCount,
      idleCount,
      totalPages,
      entries,
    };
  }

  /**
   * Dispose the entire pool and all browser instances.
   */
  async dispose(): Promise<void> {
    logger.info('[BrowserPool] Disposing pool...');
    this.isDisposed = true;

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    const closePromises: Promise<void>[] = [];

    for (const [, entry] of this.entries) {
      closePromises.push(this.disposeEntry(entry));
    }

    await Promise.all(closePromises);
    this.entries.clear();

    logger.info('[BrowserPool] Pool disposed successfully');
  }

  /**
   * Dispose a specific profile entry.
   */
  async disposeProfile(profileName: string): Promise<boolean> {
    const entry = this.entries.get(profileName);
    if (!entry) {
      return false;
    }

    await this.disposeEntry(entry);
    this.entries.delete(profileName);
    return true;
  }

  // ── Private helpers ──

  private findEntryByInstance(instance: UnifiedBrowserManager): PoolEntry | null {
    for (const [, entry] of this.entries) {
      if (entry.manager === instance) {
        return entry;
      }
    }
    return null;
  }

  private startIdleTimer(entry: PoolEntry): void {
    this.clearIdleTimer(entry);

    const timeout = this.getMaxIdleTimeoutForEntry(entry);

    entry.idleTimer = setTimeout(() => {
      if (!entry.inUse && !entry.disposed) {
        logger.info(
          `[BrowserPool] Auto-disposing idle browser for profile "${entry.profile}" (idle > ${timeout}ms)`,
        );
        this.disposeEntry(entry).catch((error) => {
          logger.error(`[BrowserPool] Failed to dispose idle entry: ${String(error)}`);
        });
        this.entries.delete(entry.profile);
      }
    }, timeout);
  }

  private clearIdleTimer(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }

  private async disposeEntry(entry: PoolEntry): Promise<void> {
    if (entry.disposed) {
      return;
    }

    entry.disposed = true;
    this.clearIdleTimer(entry);

    try {
      // Close all pages first
      const closePages = entry.pages.map(async (page) => {
        try {
          if (!page.isClosed()) {
            await page.close();
          }
        } catch (error) {
          logger.warn(`[BrowserPool] Failed to close page: ${String(error)}`);
        }
      });
      await Promise.all(closePages);
      entry.pages = [];

      // Then close the browser
      await entry.manager.close();
    } catch (error) {
      logger.error(
        `[BrowserPool] Failed to dispose entry "${entry.profile}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private cleanupIdle(): void {
    if (this.isDisposed) {
      return;
    }

    const now = Date.now();
    const toDispose: string[] = [];

    for (const [profile, entry] of this.entries) {
      if (!entry.inUse && !entry.disposed) {
        const timeout = this.getMaxIdleTimeoutForEntry(entry);
        if (now - entry.lastAccess > timeout) {
          toDispose.push(profile);
        }
      }
    }

    for (const profile of toDispose) {
      const entry = this.entries.get(profile);
      if (entry) {
        logger.debug(
          `[BrowserPool] Cleanup: disposing idle profile "${profile}" (last accessed ${new Date(entry.lastAccess).toISOString()})`,
        );
        this.disposeEntry(entry).catch((error) => {
          logger.error(`[BrowserPool] Cleanup failed for "${profile}": ${String(error)}`);
        });
        this.entries.delete(profile);
      }
    }

    if (toDispose.length > 0) {
      logger.info(`[BrowserPool] Cleanup: disposed ${toDispose.length} idle profiles`);
    }
  }

  private getMaxTabsForEntry(entry: PoolEntry): number {
    const managerWithTabLimit = entry.manager as unknown as {
      getMaxTabs?: () => unknown;
    };
    const managerLimit =
      typeof managerWithTabLimit.getMaxTabs === 'function'
        ? managerWithTabLimit.getMaxTabs()
        : undefined;
    return typeof managerLimit === 'number'
      ? managerLimit
      : (entry.profileConfig.maxTabs ?? this.defaultMaxTabs);
  }

  private getMaxIdleTimeoutForEntry(entry: PoolEntry): number {
    const managerWithIdleTimeout = entry.manager as unknown as {
      getIdleTimeout?: () => unknown;
    };
    const managerTimeout =
      typeof managerWithIdleTimeout.getIdleTimeout === 'function'
        ? managerWithIdleTimeout.getIdleTimeout()
        : undefined;
    return typeof managerTimeout === 'number'
      ? managerTimeout
      : (entry.profileConfig.idleTimeout ?? this.defaultIdleTimeout);
  }
}

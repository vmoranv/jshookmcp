/**
 * TabRegistry — unified tab/page state for all browser tools.
 *
 * Replaces the fragmented model where tab_workflow kept its own alias→index map
 * and browser_control used collector.listPages()/selectPage() independently.
 *
 * Key properties:
 * - pageId is session-stable (survives tab open/close of other tabs)
 * - Alias binds to pageId, not index
 * - Stale detection when a previously registered page disappears
 * - Single source of truth for "current page"
 */

import { logger } from '@utils/logger';

export interface TabDescriptor<PageLike = unknown> {
  pageId: string;
  index: number;
  url: string;
  title: string;
  page: PageLike;
  aliases: string[];
  stale: boolean;
}

export interface CurrentTabInfo {
  driver: 'chrome' | 'camoufox';
  currentPageId: string | null;
  currentIndex: number | null;
  url: string | null;
  title: string | null;
  aliases: Array<{ alias: string; pageId: string; index: number | null; stale: boolean }>;
  staleAliases: string[];
}

export interface PageMeta {
  index: number;
  url: string;
  title: string;
}

let globalIdCounter = 0;

export class TabRegistry<PageLike = unknown> {
  private pageIdByHandle = new WeakMap<object, string>();
  private tabsById = new Map<string, { page: PageLike; meta: PageMeta; stale: boolean }>();
  private aliasToPageId = new Map<string, string>();
  private currentPageId: string | null = null;
  private sharedContext = new Map<string, unknown>();

  /**
   * Register a page and get a stable pageId.
   * If the page object was previously registered, returns its existing pageId.
   */
  registerPage(page: PageLike, meta: PageMeta): string {
    const handle = page as object;
    const existingId = this.pageIdByHandle.get(handle);
    if (existingId) {
      const existing = this.tabsById.get(existingId);
      if (existing) {
        existing.meta = meta;
        existing.stale = false;
      } else {
        // WeakMap had reference but tabsById was cleared — re-create entry
        this.tabsById.set(existingId, { page, meta, stale: false });
      }
      return existingId;
    }

    globalIdCounter += 1;
    const pageId = `tab-${globalIdCounter}`;
    this.pageIdByHandle.set(handle, pageId);
    this.tabsById.set(pageId, { page, meta, stale: false });
    logger.debug(`[TabRegistry] Registered page ${pageId} (index=${meta.index}, url=${meta.url})`);
    return pageId;
  }

  /**
   * Reconcile the registry with a fresh pages list.
   * - New pages get registered
   * - Missing pages get marked stale
   * - Index updates are applied
   * Returns the full tab list.
   */
  reconcilePages(
    pages: PageLike[],
    metaList: PageMeta[]
  ): TabDescriptor<PageLike>[] {
    const activeIds = new Set<string>();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const meta = metaList[i] ?? { index: i, url: '', title: '' };
      const pageId = this.registerPage(page, { ...meta, index: i });
      activeIds.add(pageId);
    }

    // Mark pages not in the current list as stale
    for (const [pageId, entry] of this.tabsById) {
      if (!activeIds.has(pageId) && !entry.stale) {
        entry.stale = true;
        logger.debug(`[TabRegistry] Page ${pageId} marked stale`);
      }
    }

    // Clear currentPageId if it became stale
    if (this.currentPageId && !activeIds.has(this.currentPageId)) {
      logger.debug(`[TabRegistry] Current page ${this.currentPageId} is stale, clearing`);
      this.currentPageId = null;
    }

    return this.listTabs();
  }

  /** Bind an alias to a pageId. */
  bindAlias(alias: string, pageId: string): boolean {
    if (!this.tabsById.has(pageId)) {
      return false;
    }
    this.aliasToPageId.set(alias, pageId);
    return true;
  }

  /** Bind an alias to a page by its current index. */
  bindAliasByIndex(alias: string, index: number): string | null {
    for (const [pageId, entry] of this.tabsById) {
      if (entry.meta.index === index && !entry.stale) {
        this.aliasToPageId.set(alias, pageId);
        return pageId;
      }
    }
    return null;
  }

  /** Remove an alias binding. */
  unbindAlias(alias: string): boolean {
    return this.aliasToPageId.delete(alias);
  }

  /** Resolve an alias to its pageId. Returns null if alias not found or page is stale. */
  resolveAlias(alias: string): string | null {
    const pageId = this.aliasToPageId.get(alias);
    if (!pageId) return null;
    const entry = this.tabsById.get(pageId);
    if (!entry || entry.stale) return null;
    return pageId;
  }

  /** Get the page object by pageId. Returns null if not found or stale. */
  getPageById(pageId: string): PageLike | null {
    const entry = this.tabsById.get(pageId);
    if (!entry || entry.stale) return null;
    return entry.page;
  }

  /** Get full tab descriptor by pageId. */
  getTabById(pageId: string): TabDescriptor<PageLike> | null {
    const entry = this.tabsById.get(pageId);
    if (!entry) return null;
    const aliases = this.getAliasesForPageId(pageId);
    return {
      pageId,
      index: entry.meta.index,
      url: entry.meta.url,
      title: entry.meta.title,
      page: entry.page,
      aliases,
      stale: entry.stale,
    };
  }

  /** Get tab by current index. */
  getTabByIndex(index: number): TabDescriptor<PageLike> | null {
    for (const [pageId, entry] of this.tabsById) {
      if (entry.meta.index === index && !entry.stale) {
        return this.getTabById(pageId);
      }
    }
    return null;
  }

  /** Find a tab matching a predicate. */
  findTab(predicate: (tab: TabDescriptor<PageLike>) => boolean): TabDescriptor<PageLike> | null {
    for (const [pageId] of this.tabsById) {
      const tab = this.getTabById(pageId);
      if (tab && predicate(tab)) return tab;
    }
    return null;
  }

  /** Set the current page by pageId. */
  setCurrentPageId(pageId: string): boolean {
    if (!this.tabsById.has(pageId)) return false;
    this.currentPageId = pageId;
    return true;
  }

  /** Set the current page by index. Returns the tab descriptor or null. */
  setCurrentByIndex(index: number): TabDescriptor<PageLike> | null {
    const tab = this.getTabByIndex(index);
    if (tab) {
      this.currentPageId = tab.pageId;
    }
    return tab;
  }

  /** Get the current pageId. */
  getCurrentPageId(): string | null {
    return this.currentPageId;
  }

  /** Get current page object. */
  getCurrentPage(): PageLike | null {
    if (!this.currentPageId) return null;
    return this.getPageById(this.currentPageId);
  }

  /** Get full info about the current tab, suitable for tool responses. */
  getCurrentTabInfo(driver: 'chrome' | 'camoufox'): CurrentTabInfo {
    const allAliases: CurrentTabInfo['aliases'] = [];
    const staleAliases: string[] = [];

    for (const [alias, pageId] of this.aliasToPageId) {
      const entry = this.tabsById.get(pageId);
      const stale = !entry || entry.stale;
      allAliases.push({
        alias,
        pageId,
        index: entry?.meta.index ?? null,
        stale,
      });
      if (stale) staleAliases.push(alias);
    }

    const currentEntry = this.currentPageId ? this.tabsById.get(this.currentPageId) : null;
    const current = currentEntry && !currentEntry.stale ? currentEntry : null;

    return {
      driver,
      currentPageId: current ? this.currentPageId : null,
      currentIndex: current?.meta.index ?? null,
      url: current?.meta.url ?? null,
      title: current?.meta.title ?? null,
      aliases: allAliases,
      staleAliases,
    };
  }

  /** Get a compact context snapshot for tool response enrichment. */
  getContextMeta(): {
    url: string | null;
    title: string | null;
    tabIndex: number | null;
    pageId: string | null;
  } {
    const currentEntry = this.currentPageId ? this.tabsById.get(this.currentPageId) : null;
    const current = currentEntry && !currentEntry.stale ? currentEntry : null;
    return {
      url: current?.meta.url ?? null,
      title: current?.meta.title ?? null,
      tabIndex: current?.meta.index ?? null,
      pageId: this.currentPageId,
    };
  }

  /** List all non-stale tabs. */
  listTabs(): TabDescriptor<PageLike>[] {
    const result: TabDescriptor<PageLike>[] = [];
    for (const [pageId, entry] of this.tabsById) {
      if (!entry.stale) {
        const aliases = this.getAliasesForPageId(pageId);
        result.push({
          pageId,
          index: entry.meta.index,
          url: entry.meta.url,
          title: entry.meta.title,
          page: entry.page,
          aliases,
          stale: false,
        });
      }
    }
    return result.sort((a, b) => a.index - b.index);
  }

  /** List all tabs including stale ones. */
  listAllTabs(): TabDescriptor<PageLike>[] {
    const result: TabDescriptor<PageLike>[] = [];
    for (const [pageId, entry] of this.tabsById) {
      const aliases = this.getAliasesForPageId(pageId);
      result.push({
        pageId,
        index: entry.meta.index,
        url: entry.meta.url,
        title: entry.meta.title,
        page: entry.page,
        aliases,
        stale: entry.stale,
      });
    }
    return result.sort((a, b) => a.index - b.index);
  }

  // --- Shared context (migrated from TabWorkflowHandlers) ---

  setSharedContext(key: string, value: unknown): void {
    this.sharedContext.set(key, value);
  }

  getSharedContext(key: string): { value: unknown; found: boolean } {
    return {
      value: this.sharedContext.get(key) ?? null,
      found: this.sharedContext.has(key),
    };
  }

  getSharedContextMap(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.sharedContext.forEach((v, k) => {
      result[k] = v;
    });
    return result;
  }

  /** Clear all state. */
  clear(): void {
    this.tabsById.clear();
    this.aliasToPageId.clear();
    this.sharedContext.clear();
    this.currentPageId = null;
  }

  // --- Internal helpers ---

  private getAliasesForPageId(pageId: string): string[] {
    const aliases: string[] = [];
    for (const [alias, pid] of this.aliasToPageId) {
      if (pid === pageId) aliases.push(alias);
    }
    return aliases;
  }
}

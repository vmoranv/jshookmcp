import { logger } from '@utils/logger';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface TabPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T = unknown>(pageFunction: string | (() => T), ...args: unknown[]): Promise<T>;
  url(): string;
  title(): Promise<string>;
}

interface CamoufoxContextLike {
  newPage(): Promise<TabPageLike>;
  pages(): TabPageLike[];
}

interface CamoufoxPageLike extends TabPageLike {
  context(): CamoufoxContextLike;
}

interface BrowserLike {
  newPage(): Promise<TabPageLike>;
  pages(): Promise<TabPageLike[]>;
}

interface TabWorkflowDeps {
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<unknown>;
  getPageController: () => unknown;
  getTabRegistry: () => TabRegistry;
}

type TabAction =
  | 'alias_bind'
  | 'alias_open'
  | 'navigate'
  | 'wait_for'
  | 'context_set'
  | 'context_get'
  | 'transfer'
  | 'list'
  | 'clear';

const TAB_ACTIONS: ReadonlySet<TabAction> = new Set<TabAction>([
  'alias_bind',
  'alias_open',
  'navigate',
  'wait_for',
  'context_set',
  'context_get',
  'transfer',
  'list',
  'clear',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTabAction(value: unknown): value is TabAction {
  return typeof value === 'string' && TAB_ACTIONS.has(value as TabAction);
}

function isTabPageLike(value: unknown): value is TabPageLike {
  return (
    isRecord(value) &&
    typeof value.goto === 'function' &&
    typeof value.waitForSelector === 'function' &&
    typeof value.evaluate === 'function' &&
    typeof value.url === 'function' &&
    typeof value.title === 'function'
  );
}

function isCamoufoxPageLike(value: unknown): value is CamoufoxPageLike {
  if (!isTabPageLike(value) || !isRecord(value)) {
    return false;
  }
  return typeof value.context === 'function';
}

function isBrowserLike(value: unknown): value is BrowserLike {
  return (
    isRecord(value) && typeof value.newPage === 'function' && typeof value.pages === 'function'
  );
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAliasIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readTimeout(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

export class TabWorkflowHandlers {
  constructor(private deps: TabWorkflowDeps) {}

  private get registry(): TabRegistry {
    return this.deps.getTabRegistry();
  }

  async handleTabWorkflow(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = args.action;

    try {
      if (!isTabAction(action)) {
        return R.fail(
          `Unknown action: "${String(action)}". Valid: list, alias_bind, alias_open, navigate, wait_for, context_set, context_get, transfer, clear`,
        ).build();
      }

      switch (action) {
        case 'list':
          return this.listAliases();
        case 'clear':
          return this.clearState();
        case 'alias_bind':
          return await this.aliasBind(args);
        case 'alias_open':
          return await this.aliasOpen(args);
        case 'navigate':
          return await this.navigateAlias(args);
        case 'wait_for':
          return await this.waitFor(args);
        case 'context_set':
          return this.contextSet(args);
        case 'context_get':
          return this.contextGet(args);
        case 'transfer':
          return await this.transfer(args);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[tab_workflow] Action failed', {
        action: typeof action === 'string' ? action : String(action),
        alias: typeof args.alias === 'string' ? args.alias : undefined,
        fromAlias: typeof args.fromAlias === 'string' ? args.fromAlias : undefined,
        error: errorMsg,
      });
      return R.fail(errorMsg).build();
    }
  }

  private listAliases(): ToolResponse {
    const info = this.registry.getCurrentTabInfo(this.deps.getActiveDriver());
    const context = this.registry.getSharedContextMap();
    return R.ok().build({
      aliases: info.aliases,
      staleAliases: info.staleAliases,
      currentPageId: info.currentPageId,
      currentIndex: info.currentIndex,
      currentUrl: info.url,
      context,
    });
  }

  private clearState(): ToolResponse {
    this.registry.clear();
    return R.ok().build({ cleared: true });
  }

  private async aliasBind(args: Record<string, unknown>): Promise<ToolResponse> {
    const alias = readRequiredString(args.alias);
    const index = readAliasIndex(args.index);
    if (!alias) return R.fail('alias is required').build();
    if (index === null) return R.fail('index is required').build();

    // Reconcile pages first to ensure registry is fresh
    await this.reconcilePages();

    const pageId = this.registry.bindAliasByIndex(alias, index);
    if (!pageId) {
      return R.fail(
        `No active page at index ${index}. Use browser_list_tabs to check available pages.`,
      ).build();
    }
    return R.ok().build({ bound: { alias, index, pageId } });
  }

  private async aliasOpen(args: Record<string, unknown>): Promise<ToolResponse> {
    const alias = readRequiredString(args.alias);
    const url = readRequiredString(args.url);
    if (!alias) return R.fail('alias is required').build();
    if (!url) return R.fail('url is required').build();

    if (this.deps.getActiveDriver() === 'camoufox') {
      const currentPage = await this.deps.getCamoufoxPage();
      if (!isCamoufoxPageLike(currentPage)) {
        return R.fail('Cannot open new tab: camoufox page context not accessible').build();
      }

      const context = currentPage.context();
      const newPage = await context.newPage();
      await newPage.goto(url, { waitUntil: 'domcontentloaded' });
      const pages = context.pages();
      const idx = pages.indexOf(newPage);
      const pageTitle = await newPage.title();
      const pageId = this.registry.registerPage(newPage, {
        index: idx,
        url: newPage.url(),
        title: pageTitle,
      });
      this.registry.bindAlias(alias, pageId);
      return R.ok().build({ alias, index: idx, pageId, url: newPage.url(), title: pageTitle });
    }

    // Puppeteer path
    const browser = await this.getBrowserFromController();
    if (!browser)
      return R.fail(
        'Cannot open new tab: browser instance not accessible via PageController',
      ).build();
    const newPage = await browser.newPage();
    await newPage.goto(url, { waitUntil: 'domcontentloaded' });
    const pages = await browser.pages();
    const idx = pages.indexOf(newPage);
    const pageTitle = await newPage.title();
    const pageId = this.registry.registerPage(newPage, {
      index: idx,
      url: newPage.url(),
      title: pageTitle,
    });
    this.registry.bindAlias(alias, pageId);
    return R.ok().build({ alias, index: idx, pageId, url: newPage.url(), title: pageTitle });
  }

  private async navigateAlias(args: Record<string, unknown>): Promise<ToolResponse> {
    const alias = readRequiredString(args.alias);
    const url = readRequiredString(args.url);
    if (!alias) return R.fail('alias is required').build();
    if (!url) return R.fail('url is required').build();

    const page = await this.getPageByAlias(alias);
    if (!page)
      return R.fail(
        `No tab found for alias "${alias}". Use alias_bind or alias_open first.`,
      ).build();

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return R.ok().build({ alias, navigated: url, currentUrl: page.url() });
  }

  private async waitFor(args: Record<string, unknown>): Promise<ToolResponse> {
    const alias = readRequiredString(args.alias);
    const selector = readRequiredString(args.selector);
    const text = readRequiredString(args.waitForText);
    const timeoutMs = readTimeout(args.timeoutMs, 10000);

    if (!alias) return R.fail('alias is required').build();
    if (!selector && !text) return R.fail('selector or waitForText is required').build();

    const page = await this.getPageByAlias(alias);
    if (!page) return R.fail(`No tab found for alias "${alias}"`).build();

    if (selector) {
      await page.waitForSelector(selector, { timeout: timeoutMs });
      return R.ok().build({ alias, waitedFor: selector, found: true });
    }

    // Wait for text
    const waitText = text!;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const bodyTextValue = await page.evaluate(() => document.body.innerText);
      const bodyText =
        typeof bodyTextValue === 'string' ? bodyTextValue : String(bodyTextValue ?? '');
      if (bodyText.includes(waitText)) {
        return R.ok().build({ alias, waitedForText: waitText, found: true });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return R.fail(`Timeout waiting for text "${waitText}" in tab "${alias}"`).build();
  }

  private contextSet(args: Record<string, unknown>): ToolResponse {
    const key = readRequiredString(args.key);
    const value = args.value;
    if (!key) return R.fail('key is required').build();
    this.registry.setSharedContext(key, value);
    return R.ok().build({ set: { key, value } });
  }

  private contextGet(args: Record<string, unknown>): ToolResponse {
    const key = readRequiredString(args.key);
    if (!key) return R.fail('key is required').build();
    const { value, found } = this.registry.getSharedContext(key);
    return R.ok().build({ key, value, found });
  }

  private async transfer(args: Record<string, unknown>): Promise<ToolResponse> {
    const fromAlias = readRequiredString(args.fromAlias);
    const key = readRequiredString(args.key);
    const expression = readRequiredString(args.expression);

    if (!fromAlias) return R.fail('fromAlias is required').build();
    if (!key) return R.fail('key is required').build();
    if (!expression) return R.fail('expression is required').build();

    const page = await this.getPageByAlias(fromAlias);
    if (!page) return R.fail(`No tab found for alias "${fromAlias}"`).build();

    const value = await page.evaluate(expression);
    this.registry.setSharedContext(key, value);
    return R.ok().build({ transferred: { fromAlias, key, value } });
  }

  private async getPageByAlias(alias: string): Promise<TabPageLike | null> {
    const pageId = this.registry.resolveAlias(alias);
    if (!pageId) return null;

    const page = this.registry.getPageById(pageId);
    if (page && isTabPageLike(page)) return page;

    // Alias exists but page is stale — try reconcile then retry
    await this.reconcilePages();
    const retryPage = this.registry.getPageById(pageId);
    if (retryPage && isTabPageLike(retryPage)) return retryPage;

    return null;
  }

  private async reconcilePages(): Promise<void> {
    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      if (isCamoufoxPageLike(page)) {
        const pages = page.context().pages();
        const meta = await Promise.all(
          pages.map(async (p, i) => ({
            index: i,
            url: p.url(),
            title: await p.title(),
          })),
        );
        this.registry.reconcilePages(pages, meta);
      }
      return;
    }

    const browser = await this.getBrowserFromController();
    if (!browser) return;
    const pages = await browser.pages();
    const meta = await Promise.all(
      pages.map(async (p, i) => ({
        index: i,
        url: p.url(),
        title: await p.title(),
      })),
    );
    this.registry.reconcilePages(pages, meta);
  }

  private async getBrowserFromController(): Promise<BrowserLike | null> {
    const pc = this.deps.getPageController();
    if (!isRecord(pc) || typeof pc.getBrowser !== 'function') {
      return null;
    }

    const browser = await pc.getBrowser();
    return isBrowserLike(browser) ? browser : null;
  }
}

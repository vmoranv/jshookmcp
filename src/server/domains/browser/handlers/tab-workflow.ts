/**
 * Tab Workflow — cross-tab coordination for multi-page automation flows.
 *
 * Solves the registration-page ↔ email-verification-page problem:
 * - alias_bind: name a tab index so you don't need to track numbers
 * - alias_open: open a URL in a new tab and bind an alias
 * - navigate: navigate a specific aliased tab
 * - wait_for: wait for text/selector in an aliased tab
 * - context_set / context_get: share data between tabs (e.g. extracted email → registration page)
 * - transfer: copy data from one tab's page.evaluate to the shared context
 */

import { logger } from '../../../../utils/logger.js';

interface TabWorkflowDeps {
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<any>;
  getPageController: () => any;
}

type TabAction = 'alias_bind' | 'alias_open' | 'navigate' | 'wait_for' | 'context_set' | 'context_get' | 'transfer' | 'list' | 'clear';

interface TabInfo {
  alias: string;
  index: number;
}

export class TabWorkflowHandlers {
  // Instance-level state: no cross-session leakage
  private aliases = new Map<string, number>();
  private sharedContext = new Map<string, unknown>();

  constructor(private deps: TabWorkflowDeps) {}

  async handleTabWorkflow(args: Record<string, unknown>) {
    const action = args.action as TabAction;

    try {
      switch (action) {
        case 'list':         return this.listAliases();
        case 'clear':        return this.clearState();
        case 'alias_bind':   return this.aliasBind(args);
        case 'alias_open':   return await this.aliasOpen(args);
        case 'navigate':     return await this.navigateAlias(args);
        case 'wait_for':     return await this.waitFor(args);
        case 'context_set':  return this.contextSet(args);
        case 'context_get':  return this.contextGet(args);
        case 'transfer':     return await this.transfer(args);
        default:
          return this.error(`Unknown action: "${action}". Valid: list, alias_bind, alias_open, navigate, wait_for, context_set, context_get, transfer`);
      }
    } catch (err) {
      logger.error('[tab_workflow] Error:', err);
      return this.error(err instanceof Error ? err.message : String(err));
    }
  }

  private listAliases() {
    const tabs: TabInfo[] = [];
    this.aliases.forEach((index, alias) => tabs.push({ alias, index }));
    const context: Record<string, unknown> = {};
    this.sharedContext.forEach((v, k) => { context[k] = v; });
    return this.ok({ aliases: tabs, context });
  }

  private clearState() {
    this.aliases.clear();
    this.sharedContext.clear();
    return this.ok({ cleared: true });
  }

  private aliasBind(args: Record<string, unknown>) {
    const alias = args.alias as string;
    const index = args.index as number;
    if (!alias) return this.error('alias is required');
    if (index === undefined || index === null) return this.error('index is required');
    this.aliases.set(alias, index);
    return this.ok({ bound: { alias, index } });
  }

  private async aliasOpen(args: Record<string, unknown>) {
    const alias = args.alias as string;
    const url = args.url as string;
    if (!alias) return this.error('alias is required');
    if (!url) return this.error('url is required');

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      const context = page.context();
      const newPage = await context.newPage();
      await newPage.goto(url, { waitUntil: 'domcontentloaded' });
      // Playwright doesn't have stable tab indices — store as 'new' and let user manage
      const pages = context.pages();
      const idx = pages.indexOf(newPage);
      this.aliases.set(alias, idx);
      return this.ok({ alias, index: idx, url: newPage.url(), title: await newPage.title() });
    }

    // Puppeteer path
    const pc = this.deps.getPageController();
    const browser = await pc.getBrowser?.();
    if (!browser) return this.error('Cannot open new tab: browser instance not accessible via PageController');
    const newPage = await browser.newPage();
    await newPage.goto(url, { waitUntil: 'domcontentloaded' });
    const pages = await browser.pages();
    const idx = pages.indexOf(newPage);
    this.aliases.set(alias, idx);
    return this.ok({ alias, index: idx, url: newPage.url(), title: await newPage.title() });
  }

  private async navigateAlias(args: Record<string, unknown>) {
    const alias = args.alias as string;
    const url = args.url as string;
    if (!alias) return this.error('alias is required');
    if (!url) return this.error('url is required');

    const page = await this.getPageByAlias(alias);
    if (!page) return this.error(`No tab found for alias "${alias}". Use alias_bind or alias_open first.`);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return this.ok({ alias, navigated: url, currentUrl: page.url() });
  }

  private async waitFor(args: Record<string, unknown>) {
    const alias = args.alias as string;
    const selector = args.selector as string | undefined;
    const text = args.waitForText as string | undefined;
    const timeoutMs = (args.timeoutMs as number) ?? 10000;

    if (!alias) return this.error('alias is required');
    if (!selector && !text) return this.error('selector or waitForText is required');

    const page = await this.getPageByAlias(alias);
    if (!page) return this.error(`No tab found for alias "${alias}"`);

    if (selector) {
      await page.waitForSelector(selector, { timeout: timeoutMs });
      return this.ok({ alias, waitedFor: selector, found: true });
    }

    // Wait for text
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const bodyText: string = await page.evaluate(() => document.body.innerText);
      if (bodyText.includes(text!)) {
        return this.ok({ alias, waitedForText: text, found: true });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return this.error(`Timeout waiting for text "${text}" in tab "${alias}"`);
  }

  private contextSet(args: Record<string, unknown>) {
    const key = args.key as string;
    const value = args.value;
    if (!key) return this.error('key is required');
    this.sharedContext.set(key, value);
    return this.ok({ set: { key, value } });
  }

  private contextGet(args: Record<string, unknown>) {
    const key = args.key as string;
    if (!key) return this.error('key is required');
    const value = this.sharedContext.get(key);
    return this.ok({ key, value: value ?? null, found: this.sharedContext.has(key) });
  }

  private async transfer(args: Record<string, unknown>) {
    const fromAlias = args.fromAlias as string;
    const key = args.key as string;
    const expression = args.expression as string; // JS expression to evaluate in the tab

    if (!fromAlias) return this.error('fromAlias is required');
    if (!key) return this.error('key is required');
    if (!expression) return this.error('expression is required');

    const page = await this.getPageByAlias(fromAlias);
    if (!page) return this.error(`No tab found for alias "${fromAlias}"`);

    const value = await page.evaluate(expression);
    this.sharedContext.set(key, value);
    return this.ok({ transferred: { fromAlias, key, value } });
  }

  private async getPageByAlias(alias: string): Promise<any | null> {
    const idx = this.aliases.get(alias);
    if (idx === undefined) return null;

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      const pages = page.context().pages();
      return pages[idx] ?? null;
    }

    const pc = this.deps.getPageController();
    const browser = await pc.getBrowser?.();
    if (!browser) return null;
    const pages = await browser.pages();
    return pages[idx] ?? null;
  }

  private ok(data: Record<string, unknown>) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, ...data }, null, 2),
      }],
    };
  }

  private error(message: string) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: message }, null, 2),
      }],
    };
  }
}

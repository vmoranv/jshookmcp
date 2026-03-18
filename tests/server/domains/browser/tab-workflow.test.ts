import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TabWorkflowHandlers } from '@server/domains/browser/handlers/tab-workflow';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createPage(overrides: Record<string, unknown> = {}) {
  return {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ''),
    url: vi.fn(() => 'https://example.test'),
    title: vi.fn(async () => 'Example'),
    ...overrides,
  } as any;
}

describe('TabWorkflowHandlers', () => {
  let activeDriver: 'chrome' | 'camoufox';
  let camoufoxPage: unknown;
  let pageController: { getBrowser: ReturnType<typeof vi.fn> };
  let registry: Record<string, any>;
  let handlers: TabWorkflowHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    activeDriver = 'chrome';
    camoufoxPage = null;
    pageController = {
      getBrowser: vi.fn(async () => null),
    };
    registry = {
      getCurrentTabInfo: vi.fn(() => ({
        aliases: [],
        staleAliases: [],
        currentPageId: null,
        currentIndex: null,
        url: null,
        title: null,
      })),
      getSharedContextMap: vi.fn(() => ({})),
      clear: vi.fn(),
      bindAliasByIndex: vi.fn(),
      reconcilePages: vi.fn(),
      registerPage: vi.fn(),
      bindAlias: vi.fn(),
      resolveAlias: vi.fn(),
      getPageById: vi.fn(),
      setSharedContext: vi.fn(),
      getSharedContext: vi.fn(() => ({ value: null, found: false })),
    };
    handlers = new TabWorkflowHandlers({
      getActiveDriver: () => activeDriver,
      getCamoufoxPage: async () => camoufoxPage,
      getPageController: () => pageController,
      getTabRegistry: () => registry as any,
    });
  });

  it('returns an error for unknown actions', async () => {
    const body = parseJson(await handlers.handleTabWorkflow({ action: 'not-real' }));

    expect(body.success).toBe(false);
    expect(body.error).toContain('Unknown action');
  });

  it('returns registry state for the list action', async () => {
    registry.getCurrentTabInfo.mockReturnValueOnce({
      aliases: [{ alias: 'main', pageId: 'tab-1', index: 0, stale: false }],
      staleAliases: [],
      currentPageId: 'tab-1',
      currentIndex: 0,
      url: 'https://app.test',
      title: 'App',
    });
    registry.getSharedContextMap.mockReturnValueOnce({ token: 'abc' });

    const body = parseJson(await handlers.handleTabWorkflow({ action: 'list' }));

    expect(registry.getCurrentTabInfo).toHaveBeenCalledWith('chrome');
    expect(body.success).toBe(true);
    expect(body.aliases).toEqual([{ alias: 'main', pageId: 'tab-1', index: 0, stale: false }]);
    expect(body.context).toEqual({ token: 'abc' });
  });

  it('clears shared state for the clear action', async () => {
    const body = parseJson(await handlers.handleTabWorkflow({ action: 'clear' }));

    expect(registry.clear).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.cleared).toBe(true);
  });

  it('reconciles chrome pages before binding an alias by index', async () => {
    const pageA = createPage({
      url: vi.fn(() => 'https://a.test'),
      title: vi.fn(async () => 'A'),
    });
    const pageB = createPage({
      url: vi.fn(() => 'https://b.test'),
      title: vi.fn(async () => 'B'),
    });
    const browser = {
      newPage: vi.fn(),
      pages: vi.fn(async () => [pageA, pageB]),
    };
    pageController.getBrowser.mockResolvedValueOnce(browser);
    registry.bindAliasByIndex.mockReturnValueOnce('tab-2');

    const body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'alias_bind',
        alias: 'inbox',
        index: '1',
      })
    );

    expect(browser.pages).toHaveBeenCalledOnce();
    expect(registry.reconcilePages).toHaveBeenCalledWith(
      [pageA, pageB],
      [
        { index: 0, url: 'https://a.test', title: 'A' },
        { index: 1, url: 'https://b.test', title: 'B' },
      ]
    );
    expect(registry.bindAliasByIndex).toHaveBeenCalledWith('inbox', 1);
    expect(body.success).toBe(true);
    expect(body.bound).toEqual({
      alias: 'inbox',
      index: 1,
      pageId: 'tab-2',
    });
  });

  it('opens a new camoufox tab and binds the alias', async () => {
    activeDriver = 'camoufox';
    const newPage = createPage({
      url: vi.fn(() => 'https://mail.test'),
      title: vi.fn(async () => 'Inbox'),
    });
    let currentPage: any;
    const context = {
      newPage: vi.fn(async () => newPage),
      pages: vi.fn(() => [currentPage, newPage]),
    };
    currentPage = createPage({
      context: vi.fn(() => context),
    });
    camoufoxPage = currentPage;
    registry.registerPage.mockReturnValueOnce('tab-9');

    const body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'alias_open',
        alias: 'mail',
        url: 'https://mail.test',
      })
    );

    expect(context.newPage).toHaveBeenCalledOnce();
    expect(newPage.goto).toHaveBeenCalledWith('https://mail.test', {
      waitUntil: 'domcontentloaded',
    });
    expect(registry.registerPage).toHaveBeenCalledWith(newPage, {
      index: 1,
      url: 'https://mail.test',
      title: 'Inbox',
    });
    expect(registry.bindAlias).toHaveBeenCalledWith('mail', 'tab-9');
    expect(body.success).toBe(true);
    expect(body.pageId).toBe('tab-9');
  });

  it('navigates the page resolved from an alias', async () => {
    const page = createPage({
      url: vi.fn(() => 'https://next.test'),
    });
    registry.resolveAlias.mockReturnValueOnce('tab-4');
    registry.getPageById.mockReturnValueOnce(page);

    const body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'navigate',
        alias: 'mail',
        url: 'https://next.test',
      })
    );

    expect(page.goto).toHaveBeenCalledWith('https://next.test', {
      waitUntil: 'domcontentloaded',
    });
    expect(body.success).toBe(true);
    expect(body.currentUrl).toBe('https://next.test');
  });

  it('waits for a selector with the default timeout', async () => {
    const page = createPage();
    registry.resolveAlias.mockReturnValueOnce('tab-1');
    registry.getPageById.mockReturnValueOnce(page);

    const body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'wait_for',
        alias: 'verify',
        selector: '#otp',
      })
    );

    expect(page.waitForSelector).toHaveBeenCalledWith('#otp', {
      timeout: 10000,
    });
    expect(body.success).toBe(true);
    expect(body.found).toBe(true);
  });

  it('stores and retrieves values in shared context', async () => {
    let body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'context_set',
        key: 'token',
        value: 'abc',
      })
    );

    expect(registry.setSharedContext).toHaveBeenCalledWith('token', 'abc');
    expect(body.success).toBe(true);
    expect(body.set).toEqual({ key: 'token', value: 'abc' });

    registry.getSharedContext.mockReturnValueOnce({ value: 'abc', found: true });

    body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'context_get',
        key: 'token',
      })
    );

    expect(body.success).toBe(true);
    expect(body.value).toBe('abc');
    expect(body.found).toBe(true);
  });

  it('transfers evaluated data from a tab into shared context', async () => {
    const page = createPage({
      evaluate: vi.fn(async () => 'otp-123'),
    });
    registry.resolveAlias.mockReturnValueOnce('tab-8');
    registry.getPageById.mockReturnValueOnce(page);

    const body = parseJson(
      await handlers.handleTabWorkflow({
        action: 'transfer',
        fromAlias: 'mail',
        key: 'otp',
        expression: 'window.__otp',
      })
    );

    expect(page.evaluate).toHaveBeenCalledWith('window.__otp');
    expect(registry.setSharedContext).toHaveBeenCalledWith('otp', 'otp-123');
    expect(body.success).toBe(true);
    expect(body.transferred).toEqual({
      fromAlias: 'mail',
      key: 'otp',
      value: 'otp-123',
    });
  });
});

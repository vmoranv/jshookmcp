import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { TabWorkflowResponse } from '../../shared/common-test-types';

import { TabWorkflowHandlers } from '@server/domains/browser/handlers/tab-workflow';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface PageMock {
  goto: Mock<(url: string, options?: unknown) => Promise<void>>;
  waitForSelector: Mock<(selector: string, options?: unknown) => Promise<void>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  evaluate: Mock<(fn: unknown) => Promise<any>>;
  url: Mock<() => string>;
  title: Mock<() => Promise<string>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  context?: Mock<() => any>;
}

function createPage(overrides: Partial<PageMock> = {}): PageMock {
  return {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ''),
    url: vi.fn(() => 'https://example.test'),
    title: vi.fn(async () => 'Example'),
    ...overrides,
  };
}

interface TabRegistryMock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getCurrentTabInfo: Mock<() => any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getSharedContextMap: Mock<() => any>;
  clear: Mock<() => void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  bindAliasByIndex: Mock<(alias: string, index: number) => any>;
  reconcilePages: Mock<() => void>;
  registerPage: Mock<(page: unknown) => string>;
  bindAlias: Mock<(alias: string, pageId: string) => void>;
  resolveAlias: Mock<(alias: string) => string | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getPageById: Mock<(id: string) => any>;
  setSharedContext: Mock<(key: string, value: unknown) => void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getSharedContext: Mock<(key: string) => any>;
}

describe('TabWorkflowHandlers — extended coverage', () => {
  let activeDriver: 'chrome' | 'camoufox';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  let camoufoxPage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  let pageController: { getBrowser: Mock<() => Promise<any>> };
  let registry: TabRegistryMock;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getPageController: () => pageController as any,
      getTabRegistry: () => registry as unknown,
    });
  });

  // ─── alias_bind validation ────────────────────────────────────────

  it('returns error when alias_bind is called without alias', async () => {
    const body = parseJson<TabWorkflowResponse>(await handlers.handleTabWorkflow({ action: 'alias_bind', index: '0' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('alias is required');
  });

  it('returns error when alias_bind is called without index', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'alias_bind', alias: 'main' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('index is required');
  });

  it('returns error when alias_bind index resolves to no page', async () => {
    const browser = {
      newPage: vi.fn(),
      pages: vi.fn(async () => []),
    };
    pageController.getBrowser.mockResolvedValueOnce(browser);
    registry.bindAliasByIndex.mockReturnValueOnce(null);

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'alias_bind', alias: 'tab', index: 99 })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('No active page at index');
  });

  // ─── alias_open validation ────────────────────────────────────────

  it('returns error when alias_open is called without alias', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'alias_open', url: 'https://test.com' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('alias is required');
  });

  it('returns error when alias_open is called without url', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'alias_open', alias: 'new-tab' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('url is required');
  });

  it('opens a new chrome tab via puppeteer browser', async () => {
    const newPage = createPage({
      url: vi.fn(() => 'https://app.test'),
      title: vi.fn(async () => 'App'),
    });
    const browser = {
      newPage: vi.fn(async () => newPage),
      pages: vi.fn(async () => [createPage(), newPage]),
    };
    pageController.getBrowser.mockResolvedValueOnce(browser);
    registry.registerPage.mockReturnValueOnce('tab-3');

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'alias_open',
        alias: 'app',
        url: 'https://app.test',
      })
    );

    expect(browser.newPage).toHaveBeenCalledOnce();
    expect(newPage.goto).toHaveBeenCalledWith('https://app.test', {
      waitUntil: 'domcontentloaded',
    });
    expect(registry.registerPage).toHaveBeenCalled();
    expect(registry.bindAlias).toHaveBeenCalledWith('app', 'tab-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.pageId).toBe('tab-3');
  });

  it('returns error when chrome browser is not accessible for alias_open', async () => {
    pageController.getBrowser.mockResolvedValueOnce(null);

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'alias_open',
        alias: 'tab',
        url: 'https://test.com',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('browser instance not accessible');
  });

  // ─── navigate validation ──────────────────────────────────────────

  it('returns error when navigate is called without alias', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'navigate', url: 'https://test.com' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('alias is required');
  });

  it('returns error when navigate is called without url', async () => {
    const body = parseJson<TabWorkflowResponse>(await handlers.handleTabWorkflow({ action: 'navigate', alias: 'main' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('url is required');
  });

  it('returns error when navigate alias is not found', async () => {
    registry.resolveAlias.mockReturnValueOnce(null);

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'navigate',
        alias: 'missing',
        url: 'https://test.com',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('No tab found for alias');
  });

  // ─── wait_for validation ──────────────────────────────────────────

  it('returns error when wait_for is called without alias', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'wait_for', selector: '#btn' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('alias is required');
  });

  it('returns error when wait_for has no selector or text', async () => {
    const body = parseJson<TabWorkflowResponse>(await handlers.handleTabWorkflow({ action: 'wait_for', alias: 'main' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('selector or waitForText is required');
  });

  it('uses custom timeout for wait_for', async () => {
    const page = createPage();
    registry.resolveAlias.mockReturnValueOnce('tab-1');
    registry.getPageById.mockReturnValueOnce(page);

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'wait_for',
        alias: 'main',
        selector: '#element',
        timeoutMs: 5000,
      })
    );

    expect(page.waitForSelector).toHaveBeenCalledWith('#element', { timeout: 5000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  // ─── context_set / context_get validation ─────────────────────────

  it('returns error when context_set has no key', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'context_set', value: 'val' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('key is required');
  });

  it('returns error when context_get has no key', async () => {
    const body = parseJson<TabWorkflowResponse>(await handlers.handleTabWorkflow({ action: 'context_get' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('key is required');
  });

  it('context_get returns found: false for missing keys', async () => {
    registry.getSharedContext.mockReturnValueOnce({ value: null, found: false });

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({ action: 'context_get', key: 'missing' })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.found).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.value).toBeNull();
  });

  // ─── transfer validation ──────────────────────────────────────────

  it('returns error when transfer has no fromAlias', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'transfer',
        key: 'token',
        expression: 'window.t',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('fromAlias is required');
  });

  it('returns error when transfer has no key', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'transfer',
        fromAlias: 'mail',
        expression: 'window.t',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('key is required');
  });

  it('returns error when transfer has no expression', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'transfer',
        fromAlias: 'mail',
        key: 'token',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('expression is required');
  });

  it('returns error when transfer alias does not exist', async () => {
    registry.resolveAlias.mockReturnValueOnce(null);

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'transfer',
        fromAlias: 'missing',
        key: 'data',
        expression: 'window.data',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('No tab found for alias');
  });

  // ─── camoufox driver path ─────────────────────────────────────────

  it('reconciles camoufox pages before binding alias', async () => {
    activeDriver = 'camoufox';
    const page = createPage({
      url: vi.fn(() => 'https://a.test'),
      title: vi.fn(async () => 'A'),
      context: vi.fn(() => ({
        pages: vi.fn(() => [page]),
      })),
    });
    camoufoxPage = page;
    registry.bindAliasByIndex.mockReturnValueOnce('tab-cf-1');

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'alias_bind',
        alias: 'main',
        index: 0,
      })
    );

    expect(registry.reconcilePages).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (body.bound) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.bound.alias).toBe('main');
    }
  });

  it('camoufox alias_open errors when page context is not accessible', async () => {
    activeDriver = 'camoufox';
    // camoufoxPage is null (no context method)
    camoufoxPage = null;

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'alias_open',
        alias: 'new-tab',
        url: 'https://test.com',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('camoufox page context not accessible');
  });

  // ─── list with stale aliases ──────────────────────────────────────

  it('includes stale aliases in list output', async () => {
    registry.getCurrentTabInfo.mockReturnValueOnce({
      aliases: [{ alias: 'main', pageId: 'tab-1', index: 0, stale: false }],
      staleAliases: [{ alias: 'old', pageId: 'tab-0', index: 0, stale: true }],
      currentPageId: 'tab-1',
      currentIndex: 0,
      url: 'https://app.test',
      title: 'App',
    });
    registry.getSharedContextMap.mockReturnValueOnce({});

    const body = parseJson<TabWorkflowResponse>(await handlers.handleTabWorkflow({ action: 'list' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (body.aliases && body.staleAliases) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.aliases).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.staleAliases).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.staleAliases[0].alias).toBe('old');
    }
  });

  // ─── error handler catch ──────────────────────────────────────────

  it('catches and returns errors thrown during action execution', async () => {
    registry.resolveAlias.mockImplementation(() => {
      throw new Error('Registry exploded');
    });

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'navigate',
        alias: 'boom',
        url: 'https://test.com',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Registry exploded');
  });

  // ─── numeric index parsing ────────────────────────────────────────

  it('accepts numeric string for alias_bind index', async () => {
    const browser = {
      newPage: vi.fn(),
      pages: vi.fn(async () => [createPage()]),
    };
    pageController.getBrowser.mockResolvedValueOnce(browser);
    registry.bindAliasByIndex.mockReturnValueOnce('tab-0');

    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'alias_bind',
        alias: 'first',
        index: '0',
      })
    );

    expect(registry.bindAliasByIndex).toHaveBeenCalledWith('first', 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  it('returns error for non-numeric index string in alias_bind', async () => {
    const body = parseJson<TabWorkflowResponse>(
      await handlers.handleTabWorkflow({
        action: 'alias_bind',
        alias: 'first',
        index: 'abc',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('index is required');
  });
});

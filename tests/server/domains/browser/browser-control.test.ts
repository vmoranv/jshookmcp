import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@utils/config', () => ({
  projectRoot: '/fake/project',
}));

import { BrowserControlHandlers } from '@server/domains/browser/handlers/browser-control';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createMocks() {
  const collector = {
    connect: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    listPages: vi.fn(async () => []),
    listResolvedPages: vi.fn(async () => []),
    selectPage: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ connected: true })),
  } as any;

  const consoleMonitor = {
    disable: vi.fn(async () => {}),
    enable: vi.fn(async () => {}),
  } as any;

  const tabRegistry = {
    reconcilePages: vi.fn(() => []),
    setCurrentByIndex: vi.fn((index: number) => ({
      pageId: `page-${index}`,
      aliases: [],
    })),
    getTabByIndex: vi.fn((index: number) => ({
      pageId: `page-${index}`,
      aliases: [`alias-${index}`],
    })),
    getContextMeta: vi.fn(() => ({ pageId: 'page-0', tabIndex: 0 })),
  } as any;

  const deps = {
    collector,
    pageController: {} as any,
    consoleMonitor,
    getActiveDriver: () => 'chrome' as const,
    getCamoufoxManager: () => null,
    getCamoufoxPage: async () => null,
    getTabRegistry: () => tabRegistry,
  };

  return { collector, consoleMonitor, tabRegistry, deps };
}

// ─── handleBrowserLaunch ───

describe('BrowserControlHandlers – handleBrowserLaunch', () => {
  let handlers: BrowserControlHandlers;
  let collector: ReturnType<typeof createMocks>['collector'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('launches chrome in default mode and returns status', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true, pages: 1 });
    const body = parseJson(await handlers.handleBrowserLaunch({}));
    expect(collector.init).toHaveBeenCalledWith(undefined);
    expect(body.success).toBe(true);
    expect(body.driver).toBe('chrome');
    expect(body.status.connected).toBe(true);
  });

  it('connects chrome when mode=connect with browserURL', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    const body = parseJson(
      await handlers.handleBrowserLaunch({
        mode: 'connect',
        browserURL: 'http://127.0.0.1:9222',
      })
    );
    expect(collector.connect).toHaveBeenCalledWith({
      browserURL: 'http://127.0.0.1:9222',
      wsEndpoint: undefined,
      autoConnect: undefined,
      userDataDir: undefined,
      channel: undefined,
    });
    expect(body.success).toBe(true);
    expect(body.mode).toBe('connect');
    expect(body.endpoint).toBe('http://127.0.0.1:9222');
  });

  it('connects chrome when mode=connect with wsEndpoint', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    const body = parseJson(
      await handlers.handleBrowserLaunch({
        mode: 'connect',
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
      })
    );
    expect(collector.connect).toHaveBeenCalledWith({
      browserURL: undefined,
      wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
      autoConnect: undefined,
      userDataDir: undefined,
      channel: undefined,
    });
    expect(body.success).toBe(true);
  });

  it('returns error when chrome connect mode has no endpoint', async () => {
    const body = parseJson(await handlers.handleBrowserLaunch({ mode: 'connect' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain(
      'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required'
    );
  });

  it('launches camoufox in default launch mode', async () => {
    const body = parseJson(await handlers.handleBrowserLaunch({ driver: 'camoufox' }));
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.mode).toBe('launch');
  });

  it('connects camoufox when mode=connect with wsEndpoint', async () => {
    const body = parseJson(
      await handlers.handleBrowserLaunch({
        driver: 'camoufox',
        mode: 'connect',
        wsEndpoint: 'ws://localhost:1234',
      })
    );
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.mode).toBe('connect');
    expect(body.wsEndpoint).toBe('ws://localhost:1234');
  });

  it('returns error when camoufox connect mode has no wsEndpoint', async () => {
    const body = parseJson(
      await handlers.handleBrowserLaunch({
        driver: 'camoufox',
        mode: 'connect',
      })
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('wsEndpoint is required');
  });

  it('passes headless boolean true to collector.init', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: true });
    expect(collector.init).toHaveBeenCalledWith(true);
  });

  it('passes headless boolean false to collector.init', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: false });
    expect(collector.init).toHaveBeenCalledWith(false);
  });

  it('parses headless string "true" correctly', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: 'true' });
    expect(collector.init).toHaveBeenCalledWith(true);
  });

  it('parses headless string "false" correctly', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: 'false' });
    expect(collector.init).toHaveBeenCalledWith(false);
  });

  it('parses headless string "yes"/"no" correctly', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: 'yes' });
    expect(collector.init).toHaveBeenCalledWith(true);
  });

  it('parses headless number 1 as true', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: 1 });
    expect(collector.init).toHaveBeenCalledWith(true);
  });

  it('parses headless number 0 as false', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: 0 });
    expect(collector.init).toHaveBeenCalledWith(false);
  });

  it('treats unrecognized headless values as undefined', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    await handlers.handleBrowserLaunch({ headless: 'maybe' });
    expect(collector.init).toHaveBeenCalledWith(undefined);
  });

  it('re-throws non-linux-display errors from init', async () => {
    collector.init.mockRejectedValueOnce(new Error('some other error'));
    await expect(handlers.handleBrowserLaunch({})).rejects.toThrow('some other error');
  });
});

// ─── handleBrowserClose ───

describe('BrowserControlHandlers – handleBrowserClose', () => {
  let handlers: BrowserControlHandlers;
  let collector: ReturnType<typeof createMocks>['collector'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('closes the browser and returns success', async () => {
    const body = parseJson(await handlers.handleBrowserClose({}));
    expect(collector.close).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.message).toContain('closed');
  });
});

// ─── handleBrowserStatus ───

describe('BrowserControlHandlers – handleBrowserStatus', () => {
  let handlers: BrowserControlHandlers;
  let collector: ReturnType<typeof createMocks>['collector'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('returns the collector status with driver field', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true, pages: 2 });
    const body = parseJson(await handlers.handleBrowserStatus({}));
    expect(body.driver).toBe('chrome');
    expect(body.connected).toBe(true);
    expect(body.pages).toBe(2);
  });
});

// ─── handleBrowserListTabs ───

describe('BrowserControlHandlers – handleBrowserListTabs', () => {
  let handlers: BrowserControlHandlers;
  let collector: ReturnType<typeof createMocks>['collector'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('lists pages enriched with tab registry info', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com', title: 'A' },
      { index: 1, url: 'https://b.com', title: 'B' },
    ]);

    const body = parseJson(await handlers.handleBrowserListTabs({}));

    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.pages).toHaveLength(2);
    expect(body.pages[0].pageId).toBe('page-0');
    expect(body.pages[1].aliases).toEqual(['alias-1']);
    expect(body.currentPageId).toBe('page-0');
  });

  it('connects first when browserURL is provided', async () => {
    collector.listPages.mockResolvedValueOnce([]);
    await handlers.handleBrowserListTabs({
      browserURL: 'http://127.0.0.1:9222',
    });
    expect(collector.connect).toHaveBeenCalledWith({
      browserURL: 'http://127.0.0.1:9222',
      wsEndpoint: undefined,
      autoConnect: undefined,
      userDataDir: undefined,
      channel: undefined,
    });
  });

  it('returns error payload when listPages throws', async () => {
    collector.listPages.mockRejectedValueOnce(new Error('no browser'));
    const body = parseJson(await handlers.handleBrowserListTabs({}));
    expect(body.success).toBe(false);
    expect(body.error).toBe('no browser');
    expect(body.hint).toBeDefined();
  });
});

// ─── handleBrowserSelectTab ───

describe('BrowserControlHandlers – handleBrowserSelectTab', () => {
  let handlers: BrowserControlHandlers;
  let collector: ReturnType<typeof createMocks>['collector'];
  let consoleMonitor: ReturnType<typeof createMocks>['consoleMonitor'];
  let tabRegistry: ReturnType<typeof createMocks>['tabRegistry'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    consoleMonitor = m.consoleMonitor;
    tabRegistry = m.tabRegistry;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('selects a tab by index', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com', title: 'A' },
      { index: 1, url: 'https://b.com', title: 'B' },
    ]);

    const body = parseJson(await handlers.handleBrowserSelectTab({ index: 1 }));

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(tabRegistry.setCurrentByIndex).toHaveBeenCalledWith(1);
    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(1);
    expect(body.url).toBe('https://b.com');
    expect(body.title).toBe('B');
    expect(body.activeContextRefreshed).toBe(true);
  });

  it('selects a tab by urlPattern', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com/page', title: 'A' },
      { index: 1, url: 'https://b.com/target', title: 'B' },
    ]);

    const body = parseJson(await handlers.handleBrowserSelectTab({ urlPattern: 'target' }));

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(1);
  });

  it('selects a tab by titlePattern', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com', title: 'First' },
      { index: 1, url: 'https://b.com', title: 'Second Tab' },
    ]);

    const body = parseJson(await handlers.handleBrowserSelectTab({ titlePattern: 'Second' }));

    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(1);
  });

  it('returns error when no matching tab found', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);

    const body = parseJson(await handlers.handleBrowserSelectTab({ urlPattern: 'notfound' }));

    expect(body.success).toBe(false);
    expect(body.error).toBe('No matching tab found');
    expect(body.availablePages).toBeDefined();
  });

  it('returns error payload when selectPage throws', async () => {
    collector.selectPage.mockRejectedValueOnce(new Error('select failed'));

    const body = parseJson(await handlers.handleBrowserSelectTab({ index: 0 }));

    expect(body.success).toBe(false);
    expect(body.error).toBe('select failed');
  });

  it('continues with monitoring disabled when consoleMonitor.disable fails', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    consoleMonitor.disable.mockRejectedValueOnce(new Error('disable fail'));

    const body = parseJson(await handlers.handleBrowserSelectTab({ index: 0 }));

    expect(body.success).toBe(true);
    expect(consoleMonitor.enable).toHaveBeenCalled();
  });

  it('reports monitoring disabled when consoleMonitor.enable fails', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    consoleMonitor.enable.mockRejectedValueOnce(new Error('enable fail'));

    const body = parseJson(await handlers.handleBrowserSelectTab({ index: 0 }));

    expect(body.success).toBe(true);
    expect(body.networkMonitoringEnabled).toBe(false);
    expect(body.consoleMonitoringEnabled).toBe(false);
  });
});

// ─── handleBrowserAttach ───

describe('BrowserControlHandlers – handleBrowserAttach', () => {
  let handlers: BrowserControlHandlers;
  let collector: ReturnType<typeof createMocks>['collector'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('returns error when no endpoint provided', async () => {
    const body = parseJson(await handlers.handleBrowserAttach({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain(
      'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required'
    );
  });

  it('attaches to browser and selects the default page 0', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://example.com', title: 'Example' },
    ]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson(
      await handlers.handleBrowserAttach({ browserURL: 'http://127.0.0.1:9222' })
    );

    expect(collector.connect).toHaveBeenCalledWith({
      browserURL: 'http://127.0.0.1:9222',
      wsEndpoint: undefined,
      autoConnect: undefined,
      userDataDir: undefined,
      channel: undefined,
    });
    expect(collector.selectPage).toHaveBeenCalledWith(0);
    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(0);
    expect(body.totalPages).toBe(1);
    expect(body.takeoverReady).toBe(true);
  });

  it('attaches and selects the requested pageIndex', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com', title: 'A' },
      { index: 1, url: 'https://b.com', title: 'B' },
    ]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson(
      await handlers.handleBrowserAttach({
        wsEndpoint: 'ws://localhost:1234',
        pageIndex: 1,
      })
    );

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(body.selectedIndex).toBe(1);
    expect(body.currentUrl).toBe('https://b.com');
  });

  it('falls back to page 0 when pageIndex is out of range', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
        pageIndex: 99,
      })
    );

    expect(collector.selectPage).toHaveBeenCalledWith(0);
    expect(body.selectedIndex).toBe(0);
  });

  it('parses string pageIndex correctly', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com', title: 'A' },
      { index: 1, url: 'https://b.com', title: 'B' },
    ]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
        pageIndex: '1',
      })
    );

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(body.selectedIndex).toBe(1);
  });

  it('returns error payload when connect throws', async () => {
    collector.connect.mockRejectedValueOnce(new Error('connection refused'));

    const body = parseJson(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
      })
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('connection refused');
  });

  it('handles empty pages list gracefully', async () => {
    collector.listPages.mockResolvedValueOnce([]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
      })
    );

    expect(body.success).toBe(true);
    expect(body.totalPages).toBe(0);
    expect(body.selectedIndex).toBe(0);
  });
});

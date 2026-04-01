import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { createPageMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import type {
  BrowserAttachResponse,
  BrowserCloseResponse,
  BrowserLaunchResponse,
  BrowserListTabsResponse,
  BrowserSelectTabResponse,
  BrowserStatusResponse,
} from '@tests/shared/common-test-types';
import { readFile, writeFile } from 'fs/promises';

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

interface CollectorMock {
  connect: Mock<(args: any) => Promise<void>>;
  init: Mock<(args: any) => Promise<void>>;
  close: Mock<() => Promise<void>>;
  listPages: Mock<() => Promise<Array<{ index: number; url: string; title: string }>>>;
  listResolvedPages: Mock<() => Promise<Array<{ index: number; url: string; title: string }>>>;
  selectPage: Mock<(index: number) => Promise<void>>;
  getStatus: Mock<() => Promise<{ connected: boolean; pages?: number }>>;
}

interface ConsoleMonitorMock {
  disable: Mock<() => Promise<void>>;
  enable: Mock<() => Promise<void>>;
}

interface TabRegistryMock {
  reconcilePages: Mock<() => any[]>;
  setCurrentByIndex: Mock<(index: number) => { pageId: string; aliases: string[] }>;
  getTabByIndex: Mock<(index: number) => { pageId: string; aliases: string[] }>;
  getContextMeta: Mock<() => { pageId: string; tabIndex: number }>;
}

function createMocks() {
  const collector: CollectorMock = {
    connect: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    listPages: vi.fn(async () => []),
    listResolvedPages: vi.fn(async () => []),
    selectPage: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ connected: true })),
  };

  const consoleMonitor: ConsoleMonitorMock = {
    disable: vi.fn(async () => {}),
    enable: vi.fn(async () => {}),
  };

  const tabRegistry: TabRegistryMock = {
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
  };

  const deps = {
    collector: collector as any,
    pageController: createPageMock() as any,
    consoleMonitor: consoleMonitor as any,
    getActiveDriver: () => 'chrome' as const,
    getCamoufoxManager: () => null,
    getCamoufoxPage: async () => null,
    getTabRegistry: () => tabRegistry as any,
  };

  return { collector, consoleMonitor, tabRegistry, deps };
}

// ─── handleBrowserLaunch ───

describe('BrowserControlHandlers – handleBrowserLaunch', () => {
  let handlers: BrowserControlHandlers;
  let collector: CollectorMock;

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('launches chrome in default mode and returns status', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true, pages: 1 });
    const body = parseJson<BrowserLaunchResponse>(await handlers.handleBrowserLaunch({}));
    expect(collector.init).toHaveBeenCalledWith(undefined);
    expect(body.success).toBe(true);
    expect(body.driver).toBe('chrome');
    expect(body.status.connected).toBe(true);
  });

  it('connects chrome when mode=connect with browserURL', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({
        mode: 'connect',
        browserURL: 'http://127.0.0.1:9222',
      }),
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
    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({
        mode: 'connect',
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
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

  it('connects chrome with a valid autoConnect channel and approval hint', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({
        mode: 'connect',
        channel: 'beta',
      }),
    );

    expect(collector.connect).toHaveBeenCalledWith({
      browserURL: undefined,
      wsEndpoint: undefined,
      autoConnect: undefined,
      userDataDir: undefined,
      channel: 'beta',
    });
    expect(body.success).toBe(true);
    expect(body.mode).toBe('connect');
    expect(body.endpoint).toBe('autoConnect:beta');
    expect(body.autoConnect).toBe(true);
    expect(body.manualApprovalMayBeRequired).toBe(true);
    expect(body.approvalHint).toContain('Chrome 144+');
  });

  it('returns error when chrome connect mode has no endpoint', async () => {
    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({ mode: 'connect' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain(
      'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required',
    );
  });

  it('rejects chrome connect mode with an invalid channel', async () => {
    await expect(
      handlers.handleBrowserLaunch({
        mode: 'connect',
        channel: 'nightly',
      }),
    ).rejects.toThrow('Invalid channel "nightly"');
  });

  it('launches camoufox in default launch mode', async () => {
    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({ driver: 'camoufox' }),
    );
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.mode).toBe('launch');
  });

  it('connects camoufox when mode=connect with wsEndpoint', async () => {
    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({
        driver: 'camoufox',
        mode: 'connect',
        wsEndpoint: 'ws://localhost:1234',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.mode).toBe('connect');
    expect(body.wsEndpoint).toBe('ws://localhost:1234');
  });

  it('returns error when camoufox connect mode has no wsEndpoint', async () => {
    const body = parseJson<BrowserLaunchResponse>(
      await handlers.handleBrowserLaunch({
        driver: 'camoufox',
        mode: 'connect',
      }),
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

  it('falls back to headless mode on Linux display errors and persists .env', async () => {
    const prevFallback = process.env.JSHOOK_FORCE_LINUX_FALLBACK;
    process.env.JSHOOK_FORCE_LINUX_FALLBACK = 'true';

    try {
      collector.init.mockRejectedValueOnce(new Error('Missing X server or $DISPLAY'));
      collector.init.mockResolvedValueOnce(undefined);
      collector.getStatus.mockResolvedValueOnce({ connected: true, pages: 1 });
      vi.mocked(readFile).mockResolvedValueOnce('APP_NAME=jshook\nPUPPETEER_HEADLESS=false\n');
      vi.mocked(writeFile).mockResolvedValueOnce(undefined);

      const body = parseJson<BrowserLaunchResponse>(
        await handlers.handleBrowserLaunch({
          headless: false,
        }),
      );

      expect(collector.init).toHaveBeenNthCalledWith(1, false);
      expect(collector.init).toHaveBeenNthCalledWith(2, true);
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('project'),
        expect.stringContaining('PUPPETEER_HEADLESS=true'),
        'utf-8',
      );
      expect(body.success).toBe(true);
      expect(body.fallback?.applied).toBe(true);
      expect(body.fallback?.newEnv).toBe('PUPPETEER_HEADLESS=true');
    } finally {
      if (prevFallback === undefined) {
        delete process.env.JSHOOK_FORCE_LINUX_FALLBACK;
      } else {
        process.env.JSHOOK_FORCE_LINUX_FALLBACK = prevFallback;
      }
    }
  });
});

// ─── handleBrowserClose ───

describe('BrowserControlHandlers – handleBrowserClose', () => {
  let handlers: BrowserControlHandlers;
  let collector: CollectorMock;

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('closes the browser and returns success', async () => {
    const body = parseJson<BrowserCloseResponse>(await handlers.handleBrowserClose({}));
    expect(collector.close).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.message).toContain('closed');
  });
});

// ─── handleBrowserStatus ───

describe('BrowserControlHandlers – handleBrowserStatus', () => {
  let handlers: BrowserControlHandlers;
  let collector: CollectorMock;

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('returns the collector status with driver field', async () => {
    collector.getStatus.mockResolvedValueOnce({ connected: true, pages: 2 });
    const body = parseJson<BrowserStatusResponse>(await handlers.handleBrowserStatus({}));
    expect(body.driver).toBe('chrome');
    expect(body.connected).toBe(true);
    expect(body.pages).toBe(2);
  });
});

// ─── handleBrowserListTabs ───

describe('BrowserControlHandlers – handleBrowserListTabs', () => {
  let handlers: BrowserControlHandlers;
  let collector: CollectorMock;

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

    const body = parseJson<BrowserListTabsResponse>(await handlers.handleBrowserListTabs({}));

    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.pages).toHaveLength(2);
    // @ts-expect-error — auto-suppressed [TS2532]
    expect(body.pages[0].pageId).toBe('page-0');
    // @ts-expect-error — auto-suppressed [TS2532]
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
    const body = parseJson<BrowserListTabsResponse>(await handlers.handleBrowserListTabs({}));
    expect(body.success).toBe(false);
    expect(body.error).toBe('no browser');
    expect(body.hint).toBeDefined();
  });
});

// ─── handleBrowserSelectTab ───

describe('BrowserControlHandlers – handleBrowserSelectTab', () => {
  let handlers: BrowserControlHandlers;
  let collector: CollectorMock;
  let consoleMonitor: ConsoleMonitorMock;
  let tabRegistry: TabRegistryMock;

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

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ index: 1 }),
    );

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(tabRegistry.setCurrentByIndex).toHaveBeenCalledWith(1);
    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(1);
    expect(body.url).toBe('https://b.com');
    expect(body.title).toBe('B');
    expect(body.activeContextRefreshed).toBe(true);
  });

  it('selects a tab by index without enabling monitoring when no stable page handle exists', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    tabRegistry.setCurrentByIndex.mockReturnValueOnce({
      pageId: undefined as unknown as string,
      aliases: [],
    });

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ index: 0 }),
    );

    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(0);
    expect(body.selectedPageId).toBe(null);
    expect(body.networkMonitoringEnabled).toBe(false);
    expect(body.consoleMonitoringEnabled).toBe(false);
  });

  it('selects a tab by urlPattern', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com/page', title: 'A' },
      { index: 1, url: 'https://b.com/target', title: 'B' },
    ]);

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ urlPattern: 'target' }),
    );

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(1);
  });

  it('selects a tab by titlePattern', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.com', title: 'First' },
      { index: 1, url: 'https://b.com', title: 'Second Tab' },
    ]);

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ titlePattern: 'Second' }),
    );

    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(1);
  });

  it('returns error when no matching tab found', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ urlPattern: 'notfound' }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('No matching tab found');
    expect(body.availablePages).toBeDefined();
  });

  it('returns error payload when selectPage throws', async () => {
    collector.selectPage.mockRejectedValueOnce(new Error('select failed'));

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ index: 0 }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('select failed');
  });

  it('continues with monitoring disabled when consoleMonitor.disable fails', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    consoleMonitor.disable.mockRejectedValueOnce(new Error('disable fail'));

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ index: 0 }),
    );

    expect(body.success).toBe(true);
    expect(consoleMonitor.enable).toHaveBeenCalled();
  });

  it('reports monitoring disabled when consoleMonitor.enable fails', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    consoleMonitor.enable.mockRejectedValueOnce(new Error('enable fail'));

    const body = parseJson<BrowserSelectTabResponse>(
      await handlers.handleBrowserSelectTab({ index: 0 }),
    );

    expect(body.success).toBe(true);
    expect(body.networkMonitoringEnabled).toBe(false);
    expect(body.consoleMonitoringEnabled).toBe(false);
  });
});

// ─── handleBrowserAttach ───

describe('BrowserControlHandlers – handleBrowserAttach', () => {
  let handlers: BrowserControlHandlers;
  let collector: CollectorMock;
  let tabRegistry: TabRegistryMock;

  beforeEach(() => {
    vi.clearAllMocks();
    const m = createMocks();
    collector = m.collector;
    tabRegistry = m.tabRegistry;
    handlers = new BrowserControlHandlers(m.deps);
  });

  it('returns error when no endpoint provided', async () => {
    const body = parseJson<BrowserAttachResponse>(await handlers.handleBrowserAttach({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain(
      'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required',
    );
  });

  it('attaches to browser and selects the default page 0', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://example.com', title: 'Example' },
    ]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({ browserURL: 'http://127.0.0.1:9222' }),
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

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({
        wsEndpoint: 'ws://localhost:1234',
        pageIndex: 1,
      }),
    );

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(body.selectedIndex).toBe(1);
    expect(body.currentUrl).toBe('https://b.com');
  });

  it('falls back to page 0 when pageIndex is out of range', async () => {
    collector.listPages.mockResolvedValueOnce([{ index: 0, url: 'https://a.com', title: 'A' }]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
        pageIndex: 99,
      }),
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

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
        pageIndex: '1',
      }),
    );

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(body.selectedIndex).toBe(1);
  });

  it('returns error payload when connect throws', async () => {
    collector.connect.mockRejectedValueOnce(new Error('connection refused'));

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('connection refused');
  });

  it('attaches without takeover when the selected tab does not expose a stable page handle', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://example.com', title: 'Example' },
    ]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });
    tabRegistry.setCurrentByIndex.mockReturnValueOnce({
      pageId: undefined as unknown as string,
      aliases: [],
    });

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.selectedIndex).toBe(0);
    expect(body.selectedPageId).toBe(null);
    expect(body.takeoverReady).toBe(false);
    expect(body.networkMonitoringEnabled).toBe(false);
    expect(body.consoleMonitoringEnabled).toBe(false);
    expect(body.note).toContain('does not currently expose a stable Puppeteer Page handle');
  });

  it('handles empty pages list gracefully', async () => {
    collector.listPages.mockResolvedValueOnce([]);
    collector.getStatus.mockResolvedValueOnce({ connected: true });

    const body = parseJson<BrowserAttachResponse>(
      await handlers.handleBrowserAttach({
        browserURL: 'http://127.0.0.1:9222',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.totalPages).toBe(0);
    expect(body.selectedIndex).toBe(0);
  });
});

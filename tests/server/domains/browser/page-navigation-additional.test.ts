import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';
import { TabRegistry } from '@modules/browser/TabRegistry';
import { buildTestUrl } from '@tests/shared/test-urls';

type Driver = 'chrome' | 'camoufox';
type NavigationResponse = {
  success: boolean;
  url?: string;
  title?: string;
  driver?: Driver;
  message?: string;
};
type PageNavigationDeps = ConstructorParameters<typeof PageNavigationHandlers>[0];
type PageControllerStub = Pick<
  PageNavigationDeps['pageController'],
  'navigate' | 'reload' | 'goBack' | 'goForward' | 'getURL' | 'getTitle'
> & {
  getPage: () => Promise<unknown>;
};
type ConsoleMonitorStub = Pick<
  PageNavigationDeps['consoleMonitor'],
  'setPlaywrightPage' | 'enable' | 'isNetworkEnabled'
>;
type CamoufoxPageStub = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<any>;
  reload: () => Promise<any>;
  goBack: () => Promise<any>;
  goForward: () => Promise<any>;
  url: () => string;
  title: () => Promise<string>;
};

function mockDeps(driver: Driver = 'chrome') {
  const activeChromePage = {};
  const gotoMock = vi.fn<CamoufoxPageStub['goto']>().mockResolvedValue(undefined);
  const camoufoxReloadMock = vi.fn<CamoufoxPageStub['reload']>().mockResolvedValue(undefined);
  const camoufoxGoBackMock = vi.fn<CamoufoxPageStub['goBack']>().mockResolvedValue(undefined);
  const camoufoxGoForwardMock = vi.fn<CamoufoxPageStub['goForward']>().mockResolvedValue(undefined);
  const camoufoxUrlMock = vi
    .fn<CamoufoxPageStub['url']>()
    .mockReturnValue(buildTestUrl('', { path: 'page' }));
  const camoufoxTitleMock = vi.fn<CamoufoxPageStub['title']>().mockResolvedValue('Example');

  const camoufoxPage = {
    goto: gotoMock,
    reload: camoufoxReloadMock,
    goBack: camoufoxGoBackMock,
    goForward: camoufoxGoForwardMock,
    url: camoufoxUrlMock,
    title: camoufoxTitleMock,
  } satisfies CamoufoxPageStub;

  const navigateMock = vi.fn<PageControllerStub['navigate']>().mockResolvedValue({
    url: buildTestUrl('', { path: 'chrome' }),
    title: 'Chrome Page',
    loadTime: 0,
  });
  const reloadMock = vi.fn<PageControllerStub['reload']>().mockResolvedValue(undefined);
  const goBackMock = vi.fn<PageControllerStub['goBack']>().mockResolvedValue(undefined);
  const goForwardMock = vi.fn<PageControllerStub['goForward']>().mockResolvedValue(undefined);
  const getURLMock = vi
    .fn<PageControllerStub['getURL']>()
    .mockResolvedValue(buildTestUrl('', { path: 'chrome' }));
  const getTitleMock = vi.fn<PageControllerStub['getTitle']>().mockResolvedValue('Chrome Page');

  const pageController = {
    navigate: navigateMock,
    reload: reloadMock,
    goBack: goBackMock,
    goForward: goForwardMock,
    getPage: vi.fn(async () => activeChromePage),
    getURL: getURLMock,
    getTitle: getTitleMock,
  } satisfies PageControllerStub;

  const setPlaywrightPageMock = vi
    .fn<ConsoleMonitorStub['setPlaywrightPage']>()
    .mockImplementation(() => undefined);
  const enableMock = vi.fn<ConsoleMonitorStub['enable']>().mockResolvedValue(undefined);
  const isNetworkEnabledMock = vi
    .fn<ConsoleMonitorStub['isNetworkEnabled']>()
    .mockReturnValue(false);

  const consoleMonitor = {
    setPlaywrightPage: setPlaywrightPageMock,
    enable: enableMock,
    isNetworkEnabled: isNetworkEnabledMock,
  } satisfies ConsoleMonitorStub;

  const tabRegistry = new TabRegistry<object>();
  const deps = {
    pageController: pageController as unknown as PageNavigationDeps['pageController'],
    consoleMonitor: consoleMonitor as unknown as PageNavigationDeps['consoleMonitor'],
    getActiveDriver: vi.fn<PageNavigationDeps['getActiveDriver']>().mockReturnValue(driver),
    getCamoufoxPage: vi.fn<PageNavigationDeps['getCamoufoxPage']>().mockResolvedValue(camoufoxPage),
    getTabRegistry: vi.fn(() => tabRegistry),
  } satisfies PageNavigationDeps;

  return {
    deps,
    camoufoxPage,
    pageController,
    consoleMonitor,
    tabRegistry,
    activeChromePage,
  };
}

describe('PageNavigationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePageNavigate', () => {
    it('navigates via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({ url: 'https://test.com' });
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.url).toBe(buildTestUrl('', { path: 'chrome' }));
      expect(body.title).toBe('Chrome Page');
      expect(pageController.navigate).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
    });

    it('navigates via camoufox driver', async () => {
      const { deps, camoufoxPage, consoleMonitor } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({
        url: 'https://test.com',
        waitUntil: 'networkidle',
        timeout: 5000,
      });
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(camoufoxPage.goto).toHaveBeenCalledWith('https://test.com', {
        waitUntil: 'networkidle',
        timeout: 5000,
      });
      expect(consoleMonitor.setPlaywrightPage).toHaveBeenCalledWith(camoufoxPage);
    });

    it('rejects unsupported waitUntil aliases via camoufox driver', async () => {
      const { deps, camoufoxPage, consoleMonitor } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({
        url: 'https://test.com',
        waitUntil: 'networkidle2',
      });
      const body = parseJson<{ success: boolean; error?: string }>(result);

      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Invalid waitUntil: "networkidle2"/);
      expect(camoufoxPage.goto).not.toHaveBeenCalled();
      expect(consoleMonitor.setPlaywrightPage).not.toHaveBeenCalled();
    });

    it('enables network monitoring on camoufox', async () => {
      const { deps, consoleMonitor } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({
        url: 'https://test.com',
        enableNetworkMonitoring: true,
      });

      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });

    it('enables network monitoring on chrome', async () => {
      const { deps, consoleMonitor } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({
        url: 'https://test.com',
        enableNetworkMonitoring: true,
      });

      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });

    it('passes "commit" waitUntil through to the controller abstraction', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: 'https://test.com', waitUntil: 'commit' });

      expect(pageController.navigate).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'commit' }),
      );
    });

    it('updates tab registry context immediately after chrome navigation', async () => {
      const { deps, tabRegistry, activeChromePage } = mockDeps('chrome');
      const pageId = tabRegistry.registerPage(activeChromePage, {
        index: 4,
        url: buildTestUrl('old', { suffix: 'example', path: '/' }),
        title: 'Old',
      });
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: 'https://test.com' });

      expect(tabRegistry.getContextMeta()).toEqual({
        url: buildTestUrl('', { path: 'chrome' }),
        title: 'Chrome Page',
        tabIndex: 4,
        pageId,
      });
    });

    it('updates tab registry when chrome navigation returns an empty title', async () => {
      const { deps, tabRegistry, activeChromePage, pageController } = mockDeps('chrome');
      pageController.getTitle.mockResolvedValueOnce('');
      const pageId = tabRegistry.registerPage(activeChromePage, {
        index: 2,
        url: buildTestUrl('before', { suffix: 'example', path: 'blank' }),
        title: 'Before',
      });
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: 'https://test.com' });

      expect(tabRegistry.getContextMeta()).toEqual({
        url: buildTestUrl('', { path: 'chrome' }),
        title: '',
        tabIndex: 2,
        pageId,
      });
    });
  });

  describe('handlePageReload', () => {
    it('reloads via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageReload({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.message).toBe('Page reloaded');
      expect(pageController.reload).toHaveBeenCalled();
    });

    it('reloads via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageReload({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(camoufoxPage.reload).toHaveBeenCalled();
    });
  });

  describe('handlePageBack', () => {
    it('goes back via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.url).toBe(buildTestUrl('', { path: 'chrome' }));
      expect(pageController.goBack).toHaveBeenCalled();
    });

    it('goes back via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(body.url).toBe(buildTestUrl('', { path: 'page' }));
      expect(camoufoxPage.goBack).toHaveBeenCalled();
    });
  });

  describe('handlePageForward', () => {
    it('goes forward via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageForward({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.url).toBe(buildTestUrl('', { path: 'chrome' }));
      expect(pageController.goForward).toHaveBeenCalled();
    });

    it('goes forward via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageForward({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(camoufoxPage.goForward).toHaveBeenCalled();
    });
  });
});

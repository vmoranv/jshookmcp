import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';

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
>;
type ConsoleMonitorStub = Pick<
  PageNavigationDeps['consoleMonitor'],
  'setPlaywrightPage' | 'enable' | 'isNetworkEnabled'
>;
type CamoufoxPageStub = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  reload: () => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  goBack: () => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  goForward: () => Promise<any>;
  url: () => string;
  title: () => Promise<string>;
};

function mockDeps(driver: Driver = 'chrome') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const gotoMock = vi.fn<CamoufoxPageStub['goto']>().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const camoufoxReloadMock = vi.fn<CamoufoxPageStub['reload']>().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const camoufoxGoBackMock = vi.fn<CamoufoxPageStub['goBack']>().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const camoufoxGoForwardMock = vi.fn<CamoufoxPageStub['goForward']>().mockResolvedValue(undefined);
  const camoufoxUrlMock = vi
    .fn<CamoufoxPageStub['url']>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockReturnValue('https://example.com/page');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const camoufoxTitleMock = vi.fn<CamoufoxPageStub['title']>().mockResolvedValue('Example');

  const camoufoxPage = {
    goto: gotoMock,
    reload: camoufoxReloadMock,
    goBack: camoufoxGoBackMock,
    goForward: camoufoxGoForwardMock,
    url: camoufoxUrlMock,
    title: camoufoxTitleMock,
  } satisfies CamoufoxPageStub;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const navigateMock = vi.fn<PageControllerStub['navigate']>().mockResolvedValue({
    url: 'https://example.com/chrome',
    title: 'Chrome Page',
    loadTime: 0,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const reloadMock = vi.fn<PageControllerStub['reload']>().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const goBackMock = vi.fn<PageControllerStub['goBack']>().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const goForwardMock = vi.fn<PageControllerStub['goForward']>().mockResolvedValue(undefined);
  const getURLMock = vi
    .fn<PageControllerStub['getURL']>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockResolvedValue('https://example.com/chrome');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const getTitleMock = vi.fn<PageControllerStub['getTitle']>().mockResolvedValue('Chrome Page');

  const pageController = {
    navigate: navigateMock,
    reload: reloadMock,
    goBack: goBackMock,
    goForward: goForwardMock,
    getURL: getURLMock,
    getTitle: getTitleMock,
  } satisfies PageControllerStub;

  const setPlaywrightPageMock = vi
    .fn<ConsoleMonitorStub['setPlaywrightPage']>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation(() => undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const enableMock = vi.fn<ConsoleMonitorStub['enable']>().mockResolvedValue(undefined);
  const isNetworkEnabledMock = vi
    .fn<ConsoleMonitorStub['isNetworkEnabled']>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockReturnValue(false);

  const consoleMonitor = {
    setPlaywrightPage: setPlaywrightPageMock,
    enable: enableMock,
    isNetworkEnabled: isNetworkEnabledMock,
  } satisfies ConsoleMonitorStub;

  const deps = {
    pageController: pageController as unknown as PageNavigationDeps['pageController'],
    consoleMonitor: consoleMonitor as unknown as PageNavigationDeps['consoleMonitor'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    getActiveDriver: vi.fn<PageNavigationDeps['getActiveDriver']>().mockReturnValue(driver),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    getCamoufoxPage: vi.fn<PageNavigationDeps['getCamoufoxPage']>().mockResolvedValue(camoufoxPage),
  } satisfies PageNavigationDeps;

  return {
    deps,
    camoufoxPage,
    pageController,
    consoleMonitor,
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
      expect(body.url).toBe('https://example.com/chrome');
      expect(body.title).toBe('Chrome Page');
      expect(pageController.navigate).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'networkidle2' }),
      );
    });

    it('navigates via camoufox driver', async () => {
      const { deps, camoufoxPage, consoleMonitor } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({
        url: 'https://test.com',
        waitUntil: 'networkidle2',
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

    it('maps "commit" waitUntil to "load" for chrome', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: 'https://test.com', waitUntil: 'commit' });

      expect(pageController.navigate).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'load' }),
      );
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
      expect(body.url).toBe('https://example.com/chrome');
      expect(pageController.goBack).toHaveBeenCalled();
    });

    it('goes back via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const body = parseJson<NavigationResponse>(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(body.url).toBe('https://example.com/page');
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
      expect(body.url).toBe('https://example.com/chrome');
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

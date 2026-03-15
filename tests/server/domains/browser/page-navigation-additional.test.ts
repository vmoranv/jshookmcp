// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function mockDeps(driver: 'chrome' | 'camoufox' = 'chrome') {
  const camoufoxPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://example.com/page'),
    title: vi.fn().mockResolvedValue('Example'),
  };

  const pageController = {
    navigate: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    getURL: vi.fn().mockResolvedValue('https://example.com/chrome'),
    getTitle: vi.fn().mockResolvedValue('Chrome Page'),
  };

  const consoleMonitor = {
    setPlaywrightPage: vi.fn(),
    enable: vi.fn().mockResolvedValue(undefined),
    isNetworkEnabled: vi.fn().mockReturnValue(false),
  };

  return {
    deps: {
      pageController,
      consoleMonitor,
      getActiveDriver: vi.fn().mockReturnValue(driver),
      getCamoufoxPage: vi.fn().mockResolvedValue(camoufoxPage),
    } as any,
    camoufoxPage,
    pageController,
    consoleMonitor,
  };
}

describe('PageNavigationHandlers', () => {
  // --- handlePageNavigate ---

  describe('handlePageNavigate', () => {
    it('navigates via chrome driver', async () => {
      const { deps, pageController, consoleMonitor } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({ url: 'https://test.com' });
      const body = parseJson(result);

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
      const body = parseJson(result);

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

  // --- handlePageReload ---

  describe('handlePageReload', () => {
    it('reloads via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageReload({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.message).toBe('Page reloaded');
      expect(pageController.reload).toHaveBeenCalled();
    });

    it('reloads via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageReload({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(camoufoxPage.reload).toHaveBeenCalled();
    });
  });

  // --- handlePageBack ---

  describe('handlePageBack', () => {
    it('goes back via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.url).toBe('https://example.com/chrome');
      expect(pageController.goBack).toHaveBeenCalled();
    });

    it('goes back via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(body.url).toBe('https://example.com/page');
      expect(camoufoxPage.goBack).toHaveBeenCalled();
    });
  });

  // --- handlePageForward ---

  describe('handlePageForward', () => {
    it('goes forward via chrome driver', async () => {
      const { deps, pageController } = mockDeps('chrome');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageForward({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.url).toBe('https://example.com/chrome');
      expect(pageController.goForward).toHaveBeenCalled();
    });

    it('goes forward via camoufox driver', async () => {
      const { deps, camoufoxPage } = mockDeps('camoufox');
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageForward({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(camoufoxPage.goForward).toHaveBeenCalled();
    });
  });
});

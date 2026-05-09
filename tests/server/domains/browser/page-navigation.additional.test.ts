import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('PageNavigationHandlers', () => {
  // We need to mock the module dependencies before importing
  let PageNavigationHandlers: any;

  function createMockDeps(overrides: Record<string, any> = {}) {
    return {
      pageController: {
        navigate: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        goBack: vi.fn(async () => {}),
        goForward: vi.fn(async () => {}),
        getURL: vi.fn(async () => withPath(TEST_URLS.root, 'current')),
        getTitle: vi.fn(async () => 'Example Page'),
      },
      consoleMonitor: {
        enable: vi.fn(async () => {}),
        setPlaywrightPage: vi.fn(),
        isNetworkEnabled: vi.fn(() => false),
      },
      getActiveDriver: vi.fn(() => 'chrome' as const),
      getCamoufoxPage: vi.fn(async () => ({
        goto: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        goBack: vi.fn(async () => {}),
        goForward: vi.fn(async () => {}),
        url: vi.fn(() => withPath(TEST_URLS.root, 'camoufox')),
        title: vi.fn(async () => 'Camoufox Page'),
      })),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@server/domains/browser/handlers/page-navigation');
    PageNavigationHandlers = mod.PageNavigationHandlers;
  });

  describe('handlePageNavigate - Chrome path', () => {
    it('navigates with default waitUntil normalized to networkidle', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({ url: TEST_URLS.root });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.url).toBe(withPath(TEST_URLS.root, 'current'));
      expect(parsed.title).toBe('Example Page');
      expect(deps.pageController.navigate).toHaveBeenCalledWith(
        TEST_URLS.root,
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
    });

    it('rejects unsupported waitUntil aliases', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({
        url: TEST_URLS.root,
        waitUntil: 'networkidle2',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/Invalid waitUntil: "networkidle2"/);
      expect(deps.pageController.navigate).not.toHaveBeenCalled();
    });

    it('passes commit waitUntil through to the controller abstraction', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: TEST_URLS.root, waitUntil: 'commit' });

      expect(deps.pageController.navigate).toHaveBeenCalledWith(
        TEST_URLS.root,
        expect.objectContaining({ waitUntil: 'commit' }),
      );
    });

    it('passes supported waitUntil values through', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({
        url: TEST_URLS.root,
        waitUntil: 'domcontentloaded',
      });

      expect(deps.pageController.navigate).toHaveBeenCalledWith(
        TEST_URLS.root,
        expect.objectContaining({ waitUntil: 'domcontentloaded' }),
      );
    });

    it('passes timeout to navigate', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: TEST_URLS.root, timeout: 10000 });

      expect(deps.pageController.navigate).toHaveBeenCalledWith(
        TEST_URLS.root,
        expect.objectContaining({ timeout: 10000 }),
      );
    });

    it('enables network monitoring when requested', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({
        url: TEST_URLS.root,
        enableNetworkMonitoring: true,
      });

      expect(deps.consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });

    it('does not enable network monitoring when not requested', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: TEST_URLS.root });

      expect(deps.consoleMonitor.enable).not.toHaveBeenCalled();
    });

    it('reports network monitoring status', async () => {
      const deps = createMockDeps();
      deps.consoleMonitor.isNetworkEnabled = vi.fn(() => true);
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({
        url: TEST_URLS.root,
        enableNetworkMonitoring: true,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.network_monitoring.enabled).toBe(true);
    });
  });

  describe('handlePageNavigate - Camoufox path', () => {
    it('uses camoufox page for navigation', async () => {
      const camoufoxPage = {
        goto: vi.fn(async () => {}),
        url: vi.fn(() => withPath(TEST_URLS.root, 'cam')),
        title: vi.fn(async () => 'Cam Title'),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({ url: TEST_URLS.root });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.driver).toBe('camoufox');
      expect(parsed.url).toBe(withPath(TEST_URLS.root, 'cam'));
      expect(parsed.title).toBe('Cam Title');
      expect(camoufoxPage.goto).toHaveBeenCalled();
    });

    it('rejects unsupported waitUntil aliases for camoufox', async () => {
      const camoufoxPage = {
        goto: vi.fn(async () => {}),
        url: vi.fn(() => TEST_URLS.root),
        title: vi.fn(async () => 'Title'),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageNavigate({
        url: TEST_URLS.root,
        waitUntil: 'networkidle2',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/Invalid waitUntil: "networkidle2"/);
      expect(camoufoxPage.goto).not.toHaveBeenCalled();
    });

    it('sets playwright page on console monitor', async () => {
      const camoufoxPage = {
        goto: vi.fn(async () => {}),
        url: vi.fn(() => TEST_URLS.root),
        title: vi.fn(async () => 'Title'),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({ url: TEST_URLS.root });

      expect(deps.consoleMonitor.setPlaywrightPage).toHaveBeenCalledWith(camoufoxPage);
    });

    it('enables network monitoring on camoufox path when requested', async () => {
      const camoufoxPage = {
        goto: vi.fn(async () => {}),
        url: vi.fn(() => TEST_URLS.root),
        title: vi.fn(async () => 'Title'),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      await handler.handlePageNavigate({
        url: TEST_URLS.root,
        enableNetworkMonitoring: true,
      });

      expect(deps.consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });
  });

  describe('handlePageReload', () => {
    it('reloads Chrome page', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageReload({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Page reloaded');
      expect(deps.pageController.reload).toHaveBeenCalled();
    });

    it('reloads Camoufox page', async () => {
      const camoufoxPage = {
        reload: vi.fn(async () => {}),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageReload({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.driver).toBe('camoufox');
      expect(camoufoxPage.reload).toHaveBeenCalled();
    });
  });

  describe('handlePageBack', () => {
    it('goes back in Chrome', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.url).toBe(withPath(TEST_URLS.root, 'current'));
      expect(deps.pageController.goBack).toHaveBeenCalled();
    });

    it('goes back in Camoufox', async () => {
      const camoufoxPage = {
        goBack: vi.fn(async () => {}),
        url: vi.fn(() => withPath(TEST_URLS.root, 'previous')),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageBack({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.driver).toBe('camoufox');
      expect(parsed.url).toBe(withPath(TEST_URLS.root, 'previous'));
      expect(camoufoxPage.goBack).toHaveBeenCalled();
    });
  });

  describe('handlePageForward', () => {
    it('goes forward in Chrome', async () => {
      const deps = createMockDeps();
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageForward({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.url).toBe(withPath(TEST_URLS.root, 'current'));
      expect(deps.pageController.goForward).toHaveBeenCalled();
    });

    it('goes forward in Camoufox', async () => {
      const camoufoxPage = {
        goForward: vi.fn(async () => {}),
        url: vi.fn(() => withPath(TEST_URLS.root, 'next')),
      };
      const deps = createMockDeps({
        getActiveDriver: vi.fn(() => 'camoufox'),
        getCamoufoxPage: vi.fn(async () => camoufoxPage),
      });
      const handler = new PageNavigationHandlers(deps);

      const result = await handler.handlePageForward({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.driver).toBe('camoufox');
      expect(parsed.url).toBe(withPath(TEST_URLS.root, 'next'));
      expect(camoufoxPage.goForward).toHaveBeenCalled();
    });
  });
});

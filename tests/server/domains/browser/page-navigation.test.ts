import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';
import { TabRegistry } from '@modules/browser/TabRegistry';
import { buildTestUrl } from '@tests/shared/test-urls';

describe('PageNavigationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not claim captcha_detected for chrome navigation without running detection', async () => {
    const activePage = {};
    const tabRegistry = new TabRegistry<object>();
    const pageId = tabRegistry.registerPage(activePage, {
      index: 0,
      url: buildTestUrl('before', { suffix: 'example', path: '/' }),
      title: 'Before',
    });

    const pageController = {
      navigate: vi.fn(async () => ({
        url: buildTestUrl('target', { suffix: 'example', path: '/' }),
        title: 'Target',
        loadTime: 12,
      })),
      getPage: vi.fn(async () => activePage),
      getURL: vi.fn(async () => buildTestUrl('target', { suffix: 'example', path: '/' })),
      getTitle: vi.fn(async () => 'Target'),
    } as any;

    const consoleMonitor = {
      enable: vi.fn(async () => {}),
      isNetworkEnabled: vi.fn(() => false),
      setPlaywrightPage: vi.fn(),
    } as any;

    const handlers = new PageNavigationHandlers({
      pageController,
      consoleMonitor,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
      getTabRegistry: () => tabRegistry,
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageNavigate({
        url: buildTestUrl('target', { suffix: 'example', path: '/' }),
      }),
    );

    expect(body.success).toBe(true);
    expect(body.url).toBe(buildTestUrl('target', { suffix: 'example', path: '/' }));
    expect(body).not.toHaveProperty('captcha_detected');
    expect(tabRegistry.getContextMeta()).toEqual({
      url: buildTestUrl('target', { suffix: 'example', path: '/' }),
      title: 'Target',
      tabIndex: 0,
      pageId,
    });
  });

  it('does not claim captcha_detected for camoufox navigation without running detection', async () => {
    const pageHandle = {};
    const tabRegistry = new TabRegistry<object>();
    const pageId = tabRegistry.registerPage(pageHandle, {
      index: 1,
      url: buildTestUrl('before', { suffix: 'example', path: 'camoufox' }),
      title: 'Before Camoufox',
    });

    const page = {
      goto: vi.fn(async () => {}),
      url: vi.fn(() => buildTestUrl('target', { suffix: 'example', path: '/' })),
      title: vi.fn(async () => 'Camoufox Target'),
    };

    const consoleMonitor = {
      enable: vi.fn(async () => {}),
      isNetworkEnabled: vi.fn(() => false),
      setPlaywrightPage: vi.fn(),
    } as any;

    const handlers = new PageNavigationHandlers({
      pageController: {} as any,
      consoleMonitor,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => Object.assign(pageHandle, page),
      getTabRegistry: () => tabRegistry,
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageNavigate({
        url: buildTestUrl('target', { suffix: 'example', path: '/' }),
      }),
    );

    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.url).toBe(buildTestUrl('target', { suffix: 'example', path: '/' }));
    expect(body).not.toHaveProperty('captcha_detected');
    expect(tabRegistry.getContextMeta()).toEqual({
      url: buildTestUrl('target', { suffix: 'example', path: '/' }),
      title: 'Camoufox Target',
      tabIndex: 1,
      pageId,
    });
  });

  it('refreshes camoufox tab context even when title is empty', async () => {
    const pageHandle = {};
    const tabRegistry = new TabRegistry<object>();
    const pageId = tabRegistry.registerPage(pageHandle, {
      index: 3,
      url: buildTestUrl('before', { suffix: 'example', path: 'empty-title' }),
      title: 'Before Empty',
    });

    const page = {
      goto: vi.fn(async () => {}),
      url: vi.fn(() => buildTestUrl('target', { suffix: 'example', path: 'blank' })),
      title: vi.fn(async () => ''),
    };

    const consoleMonitor = {
      enable: vi.fn(async () => {}),
      isNetworkEnabled: vi.fn(() => false),
      setPlaywrightPage: vi.fn(),
    } as any;

    const handlers = new PageNavigationHandlers({
      pageController: {} as any,
      consoleMonitor,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => Object.assign(pageHandle, page),
      getTabRegistry: () => tabRegistry,
    });

    await handlers.handlePageNavigate({
      url: buildTestUrl('target', { suffix: 'example', path: 'blank' }),
    });

    expect(tabRegistry.getContextMeta()).toEqual({
      url: buildTestUrl('target', { suffix: 'example', path: 'blank' }),
      title: '',
      tabIndex: 3,
      pageId,
    });
  });
});

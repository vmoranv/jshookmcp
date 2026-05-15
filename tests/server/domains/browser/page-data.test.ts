import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageDataHandlers } from '@server/domains/browser/handlers/page-data';

describe('PageDataHandlers', () => {
  let pageController: any;
  let handlers: PageDataHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = {
      listFrames: vi.fn(),
      getPerformanceMetrics: vi.fn(),
      setCookies: vi.fn(),
      getCookies: vi.fn(),
      clearCookies: vi.fn(),
      setViewport: vi.fn(),
      emulateDevice: vi.fn(),
      getLocalStorage: vi.fn(),
      setLocalStorage: vi.fn(),
    };
    handlers = new PageDataHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
    });
  });

  it('lists frames and returns a count', async () => {
    const mainFrameUrl = TEST_URLS.root;
    const childFrameUrl = withPath(TEST_URLS.cdn, 'embed');

    pageController.listFrames.mockResolvedValue([
      {
        frameId: 'main',
        url: mainFrameUrl,
        name: '',
        parentFrameId: null,
        parentUrl: null,
        isMainFrame: true,
        crossOrigin: false,
      },
      {
        frameId: 'child',
        url: childFrameUrl,
        name: 'embed',
        parentFrameId: 'main',
        parentUrl: mainFrameUrl,
        isMainFrame: false,
        crossOrigin: true,
      },
    ]);

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageListFrames({}));

    expect(pageController.listFrames).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      count: 2,
      frames: [
        {
          frameId: 'main',
          url: mainFrameUrl,
          name: '',
          parentFrameId: null,
          parentUrl: null,
          isMainFrame: true,
          crossOrigin: false,
        },
        {
          frameId: 'child',
          url: childFrameUrl,
          name: 'embed',
          parentFrameId: 'main',
          parentUrl: mainFrameUrl,
          isMainFrame: false,
          crossOrigin: true,
        },
      ],
    });
  });

  it('sets cookies and returns the cookie count message', async () => {
    const cookies = [
      { name: 'session', value: 'abc' },
      { name: 'theme', value: 'dark' },
    ];
    pageController.setCookies.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageSetCookies({ cookies }));

    expect(pageController.setCookies).toHaveBeenCalledWith(cookies);
    expect(body).toEqual({
      success: true,
      message: 'Set 2 cookies',
    });
  });

  it('returns cookies with a count', async () => {
    pageController.getCookies.mockResolvedValue([
      { name: 'session', value: 'abc' },
      { name: 'theme', value: 'dark' },
    ]);

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageGetCookies({}));

    expect(pageController.getCookies).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      count: 2,
      cookies: [
        { name: 'session', value: 'abc' },
        { name: 'theme', value: 'dark' },
      ],
    });
  });

  it('clears cookies and returns success', async () => {
    pageController.clearCookies.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageClearCookies({}));

    expect(pageController.clearCookies).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Cookies cleared',
    });
  });

  it('sets viewport dimensions and returns the applied viewport', async () => {
    pageController.setViewport.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageSetViewport({ width: 1440, height: 900 }),
    );

    expect(pageController.setViewport).toHaveBeenCalledWith(1440, 900);
    expect(body).toEqual({
      success: true,
      viewport: { width: 1440, height: 900 },
    });
  });

  it('emulates a device and returns the selected device', async () => {
    pageController.emulateDevice.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageEmulateDevice({ device: 'iPhone' }),
    );

    expect(pageController.emulateDevice).toHaveBeenCalledWith('iPhone');
    expect(body).toEqual({
      success: true,
      device: 'iPhone',
    });
  });

  it('returns local storage entries with a count', async () => {
    pageController.getLocalStorage.mockResolvedValue({
      token: 'abc',
      theme: 'dark',
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageGetLocalStorage({}));

    expect(pageController.getLocalStorage).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      count: 2,
      storage: {
        token: 'abc',
        theme: 'dark',
      },
    });
  });

  it('sets a local storage entry and returns the key', async () => {
    pageController.setLocalStorage.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageSetLocalStorage({ key: 'token', value: 'abc123' }),
    );

    expect(pageController.setLocalStorage).toHaveBeenCalledWith('token', 'abc123');
    expect(body).toEqual({
      success: true,
      key: 'token',
    });
  });

  it('returns failure response when setting cookies fails', async () => {
    pageController.setCookies.mockRejectedValue(new Error('set cookies failed'));

    const response = await handlers.handlePageSetCookies({
      cookies: [{ name: 'session', value: 'abc' }],
    });
    const body = parseJson<BrowserStatusResponse>(response);
    expect(body.success).toBe(false);
    expect(body.message).toContain('set cookies failed');
  });

  it('lists frames via camoufox path when driver is camoufox', async () => {
    const mainFrame = {
      url: () => TEST_URLS.root,
      name: () => '',
      parentFrame: () => null,
    };
    const childFrame = {
      url: () => withPath(TEST_URLS.cdn, 'embed'),
      name: () => 'embed',
      parentFrame: () => mainFrame,
    };
    const camoufoxPage = {
      mainFrame: () => mainFrame,
      frames: () => [mainFrame, childFrame],
    };

    const camoufoxHandlers = new PageDataHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: vi.fn().mockResolvedValue(camoufoxPage),
    });

    const body = parseJson<BrowserStatusResponse>(await camoufoxHandlers.handlePageListFrames({}));

    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.frames[0]).toEqual(
      expect.objectContaining({
        frameId: 'frame-0',
        isMainFrame: true,
        crossOrigin: false,
      }),
    );
    expect(body.frames[1]).toEqual(
      expect.objectContaining({
        frameId: 'frame-1',
        crossOrigin: true,
        parentFrameId: 'frame-0',
      }),
    );
  });

  it('handles camoufox frame with no parent and no name', async () => {
    const mainFrame = {
      url: () => 'invalid-url',
      name: () => '',
      parentFrame: () => null,
    };
    const orphanFrame = {
      url: () => 'also-bad',
      name: () => '',
      parentFrame: () => null,
    };
    const camoufoxPage = {
      mainFrame: () => mainFrame,
      frames: () => [mainFrame, orphanFrame],
    };

    const camoufoxHandlers = new PageDataHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: vi.fn().mockResolvedValue(camoufoxPage),
    });

    const body = parseJson<BrowserStatusResponse>(await camoufoxHandlers.handlePageListFrames({}));

    expect(body.frames[1].parentFrameId).toBeNull();
    expect(body.frames[1].parentUrl).toBeNull();
    expect(body.frames[1].name).toBe('');
    expect(body.frames[1].crossOrigin).toBe(false);
  });

  it('returns failure when camoufox getCamoufoxPage is missing', async () => {
    const camoufoxHandlers = new PageDataHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
    });

    const response = await camoufoxHandlers.handlePageListFrames({});
    const body = parseJson<BrowserStatusResponse>(response);
    expect(body.success).toBe(false);
  });

  it('returns failure when listFrames throws', async () => {
    pageController.listFrames.mockRejectedValue(new Error('no page'));

    const response = await handlers.handlePageListFrames({});
    const body = parseJson<BrowserStatusResponse>(response);
    expect(body.success).toBe(false);
    expect(body.message).toContain('no page');
  });

  it('returns page content as html', async () => {
    pageController.getContent = vi.fn().mockResolvedValue('<html><body>Hello</body></html>');

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetContent({}));
    expect(body.success).toBe(true);
    expect(body.html).toContain('Hello');
  });

  it('returns page title', async () => {
    pageController.getTitle = vi.fn().mockResolvedValue('Test Page');

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetTitle({}));
    expect(body.success).toBe(true);
    expect(body.title).toBe('Test Page');
  });

  it('returns page url', async () => {
    pageController.getURL = vi.fn().mockResolvedValue(TEST_URLS.root);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetUrl({}));
    expect(body.success).toBe(true);
    expect(body.url).toBe(TEST_URLS.root);
  });

  it('returns page text for a selector', async () => {
    pageController.evaluate = vi.fn().mockResolvedValue('Hello World');

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetText({ selector: '#content' }),
    );
    expect(body.success).toBe(true);
    expect(body.text).toBe('Hello World');
    expect(body.selector).toBe('#content');
  });

  it('returns outer html for a selector', async () => {
    pageController.evaluate = vi.fn().mockResolvedValue('<div id="x">hi</div>');

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetOuterHtml({ selector: '#x' }),
    );
    expect(body.success).toBe(true);
    expect(body.html).toContain('<div');
  });

  it('returns scroll position', async () => {
    pageController.evaluate = vi.fn().mockResolvedValue({
      scrollX: 10,
      scrollY: 20,
      maxScrollX: 500,
      maxScrollY: 800,
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetScrollPosition({}));
    expect(body.success).toBe(true);
    expect(body.scrollX).toBe(10);
    expect(body.maxScrollY).toBe(800);
  });

  it('returns failure when getContent fails', async () => {
    pageController.getContent = vi.fn().mockRejectedValue(new Error('no page'));

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetContent({}));
    expect(body.success).toBe(false);
  });

  it('returns failure when getTitle fails', async () => {
    pageController.getTitle = vi.fn().mockRejectedValue(new Error('err'));

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetTitle({}));
    expect(body.success).toBe(false);
  });

  it('returns failure when getUrl fails', async () => {
    pageController.getURL = vi.fn().mockRejectedValue(new Error('err'));

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetUrl({}));
    expect(body.success).toBe(false);
  });

  it('returns failure when emulateDevice fails', async () => {
    pageController.emulateDevice.mockRejectedValue(new Error('device error'));

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageEmulateDevice({ device: 'iPhone' }),
    );
    expect(body.success).toBe(false);
  });

  it('returns failure when getLocalStorage fails', async () => {
    pageController.getLocalStorage.mockRejectedValue(new Error('storage error'));

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageGetLocalStorage({}));
    expect(body.success).toBe(false);
  });

  it('returns failure when setLocalStorage fails', async () => {
    pageController.setLocalStorage.mockRejectedValue(new Error('write error'));

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageSetLocalStorage({ key: 'k', value: 'v' }),
    );
    expect(body.success).toBe(false);
  });
});

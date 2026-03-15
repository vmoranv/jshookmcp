import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageDataHandlers } from '@server/domains/browser/handlers/page-data';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('PageDataHandlers', () => {
  let pageController: any;
  let handlers: PageDataHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = {
      getPerformanceMetrics: vi.fn(),
      setCookies: vi.fn(),
      getCookies: vi.fn(),
      clearCookies: vi.fn(),
      setViewport: vi.fn(),
      emulateDevice: vi.fn(),
      getLocalStorage: vi.fn(),
      setLocalStorage: vi.fn(),
      getAllLinks: vi.fn(),
    };
    handlers = new PageDataHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('returns performance metrics', async () => {
    pageController.getPerformanceMetrics.mockResolvedValue({
      domContentLoaded: 120,
      loadEvent: 180,
    });

    const body = parseJson(await handlers.handlePageGetPerformance({}));

    expect(pageController.getPerformanceMetrics).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      metrics: {
        domContentLoaded: 120,
        loadEvent: 180,
      },
    });
  });

  it('sets cookies and returns the cookie count message', async () => {
    const cookies = [
      { name: 'session', value: 'abc' },
      { name: 'theme', value: 'dark' },
    ];
    pageController.setCookies.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handlePageSetCookies({ cookies }));

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

    const body = parseJson(await handlers.handlePageGetCookies({}));

    expect(pageController.getCookies).toHaveBeenCalledOnce();
    expect(body).toEqual({
      count: 2,
      cookies: [
        { name: 'session', value: 'abc' },
        { name: 'theme', value: 'dark' },
      ],
    });
  });

  it('clears cookies and returns success', async () => {
    pageController.clearCookies.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handlePageClearCookies({}));

    expect(pageController.clearCookies).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Cookies cleared',
    });
  });

  it('sets viewport dimensions and returns the applied viewport', async () => {
    pageController.setViewport.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handlePageSetViewport({ width: 1440, height: 900 }));

    expect(pageController.setViewport).toHaveBeenCalledWith(1440, 900);
    expect(body).toEqual({
      success: true,
      viewport: { width: 1440, height: 900 },
    });
  });

  it('emulates a device and returns the selected device', async () => {
    pageController.emulateDevice.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handlePageEmulateDevice({ device: 'iPhone' }));

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

    const body = parseJson(await handlers.handlePageGetLocalStorage({}));

    expect(pageController.getLocalStorage).toHaveBeenCalledOnce();
    expect(body).toEqual({
      count: 2,
      storage: {
        token: 'abc',
        theme: 'dark',
      },
    });
  });

  it('sets a local storage entry and returns the key', async () => {
    pageController.setLocalStorage.mockResolvedValue(undefined);

    const body = parseJson(
      await handlers.handlePageSetLocalStorage({ key: 'token', value: 'abc123' })
    );

    expect(pageController.setLocalStorage).toHaveBeenCalledWith('token', 'abc123');
    expect(body).toEqual({
      success: true,
      key: 'token',
    });
  });

  it('returns all links with a count', async () => {
    pageController.getAllLinks.mockResolvedValue([
      { text: 'Docs', href: 'https://vmoranv.github.io/jshookmcp/docs' },
      { text: 'GitHub', href: 'https://github.com/vmoranv/jshookmcp' },
    ]);

    const body = parseJson(await handlers.handlePageGetAllLinks({}));

    expect(pageController.getAllLinks).toHaveBeenCalledOnce();
    expect(body).toEqual({
      count: 2,
      links: [
        { text: 'Docs', href: 'https://vmoranv.github.io/jshookmcp/docs' },
        { text: 'GitHub', href: 'https://github.com/vmoranv/jshookmcp' },
      ],
    });
  });

  it('rethrows page controller errors when setting cookies', async () => {
    pageController.setCookies.mockRejectedValue(new Error('set cookies failed'));

    await expect(
      handlers.handlePageSetCookies({ cookies: [{ name: 'session', value: 'abc' }] })
    ).rejects.toThrow('set cookies failed');
  });
});

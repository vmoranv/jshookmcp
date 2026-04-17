import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { PageController } from '@modules/collector/PageController';

type AnyRecord = Record<string, any>;

function withStubbedGlobals<T>(globals: AnyRecord, run: () => Promise<T> | T): Promise<T> | T {
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const restore = () => {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as AnyRecord)[key];
      }
    }
  };

  try {
    const result = run();
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

describe('PageController', () => {
  let page: any;
  let collector: any;
  let controller: PageController;

  beforeEach(() => {
    page = {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('Demo'),
      url: vi.fn().mockReturnValue('https://vmoranv.github.io/jshookmcp/final'),
      content: vi.fn().mockResolvedValue('<html></html>'),
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
      hover: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      goBack: vi.fn().mockResolvedValue(undefined),
      goForward: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockResolvedValue(undefined),
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      setCookie: vi.fn().mockResolvedValue(undefined),
      cookies: vi.fn().mockResolvedValue([{ name: 'sid', value: '1' }]),
      deleteCookie: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('shot')),
      keyboard: {
        press: vi.fn().mockResolvedValue(undefined),
      },
      $: vi.fn().mockResolvedValue(null),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockImplementation(() => page),
    };
    collector = { getActivePage: vi.fn().mockResolvedValue(page) };
    controller = new PageController(collector);
  });

  it('navigates with defaults and returns page metadata', async () => {
    const result = await controller.navigate('https://vmoranv.github.io/jshookmcp');

    expect(page.goto).toHaveBeenCalledWith('https://vmoranv.github.io/jshookmcp', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    expect(result.url).toBe('https://vmoranv.github.io/jshookmcp/final');
    expect(result.title).toBe('Demo');
  });

  it('click uses default click options', async () => {
    await controller.click('#submit');

    expect(page.click).toHaveBeenCalledWith('#submit', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
  });

  it('waitForSelector returns success payload when element appears', async () => {
    page.evaluate.mockResolvedValue({ tagName: 'button', id: 'submit' });

    const result = await controller.waitForSelector('#submit', 1000);
    expect(result.success).toBe(true);
    expect(result.element?.id).toBe('submit');
  });

  it('waitForSelector returns failure payload on timeout', async () => {
    page.waitForSelector.mockRejectedValue(new Error('timeout'));

    const result = await controller.waitForSelector('#missing', 10);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Timeout waiting for selector');
  });

  it('waitForSelector returns success even when the DOM query returns null', async () => {
    page.evaluate.mockResolvedValue(null);

    const result = await controller.waitForSelector('#missing', 1000);
    expect(result.success).toBe(true);
    expect(result.element).toBeNull();
  });

  it('emulateDevice resolves aliases and applies device settings', async () => {
    const resolved = await controller.emulateDevice('iPhone 13 Pro');

    expect(resolved).toBe('iPhone');
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.setUserAgent).toHaveBeenCalled();
  });

  describe('resolveFrame', () => {
    it('returns the main page if no frame options are provided', async () => {
      // We expose resolveFrame via a cast to any to test the private implementation
      const resolved = await (controller as any).resolveFrame(page);
      expect(resolved).toBe(page);
    });

    it('returns the main page if options are empty', async () => {
      const resolved = await (controller as any).resolveFrame(page, {});
      expect(resolved).toBe(page);
    });

    it('resolves frame by frameUrl', async () => {
      const mockFrame1 = { url: () => 'https://example.com/ad' };
      const mockFrame2 = { url: () => 'https://sandbox.local/game' };
      page.frames.mockReturnValue([mockFrame1, mockFrame2]);

      const resolved = await (controller as any).resolveFrame(page, { frameUrl: 'sandbox.local' });
      expect(resolved).toBe(mockFrame2);
    });

    it('throws error if frameUrl not found', async () => {
      page.frames.mockReturnValue([{ url: () => 'https://example.com/ad' }]);

      await expect((controller as any).resolveFrame(page, { frameUrl: 'missing' })).rejects.toThrow(
        'No frame matching URL substring "missing"',
      );
    });

    it('resolves frame by frameSelector', async () => {
      const mockFrame = { url: () => 'https://sandbox.local/iframe' };
      const mockElementHandle = {
        contentFrame: vi.fn().mockResolvedValue(mockFrame),
      };
      page.$.mockResolvedValue(mockElementHandle);

      const resolved = await (controller as any).resolveFrame(page, {
        frameSelector: 'iframe#game',
      });
      expect(page.$).toHaveBeenCalledWith('iframe#game');
      expect(resolved).toBe(mockFrame);
    });

    it('throws error if frameSelector element not found', async () => {
      page.$.mockResolvedValue(null);
      await expect(
        (controller as any).resolveFrame(page, { frameSelector: 'iframe#missing' }),
      ).rejects.toThrow('No element found for iframe selector:');
    });

    it('throws error if element found by frameSelector has no contentFrame', async () => {
      page.$.mockResolvedValue({ contentFrame: vi.fn().mockResolvedValue(null) });
      await expect(
        (controller as any).resolveFrame(page, { frameSelector: 'div#not-an-iframe' }),
      ).rejects.toThrow('exists but has no content frame');
    });
  });

  it('emulateDevice rejects unsupported device names', async () => {
    await expect(controller.emulateDevice('BlackBerry Classic')).rejects.toThrow(
      'Unsupported device',
    );
  });

  it('uploadFile throws when file input element is missing', async () => {
    page.$.mockResolvedValue(null);

    await expect(controller.uploadFile('#upload', 'D:/tmp/a.txt')).rejects.toThrow(
      'File input not found',
    );
  });

  it('forwards common browser actions and reads page state helpers', async () => {
    page.evaluate.mockResolvedValue(undefined);

    await controller.reload();
    await controller.goBack();
    await controller.goForward();
    await controller.type('#name', 'Alice', { delay: 5 });
    await controller.select('#role', ['admin', 'beta']);
    await controller.hover('#help');
    await controller.scroll({ x: 10, y: 20 });
    await controller.waitForNavigation(1000);
    await controller.waitForNetworkIdle(2000);
    await controller.pressKey('Enter');
    await controller.setCookies([{ name: 'sid', value: 'abc', domain: 'example.com' }]);
    await controller.clearCookies();
    await controller.setViewport(1280, 720);

    expect(page.reload).toHaveBeenCalledWith({ waitUntil: 'networkidle2', timeout: 30000 });
    expect(page.goBack).toHaveBeenCalledTimes(1);
    expect(page.goForward).toHaveBeenCalledTimes(1);
    expect(page.type).toHaveBeenCalledWith('#name', 'Alice', { delay: 5 });
    expect(page.select).toHaveBeenCalledWith('#role', 'admin', 'beta');
    expect(page.hover).toHaveBeenCalledWith('#help');
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { x: 10, y: 20 });
    expect(page.waitForNavigation).toHaveBeenCalledWith({
      waitUntil: 'networkidle2',
      timeout: 1000,
    });
    expect(page.waitForNetworkIdle).toHaveBeenCalledWith({ timeout: 2000 });
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    expect(page.setCookie).toHaveBeenCalledWith({
      name: 'sid',
      value: 'abc',
      domain: 'example.com',
    });
    expect(page.deleteCookie).toHaveBeenCalledWith({ name: 'sid', value: '1' });
    expect(page.setViewport).toHaveBeenCalledWith({ width: 1280, height: 720 });
  });

  it('reads URL/title/content and supports screenshots plus Android aliases', async () => {
    const screenshot = await controller.screenshot({
      clip: { x: 1, y: 2, width: 3, height: 4 },
      path: 'tmp/shot.png',
    });

    expect(screenshot).toEqual(Buffer.from('shot'));
    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        clip: { x: 1, y: 2, width: 3, height: 4 },
        fullPage: false,
        path: 'tmp/shot.png',
        type: 'png',
      }),
    );
    expect(await controller.getURL()).toBe('https://vmoranv.github.io/jshookmcp/final');
    expect(await controller.getTitle()).toBe('Demo');
    expect(await controller.getContent()).toBe('<html></html>');
    expect(await controller.emulateDevice('Pixel 8')).toBe('Android');
    expect(page.setViewport).toHaveBeenCalledWith({
      width: 360,
      height: 640,
      isMobile: true,
    });
  });

  it('reads storage and link helpers', async () => {
    page.evaluate
      .mockResolvedValueOnce({
        foo: 'bar',
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ text: 'Home', href: 'https://example.com' }]);

    expect(await controller.getLocalStorage()).toEqual({ foo: 'bar' });
    await controller.setLocalStorage('theme', 'dark');
    await controller.clearLocalStorage();
    expect(await controller.getAllLinks()).toEqual([{ text: 'Home', href: 'https://example.com' }]);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('returns the active cookies list and active page handle', async () => {
    expect(await controller.getCookies()).toEqual([{ name: 'sid', value: '1' }]);
    expect(await controller.getPage()).toBe(page);
  });

  it('evaluates inside a resolved frame with the same CDP health check as top-level evaluate', async () => {
    const frame = {
      evaluate: vi.fn().mockResolvedValue('frame-title'),
      url: vi.fn().mockReturnValue('https://sandbox.local/frame'),
    };
    page.frames.mockReturnValue([frame]);
    page.createCDPSession = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
    });

    const result = await controller.evaluate<string>('document.title', {
      frameUrl: 'sandbox.local',
    });

    expect(result).toBe('frame-title');
    expect(frame.evaluate).toHaveBeenCalledWith('document.title');
    expect(page.createCDPSession).toHaveBeenCalledTimes(1);
  });

  it('times out frame evaluation after 30000ms', async () => {
    vi.useFakeTimers();
    try {
      const frame = {
        evaluate: vi.fn(() => new Promise(() => {})),
        url: vi.fn().mockReturnValue('https://sandbox.local/frame'),
      };
      page.frames.mockReturnValue([frame]);
      page.createCDPSession = vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({}),
        detach: vi.fn().mockResolvedValue(undefined),
      });

      const evaluation = controller.evaluate('document.title', { frameUrl: 'sandbox.local' });
      const rejection = expect(evaluation).rejects.toThrow('page.evaluate timed out after 30000ms');
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('executes browser-side callbacks for selector, metrics, storage, links, script injection, and evaluate helpers', async () => {
    const button = {
      tagName: 'BUTTON',
      id: 'submit',
      className: 'primary',
      textContent: 'Submit',
      attributes: [
        { name: 'id', value: 'submit' },
        { name: 'class', value: 'primary' },
      ],
    };
    const links = [
      {
        textContent: 'Home',
        href: 'https://example.com',
      },
    ];
    const headChildren: any[] = [];
    const localStore = new Map<string, string>([['theme', 'dark']]);

    const documentLike = {
      head: {
        appendChild: vi.fn((node: any) => {
          headChildren.push(node);
          return node;
        }),
      },
      querySelector: vi.fn((selector: string) => {
        if (selector === '#submit') {
          return button;
        }
        if (selector === 'a[href]') {
          return null;
        }
        return null;
      }),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === 'a[href]') {
          return links;
        }
        return [];
      }),
      createElement: vi.fn(() => ({ textContent: '' })),
    };
    const performanceLike = {
      getEntriesByType: vi.fn((type: string) => {
        if (type === 'navigation') {
          return [
            {
              domContentLoadedEventEnd: 9,
              domContentLoadedEventStart: 3,
              loadEventEnd: 25,
              loadEventStart: 10,
              domainLookupEnd: 2,
              domainLookupStart: 1,
              connectEnd: 4,
              connectStart: 2,
              responseStart: 8,
              requestStart: 5,
              responseEnd: 12,
              fetchStart: 1,
            },
          ];
        }
        if (type === 'resource') {
          return [{}, {}];
        }
        return [];
      }),
    };
    const localStorageLike = {
      get length() {
        return localStore.size;
      },
      key: vi.fn((index: number) => Array.from(localStore.keys())[index] ?? null),
      getItem: vi.fn((key: string) => localStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStore.set(key, value);
      }),
      clear: vi.fn(() => {
        localStore.clear();
      }),
    };
    const windowLike = {
      scrollTo: vi.fn(),
    };
    page.evaluate = vi.fn(async (pageFunction: any, ...args: any[]) => {
      if (typeof pageFunction === 'string') {
        // eslint-disable-next-line no-eval
        return eval(pageFunction);
      }

      return withStubbedGlobals(
        {
          document: documentLike,
          performance: performanceLike,
          localStorage: localStorageLike,
          window: windowLike,
        },
        () => pageFunction(...args),
      );
    });
    page.createCDPSession = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
    });

    expect(await controller.waitForSelector('#submit', 1000)).toEqual({
      success: true,
      element: {
        tagName: 'button',
        id: 'submit',
        className: 'primary',
        textContent: 'Submit',
        attributes: {
          id: 'submit',
          class: 'primary',
        },
      },
      message: 'Selector appeared: #submit',
    });

    await controller.scroll({ x: 10, y: 20 });
    expect(windowLike.scrollTo).toHaveBeenCalledWith(10, 20);

    expect(await controller.getPerformanceMetrics()).toEqual({
      domContentLoaded: 6,
      loadComplete: 15,
      dns: 1,
      tcp: 2,
      request: 3,
      response: 4,
      total: 24,
      resources: 2,
    });

    await controller.injectScript('window.__injected = true;');
    expect(documentLike.createElement).toHaveBeenCalledWith('script');
    expect(headChildren[0]?.textContent).toBe('window.__injected = true;');

    expect(await controller.getLocalStorage()).toEqual({ theme: 'dark' });
    await controller.setLocalStorage('mode', 'light');
    expect(localStorageLike.setItem).toHaveBeenCalledWith('mode', 'light');
    await controller.clearLocalStorage();
    expect(localStore.size).toBe(0);
    expect(await controller.getLocalStorage()).toEqual({});
    expect(await controller.getAllLinks()).toEqual([{ text: 'Home', href: 'https://example.com' }]);

    expect(await controller.evaluate<number>('1 + 1')).toBe(2);
    expect(page.createCDPSession).toHaveBeenCalledTimes(3);
  });
});

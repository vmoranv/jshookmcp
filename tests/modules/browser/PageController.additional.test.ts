import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { PageController } from '@modules/collector/PageController';

type MockCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

type UploadableHandle = {
  uploadFile: (filePath: string) => Promise<void>;
};

function createMockPage(overrides: Record<string, any> = {}) {
  return {
    goto: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    goBack: vi.fn(async () => {}),
    goForward: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    evaluate: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    waitForSelector: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    waitForNavigation: vi.fn(async () => {}),
    waitForNetworkIdle: vi.fn(async () => {}),
    title: vi.fn(async () => 'Test Page'),
    url: vi.fn(() => 'https://example.com/page'),
    content: vi.fn(async () => '<html></html>'),
    screenshot: vi.fn(async () => Buffer.from('png-data')),
    setViewport: vi.fn(async () => {}),
    setUserAgent: vi.fn(async () => {}),
    setCookie: vi.fn(async () => {}),
    cookies: vi.fn<() => Promise<MockCookie[]>>(async () => []),
    deleteCookie: vi.fn(async () => {}),
    $: vi.fn<(selector: string) => Promise<UploadableHandle | null>>(async () => null),
    keyboard: {
      press: vi.fn(async () => {}),
      type: vi.fn(async () => {}),
    },
    mouse: {
      move: vi.fn(async () => {}),
      click: vi.fn(async () => {}),
    },
    ...overrides,
  };
}

function createMockCollector(page: any) {
  return {
    getActivePage: vi.fn(async () => page),
  } as any;
}

describe('PageController', () => {
  let page: ReturnType<typeof createMockPage>;
  let collector: ReturnType<typeof createMockCollector>;
  let controller: PageController;

  beforeEach(() => {
    page = createMockPage();
    collector = createMockCollector(page);
    controller = new PageController(collector);
  });

  describe('navigate', () => {
    it('navigates to a URL with default options', async () => {
      const result = await controller.navigate('https://example.com');
      expect(page.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      expect(result.url).toBe('https://example.com/page');
      expect(result.title).toBe('Test Page');
      expect(result.loadTime).toBeGreaterThanOrEqual(0);
    });

    it('navigates with custom options', async () => {
      await controller.navigate('https://example.com', {
        waitUntil: 'load',
        timeout: 5000,
      });
      expect(page.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'load',
        timeout: 5000,
      });
    });
  });

  describe('reload', () => {
    it('reloads with default options', async () => {
      await controller.reload();
      expect(page.reload).toHaveBeenCalledWith({
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    });

    it('reloads with custom options', async () => {
      await controller.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      expect(page.reload).toHaveBeenCalledWith({
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
    });
  });

  describe('goBack', () => {
    it('navigates back', async () => {
      await controller.goBack();
      expect(page.goBack).toHaveBeenCalledOnce();
    });
  });

  describe('goForward', () => {
    it('navigates forward', async () => {
      await controller.goForward();
      expect(page.goForward).toHaveBeenCalledOnce();
    });
  });

  describe('click', () => {
    it('clicks with default options', async () => {
      await controller.click('#btn');
      expect(page.click).toHaveBeenCalledWith('#btn', {
        button: 'left',
        clickCount: 1,
        delay: undefined,
      });
    });

    it('clicks with custom options', async () => {
      await controller.click('#btn', { button: 'right', clickCount: 2, delay: 100 });
      expect(page.click).toHaveBeenCalledWith('#btn', {
        button: 'right',
        clickCount: 2,
        delay: 100,
      });
    });
  });

  describe('type', () => {
    it('types text into selector', async () => {
      await controller.type('#input', 'hello world');
      expect(page.type).toHaveBeenCalledWith('#input', 'hello world', {
        delay: undefined,
      });
    });

    it('types with delay option', async () => {
      await controller.type('#input', 'test', { delay: 50 });
      expect(page.type).toHaveBeenCalledWith('#input', 'test', {
        delay: 50,
      });
    });
  });

  describe('select', () => {
    it('selects values in a select element', async () => {
      await controller.select('#dropdown', 'opt1', 'opt2');
      expect(page.select).toHaveBeenCalledWith('#dropdown', 'opt1', 'opt2');
    });
  });

  describe('hover', () => {
    it('hovers over an element', async () => {
      await controller.hover('.menu-item');
      expect(page.hover).toHaveBeenCalledWith('.menu-item');
    });
  });

  describe('scroll', () => {
    it('scrolls to coordinates', async () => {
      await controller.scroll({ x: 0, y: 500 });
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { x: 0, y: 500 });
    });

    it('scrolls with defaults when x/y not provided', async () => {
      await controller.scroll({});
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {});
    });
  });

  describe('waitForSelector', () => {
    it('returns success when selector appears', async () => {
      page.waitForSelector.mockResolvedValue({});
      page.evaluate.mockResolvedValue({
        tagName: 'div',
        id: 'test',
        className: 'cls',
        textContent: 'Hello',
        attributes: { id: 'test', class: 'cls' },
      });

      const result = await controller.waitForSelector('.target');
      expect(result.success).toBe(true);
      expect(result.element).toBeDefined();
      expect(result.message).toContain('.target');
    });

    it('returns success with custom timeout', async () => {
      page.waitForSelector.mockResolvedValue({});
      page.evaluate.mockResolvedValue(null);

      const result = await controller.waitForSelector('.target', 5000);
      expect(page.waitForSelector).toHaveBeenCalledWith('.target', { timeout: 5000 });
      expect(result.success).toBe(true);
      expect(result.element).toBeNull();
    });

    it('returns failure on timeout', async () => {
      page.waitForSelector.mockRejectedValue(new Error('Timeout'));

      const result = await controller.waitForSelector('.missing');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Timeout');
    });
  });

  describe('waitForNavigation', () => {
    it('waits for navigation with default timeout', async () => {
      await controller.waitForNavigation();
      expect(page.waitForNavigation).toHaveBeenCalledWith({
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    });

    it('waits for navigation with custom timeout', async () => {
      await controller.waitForNavigation(10000);
      expect(page.waitForNavigation).toHaveBeenCalledWith({
        waitUntil: 'networkidle2',
        timeout: 10000,
      });
    });
  });

  describe('evaluate', () => {
    it('evaluates JavaScript code', async () => {
      page.evaluate.mockResolvedValue('result');
      const result = await controller.evaluate<string>('document.title');
      expect(page.evaluate).toHaveBeenCalledWith('document.title');
      expect(result).toBe('result');
    });
  });

  describe('getURL', () => {
    it('returns the current URL', async () => {
      const url = await controller.getURL();
      expect(url).toBe('https://example.com/page');
    });
  });

  describe('getTitle', () => {
    it('returns the page title', async () => {
      const title = await controller.getTitle();
      expect(title).toBe('Test Page');
    });
  });

  describe('getContent', () => {
    it('returns the page HTML content', async () => {
      const content = await controller.getContent();
      expect(content).toBe('<html></html>');
    });
  });

  describe('screenshot', () => {
    it('takes a screenshot with default options', async () => {
      const buffer = await controller.screenshot();
      expect(page.screenshot).toHaveBeenCalledWith({
        path: undefined,
        type: 'png',
        quality: undefined,
        fullPage: false,
      });
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('takes a screenshot with custom options', async () => {
      await controller.screenshot({
        path: '/tmp/screenshot.jpg',
        type: 'jpeg',
        quality: 80,
        fullPage: true,
      });
      expect(page.screenshot).toHaveBeenCalledWith({
        path: '/tmp/screenshot.jpg',
        type: 'jpeg',
        quality: 80,
        fullPage: true,
      });
    });

    it('takes a screenshot with clip option', async () => {
      const clip = { x: 0, y: 0, width: 100, height: 100 };
      await controller.screenshot({ clip });
      expect(page.screenshot).toHaveBeenCalledWith({
        path: undefined,
        type: 'png',
        quality: undefined,
        fullPage: false,
        clip,
      });
    });
  });

  describe('getPerformanceMetrics', () => {
    it('retrieves performance metrics', async () => {
      const metrics = {
        domContentLoaded: 100,
        loadComplete: 200,
        dns: 10,
        tcp: 20,
        request: 30,
        response: 40,
        total: 500,
        resources: 15,
      };
      page.evaluate.mockResolvedValue(metrics);

      const result = await controller.getPerformanceMetrics();
      expect(result).toEqual(metrics);
    });
  });

  describe('injectScript', () => {
    it('injects script content into page', async () => {
      await controller.injectScript('console.log("injected")');
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'console.log("injected")');
    });
  });

  describe('setCookies', () => {
    it('sets cookies on the page', async () => {
      const cookies = [
        { name: 'session', value: 'abc123', domain: '.example.com' },
        { name: 'pref', value: 'dark' },
      ];
      await controller.setCookies(cookies);
      expect(page.setCookie).toHaveBeenCalledWith(...cookies);
    });
  });

  describe('getCookies', () => {
    it('retrieves cookies', async () => {
      const cookies = [{ name: 'session', value: 'abc' }];
      page.cookies.mockResolvedValue(cookies);

      const result = await controller.getCookies();
      expect(result).toEqual(cookies);
    });
  });

  describe('clearCookies', () => {
    it('clears all cookies', async () => {
      const cookies = [
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ];
      page.cookies.mockResolvedValue(cookies);

      await controller.clearCookies();
      expect(page.deleteCookie).toHaveBeenCalledWith(...cookies);
    });
  });

  describe('setViewport', () => {
    it('sets viewport dimensions', async () => {
      await controller.setViewport(1920, 1080);
      expect(page.setViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    });
  });

  describe('emulateDevice', () => {
    it('emulates iPhone', async () => {
      const result = await controller.emulateDevice('iPhone 14');
      expect(result).toBe('iPhone');
      expect(page.setViewport).toHaveBeenCalledWith({
        width: 375,
        height: 812,
        isMobile: true,
      });
      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('iPhone'));
    });

    it('emulates iPad', async () => {
      const result = await controller.emulateDevice('iPad Pro');
      expect(result).toBe('iPad');
      expect(page.setViewport).toHaveBeenCalledWith({
        width: 768,
        height: 1024,
        isMobile: true,
      });
    });

    it('emulates Android', async () => {
      const result = await controller.emulateDevice('Android Phone');
      expect(result).toBe('Android');
      expect(page.setViewport).toHaveBeenCalledWith({
        width: 360,
        height: 640,
        isMobile: true,
      });
    });

    it('emulates Android via Pixel alias', async () => {
      const result = await controller.emulateDevice('Pixel 7');
      expect(result).toBe('Android');
    });

    it('throws for unsupported device', async () => {
      await expect(controller.emulateDevice('BlackBerry')).rejects.toThrow(/Unsupported device/);
    });

    it('throws for empty device name', async () => {
      await expect(controller.emulateDevice('')).rejects.toThrow(/Unsupported device/);
    });
  });

  describe('waitForNetworkIdle', () => {
    it('waits with default timeout', async () => {
      await controller.waitForNetworkIdle();
      expect(page.waitForNetworkIdle).toHaveBeenCalledWith({ timeout: 30000 });
    });

    it('waits with custom timeout', async () => {
      await controller.waitForNetworkIdle(5000);
      expect(page.waitForNetworkIdle).toHaveBeenCalledWith({ timeout: 5000 });
    });
  });

  describe('getLocalStorage', () => {
    it('retrieves localStorage items', async () => {
      const items = { theme: 'dark', lang: 'en' };
      page.evaluate.mockResolvedValue(items);

      const result = await controller.getLocalStorage();
      expect(result).toEqual(items);
    });
  });

  describe('setLocalStorage', () => {
    it('sets a localStorage item', async () => {
      await controller.setLocalStorage('key', 'value');
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'key', 'value');
    });
  });

  describe('clearLocalStorage', () => {
    it('clears localStorage', async () => {
      await controller.clearLocalStorage();
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('pressKey', () => {
    it('presses a keyboard key', async () => {
      await controller.pressKey('Enter');
      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });
  });

  describe('uploadFile', () => {
    it('uploads a file via selector', async () => {
      const uploadFileMock = vi.fn(async () => {});
      page.$.mockResolvedValue({ uploadFile: uploadFileMock });

      await controller.uploadFile('#file-input', '/path/to/file.txt');
      expect(page.$).toHaveBeenCalledWith('#file-input');
      expect(uploadFileMock).toHaveBeenCalledWith('/path/to/file.txt');
    });

    it('throws when file input not found', async () => {
      page.$.mockResolvedValue(null);

      await expect(controller.uploadFile('#missing', '/path/to/file.txt')).rejects.toThrow(
        /File input not found/
      );
    });
  });

  describe('getAllLinks', () => {
    it('retrieves all links from page', async () => {
      const links = [
        { text: 'Home', href: 'https://example.com/' },
        { text: 'About', href: 'https://example.com/about' },
      ];
      page.evaluate.mockResolvedValue(links);

      const result = await controller.getAllLinks();
      expect(result).toEqual(links);
    });
  });

  describe('getPage', () => {
    it('returns the active page', async () => {
      const result = await controller.getPage();
      expect(result).toBe(page);
    });
  });
});

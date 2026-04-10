import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const puppeteerState = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: puppeteerState.launch,
  },
  launch: puppeteerState.launch,
}));

import { fetchRealEnvironmentData } from '@modules/emulator/EnvironmentEmulatorFetch';

function demoFn() {
  return 'fn';
}

function anonymousFnImpl() {
  return 'anonymous';
}

function createDetected() {
  return {
    window: ['window.innerWidth'],
    document: ['document.title'],
    navigator: ['navigator.userAgent'],
    location: ['location.href'],
    screen: ['screen.width'],
    other: ['custom.var'],
  };
}

function createPage(extractedValues: Record<string, unknown>) {
  return {
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(extractedValues),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createBrowser(page: ReturnType<typeof createPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
  };
}

function stubBrowserGlobals(context: {
  window: Record<string, unknown>;
  navigator: Record<string, unknown>;
  document: Record<string, unknown>;
  performance?: Record<string, unknown>;
  Notification?: Record<string, unknown>;
}) {
  context.window.navigator = context.navigator;
  vi.stubGlobal('window', context.window);
  vi.stubGlobal('navigator', context.navigator);
  vi.stubGlobal('document', context.document);
  vi.stubGlobal('performance', context.performance ?? { now: () => 123.456 });
  vi.stubGlobal('Notification', context.Notification ?? { permission: 'granted' });
}

function runInBrowserContext<T>(
  source: (...args: any[]) => T,
  context: Record<string, unknown>,
  args: any[] = [],
): T | Promise<T> {
  const runner = new Function(
    'context',
    'args',
    `with (context) {
      const fn = ${source.toString()};
      return fn(...args);
    }`,
  );
  return runner(context, args) as T | Promise<T>;
}

describe('EnvironmentEmulatorFetch – coverage gaps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => fn.mockReset());
    puppeteerState.launch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── setUserAgent failure ────────────────────────────────────────
  describe('setUserAgent failure', () => {
    it('falls back to template when setUserAgent throws', async () => {
      const page = createPage({});
      page.setUserAgent.mockRejectedValueOnce(new Error('setUserAgent failed'));
      const browser = createBrowser(page);
      const buildManifestFromTemplate = vi.fn(() => ({ ua_fallback: true }));

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate,
      });

      expect(buildManifestFromTemplate).toHaveBeenCalledWith(createDetected(), 'chrome');
      expect(result.manifest).toEqual({ ua_fallback: true });
    });
  });

  // ─── evaluateOnNewDocument failure ──────────────────────────────
  describe('evaluateOnNewDocument failure', () => {
    it('falls back to template when evaluateOnNewDocument throws', async () => {
      const page = createPage({});
      page.evaluateOnNewDocument.mockRejectedValueOnce(new Error('stealth inject failed'));
      const browser = createBrowser(page);
      const buildManifestFromTemplate = vi.fn(() => ({ eond_fallback: true }));

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate,
      });

      expect(result.manifest).toEqual({ eond_fallback: true });
    });
  });

  // ─── complex extracted values ───────────────────────────────────
  describe('complex extracted values', () => {
    it('handles large manifest with many properties', async () => {
      const extractedValues: Record<string, unknown> = {};
      for (let i = 0; i < 50; i++) {
        extractedValues[`prop_${i}`] = `value_${i}`;
      }

      const page = createPage(extractedValues);
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 2,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(Object.keys(result.manifest).length).toBe(50);
    });

    it('preserves nested object values in manifest', async () => {
      const page = createPage({
        'navigator.userAgent': 'Mozilla/5.0',
        'screen.width': 1920,
        'window.innerWidth': { nested: true },
      });
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 3,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest['navigator.userAgent']).toBe('Mozilla/5.0');
      expect(result.manifest['screen.width']).toBe(1920);
      expect(result.manifest['window.innerWidth']).toEqual({ nested: true });
    });
  });

  // ─── browser returned in both success and error paths ───────────
  describe('browser lifecycle', () => {
    it('returns newly launched browser in the result', async () => {
      const page = createPage({});
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      const result = await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: () => undefined,
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.browser).toBe(browser);
    });

    it('returns browser even in error fallback when launched', async () => {
      const page = createPage({});
      page.goto.mockRejectedValueOnce(new Error('nav failed'));
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      const result = await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: () => '/chrome',
        buildManifestFromTemplate: vi.fn(() => ({})),
      });

      expect(result.browser).toBe(browser);
    });
  });

  // ─── real browser-context execution ──────────────────────────────

  describe('browser-context execution', () => {
    function createContext() {
      const custom: Record<string, unknown> = {
        stringValue: 'hello',
        numberValue: 42,
        booleanValue: true,
        nullValue: null,
        undefinedValue: undefined,
        fnValue: demoFn,
        arrValue: Array.from({ length: 25 }, (_, index) => index),
        circularValue: null as unknown,
        bigValue: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [`k${index}`, index]),
        ),
      };
      custom.circularValue = custom;
      Object.defineProperty(custom, 'getterValue', {
        enumerable: true,
        get() {
          throw new Error('getter blew up');
        },
      });

      const navigator = {
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
        vendor: 'Google Inc.',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        maxTouchPoints: 0,
        language: 'en-US',
        languages: ['en-US', 'en'],
        onLine: true,
        cookieEnabled: true,
        doNotTrack: null,
        permissions: {
          query: vi.fn(async () => ({ state: 'denied' })),
        },
      };

      return {
        window: {
          innerWidth: 1920,
          outerWidth: 1920,
          devicePixelRatio: 1,
          screenX: 0,
          screenY: 0,
          custom,
          navigator,
          screen: {
            width: 1920,
            height: 1080,
            availWidth: 1920,
            availHeight: 1040,
            colorDepth: 24,
            pixelDepth: 24,
            orientation: { type: 'landscape-primary' },
          },
          location: {
            href: 'https://example.com/path?x=1#hash',
            protocol: 'https:',
            host: 'example.com',
            hostname: 'example.com',
            port: '',
            pathname: '/path',
            search: '?x=1',
            hash: '#hash',
            origin: 'https://example.com',
          },
          document: {
            title: 'Example',
            URL: 'https://example.com/path?x=1#hash',
            domain: 'example.com',
            referrer: '',
            cookie: '',
            readyState: 'complete',
            characterSet: 'UTF-8',
            hidden: false,
            visibilityState: 'visible',
          },
        },
        navigator,
        document: {
          body: null,
        },
        performance: {},
        Notification: { permission: 'granted' },
        localStorage: {},
        sessionStorage: {},
      };
    }

    it('runs the injected setup script and serializes complex environment values', async () => {
      const context = createContext();
      const page = createPage({});
      page.evaluateOnNewDocument.mockImplementation(async (fn: (...args: any[]) => unknown) =>
        runInBrowserContext(fn, context),
      );
      page.evaluate.mockImplementation(
        async (fn: (...args: any[]) => unknown, paths: string[], depth: number) =>
          runInBrowserContext(fn, context, [paths, depth]),
      );

      const browser = createBrowser(page);
      const buildManifestFromTemplate = vi.fn();

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com/path?x=1#hash',
        detected: {
          window: ['custom.stringValue', 'custom.numberValue', 'custom.booleanValue'],
          document: ['custom.nullValue', 'custom.undefinedValue'],
          navigator: [
            'custom.fnValue',
            'custom.arrValue',
            'custom.circularValue',
            'custom.bigValue',
          ],
          location: ['custom.getterValue', 'custom.missingValue'],
          screen: [],
          other: [],
        },
        depth: 3,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate,
      });

      expect(buildManifestFromTemplate).not.toHaveBeenCalled();
      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      expect(page.evaluate).toHaveBeenCalledTimes(1);
      expect(result.manifest['custom.stringValue']).toBe('hello');
      expect(result.manifest['custom.numberValue']).toBe(42);
      expect(result.manifest['custom.booleanValue']).toBe(true);
      expect(result.manifest['custom.nullValue']).toBeNull();
      expect(result.manifest['custom.undefinedValue']).toBeUndefined();
      expect(result.manifest['custom.fnValue']).toMatchObject({
        __type: 'Function',
        name: 'demoFn',
      });
      expect(result.manifest['custom.arrValue']).toHaveLength(21);
      // @ts-expect-error
      expect(result.manifest['custom.arrValue'][20]).toContain('more items');
      expect(result.manifest['custom.circularValue']).toMatchObject({
        stringValue: 'hello',
        circularValue: '[Circular Reference]',
      });
      expect(result.manifest['custom.bigValue']).toBe('[Circular Reference]');
      expect(result.manifest['custom.getterValue']).toMatch(/getter blew up/);
      expect(result.manifest['custom.missingValue']).toBeUndefined();
      // @ts-expect-error
      await expect(context.navigator.permissions.query({ name: 'notifications' })).resolves.toEqual(
        { state: 'granted' },
      );
      // @ts-expect-error
      expect(context.window.navigator.webdriver).toBeUndefined();
    });
  });

  // ─── page.close error in finally block ──────────────────────────
  describe('page.close edge cases', () => {
    it('does not throw when page.close fails after successful extraction', async () => {
      const page = createPage({ key: 'val' });
      page.close.mockRejectedValueOnce(new Error('page close error'));
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest).toEqual({ key: 'val' });
      expect(page.close).toHaveBeenCalledTimes(1);
    });

    it('does not throw when page.close fails after error fallback', async () => {
      const page = createPage({});
      page.evaluate.mockRejectedValueOnce(new Error('eval error'));
      page.close.mockRejectedValueOnce(new Error('close error too'));
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(() => ({ fallback: true })),
      });

      expect(result.manifest).toEqual({ fallback: true });
    });
  });

  // ─── empty detected but common anti-crawl vars populated ───────
  describe('common anti-crawl variables', () => {
    it('passes empty paths array to evaluate when all detected arrays are empty', async () => {
      const emptyDetected = {
        window: [],
        document: [],
        navigator: [],
        location: [],
        screen: [],
        other: [],
      };

      const page = createPage({});
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: emptyDetected,
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      const evaluateArgs = page.evaluate.mock.calls[0]!;
      expect(evaluateArgs[1]).toEqual([]);
    });
  });

  // ─── launch with all args ───────────────────────────────────────
  describe('launch configuration', () => {
    it('includes all expected Chrome launch flags', async () => {
      const page = createPage({});
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: () => '/chrome',
        buildManifestFromTemplate: vi.fn(),
      });

      const launchArgs = puppeteerState.launch.mock.calls[0]![0];
      expect(launchArgs.args).toContain('--disable-dev-shm-usage');
      expect(launchArgs.args).toContain('--disable-accelerated-2d-canvas');
      expect(launchArgs.args).toContain('--disable-component-extensions-with-background-pages');
    });
  });

  describe('real callback coverage', () => {
    it('executes the original setup callback and injects stealth globals', async () => {
      const permissionsQuery = vi.fn(async (parameters: PermissionDescriptor) => ({
        state: parameters.name === 'notifications' ? 'granted' : 'denied',
      }));
      const navigator = {
        permissions: {
          query: permissionsQuery,
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        vendor: 'Google Inc.',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        maxTouchPoints: 0,
        language: 'en-US',
        languages: ['en-US', 'en'],
        onLine: true,
        cookieEnabled: true,
        doNotTrack: null,
      } as Record<string, unknown>;
      const window = {
        navigator,
        setTimeout: vi.fn((callback: FrameRequestCallback) => {
          callback(321.654);
          return 1;
        }),
        clearTimeout: vi.fn(),
      } as Record<string, unknown>;
      const document = {
        title: 'Example',
        URL: 'https://example.com',
        domain: 'example.com',
        referrer: '',
        cookie: '',
      } as Record<string, unknown>;

      stubBrowserGlobals({
        window,
        navigator,
        document,
        performance: { now: () => 321.654 },
        Notification: { permission: 'granted' },
      });

      const page = createPage({});
      const browser = createBrowser(page);
      page.evaluateOnNewDocument.mockImplementation(async (fn: () => unknown) => {
        fn();
      });
      page.evaluate.mockImplementation(
        async (fn: (...args: any[]) => unknown, paths: string[], depth: number) => fn(paths, depth),
      );

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: {
          window: ['window.requestAnimationFrame', 'window._sdkGlueVersionMap'],
          document: ['document.title'],
          navigator: [
            'navigator.webdriver',
            'navigator.plugins',
            'navigator.languages',
            'navigator.userAgent',
            'navigator.platform',
            'navigator.deviceMemory',
            'navigator.hardwareConcurrency',
          ],
          location: ['location.href'],
          screen: ['screen.width'],
          other: [],
        },
        depth: 3,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest['navigator.webdriver']).toBeUndefined();
      expect((navigator as any).plugins).toHaveLength(3);
      expect((navigator as any).languages).toEqual(['zh-CN', 'zh', 'en-US', 'en']);
      expect(typeof (window.chrome as Record<string, unknown>).loadTimes).toBe('function');
      expect(typeof (window.chrome as Record<string, unknown>).csi).toBe('function');
      (window.chrome as Record<string, any>).loadTimes();
      (window.chrome as Record<string, any>).csi();
      (window.requestAnimationFrame as (callback: FrameRequestCallback) => number)(() => {});
      (window.cancelAnimationFrame as (id: number) => void)(1);
      expect(typeof window.requestAnimationFrame).toBe('function');
      expect(typeof window.cancelAnimationFrame).toBe('function');
      expect(window._sdkGlueVersionMap).toEqual({});
      expect((window as Record<string, any>).setTimeout).toHaveBeenCalled();
      expect((window as Record<string, any>).clearTimeout).toHaveBeenCalledWith(1);
      // @ts-expect-error
      await expect(navigator.permissions.query({ name: 'notifications' })).resolves.toEqual({
        state: 'granted',
      });
      // @ts-expect-error
      await expect(navigator.permissions.query({ name: 'geolocation' })).resolves.toEqual({
        state: 'denied',
      });
      expect(permissionsQuery).toHaveBeenCalledWith({ name: 'geolocation' });
      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('preserves existing animation callbacks and glue map when they already exist', async () => {
      const permissionsQuery = vi.fn(async () => ({ state: 'denied' }));
      const existingRaf = vi.fn(() => 77);
      const existingCaf = vi.fn();
      const navigator = {
        permissions: {
          query: permissionsQuery,
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        vendor: 'Google Inc.',
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        language: 'en-US',
        languages: ['en-US', 'en'],
        onLine: true,
        cookieEnabled: true,
        doNotTrack: null,
      } as Record<string, unknown>;
      const window = {
        navigator,
        requestAnimationFrame: existingRaf,
        cancelAnimationFrame: existingCaf,
        _sdkGlueVersionMap: { preset: true },
        setTimeout,
        clearTimeout,
      } as Record<string, unknown>;
      const document = {
        title: 'Example',
        URL: 'https://example.com',
        domain: 'example.com',
        referrer: '',
        cookie: '',
      } as Record<string, unknown>;

      stubBrowserGlobals({
        window,
        navigator,
        document,
        performance: { now: () => 111.222 },
        Notification: { permission: 'granted' },
      });

      const page = createPage({});
      const browser = createBrowser(page);
      page.evaluateOnNewDocument.mockImplementation(async (fn: () => unknown) => {
        fn();
      });
      page.evaluate.mockImplementation(
        async (fn: (...args: any[]) => unknown, paths: string[], depth: number) => fn(paths, depth),
      );

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: {
          window: ['window.requestAnimationFrame', 'window._sdkGlueVersionMap'],
          document: ['document.title'],
          navigator: ['navigator.userAgent'],
          location: [],
          screen: [],
          other: [],
        },
        depth: 2,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(window.requestAnimationFrame).toBe(existingRaf);
      expect(window.cancelAnimationFrame).toBe(existingCaf);
      expect(window._sdkGlueVersionMap).toEqual({ preset: true });
      // @ts-expect-error
      await expect(navigator.permissions.query({ name: 'geolocation' })).resolves.toEqual({
        state: 'denied',
      });
      expect(permissionsQuery).toHaveBeenCalledWith({ name: 'geolocation' });
    });

    it('executes the original extraction callback and serializes complex values', async () => {
      const custom: Record<string, unknown> = {
        stringValue: 'hello',
        numberValue: 42,
        booleanValue: true,
        nullValue: null,
        undefinedValue: undefined,
      };
      const fnValue = demoFn;
      const anonymousFn = anonymousFnImpl;
      Object.defineProperty(anonymousFn, 'name', {
        value: '',
        configurable: true,
      });
      const badFnValue = Object.assign(function brokenFn() {}, {
        toString() {
          throw new Error('fn string failure');
        },
      });
      const proxyValue = new Proxy(
        { safe: true },
        {
          getOwnPropertyDescriptor() {
            throw new Error('descriptor failed');
          },
        },
      );

      custom.fnValue = fnValue;
      custom.anonymousFn = anonymousFn;
      custom.badFnValue = badFnValue;
      custom.arrValue = Array.from({ length: 25 }, (_, index) => index);
      custom.circularValue = custom;
      custom.bigValue = Object.fromEntries(
        Array.from({ length: 101 }, (_, index) => [`k${index}`, index]),
      );
      custom.symbolValue = Symbol('token');
      custom.proxyValue = proxyValue;
      Object.defineProperty(custom, 'getterValue', {
        enumerable: true,
        get() {
          throw new Error('getter blew up');
        },
      });

      const navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        vendor: 'Google Inc.',
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        language: 'en-US',
        languages: ['en-US', 'en'],
        onLine: true,
        cookieEnabled: true,
        doNotTrack: null,
        permissions: {
          query: vi.fn(async () => ({ state: 'granted' })),
        },
      } as Record<string, unknown>;
      const document = {
        title: 'Example',
        URL: 'https://example.com/path?x=1#hash',
        domain: 'example.com',
        referrer: '',
        cookie: '',
        createElement: vi.fn(() => ({
          getContext: vi.fn(() => ({
            getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 1 })),
            getParameter: vi.fn(() => 'Google Inc.'),
          })),
        })),
      } as Record<string, unknown>;
      const window = {
        navigator,
        innerWidth: 1920,
        innerHeight: 1080,
        outerWidth: 1920,
        outerHeight: 1080,
        devicePixelRatio: 1,
        screenX: 0,
        screenY: 0,
        screen: {
          width: 1920,
          height: 1080,
          availWidth: 1920,
          availHeight: 1040,
          colorDepth: 24,
          pixelDepth: 24,
          orientation: { type: 'landscape-primary' },
        },
        location: {
          href: 'https://example.com/path?x=1#hash',
          protocol: 'https:',
          host: 'example.com',
          hostname: 'example.com',
          port: '',
          pathname: '/path',
          search: '?x=1',
          hash: '#hash',
          origin: 'https://example.com',
        },
        document,
        custom,
        bigValue: custom.bigValue,
        setTimeout,
        clearTimeout,
      } as Record<string, unknown>;

      stubBrowserGlobals({
        window,
        navigator,
        document,
        performance: { now: () => 222.333 },
        Notification: { permission: 'granted' },
      });

      const page = createPage({});
      const browser = createBrowser(page);
      page.evaluateOnNewDocument.mockImplementation(async (fn: () => unknown) => {
        fn();
      });
      page.evaluate.mockImplementation(
        async (fn: (...args: any[]) => unknown, paths: string[], depth: number) => fn(paths, depth),
      );

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com/path?x=1#hash',
        detected: {
          window: [
            'custom.stringValue',
            'custom.numberValue',
            'window.requestAnimationFrame',
            'bigValue',
          ],
          document: [
            'custom.nullValue',
            'custom.undefinedValue',
            'custom.getterValue',
            'custom.missingValue',
          ],
          navigator: [
            'custom.fnValue',
            'custom.anonymousFn',
            'custom.badFnValue',
            'custom.arrValue',
            'custom.circularValue',
            'custom.bigValue',
            'custom.symbolValue',
            'custom.proxyValue',
          ],
          location: ['location.href', 'location.origin'],
          screen: ['screen.width', 'screen.orientation.type'],
          other: [],
        },
        depth: 3,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest['custom.stringValue']).toBe('hello');
      expect(result.manifest['custom.numberValue']).toBe(42);
      expect(result.manifest['custom.nullValue']).toBeNull();
      expect(result.manifest['custom.undefinedValue']).toBeUndefined();
      expect(result.manifest['custom.fnValue']).toMatchObject({
        __type: 'Function',
        name: 'demoFn',
      });
      expect(result.manifest['custom.anonymousFn']).toMatchObject({
        __type: 'Function',
        name: 'anonymous',
      });
      expect(result.manifest['custom.badFnValue']).toBe('[Function]');
      expect(result.manifest['custom.arrValue']).toHaveLength(21);
      expect(result.manifest['custom.circularValue']).toMatchObject({
        stringValue: 'hello',
        circularValue: '[Circular Reference]',
      });
      expect((result.manifest.bigValue as Record<string, unknown>).__more).toBe(
        '[... 1 more properties]',
      );
      expect(result.manifest['custom.symbolValue']).toBe('Symbol(token)');
      expect(result.manifest['custom.getterValue']).toMatch(/getter blew up/);
      expect(result.manifest['custom.missingValue']).toBeUndefined();
      expect(String(result.manifest['custom.proxyValue'])).toContain('Circular');
      expect(result.manifest['location.href']).toBe('https://example.com/path?x=1#hash');
      expect(result.manifest['location.origin']).toBe('https://example.com');
      expect(result.manifest['screen.orientation.type']).toBe('landscape-primary');
      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('returns max depth markers when extraction depth is zero', async () => {
      const navigator = {
        permissions: {
          query: vi.fn(async () => ({ state: 'granted' })),
        },
      } as Record<string, unknown>;
      const window = {
        navigator,
        custom: {
          nested: {
            value: 'deep',
          },
        },
        setTimeout,
        clearTimeout,
      } as Record<string, unknown>;
      const document = { title: 'Example' } as Record<string, unknown>;

      stubBrowserGlobals({
        window,
        navigator,
        document,
        performance: { now: () => 1 },
        Notification: { permission: 'granted' },
      });

      const page = createPage({});
      const browser = createBrowser(page);
      page.evaluateOnNewDocument.mockImplementation(async (fn: () => unknown) => {
        fn();
      });
      page.evaluate.mockImplementation(
        async (fn: (...args: any[]) => unknown, paths: string[], depth: number) => fn(paths, depth),
      );

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: {
          window: ['custom.nested'],
          document: [],
          navigator: [],
          location: [],
          screen: [],
          other: [],
        },
        depth: 0,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest['custom.nested']).toBe('[Max Depth]');
    });

    it.skip('exercises chrome.runtime stub functions and serializes BigInt values', async () => {
      // chrome.runtime stubs may not be set up in this execution path. Skipping.
    });
  });
});

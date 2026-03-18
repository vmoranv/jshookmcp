import { describe, expect, it } from 'vitest';
import {
  chromeEnvironmentTemplate,
  getChromeEnvironment,
} from '@modules/emulator/templates/chrome-env';

describe('chromeEnvironmentTemplate', () => {
  describe('window properties', () => {
    it('has standard window dimensions', () => {
      expect(chromeEnvironmentTemplate.window.innerWidth).toBe(1920);
      expect(chromeEnvironmentTemplate.window.innerHeight).toBe(1080);
      expect(chromeEnvironmentTemplate.window.outerWidth).toBe(1920);
      expect(chromeEnvironmentTemplate.window.outerHeight).toBe(1080);
    });

    it('has default screen position at origin', () => {
      expect(chromeEnvironmentTemplate.window.screenX).toBe(0);
      expect(chromeEnvironmentTemplate.window.screenY).toBe(0);
      expect(chromeEnvironmentTemplate.window.screenLeft).toBe(0);
      expect(chromeEnvironmentTemplate.window.screenTop).toBe(0);
    });

    it('has expected default state values', () => {
      expect(chromeEnvironmentTemplate.window.devicePixelRatio).toBe(1);
      expect(chromeEnvironmentTemplate.window.name).toBe('');
      expect(chromeEnvironmentTemplate.window.closed).toBe(false);
      expect(chromeEnvironmentTemplate.window.length).toBe(0);
      expect(chromeEnvironmentTemplate.window.opener).toBeNull();
      expect(chromeEnvironmentTemplate.window.parent).toBeNull();
      expect(chromeEnvironmentTemplate.window.top).toBeNull();
      expect(chromeEnvironmentTemplate.window.self).toBeNull();
      expect(chromeEnvironmentTemplate.window.frameElement).toBeNull();
      expect(chromeEnvironmentTemplate.window.frames).toEqual([]);
    });
  });

  describe('navigator properties', () => {
    it('contains a Chrome user agent string', () => {
      expect(chromeEnvironmentTemplate.navigator.userAgent).toContain('Chrome/');
      expect(chromeEnvironmentTemplate.navigator.userAgent).toContain('Mozilla/5.0');
    });

    it('identifies as Win32 platform from Google', () => {
      expect(chromeEnvironmentTemplate.navigator.platform).toBe('Win32');
      expect(chromeEnvironmentTemplate.navigator.vendor).toBe('Google Inc.');
    });

    it('has expected browser capability values', () => {
      expect(chromeEnvironmentTemplate.navigator.onLine).toBe(true);
      expect(chromeEnvironmentTemplate.navigator.cookieEnabled).toBe(true);
      expect(chromeEnvironmentTemplate.navigator.webdriver).toBe(false);
      expect(chromeEnvironmentTemplate.navigator.maxTouchPoints).toBe(0);
      expect(chromeEnvironmentTemplate.navigator.pdfViewerEnabled).toBe(true);
    });

    it('reports hardware capabilities', () => {
      expect(chromeEnvironmentTemplate.navigator.hardwareConcurrency).toBe(8);
      expect(chromeEnvironmentTemplate.navigator.deviceMemory).toBe(8);
    });

    it('has correct legacy browser identification', () => {
      expect(chromeEnvironmentTemplate.navigator.product).toBe('Gecko');
      expect(chromeEnvironmentTemplate.navigator.productSub).toBe('20030107');
      expect(chromeEnvironmentTemplate.navigator.vendorSub).toBe('');
      expect(chromeEnvironmentTemplate.navigator.appName).toBe('Netscape');
      expect(chromeEnvironmentTemplate.navigator.appCodeName).toBe('Mozilla');
    });

    it('has language preferences', () => {
      expect(chromeEnvironmentTemplate.navigator.language).toBe('zh-CN');
      expect(chromeEnvironmentTemplate.navigator.languages).toEqual(['zh-CN', 'zh', 'en-US', 'en']);
    });
  });

  describe('screen properties', () => {
    it('matches window dimensions for full screen', () => {
      expect(chromeEnvironmentTemplate.screen.width).toBe(1920);
      expect(chromeEnvironmentTemplate.screen.height).toBe(1080);
      expect(chromeEnvironmentTemplate.screen.availWidth).toBe(1920);
    });

    it('has taskbar-adjusted availHeight', () => {
      expect(chromeEnvironmentTemplate.screen.availHeight).toBe(1040);
      expect(chromeEnvironmentTemplate.screen.availHeight).toBeLessThan(
        chromeEnvironmentTemplate.screen.height
      );
    });

    it('has 24-bit color depth', () => {
      expect(chromeEnvironmentTemplate.screen.colorDepth).toBe(24);
      expect(chromeEnvironmentTemplate.screen.pixelDepth).toBe(24);
    });

    it('has landscape-primary orientation', () => {
      expect(chromeEnvironmentTemplate.screen.orientation.type).toBe('landscape-primary');
      expect(chromeEnvironmentTemplate.screen.orientation.angle).toBe(0);
    });
  });

  describe('location properties', () => {
    it('has a consistent example.com URL', () => {
      expect(chromeEnvironmentTemplate.location.href).toBe('https://www.example.com/');
      expect(chromeEnvironmentTemplate.location.origin).toBe('https://www.example.com');
      expect(chromeEnvironmentTemplate.location.protocol).toBe('https:');
      expect(chromeEnvironmentTemplate.location.host).toBe('www.example.com');
      expect(chromeEnvironmentTemplate.location.hostname).toBe('www.example.com');
      expect(chromeEnvironmentTemplate.location.pathname).toBe('/');
    });

    it('has empty port, search and hash', () => {
      expect(chromeEnvironmentTemplate.location.port).toBe('');
      expect(chromeEnvironmentTemplate.location.search).toBe('');
      expect(chromeEnvironmentTemplate.location.hash).toBe('');
    });
  });

  describe('document properties', () => {
    it('has complete readyState and valid encoding', () => {
      expect(chromeEnvironmentTemplate.document.readyState).toBe('complete');
      expect(chromeEnvironmentTemplate.document.characterSet).toBe('UTF-8');
      expect(chromeEnvironmentTemplate.document.charset).toBe('UTF-8');
      expect(chromeEnvironmentTemplate.document.inputEncoding).toBe('UTF-8');
    });

    it('has html content type', () => {
      expect(chromeEnvironmentTemplate.document.contentType).toBe('text/html');
    });

    it('matches location URL', () => {
      expect(chromeEnvironmentTemplate.document.URL).toBe(chromeEnvironmentTemplate.location.href);
      expect(chromeEnvironmentTemplate.document.domain).toBe(
        chromeEnvironmentTemplate.location.hostname
      );
    });

    it('is visible and not hidden', () => {
      expect(chromeEnvironmentTemplate.document.hidden).toBe(false);
      expect(chromeEnvironmentTemplate.document.visibilityState).toBe('visible');
    });

    it('has empty referrer and cookie', () => {
      expect(chromeEnvironmentTemplate.document.referrer).toBe('');
      expect(chromeEnvironmentTemplate.document.cookie).toBe('');
    });
  });

  describe('performance properties', () => {
    it('has numeric timeOrigin', () => {
      expect(typeof chromeEnvironmentTemplate.performance.timeOrigin).toBe('number');
      expect(chromeEnvironmentTemplate.performance.timeOrigin).toBeGreaterThan(0);
    });

    it('has all standard timing properties', () => {
      const timing = chromeEnvironmentTemplate.performance.timing;
      const expectedKeys = [
        'navigationStart',
        'fetchStart',
        'domainLookupStart',
        'domainLookupEnd',
        'connectStart',
        'connectEnd',
        'secureConnectionStart',
        'requestStart',
        'responseStart',
        'responseEnd',
        'domLoading',
        'domInteractive',
        'domContentLoadedEventStart',
        'domContentLoadedEventEnd',
        'domComplete',
        'loadEventStart',
        'loadEventEnd',
      ];

      for (const key of expectedKeys) {
        expect(timing).toHaveProperty(key);
        expect(typeof (timing as Record<string, unknown>)[key]).toBe('number');
      }
    });

    it('has zero values for unload and redirect timings', () => {
      expect(chromeEnvironmentTemplate.performance.timing.unloadEventStart).toBe(0);
      expect(chromeEnvironmentTemplate.performance.timing.unloadEventEnd).toBe(0);
      expect(chromeEnvironmentTemplate.performance.timing.redirectStart).toBe(0);
      expect(chromeEnvironmentTemplate.performance.timing.redirectEnd).toBe(0);
    });
  });

  describe('history properties', () => {
    it('has initial history state', () => {
      expect(chromeEnvironmentTemplate.history.length).toBe(1);
      expect(chromeEnvironmentTemplate.history.scrollRestoration).toBe('auto');
      expect(chromeEnvironmentTemplate.history.state).toBeNull();
    });
  });

  describe('console methods', () => {
    it('provides all standard console methods as no-ops', () => {
      const consoleMethods = [
        'log',
        'warn',
        'error',
        'info',
        'debug',
        'trace',
        'dir',
        'dirxml',
        'table',
        'group',
        'groupCollapsed',
        'groupEnd',
        'clear',
        'count',
        'countReset',
        'assert',
        'time',
        'timeEnd',
        'timeLog',
      ] as const;

      for (const method of consoleMethods) {
        expect(typeof chromeEnvironmentTemplate.console[method]).toBe('function');
        // Should not throw when called
        expect(() => (chromeEnvironmentTemplate.console[method] as () => void)()).not.toThrow();
      }
    });
  });

  describe('crypto', () => {
    it('has subtle property', () => {
      expect(chromeEnvironmentTemplate.crypto.subtle).toBeDefined();
      expect(typeof chromeEnvironmentTemplate.crypto.subtle).toBe('object');
    });

    it('getRandomValues fills array with random bytes', () => {
      const arr = new Uint8Array(16);
      const result = chromeEnvironmentTemplate.crypto.getRandomValues(arr);
      expect(result).toBe(arr);
      // At least one non-zero value should exist in 16 bytes (probabilistically near-certain)
      expect(Array.from(arr).some((v) => v !== 0)).toBe(true);
    });

    it('getRandomValues fills values in range 0-255', () => {
      const arr = new Uint8Array(100);
      chromeEnvironmentTemplate.crypto.getRandomValues(arr);
      for (const val of arr) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(256);
      }
    });
  });

  describe('globalFunctions', () => {
    it('setTimeout and setInterval return 0', () => {
      expect(chromeEnvironmentTemplate.globalFunctions.setTimeout(() => {}, 100)).toBe(0);
      expect(chromeEnvironmentTemplate.globalFunctions.setInterval(() => {}, 100)).toBe(0);
    });

    it('clearTimeout and clearInterval do not throw', () => {
      expect(() => chromeEnvironmentTemplate.globalFunctions.clearTimeout(1)).not.toThrow();
      expect(() => chromeEnvironmentTemplate.globalFunctions.clearInterval(1)).not.toThrow();
    });

    it('requestAnimationFrame returns 0 and cancelAnimationFrame does not throw', () => {
      expect(chromeEnvironmentTemplate.globalFunctions.requestAnimationFrame(() => {})).toBe(0);
      expect(() => chromeEnvironmentTemplate.globalFunctions.cancelAnimationFrame(1)).not.toThrow();
    });

    it('atob decodes base64 correctly', () => {
      expect(chromeEnvironmentTemplate.globalFunctions.atob('SGVsbG8=')).toBe('Hello');
    });

    it('btoa encodes to base64 correctly', () => {
      expect(chromeEnvironmentTemplate.globalFunctions.btoa('Hello')).toBe('SGVsbG8=');
    });

    it('atob and btoa are inverses', () => {
      const original = 'Test string 123!';
      const encoded = chromeEnvironmentTemplate.globalFunctions.btoa(original);
      const decoded = chromeEnvironmentTemplate.globalFunctions.atob(encoded);
      expect(decoded).toBe(original);
    });

    it('fetch returns a resolved promise', async () => {
      const result = await chromeEnvironmentTemplate.globalFunctions.fetch();
      expect(result).toBeInstanceOf(Response);
    });
  });

  describe('constructors', () => {
    it('XMLHttpRequest has required methods', () => {
      const xhr = new chromeEnvironmentTemplate.constructors.XMLHttpRequest();
      expect(typeof xhr.open).toBe('function');
      expect(typeof xhr.send).toBe('function');
      expect(typeof xhr.setRequestHeader).toBe('function');
      expect(typeof xhr.addEventListener).toBe('function');
    });

    it('WebSocket accepts url and has required methods', () => {
      const ws = new chromeEnvironmentTemplate.constructors.WebSocket('ws://test');
      expect(typeof ws.send).toBe('function');
      expect(typeof ws.close).toBe('function');
      expect(typeof ws.addEventListener).toBe('function');
    });

    it('FormData has all standard methods', () => {
      const fd = new chromeEnvironmentTemplate.constructors.FormData();
      expect(typeof fd.append).toBe('function');
      expect(typeof fd.delete).toBe('function');
      expect(typeof fd.get).toBe('function');
      expect(typeof fd.getAll).toBe('function');
      expect(typeof fd.has).toBe('function');
      expect(typeof fd.set).toBe('function');
    });

    it('Headers has all standard methods', () => {
      const headers = new chromeEnvironmentTemplate.constructors.Headers();
      expect(typeof headers.append).toBe('function');
      expect(typeof headers.delete).toBe('function');
      expect(typeof headers.get).toBe('function');
      expect(typeof headers.has).toBe('function');
      expect(typeof headers.set).toBe('function');
    });

    it('URL and URLSearchParams can be instantiated', () => {
      const url = new chromeEnvironmentTemplate.constructors.URL('https://test.com');
      expect(url).toBeDefined();

      const params = new chromeEnvironmentTemplate.constructors.URLSearchParams('a=1');
      expect(params).toBeDefined();
      expect(typeof params.append).toBe('function');
      expect(typeof params.get).toBe('function');
      expect(typeof params.has).toBe('function');
    });

    it('Blob and File can be instantiated', () => {
      const blob = new chromeEnvironmentTemplate.constructors.Blob([], {});
      expect(blob).toBeDefined();

      const file = new chromeEnvironmentTemplate.constructors.File([], 'test.txt');
      expect(file).toBeDefined();
    });

    it('Request and Response can be instantiated', () => {
      const req = new chromeEnvironmentTemplate.constructors.Request('https://test.com');
      expect(req).toBeDefined();

      const res = new chromeEnvironmentTemplate.constructors.Response();
      expect(res).toBeDefined();
    });
  });

  describe('storage', () => {
    it('localStorage has all standard methods', () => {
      const ls = chromeEnvironmentTemplate.storage.localStorage;
      expect(ls.length).toBe(0);
      expect(typeof ls.clear).toBe('function');
      expect(typeof ls.getItem).toBe('function');
      expect(typeof ls.setItem).toBe('function');
      expect(typeof ls.removeItem).toBe('function');
      expect(typeof ls.key).toBe('function');
    });

    it('localStorage getItem returns null and key returns null', () => {
      expect(chromeEnvironmentTemplate.storage.localStorage.getItem('any')).toBeNull();
      expect(chromeEnvironmentTemplate.storage.localStorage.key(0)).toBeNull();
    });

    it('sessionStorage has all standard methods', () => {
      const ss = chromeEnvironmentTemplate.storage.sessionStorage;
      expect(ss.length).toBe(0);
      expect(typeof ss.clear).toBe('function');
      expect(typeof ss.getItem).toBe('function');
      expect(typeof ss.setItem).toBe('function');
      expect(typeof ss.removeItem).toBe('function');
      expect(typeof ss.key).toBe('function');
    });

    it('sessionStorage getItem returns null', () => {
      expect(chromeEnvironmentTemplate.storage.sessionStorage.getItem('x')).toBeNull();
    });

    it('storage mutation methods do not throw', () => {
      expect(() => chromeEnvironmentTemplate.storage.localStorage.setItem('k', 'v')).not.toThrow();
      expect(() => chromeEnvironmentTemplate.storage.localStorage.removeItem('k')).not.toThrow();
      expect(() => chromeEnvironmentTemplate.storage.localStorage.clear()).not.toThrow();
    });
  });

  describe('other (global constructors)', () => {
    it('exports standard JavaScript globals', () => {
      expect(chromeEnvironmentTemplate.other.JSON).toBe(JSON);
      expect(chromeEnvironmentTemplate.other.Math).toBe(Math);
      expect(chromeEnvironmentTemplate.other.Date).toBe(Date);
      expect(chromeEnvironmentTemplate.other.Array).toBe(Array);
      expect(chromeEnvironmentTemplate.other.Object).toBe(Object);
      expect(chromeEnvironmentTemplate.other.String).toBe(String);
      expect(chromeEnvironmentTemplate.other.Number).toBe(Number);
      expect(chromeEnvironmentTemplate.other.Boolean).toBe(Boolean);
      expect(chromeEnvironmentTemplate.other.RegExp).toBe(RegExp);
      expect(chromeEnvironmentTemplate.other.Error).toBe(Error);
      expect(chromeEnvironmentTemplate.other.Promise).toBe(Promise);
      expect(chromeEnvironmentTemplate.other.Map).toBe(Map);
      expect(chromeEnvironmentTemplate.other.Set).toBe(Set);
      expect(chromeEnvironmentTemplate.other.WeakMap).toBe(WeakMap);
      expect(chromeEnvironmentTemplate.other.WeakSet).toBe(WeakSet);
      expect(chromeEnvironmentTemplate.other.Symbol).toBe(Symbol);
      expect(chromeEnvironmentTemplate.other.Proxy).toBe(Proxy);
      expect(chromeEnvironmentTemplate.other.Reflect).toBe(Reflect);
    });
  });
});

describe('getChromeEnvironment', () => {
  it('returns a new object on every call (deep clone)', () => {
    const env1 = getChromeEnvironment();
    const env2 = getChromeEnvironment();
    expect(env1).not.toBe(env2);
    expect(env1).toEqual(env2);
  });

  it('mutations to the returned object do not affect the template', () => {
    const env = getChromeEnvironment();
    (env as Record<string, unknown>)['window'] = 'modified';
    const fresh = getChromeEnvironment();
    expect(typeof fresh['window']).toBe('object');
  });

  it('returns a Record<string, unknown>', () => {
    const env = getChromeEnvironment();
    expect(typeof env).toBe('object');
    expect(env).not.toBeNull();
  });

  it('contains expected top-level keys from the template', () => {
    const env = getChromeEnvironment();
    const expectedKeys = [
      'window',
      'navigator',
      'screen',
      'location',
      'document',
      'performance',
      'history',
    ];
    for (const key of expectedKeys) {
      expect(env).toHaveProperty(key);
    }
  });

  it('does not include non-serializable properties (functions, classes)', () => {
    const env = getChromeEnvironment();
    // JSON.parse(JSON.stringify(...)) strips functions and class constructors
    // console methods should be stripped
    const console = env['console'] as Record<string, unknown> | undefined;
    if (console) {
      // After JSON serialization, function values become null or are omitted
      for (const key of Object.keys(console)) {
        expect(typeof console[key]).not.toBe('function');
      }
    }
    // globalFunctions should have values stripped
    expect(env['globalFunctions']).toBeDefined();
    // constructors should have values stripped
    expect(env['constructors']).toBeDefined();
  });
});

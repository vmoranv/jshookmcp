type MutableArrayLikeNumber = {
  length: number;
  [index: number]: number;
};

export const chromeEnvironmentTemplate = {
  window: {
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    screenX: 0,
    screenY: 0,
    screenLeft: 0,
    screenTop: 0,
    devicePixelRatio: 1,
    name: '',
    closed: false,
    length: 0,
    opener: null,
    parent: null,
    top: null,
    self: null,
    frameElement: null,
    frames: [],
  },

  navigator: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    appVersion:
      '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    onLine: true,
    cookieEnabled: true,
    doNotTrack: null,
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webdriver: false,
    pdfViewerEnabled: true,
    product: 'Gecko',
    productSub: '20030107',
    vendorSub: '',
    appName: 'Netscape',
    appCodeName: 'Mozilla',
  },

  screen: {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: {
      type: 'landscape-primary',
      angle: 0,
    },
  },

  location: {
    href: 'https://www.example.com/',
    origin: 'https://www.example.com',
    protocol: 'https:',
    host: 'www.example.com',
    hostname: 'www.example.com',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
  },

  document: {
    documentElement: {},
    head: {},
    body: {},
    title: '',
    URL: 'https://www.example.com/',
    domain: 'www.example.com',
    referrer: '',
    cookie: '',
    readyState: 'complete',
    characterSet: 'UTF-8',
    charset: 'UTF-8',
    inputEncoding: 'UTF-8',
    contentType: 'text/html',
    doctype: {},
    hidden: false,
    visibilityState: 'visible',
  },

  performance: {
    timeOrigin: Date.now(),
    timing: {
      navigationStart: Date.now(),
      unloadEventStart: 0,
      unloadEventEnd: 0,
      redirectStart: 0,
      redirectEnd: 0,
      fetchStart: Date.now(),
      domainLookupStart: Date.now(),
      domainLookupEnd: Date.now(),
      connectStart: Date.now(),
      connectEnd: Date.now(),
      secureConnectionStart: Date.now(),
      requestStart: Date.now(),
      responseStart: Date.now(),
      responseEnd: Date.now(),
      domLoading: Date.now(),
      domInteractive: Date.now(),
      domContentLoadedEventStart: Date.now(),
      domContentLoadedEventEnd: Date.now(),
      domComplete: Date.now(),
      loadEventStart: Date.now(),
      loadEventEnd: Date.now(),
    },
  },

  history: {
    length: 1,
    scrollRestoration: 'auto',
    state: null,
  },

  console: {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    dir: () => {},
    dirxml: () => {},
    table: () => {},
    group: () => {},
    groupCollapsed: () => {},
    groupEnd: () => {},
    clear: () => {},
    count: () => {},
    countReset: () => {},
    assert: () => {},
    time: () => {},
    timeEnd: () => {},
    timeLog: () => {},
  },

  crypto: {
    subtle: {},
    getRandomValues: (arr: MutableArrayLikeNumber) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
  },

  globalFunctions: {
    setTimeout: (_fn: Function, _delay: number) => 0,
    setInterval: (_fn: Function, _delay: number) => 0,
    clearTimeout: (_id: number) => {},
    clearInterval: (_id: number) => {},
    requestAnimationFrame: (_callback: Function) => 0,
    cancelAnimationFrame: (_id: number) => {},
    atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
    fetch: () => Promise.resolve(new Response()),
  },

  constructors: {
    XMLHttpRequest: class XMLHttpRequest {
      open() {}
      send() {}
      setRequestHeader() {}
      addEventListener() {}
    },
    WebSocket: class WebSocket {
      constructor(_url: string) {}
      send() {}
      close() {}
      addEventListener() {}
    },
    Blob: class Blob {
      constructor(_parts: unknown[], _options?: unknown) {}
    },
    File: class File extends Blob {
      constructor(parts: BlobPart[], _name: string, options?: BlobPropertyBag) {
        super(parts, options);
      }
    },
    FormData: class FormData {
      append() {}
      delete() {}
      get() {}
      getAll() {}
      has() {}
      set() {}
    },
    Headers: class Headers {
      append() {}
      delete() {}
      get() {}
      has() {}
      set() {}
    },
    Request: class Request {
      constructor(_input: unknown, _init?: unknown) {}
    },
    Response: class Response {
      constructor(_body?: unknown, _init?: unknown) {}
    },
    URL: class URL {
      constructor(_url: string, _base?: string) {}
    },
    URLSearchParams: class URLSearchParams {
      constructor(_init?: unknown) {}
      append() {}
      delete() {}
      get() {}
      getAll() {}
      has() {}
      set() {}
    },
  },

  storage: {
    localStorage: {
      length: 0,
      clear: () => {},
      getItem: (_key: string) => null,
      setItem: (_key: string, _value: string) => {},
      removeItem: (_key: string) => {},
      key: (_index: number) => null,
    },
    sessionStorage: {
      length: 0,
      clear: () => {},
      getItem: (_key: string) => null,
      setItem: (_key: string, _value: string) => {},
      removeItem: (_key: string) => {},
      key: (_index: number) => null,
    },
  },

  other: {
    JSON: JSON,
    Math: Math,
    Date: Date,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    RegExp: RegExp,
    Error: Error,
    Promise: Promise,
    Map: Map,
    Set: Set,
    WeakMap: WeakMap,
    WeakSet: WeakSet,
    Symbol: Symbol,
    Proxy: Proxy,
    Reflect: Reflect,
  },
};

export function getChromeEnvironment(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(chromeEnvironmentTemplate)) as Record<string, unknown>;
}

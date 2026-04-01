import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInfo } from '@modules/browser/BrowserDiscovery';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const chromeState = vi.hoisted(() => ({
  ctor: vi.fn(),
  instances: [] as any[],
  launchImpl: null as null | ((instance: any) => Promise<any>),
}));

const camoufoxState = vi.hoisted(() => ({
  ctor: vi.fn(),
  instances: [] as any[],
  launchImpl: null as null | ((instance: any) => Promise<any>),
}));

const discoveryState = vi.hoisted(() => ({
  discoverBrowsers: vi.fn<() => Promise<BrowserInfo[]>>(async () => []),
}));

const connectMock = vi.hoisted(() => vi.fn());

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/modules/browser/BrowserModeManager', () => {
  class BrowserModeManager {
    __modeConfig: any;
    __launchOptions: any;
    private browser: any = null;
    private page = { id: 'chrome-page' };
    launch = vi.fn(async () =>
      chromeState.launchImpl
        ? await chromeState.launchImpl(this)
        : (this.browser ?? (this.browser = { isConnected: vi.fn(() => true) })),
    );
    newPage = vi.fn(async () => this.page);
    goto = vi.fn(async (_url: string, targetPage?: any) => targetPage ?? this.page);
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);

    constructor(modeConfig: any, launchOptions: any) {
      chromeState.ctor(modeConfig, launchOptions);
      this.__modeConfig = modeConfig;
      this.__launchOptions = launchOptions;
      chromeState.instances.push(this);
    }
  }

  return { BrowserModeManager };
});

vi.mock('@src/modules/browser/CamoufoxBrowserManager', () => {
  class CamoufoxBrowserManager {
    __config: any;
    private browser: any = null;
    private page = { id: 'camoufox-page' };
    launch = vi.fn(async () =>
      camoufoxState.launchImpl
        ? await camoufoxState.launchImpl(this)
        : (this.browser ?? (this.browser = { isConnected: vi.fn(() => true) })),
    );
    connectToServer = vi.fn(
      async () => this.browser ?? (this.browser = { isConnected: vi.fn(() => true) }),
    );
    newPage = vi.fn(async () => this.page);
    goto = vi.fn(async (_url: string, targetPage?: any) => targetPage ?? this.page);
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);

    constructor(config: any) {
      camoufoxState.ctor(config);
      this.__config = config;
      camoufoxState.instances.push(this);
    }
  }

  return {
    CamoufoxBrowserManager,
  };
});

vi.mock('@src/modules/browser/BrowserDiscovery', () => {
  class BrowserDiscovery {
    discoverBrowsers = discoveryState.discoverBrowsers;
  }
  return { BrowserDiscovery };
});

vi.mock('rebrowser-puppeteer-core', () => ({
  connect: connectMock,
}));

import { UnifiedBrowserManager } from '@modules/browser/UnifiedBrowserManager';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('UnifiedBrowserManager coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeState.instances.length = 0;
    camoufoxState.instances.length = 0;
    chromeState.launchImpl = null;
    camoufoxState.launchImpl = null;
    discoveryState.discoverBrowsers.mockReset();
    discoveryState.discoverBrowsers.mockResolvedValue([]);
  });

  it('launches Chrome in headed mode when requested', async () => {
    const manager = new UnifiedBrowserManager({
      driver: 'chrome',
      headless: false,
    });

    await manager.launch();

    expect(chromeState.ctor).toHaveBeenCalledTimes(1);
    const chromeInstance = chromeState.instances[0]!;
    expect(chromeInstance.__modeConfig.defaultHeadless).toBe(false);
    expect(chromeInstance.__launchOptions.headless).toBe(false);
  });

  it('uses shell headless mode for Chrome', async () => {
    const manager = new UnifiedBrowserManager({
      driver: 'chrome',
      headless: 'shell',
      args: ['--custom-arg'],
      proxy: { server: 'http://127.0.0.1:8888' },
      debugPort: 9222,
    });

    await manager.launch();

    const chromeInstance = chromeState.instances[0]!;
    expect(chromeInstance.__modeConfig.defaultHeadless).toBe(true);
    expect(chromeInstance.__launchOptions.headless).toBe('shell');
    expect(chromeInstance.__launchOptions.args).toContain('--custom-arg');
    expect(chromeInstance.__launchOptions.args).toContain('--proxy-server=http://127.0.0.1:8888');
    expect(chromeInstance.__launchOptions.args).toContain('--remote-debugging-port=9222');
  });

  it('launches Camoufox with virtual headless mode', async () => {
    const manager = new UnifiedBrowserManager({
      driver: 'camoufox',
      headless: 'virtual',
      os: 'linux',
    });

    await manager.launch();

    expect(camoufoxState.ctor).toHaveBeenCalledTimes(1);
    const camoufoxInstance = camoufoxState.instances[0]!;
    expect(camoufoxInstance.__config.headless).toBe('virtual');
    expect(camoufoxInstance.__config.os).toBe('linux');
  });

  it('reuses a connected Chrome browser on repeated launches', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });

    await manager.launch();
    const firstBrowser = chromeState.instances[0]!.getBrowser();
    const again = await manager.launch();

    expect(again).toBe(firstBrowser);
    expect(chromeState.ctor).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent Chrome launches', async () => {
    const deferred = createDeferred<any>();
    chromeState.launchImpl = () => deferred.promise;

    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    const first = manager.launch();
    const second = manager.launch();

    expect(chromeState.ctor).toHaveBeenCalledTimes(1);
    deferred.resolve({ isConnected: vi.fn(() => true) });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('deduplicates concurrent Camoufox launches', async () => {
    const deferred = createDeferred<any>();
    camoufoxState.launchImpl = () => deferred.promise;

    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });
    const first = manager.launch();
    const second = manager.launch();

    expect(camoufoxState.ctor).toHaveBeenCalledTimes(1);
    deferred.resolve({ isConnected: vi.fn(() => true) });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('throws while Chrome is closing before launch starts', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    Reflect.set(manager as object, 'isClosing', true);

    await expect(manager.launch()).rejects.toThrow(/closing/i);
  });

  it('lazily launches Camoufox from newPage', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });

    const page = await manager.newPage();

    expect(camoufoxState.ctor).toHaveBeenCalledTimes(1);
    expect(page).toEqual({ id: 'camoufox-page' });
    expect(manager.getActivePage()).toEqual({ id: 'camoufox-page' });
  });

  it('connects to an existing Camoufox browser', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });
    await manager.connect('ws://127.0.0.1:9333');

    expect(camoufoxState.instances[0]!.connectToServer).toHaveBeenCalledWith('ws://127.0.0.1:9333');
    expect(manager.getBrowser()).toBe(camoufoxState.instances[0]!.getBrowser());
  });

  it('reuses a connected Camoufox browser on repeated launches', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });

    await manager.launch();
    const firstBrowser = camoufoxState.instances[0]!.getBrowser();
    const again = await manager.launch();

    expect(again).toBe(firstBrowser);
    expect(camoufoxState.ctor).toHaveBeenCalledTimes(1);
  });

  it('throws while Camoufox is closing before launch starts', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });
    Reflect.set(manager as object, 'isClosing', true);

    await expect(manager.launch()).rejects.toThrow(/closing/i);
  });

  it('connects to an existing Chrome browser and disconnects on close', async () => {
    const browser = {
      disconnect: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    connectMock.mockResolvedValue(browser);

    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    await manager.connect('ws://127.0.0.1:9222');
    await manager.close();

    expect(connectMock).toHaveBeenCalledWith({
      browserWSEndpoint: 'ws://127.0.0.1:9222',
      defaultViewport: null,
    });
    expect(browser.disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes Camoufox managers through their own close path', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });
    await manager.newPage();
    await manager.close();

    expect(camoufoxState.instances[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('closes cleanly when no browser has been launched', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });

    await expect(manager.close()).resolves.toBeUndefined();
  });

  it('returns null when no Chrome browser with a preferred debug port is found', async () => {
    discoveryState.discoverBrowsers.mockResolvedValue([
      { type: 'firefox', pid: 1, debugPort: 9222 },
      { type: 'chrome', pid: 2, debugPort: 9999 },
    ]);

    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    const found = await manager.findChromeWithDebugPort([9222]);
    const attached = await manager.attachToExistingChrome([9222]);

    expect(found).toBeNull();
    expect(attached).toBeNull();
    expect(loggerState.info).toHaveBeenCalledWith(
      'No existing Chrome browser with debug port found',
    );
  });

  it('reports status and active page state', async () => {
    const manager = new UnifiedBrowserManager({
      driver: 'chrome',
      headless: false,
      debugPort: 9333,
    });

    await manager.newPage();
    const status = manager.getStatus();

    expect(status).toEqual({
      driver: 'chrome',
      running: true,
      hasActivePage: true,
      headless: false,
      debugPort: 9333,
    });
  });

  it('uses the explicit page when navigating on Chrome', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    const page = await manager.newPage();

    await manager.goto('https://example.com', page);

    expect(chromeState.instances[0]!.goto).toHaveBeenCalledWith('https://example.com', page);
  });

  it('lazily launches Chrome from goto when no page exists', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });

    await manager.goto('https://example.com');

    expect(chromeState.ctor).toHaveBeenCalledTimes(1);
    expect(chromeState.instances[0]!.goto).toHaveBeenCalledWith('https://example.com', null);
  });

  it('lazily launches Camoufox from goto when no page exists', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });

    await manager.goto('https://example.com');

    expect(camoufoxState.ctor).toHaveBeenCalledTimes(1);
    expect(camoufoxState.instances[0]!.goto).toHaveBeenCalledWith('https://example.com', null);
  });
});

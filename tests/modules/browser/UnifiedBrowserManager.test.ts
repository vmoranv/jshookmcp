import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const chromeState = vi.hoisted(() => ({
  ctor: null as any,
  instances: [] as any[],
}));

const camoufoxState = vi.hoisted(() => ({
  ctor: null as any,
  instances: [] as any[],
}));

const discoveryState = vi.hoisted(() => ({
  discoverBrowsers: vi.fn(async () => []),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/modules/browser/BrowserModeManager.js', () => {
  const ctorSpy = vi.fn();
  chromeState.ctor = ctorSpy;

  class BrowserModeManager {
    __modeConfig: any;
    __launchOptions: any;
    private browser = { isConnected: vi.fn(() => true) };
    private page = { id: 'chrome-page' };
    launch = vi.fn(async () => this.browser);
    newPage = vi.fn(async () => this.page);
    goto = vi.fn(async (_url: string, targetPage?: unknown) => targetPage ?? this.page);
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);

    constructor(modeConfig: any, launchOptions: any) {
      ctorSpy(modeConfig, launchOptions);
      this.__modeConfig = modeConfig;
      this.__launchOptions = launchOptions;
      chromeState.instances.push(this);
    }
  }

  return { BrowserModeManager };
});

vi.mock('../../../src/modules/browser/CamoufoxBrowserManager.js', () => {
  const ctorSpy = vi.fn();
  camoufoxState.ctor = ctorSpy;

  class CamoufoxBrowserManager {
    __config: any;
    private browser = { isConnected: vi.fn(() => true) };
    private page = { id: 'camoufox-page' };
    launch = vi.fn(async () => this.browser);
    connectToServer = vi.fn(async () => this.browser);
    newPage = vi.fn(async () => this.page);
    goto = vi.fn(async (_url: string, targetPage?: unknown) => targetPage ?? this.page);
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);

    constructor(config: any) {
      ctorSpy(config);
      this.__config = config;
      camoufoxState.instances.push(this);
    }
  }

  return {
    CamoufoxBrowserManager,
  };
});

vi.mock('../../../src/modules/browser/BrowserDiscovery.js', () => {
  class BrowserDiscovery {
    discoverBrowsers = discoveryState.discoverBrowsers;
  }
  return { BrowserDiscovery };
});

import { UnifiedBrowserManager } from '../../../src/modules/browser/UnifiedBrowserManager.js';

describe('UnifiedBrowserManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
    loggerState.debug.mockReset();

    chromeState.instances.length = 0;
    camoufoxState.instances.length = 0;
    chromeState.ctor?.mockClear?.();
    camoufoxState.ctor?.mockClear?.();
    discoveryState.discoverBrowsers.mockReset();
    discoveryState.discoverBrowsers.mockResolvedValue([]);
  });

  it('launches Chrome with normalized headless mode and merged launch args', async () => {
    const manager = new UnifiedBrowserManager({
      driver: 'chrome',
      headless: 'virtual',
      args: ['--custom-arg'],
      proxy: { server: 'http://127.0.0.1:8888' },
      debugPort: 9222,
    });

    await manager.launch();

    expect(chromeState.ctor).toHaveBeenCalledTimes(1);
    const chromeInstance = chromeState.instances[0]!;
    expect(chromeInstance.__modeConfig.defaultHeadless).toBe(true);
    expect(chromeInstance.__launchOptions.headless).toBe(true);
    expect(chromeInstance.__launchOptions.args).toContain('--custom-arg');
    expect(chromeInstance.__launchOptions.args).toContain('--proxy-server=http://127.0.0.1:8888');
    expect(chromeInstance.__launchOptions.args).toContain('--remote-debugging-port=9222');
  });

  it('launches Camoufox with driver-specific headless normalization', async () => {
    const manager = new UnifiedBrowserManager({
      driver: 'camoufox',
      headless: 'shell',
      os: 'linux',
      proxy: { server: 'socks5://127.0.0.1:9000' },
    });

    await manager.launch();

    expect(camoufoxState.ctor).toHaveBeenCalledTimes(1);
    const camoufoxInstance = camoufoxState.instances[0]!;
    expect(camoufoxInstance.__config.headless).toBe(true);
    expect(camoufoxInstance.__config.os).toBe('linux');
    expect(camoufoxInstance.__config.proxy).toEqual({ server: 'socks5://127.0.0.1:9000' });
  });

  it('creates new pages lazily and tracks active page state', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });

    const page = await manager.newPage();

    expect(chromeState.instances).toHaveLength(1);
    expect(chromeState.instances[0]!.launch).toHaveBeenCalledTimes(1);
    expect(chromeState.instances[0]!.newPage).toHaveBeenCalledTimes(1);
    expect(page).toEqual({ id: 'chrome-page' });
    expect(manager.getActivePage()).toEqual({ id: 'chrome-page' });
  });

  it('delegates navigation for camoufox using active page context', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });
    const page = await manager.newPage();

    await manager.goto('https://example.com/path');

    expect(camoufoxState.instances[0]!.goto).toHaveBeenCalledWith('https://example.com/path', page);
  });

  it('finds Chrome/Edge instances with preferred debug ports', async () => {
    discoveryState.discoverBrowsers.mockResolvedValue([
      { type: 'firefox', pid: 1, debugPort: 9222 },
      { type: 'chrome', pid: 2, debugPort: 9333 },
      { type: 'edge', pid: 3, debugPort: 9229 },
    ]);
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });

    const found = await manager.findChromeWithDebugPort([9229, 9333]);

    expect(found).toEqual({ type: 'chrome', pid: 2, debugPort: 9333 });
  });

  it('returns null when attach-to-existing Chrome connection fails', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    vi.spyOn(manager as any, 'findChromeWithDebugPort').mockResolvedValue({
      type: 'chrome',
      pid: 99,
      debugPort: 9222,
    });
    const connectSpy = vi
      .spyOn(manager as any, 'connectChrome')
      .mockRejectedValue(new Error('connection failed'));

    const browser = await manager.attachToExistingChrome([9222]);

    expect(connectSpy).toHaveBeenCalledWith('ws://127.0.0.1:9222');
    expect(browser).toBeNull();
  });

  it('closes active manager and resets active page', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    await manager.newPage();

    await manager.close();

    expect(chromeState.instances[0]!.close).toHaveBeenCalledTimes(1);
    expect(manager.getActivePage()).toBeNull();
  });
});

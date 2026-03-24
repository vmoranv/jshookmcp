import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInfo } from '@modules/browser/BrowserDiscovery';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const chromeState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ctor: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  instances: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  launchImpl: null as null | ((instance: any) => Promise<any>),
}));

const camoufoxState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ctor: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  instances: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  launchImpl: null as null | ((instance: any) => Promise<any>),
}));

const discoveryState = vi.hoisted(() => ({
  discoverBrowsers: vi.fn<() => Promise<BrowserInfo[]>>(async () => []),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/browser/BrowserModeManager', () => {
  const ctorSpy = vi.fn();
  chromeState.ctor = ctorSpy;

  class BrowserModeManager {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    __modeConfig: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    __launchOptions: any;
    private browser = { isConnected: vi.fn(() => true) };
    private page = { id: 'primary-browser-page' };
    launch = vi.fn(async () =>
      chromeState.launchImpl ? chromeState.launchImpl(this) : this.browser,
    );
    newPage = vi.fn(async () => this.page);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    goto = vi.fn(async (_url: string, targetPage?: any) => targetPage ?? this.page);
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    constructor(modeConfig: any, launchOptions: any) {
      ctorSpy(modeConfig, launchOptions);
      this.__modeConfig = modeConfig;
      this.__launchOptions = launchOptions;
      chromeState.instances.push(this);
    }
  }

  return { BrowserModeManager };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/browser/CamoufoxBrowserManager', () => {
  const ctorSpy = vi.fn();
  camoufoxState.ctor = ctorSpy;

  class CamoufoxBrowserManager {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    __config: any;
    private browser = { isConnected: vi.fn(() => true) };
    private page = { id: 'camoufox-page' };
    launch = vi.fn(async () =>
      camoufoxState.launchImpl ? camoufoxState.launchImpl(this) : this.browser,
    );
    connectToServer = vi.fn(async () => this.browser);
    newPage = vi.fn(async () => this.page);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    goto = vi.fn(async (_url: string, targetPage?: any) => targetPage ?? this.page);
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/browser/BrowserDiscovery', () => {
  class BrowserDiscovery {
    discoverBrowsers = discoveryState.discoverBrowsers;
  }
  return { BrowserDiscovery };
});

import { UnifiedBrowserManager } from '@modules/browser/UnifiedBrowserManager';

describe('UnifiedBrowserManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.info.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.warn.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.error.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.debug.mockReset();

    chromeState.instances.length = 0;
    camoufoxState.instances.length = 0;
    chromeState.launchImpl = null;
    camoufoxState.launchImpl = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    chromeState.ctor?.mockClear?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    camoufoxState.ctor?.mockClear?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    discoveryState.discoverBrowsers.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(chromeInstance.__modeConfig.defaultHeadless).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(chromeInstance.__launchOptions.headless).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(chromeInstance.__launchOptions.args).toContain('--custom-arg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(chromeInstance.__launchOptions.args).toContain('--proxy-server=http://127.0.0.1:8888');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(camoufoxInstance.__config.headless).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(camoufoxInstance.__config.os).toBe('linux');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(camoufoxInstance.__config.proxy).toEqual({ server: 'socks5://127.0.0.1:9000' });
  });

  it('creates new pages lazily and tracks active page state', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });

    const page = await manager.newPage();

    expect(chromeState.instances).toHaveLength(1);
    expect(chromeState.instances[0]!.launch).toHaveBeenCalledTimes(1);
    expect(chromeState.instances[0]!.newPage).toHaveBeenCalledTimes(1);
    expect(page).toEqual({ id: 'primary-browser-page' });
    expect(manager.getActivePage()).toEqual({ id: 'primary-browser-page' });
  });

  it('delegates navigation for camoufox using active page context', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'camoufox' });
    const page = await manager.newPage();

    await manager.goto('https://vmoranv.github.io/jshookmcp/path');

    expect(camoufoxState.instances[0]!.goto).toHaveBeenCalledWith(
      'https://vmoranv.github.io/jshookmcp/path',
      page,
    );
  });

  it('finds Chrome/Edge instances with preferred debug ports', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(manager as any, 'findChromeWithDebugPort').mockResolvedValue({
      type: 'chrome',
      pid: 99,
      debugPort: 9222,
    });
    const connectSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .spyOn(manager as any, 'connectChrome')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

  it('does not wait for an in-flight Chrome launch before closing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    let resolveLaunch!: (value: any) => void;
    const pendingLaunch = new Promise((resolve) => {
      resolveLaunch = resolve;
    });
    chromeState.launchImpl = () => pendingLaunch;

    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    const launchPromise = manager.launch();

    await Promise.resolve();
    expect(chromeState.instances).toHaveLength(1);

    const closeResult = await Promise.race([
      manager.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);

    expect(closeResult).toBe('closed');
    expect(chromeState.instances[0]!.close).toHaveBeenCalledTimes(1);

    resolveLaunch({ isConnected: vi.fn(() => true) });
    await expect(launchPromise).resolves.toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      isConnected: expect.any(Function),
    });
  });
});

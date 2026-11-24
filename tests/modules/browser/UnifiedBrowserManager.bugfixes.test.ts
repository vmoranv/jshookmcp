import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const chromeState = vi.hoisted(() => ({
  instances: [] as any[],
  launchImpl: null as null | ((instance: any) => Promise<any>),
}));

const discoveryState = vi.hoisted(() => ({
  discoverBrowsers: vi.fn(async () => []),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/modules/browser/BrowserModeManager', () => {
  class BrowserModeManager {
    private browser = { connected: true };
    launch = vi.fn(async () =>
      chromeState.launchImpl ? chromeState.launchImpl(this) : this.browser,
    );
    newPage = vi.fn(async () => ({}));
    goto = vi.fn(async () => ({}));
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);
    constructor() {
      chromeState.instances.push(this);
    }
  }
  return { BrowserModeManager };
});

vi.mock('@src/modules/browser/BrowserDiscovery', () => ({
  BrowserDiscovery: class {
    discoverBrowsers() {
      return discoveryState.discoverBrowsers();
    }
  },
}));

import { UnifiedBrowserManager } from '@modules/browser/UnifiedBrowserManager';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('UnifiedBrowserManager bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeState.instances = [];
    chromeState.launchImpl = null;
  });

  it('close() waits for an in-flight chrome launch and closes it', async () => {
    const gate = deferred<any>();
    chromeState.launchImpl = async () => {
      await gate.promise;
      return { connected: true };
    };

    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    const launchPromise = manager.launch();

    const closePromise = manager.close();
    // While close is pending, let the launch finish.
    gate.resolve(null);

    await launchPromise;
    await closePromise;

    // The manager created by the in-flight launch must have been closed.
    expect(chromeState.instances).toHaveLength(1);
    expect(chromeState.instances[0]?.close).toHaveBeenCalled();
  });
});

const puppeteerConnectMock = vi.hoisted(() => vi.fn());
vi.mock('rebrowser-puppeteer-core', () => ({ connect: puppeteerConnectMock }));

describe('UnifiedBrowserManager connect lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeState.instances = [];
    chromeState.launchImpl = null;
  });

  it('releases a connection that completes after close() already finished', async () => {
    const gate = deferred<any>();
    puppeteerConnectMock.mockReturnValue(gate.promise);
    const attached = { connected: true, disconnect: vi.fn(async () => {}) };

    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    const connectPromise = manager.connect('ws://127.0.0.1:9222');
    const connectRejection = expect(connectPromise).rejects.toThrow(/close was requested/);

    await manager.close();
    gate.resolve(attached);

    await connectRejection;
    expect(attached.disconnect).toHaveBeenCalledTimes(1);
    expect(manager.getBrowser()).toBeNull();
  });

  it('closes the previously launched manager before replacing it with an attachment', async () => {
    const manager = new UnifiedBrowserManager({ driver: 'chrome' });
    await manager.launch();
    const launchedManager = chromeState.instances[0];
    expect(launchedManager?.close).not.toHaveBeenCalled();

    const attached = { connected: true, disconnect: vi.fn(async () => {}) };
    puppeteerConnectMock.mockResolvedValue(attached);

    await manager.connect('ws://127.0.0.1:9222');

    // Replacing a launched manager without closing it leaks the Chrome process.
    expect(launchedManager?.close).toHaveBeenCalledTimes(1);
    expect(manager.getBrowser()).toBe(attached);
  });
});

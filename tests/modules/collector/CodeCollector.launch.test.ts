import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuppeteerConfig } from '@internal-types/index';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  connectPlaywrightCdpFallback: vi.fn(),
  findBrowserExecutable: vi.fn(),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: mocks.launch,
    connect: mocks.connect,
  },
  launch: mocks.launch,
  connect: mocks.connect,
}));

vi.mock('@modules/collector/playwright-cdp-fallback', () => ({
  connectPlaywrightCdpFallback: mocks.connectPlaywrightCdpFallback,
}));

vi.mock('@utils/browserExecutable', () => ({
  findBrowserExecutable: mocks.findBrowserExecutable,
}));

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CodeCollector } from '@modules/collector/CodeCollector';

function createBrowserMock() {
  return {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockReturnValue({ pid: 12345 }),
    targets: vi.fn().mockReturnValue([]),
    version: vi.fn().mockResolvedValue('Chrome/123'),
  } as any;
}

const baseConfig: PuppeteerConfig = {
  headless: true,
  timeout: 1000,
};

describe('CodeCollector launch options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBrowserExecutable.mockReturnValue(undefined);
    mocks.connectPlaywrightCdpFallback.mockRejectedValue(new Error('fallback unavailable'));
  });

  it('merges custom args with js-flags and reuses identical launch options', async () => {
    const browser = createBrowserMock();
    mocks.launch.mockResolvedValue(browser);

    const collector = new CodeCollector(baseConfig);
    const first = await collector.launch({
      args: ['--site-per-process', '--js-flags=--trace-opt'],
      enableV8NativesSyntax: true,
    });
    const second = await collector.launch({
      args: ['--site-per-process', '--js-flags=--trace-opt'],
      enableV8NativesSyntax: true,
    });

    expect(first.action).toBe('launched');
    expect(second.action).toBe('reused');
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          '--site-per-process',
          '--js-flags=--trace-opt --allow-natives-syntax',
        ]),
      }),
    );
  });

  it('relaunches when effective launch options change', async () => {
    const browser1 = createBrowserMock();
    const browser2 = createBrowserMock();
    mocks.launch.mockResolvedValueOnce(browser1).mockResolvedValueOnce(browser2);

    const collector = new CodeCollector(baseConfig);
    await collector.launch({ headless: true });
    const relaunched = await collector.launch({
      headless: false,
      enableV8NativesSyntax: true,
    });

    expect(relaunched.action).toBe('relaunched');
    expect(relaunched.reason).toBe('launch-options-changed');
    expect(browser1.close).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.launch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        headless: false,
        args: expect.arrayContaining(['--js-flags=--allow-natives-syntax']),
      }),
    );
  });

  it('removes allow-natives-syntax when explicitly disabled', async () => {
    const browser = createBrowserMock();
    mocks.launch.mockResolvedValue(browser);

    const collector = new CodeCollector({
      ...baseConfig,
      args: ['--js-flags=--allow-natives-syntax --trace-opt'],
    });
    const result = await collector.launch({ enableV8NativesSyntax: false });

    expect(result.launchOptions.v8NativeSyntaxEnabled).toBe(false);
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--js-flags=--trace-opt']),
      }),
    );
    expect(
      (mocks.launch.mock.calls[0]?.[0] as { args?: string[] } | undefined)?.args ?? [],
    ).not.toContain('--js-flags=--allow-natives-syntax --trace-opt');
  });

  it('closes a locally launched browser before attaching to an existing browser', async () => {
    const localBrowser = createBrowserMock();
    const attachedBrowser = createBrowserMock();
    mocks.launch.mockResolvedValue(localBrowser);
    mocks.connect.mockResolvedValue(attachedBrowser);

    const collector = new CodeCollector(baseConfig);
    await collector.launch();
    await collector.connect({ wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test' });

    expect(localBrowser.close).toHaveBeenCalledOnce();
    expect(localBrowser.disconnect).not.toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalledWith({
      browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
      defaultViewport: null,
    });
  });
});

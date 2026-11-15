import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const connectState = vi.hoisted(() => ({
  connect: vi.fn(),
}));

const fallbackState = vi.hoisted(() => ({
  connectPlaywrightCdpFallback: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

vi.mock('rebrowser-puppeteer-core', () => ({
  connect: connectState.connect,
}));

vi.mock('@modules/collector/playwright-cdp-fallback', () => ({
  connectPlaywrightCdpFallback: fallbackState.connectPlaywrightCdpFallback,
}));

import { connectWithTimeoutImpl } from '@modules/collector/CodeCollectorConnectionInternal';
import { BROWSER_PROTOCOL_TIMEOUT_MS } from '@src/constants';

function makeBrowser() {
  return {
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
}

describe('connectWithTimeout attempt superseding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discards a stale fallback result when a newer attempt started meanwhile', async () => {
    const ref = { current: 0 };
    const hanging = new Promise<never>(() => {});
    const browserB = makeBrowser();
    const browserF = makeBrowser();

    // Attempt 1: connection hangs -> timeout -> playwright fallback (slow).
    connectState.connect.mockReturnValueOnce(hanging);
    fallbackState.connectPlaywrightCdpFallback.mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(browserF), 30);
        }),
    );
    // Attempt 2: connection succeeds immediately.
    connectState.connect.mockReturnValueOnce(Promise.resolve(browserB));

    const attempt1 = connectWithTimeoutImpl(
      { browserWSEndpoint: 'ws://x' },
      'ws://x',
      { wsEndpoint: 'ws://x' },
      15,
      ref,
    );

    // Start attempt 2 while attempt 1's fallback is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const attempt2 = connectWithTimeoutImpl(
      { browserWSEndpoint: 'ws://x' },
      'ws://x',
      { wsEndpoint: 'ws://x' },
      1000,
      ref,
    );

    await expect(attempt2).resolves.toBe(browserB);
    // The stale fallback browser must be discarded, not returned.
    await expect(attempt1).rejects.toThrow();
    expect(browserF.disconnect).toHaveBeenCalled();
    expect(browserB.disconnect).not.toHaveBeenCalled();
  });

  it('accepts the fallback result when no newer attempt started', async () => {
    const ref = { current: 0 };
    const hanging = new Promise<never>(() => {});
    const browserF = makeBrowser();

    connectState.connect.mockReturnValueOnce(hanging);
    fallbackState.connectPlaywrightCdpFallback.mockResolvedValueOnce(browserF);

    const browser = await connectWithTimeoutImpl(
      { browserWSEndpoint: 'ws://y' },
      'ws://y',
      { wsEndpoint: 'ws://y' },
      15,
      ref,
    );

    expect(browser).toBe(browserF);
    expect(browserF.disconnect).not.toHaveBeenCalled();
  });

  it('forwards BROWSER_PROTOCOL_TIMEOUT_MS to puppeteer.connect', async () => {
    const ref = { current: 0 };
    const browser = makeBrowser();
    connectState.connect.mockResolvedValueOnce(browser);

    await connectWithTimeoutImpl(
      { browserWSEndpoint: 'wss://z' },
      'wss://z',
      { wsEndpoint: 'wss://z' },
      1000,
      ref,
    );

    expect(connectState.connect).toHaveBeenCalledWith(
      expect.objectContaining({ protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS }),
    );
  });
});

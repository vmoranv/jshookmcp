import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PlaywrightNetworkMonitor } from '@modules/monitor/PlaywrightNetworkMonitor';

function makePage() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    evaluate: vi.fn(async () => {}),
    url: vi.fn(() => 'https://example.com/'),
  } as any;
}

describe('PlaywrightNetworkMonitor bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disable() is safe when no page was ever initialized', async () => {
    // monitor with a null page — disable must not throw.
    const monitor = new PlaywrightNetworkMonitor(null as any);
    await expect(monitor.disable()).resolves.toBeUndefined();
    expect(monitor.isEnabled()).toBe(false);
  });

  it('disable() is safe after the page was torn down', async () => {
    const page = makePage();
    const monitor = new PlaywrightNetworkMonitor(page);
    await monitor.enable();

    // Simulate page teardown clearing the reference.
    (monitor as any).page = null;

    await expect(monitor.disable()).resolves.toBeUndefined();
    expect(monitor.isEnabled()).toBe(false);
  });

  it('enable/disable roundtrip still detaches listeners', async () => {
    const page = makePage();
    const monitor = new PlaywrightNetworkMonitor(page);
    await monitor.enable();
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page.on).toHaveBeenCalledWith('response', expect.any(Function));

    await monitor.disable();
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page.off).toHaveBeenCalledWith('response', expect.any(Function));
  });

  it('drops a body captured from before clearRecords()', async () => {
    const handlers: Record<string, (payload: any) => void> = {};
    const page = {
      on: vi.fn((event: string, handler: (payload: any) => void) => {
        handlers[event] = handler;
      }),
      off: vi.fn(),
      evaluate: vi.fn(async () => {}),
    } as any;

    let resolveBody!: (buf: Buffer) => void;
    const bodyPromise = new Promise<Buffer>((resolve) => {
      resolveBody = resolve;
    });
    const req = {
      url: () => 'https://example.com/stale',
      method: () => 'GET',
      headers: () => ({}),
      postData: () => null,
      resourceType: () => 'xhr',
    };
    const res = {
      request: () => req,
      url: () => 'https://example.com/stale',
      status: () => 200,
      statusText: () => 'OK',
      headers: () => ({ 'content-type': 'application/json' }),
      body: () => bodyPromise,
    };

    const monitor = new PlaywrightNetworkMonitor(page);
    await monitor.enable();
    handlers.request!(req);
    handlers.response!(res);
    const requestId = monitor.getRequests()[0]!.requestId;

    monitor.clearRecords();
    resolveBody(Buffer.from('{"late":true}'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await monitor.getResponseBody(requestId)).toBeNull();
  });
});

/**
 * CDPTimingProxy unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CDPTimingProxy, wrapWithJitter } from '@modules/stealth/CDPTimingProxy';
import type { CDPSessionLike } from '@modules/stealth/CDPTimingProxy';

function createMockSession(): CDPSessionLike & {
  _calls: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return {
    _calls: calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    send: vi.fn().mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      return { result: 'ok' };
    }),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('CDPTimingProxy', () => {
  let mockSession: ReturnType<typeof createMockSession>;
  let proxy: CDPTimingProxy;

  beforeEach(() => {
    mockSession = createMockSession();
    proxy = new CDPTimingProxy(mockSession, {
      enabled: true,
      minDelayMs: 10,
      maxDelayMs: 30,
      burstMode: false,
    });
  });

  it('sends through to wrapped session', async () => {
    const result = await proxy.send('Runtime.evaluate', { expression: '1+1' });
    expect(result).toEqual({ result: 'ok' });
    expect(mockSession.send).toHaveBeenCalledWith('Runtime.evaluate', { expression: '1+1' });
  });

  it('adds delay when enabled', async () => {
    const start = Date.now();
    await proxy.send('Runtime.evaluate');
    const elapsed = Date.now() - start;

    // Should have at least minDelayMs of delay
    expect(elapsed).toBeGreaterThanOrEqual(8); // slight tolerance
  });

  it('no delay when disabled', async () => {
    proxy.configure({ enabled: false });

    const start = Date.now();
    await proxy.send('Runtime.evaluate');
    const elapsed = Date.now() - start;

    // Should be very fast when disabled
    expect(elapsed).toBeLessThan(10);
  });

  it('burst mode skips delay', async () => {
    proxy.enterBurstMode();

    const start = Date.now();
    await proxy.send('Runtime.evaluate');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(proxy.getOptions().burstMode).toBe(true);
  });

  it('exitBurstMode restores delay', async () => {
    proxy.enterBurstMode();
    proxy.exitBurstMode();

    expect(proxy.getOptions().burstMode).toBe(false);

    const start = Date.now();
    await proxy.send('Runtime.evaluate');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(8);
  });

  it('configure updates options', () => {
    proxy.configure({ minDelayMs: 50, maxDelayMs: 100 });
    const opts = proxy.getOptions();
    expect(opts.minDelayMs).toBe(50);
    expect(opts.maxDelayMs).toBe(100);
    expect(opts.enabled).toBe(true); // unchanged
  });

  it('on/off pass through to wrapped session', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const handler = () => {};
    proxy.on('event', handler);
    expect(mockSession.on).toHaveBeenCalledWith('event', handler);

    proxy.off('event', handler);
    expect(mockSession.off).toHaveBeenCalledWith('event', handler);
  });

  it('getWrappedSession returns original session', () => {
    expect(proxy.getWrappedSession()).toBe(mockSession);
  });

  it('wrapWithJitter factory creates proxy', () => {
    const session = createMockSession();
    const wrapped = wrapWithJitter(session, { minDelayMs: 5, maxDelayMs: 10 });

    expect(wrapped).toBeInstanceOf(CDPTimingProxy);
    expect(wrapped.getOptions().minDelayMs).toBe(5);
    expect(wrapped.getOptions().maxDelayMs).toBe(10);
  });

  it('getOptions returns copy not reference', () => {
    const opts1 = proxy.getOptions();
    const opts2 = proxy.getOptions();
    expect(opts1).toEqual(opts2);
    expect(opts1).not.toBe(opts2);
  });
});

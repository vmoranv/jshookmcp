import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
  },
  getToolDomain: vi.fn((name: string) => {
    if (name.startsWith('browser_') || name.startsWith('page_')) return 'browser';
    if (name.startsWith('network_')) return 'network';
    return undefined;
  }),
}));

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@server/ToolCatalog', () => ({
  getToolDomain: mocks.getToolDomain,
}));

import { createDomainProxy, resolveEnabledDomains } from '@server/MCPServer.domain';

describe('MCPServer.domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives enabled domains from tool definitions and ignores unknown tools', () => {
    const domains = resolveEnabledDomains([
      { name: 'browser_launch' },
      { name: 'page_navigate' },
      { name: 'network_enable' },
      { name: 'unknown_tool' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ] as any);

    expect(domains).toEqual(new Set(['browser', 'network']));
  });

  it('throws a descriptive error when accessing a disabled domain proxy', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabledDomains: new Set<string>() } as any;
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', () => ({
      open: () => 'ok',
    }));

    expect(() => proxy.open()).toThrow(
      'Browser handlers is unavailable: domain "browser" not enabled by current tool profile'
    );
  });

  it('lazy-initializes once and binds methods to the created instance', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const factory = vi.fn(() => ({
      state: 7,
      read() {
        return this.state;
      },
    }));
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', factory);
    const read = proxy.read;

    expect(read()).toBe(7);
    expect(proxy.read()).toBe(7);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Lazy-initializing Browser handlers for domain "browser"'
    );
  });

  it('detects circular initialization when the factory re-enters the proxy', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    let proxy: { ping: () => string };

    proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', () => {
      proxy.ping();
      return {
        ping: () => 'ok',
      };
    });

    expect(() => proxy.ping()).toThrow(
      'Browser handlers: circular initialization detected for domain "browser"'
    );
  });

  it('allows a later access to retry initialization after a factory failure', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const factory = vi.fn(() => {
      if (factory.mock.calls.length === 1) {
        throw new Error('boom');
      }

      return {
        status: 'ok',
      };
    });
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', factory);

    expect(() => proxy.status).toThrow('boom');
    expect(proxy.status).toBe('ok');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(mocks.logger.info).toHaveBeenCalledTimes(2);
  });
});

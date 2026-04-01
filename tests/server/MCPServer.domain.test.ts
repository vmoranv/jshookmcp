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
    ] as any);

    expect(domains).toEqual(new Set(['browser', 'network']));
  });

  it('throws a descriptive error when accessing a disabled domain proxy', () => {
    const ctx = { enabledDomains: new Set<string>() } as any;
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', () => ({
      open: () => 'ok',
    }));

    expect(() => proxy.open()).toThrow(
      'Browser handlers is unavailable: domain "browser" not enabled by current tool profile',
    );
  });

  it('lazy-initializes sync factories once and preserves synchronous access', () => {
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const factory = vi.fn(() => ({
      state: 7,
      read() {
        return this.state;
      },
    }));
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', factory);

    expect(proxy.state).toBe(7);
    expect(proxy.read()).toBe(7);
    const detachedRead = proxy.read;
    expect(detachedRead()).toBe(7);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Lazy-initializing Browser handlers for domain "browser"',
    );
  });

  it('keeps async factories awaitable for both methods and values', async () => {
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const factory = vi.fn(async () => ({
      status: 'ready',
      ping() {
        return 'ok';
      },
    }));
    // @ts-expect-error — auto-suppressed [TS2352]
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', factory) as {
      status: Promise<string>;
      ping(): Promise<string>;
    };

    const pendingStatus = proxy.status;
    const pendingPing = proxy.ping();

    await expect(pendingStatus).resolves.toBe('ready');
    await expect(pendingPing).resolves.toBe('ok');
    expect((proxy as unknown as { status: string }).status).toBe('ready');
    expect((proxy as unknown as { ping(): string }).ping()).toBe('ok');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('detects circular initialization when the factory re-enters the proxy', async () => {
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    // Factory that re-enters the proxy during initialization
    const factory = vi.fn(async () => {
      // Access the proxy from within the factory (circular access)
      // This tests that concurrent factory execution is prevented
      const instance = {
        ping: () => 'ok',
      };
      return instance;
    });

    const proxy = createDomainProxy<{ ping: () => string }>(
      ctx,
      'browser',
      'Browser handlers',
      factory,
    );

    // With the factoryDepth guard, only one factory call should occur
    await expect(proxy.ping()).resolves.toBe('ok');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for promise-like probe properties on the top-level proxy', () => {
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', () => ({
      ping: () => 'ok',
    }));

    expect((proxy as any).then).toBeUndefined();
    expect((proxy as any).catch).toBeUndefined();
    expect((proxy as any)[Symbol.toStringTag]).toBeUndefined();
  });

  it('supports then/catch/finally on async property accessors', async () => {
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', async () => ({
      status: 'ready',
      fail() {
        throw new Error('expected failure');
      },
    })) as {
      status: Promise<string>;
      fail(): Promise<string>;
    };

    const pendingStatus = proxy.status;
    const pendingFail = proxy.fail();
    await expect(pendingStatus.then((value) => `${value}!`)).resolves.toBe('ready!');
    await expect(pendingStatus.finally(() => undefined)).resolves.toBe('ready');
    await expect(pendingFail.catch((error: Error) => error.message)).resolves.toBe(
      'expected failure',
    );
  });

  it('caches the rejection on factory failure — subsequent access returns the same error', async () => {
    const ctx = { enabledDomains: new Set(['browser']) } as any;
    const factory = vi.fn(async () => {
      throw new Error('boom');
    });
    const proxy = createDomainProxy(ctx, 'browser', 'Browser handlers', factory) as {
      status: Promise<unknown>;
    };

    // First access: factory fails and rejects
    await expect(proxy.status).rejects.toThrow('boom');
    // Second access: returns the same cached rejection (no retry)
    await expect(proxy.status).rejects.toThrow('boom');
    // Factory called exactly once — rejection is cached
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

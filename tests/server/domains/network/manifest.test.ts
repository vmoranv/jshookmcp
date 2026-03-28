import manifest from '@server/domains/network/manifest';
import { describe, expect, it } from 'vitest';

describe('Network Domain Manifest', () => {
  it('has correct domain property', () => {
    expect(manifest.domain).toBe('network');
  });

  it('has kind and version', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
  });

  it('declares tool registrations and covers bindings', async () => {
    const regs = manifest.registrations;
    if (!regs) throw new Error('No registrations');
    expect(regs.length).toBeGreaterThan(0);

    // Cover the lambda bindings dynamically
    const mockHandler = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return undefined; // so it isn't treated as a promise
          return async () => `mocked-${String(prop)}`;
        },
      },
    );

    for (const reg of regs) {
      if (reg.bind && typeof reg.bind !== 'string' && 'invoke' in reg.bind) {
        // Execute the lambda to achieve statement coverage
        const result = await (reg.bind as any).invoke(mockHandler as any, {});
        expect(result).toBeDefined();
      }
    }
  });

  it('can ensure context', () => {
    const mockCtx = {
      browser: {},
      networkMonitor: {},
      collector: {},
      consoleMonitor: {},
    };
    const handlers = manifest.ensure!(mockCtx as any);
    expect(handlers).toBeDefined();

    // Call again to hit the cached branch
    const handlers2 = manifest.ensure!(mockCtx as any);
    expect(handlers2).toBe(handlers);
  });
});

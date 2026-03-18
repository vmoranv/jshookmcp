import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindByDepKey, getDep } from '@server/registry/bind-helpers';

describe('registry/bind-helpers', () => {
  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('returns an existing dependency by key', () => {
    expect(getDep<{ run: boolean }>({ alpha: { run: true } }, 'alpha')).toEqual({ run: true });
  });

  it('treats falsy dependencies as missing and throws', () => {
    expect(() => getDep({ zero: 0 }, 'zero')).toThrow('[registry] Missing dependency: "zero"');
    expect(() => getDep({ empty: '' }, 'empty')).toThrow('[registry] Missing dependency: "empty"');
    expect(() => getDep({}, 'missing')).toThrow('[registry] Missing dependency: "missing"');
  });

  it('binds a dependency lookup into an executable handler', async () => {
    const invoke = vi.fn(async (handler: { run: () => string }, args: Record<string, unknown>) => ({
      value: handler.run(),
      args,
    }));
    const bound = bindByDepKey<{ run: () => string }>('alpha', invoke);
    const handler = bound({ alpha: { run: () => 'ok' } });

    await expect(handler({ id: 1 })).resolves.toEqual({
      value: 'ok',
      args: { id: 1 },
    });
    expect(invoke).toHaveBeenCalledWith({ run: expect.any(Function) }, { id: 1 });
  });
});

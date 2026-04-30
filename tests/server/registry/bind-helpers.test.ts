import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindByDepKey,
  bindMethodByDepKey,
  defineMethodRegistrations,
  getDep,
} from '@server/registry/bind-helpers';

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

  it('binds a typed handler method by name and preserves this', async () => {
    const bound = bindMethodByDepKey<
      {
        prefix: string;
        handleEcho(args: Record<string, unknown>): Promise<unknown>;
      },
      'handleEcho'
    >('alpha', 'handleEcho');
    const handler = bound({
      alpha: {
        prefix: 'ok:',
        async handleEcho(
          this: { prefix: string; handleEcho(args: Record<string, unknown>): Promise<unknown> },
          args: Record<string, unknown>,
        ) {
          return { value: this.prefix + String(args['msg'] ?? '') };
        },
      },
    });

    await expect(handler({ msg: 'x' })).resolves.toEqual({ value: 'ok:x' });
  });

  it('binds a zero-argument async handler method by name', async () => {
    const bound = bindMethodByDepKey<
      {
        handleList(): Promise<unknown>;
      },
      'handleList'
    >('alpha', 'handleList');
    const handler = bound({
      alpha: {
        async handleList() {
          return { items: ['a', 'b'] };
        },
      },
    });

    await expect(handler({ ignored: true })).resolves.toEqual({ items: ['a', 'b'] });
  });

  it('binds a synchronous handler method by name', async () => {
    const bound = bindMethodByDepKey<
      {
        prefix: string;
        handleSync(args: Record<string, unknown>): unknown;
      },
      'handleSync'
    >('alpha', 'handleSync');
    const handler = bound({
      alpha: {
        prefix: 'sync:',
        handleSync(this: { prefix: string }, args: Record<string, unknown>) {
          return { value: this.prefix + String(args['msg'] ?? '') };
        },
      },
    });

    await expect(handler({ msg: 'x' })).resolves.toEqual({ value: 'sync:x' });
  });

  it('binds a mapped multi-argument handler method by name', async () => {
    const bound = bindMethodByDepKey<
      {
        handleInstall(slug: string, targetDir?: string): Promise<unknown>;
      },
      'handleInstall'
    >('alpha', 'handleInstall', {
      mapArgs: (args) => [String(args['slug'] ?? ''), args['targetDir'] as string | undefined],
    });
    const handleInstall = vi.fn(async (slug: string, targetDir?: string) => ({ slug, targetDir }));
    const handler = bound({
      alpha: {
        handleInstall,
      },
    });

    await expect(handler({ slug: 'demo', targetDir: 'plugins' })).resolves.toEqual({
      slug: 'demo',
      targetDir: 'plugins',
    });
    expect(handleInstall).toHaveBeenCalledWith('demo', 'plugins');
  });

  it('defines declarative method registrations with optional wrapping', async () => {
    const registrations = defineMethodRegistrations<
      {
        handlePing(args: Record<string, unknown>): Promise<unknown>;
      },
      'ping'
    >({
      domain: 'demo',
      depKey: 'demoHandlers',
      lookup: (name) => ({ name }) as never,
      wrapResult: (result) => ({ wrapped: result }),
      entries: [{ tool: 'ping', method: 'handlePing' }],
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.tool.name).toBe('ping');
    expect(registrations[0]?.domain).toBe('demo');
    await expect(
      registrations[0]?.bind({
        demoHandlers: {
          async handlePing(args: Record<string, unknown>) {
            return { ok: true, args };
          },
        },
      })({ id: 1 }),
    ).resolves.toEqual({
      wrapped: { ok: true, args: { id: 1 } },
    });
  });

  it('defines declarative registrations with mapped args', async () => {
    const registrations = defineMethodRegistrations<
      {
        handleInstall(slug: string, targetDir?: string): Promise<unknown>;
      },
      'install'
    >({
      domain: 'demo',
      depKey: 'demoHandlers',
      lookup: (name) => ({ name }) as never,
      entries: [
        {
          tool: 'install',
          method: 'handleInstall',
          mapArgs: (args) => [String(args['slug'] ?? ''), args['targetDir'] as string | undefined],
        },
      ],
    });

    expect(registrations).toHaveLength(1);
    await expect(
      registrations[0]?.bind({
        demoHandlers: {
          async handleInstall(slug: string, targetDir?: string) {
            return { slug, targetDir };
          },
        },
      })({ slug: 'demo', targetDir: 'plugins' }),
    ).resolves.toEqual({
      slug: 'demo',
      targetDir: 'plugins',
    });
  });
});

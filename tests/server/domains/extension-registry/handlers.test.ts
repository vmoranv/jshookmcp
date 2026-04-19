import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionRegistryHandlers } from '@server/domains/extension-registry/handlers.impl';

describe('ExtensionRegistryHandlers', () => {
  let registry: {
    listInstalled: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
    loadPlugin: ReturnType<typeof vi.fn>;
    unloadPlugin: ReturnType<typeof vi.fn>;
  };
  let webhook: {
    sendEvent: ReturnType<typeof vi.fn>;
  };
  let handlers: ExtensionRegistryHandlers;

  beforeEach(() => {
    registry = {
      listInstalled: vi.fn().mockReturnValue([]),
      register: vi.fn().mockResolvedValue('plugin-1'),
      unregister: vi.fn().mockResolvedValue(undefined),
      loadPlugin: vi.fn().mockResolvedValue({
        manifest: {
          id: 'plugin-1',
          name: 'test-plugin',
          version: '1.0.0',
          entry: '/tmp/plugin.mjs',
          permissions: [],
        },
        exports: { default: (input: unknown) => input },
      }),
      unloadPlugin: vi.fn().mockResolvedValue(undefined),
    };
    webhook = {
      sendEvent: vi.fn().mockResolvedValue(undefined),
    };
    handlers = new ExtensionRegistryHandlers(registry as any, webhook as any);
  });

  it('lists installed plugins', async () => {
    const result = await handlers.handleListInstalled();
    expect(registry.listInstalled).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
  });

  it('uninstalls a plugin', async () => {
    const result = await handlers.handleUninstall({ pluginId: 'plugin-1' } as any);
    expect(registry.unregister).toHaveBeenCalledWith('plugin-1');
    expect(result.isError).toBeUndefined();
  });

  it('reloads a plugin', async () => {
    const result = await handlers.handleReload({ pluginId: 'plugin-1' } as any);
    expect(registry.unloadPlugin).toHaveBeenCalledWith('plugin-1');
    expect(registry.loadPlugin).toHaveBeenCalledWith('plugin-1');
    expect(result.isError).toBeUndefined();
  });

  it('executes plugin context', async () => {
    const result = await handlers.handleExecuteInContext({
      pluginId: 'plugin-1',
      contextName: 'default',
      args: { ok: true },
    } as any);
    expect(registry.loadPlugin).toHaveBeenCalledWith('plugin-1');
    expect(result.isError).toBeUndefined();
  });
});

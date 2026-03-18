import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
  pathToFileURL: vi.fn((value: string) => ({ href: `file://${value.replace(/\\/g, '/')}` })),
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

vi.mock('node:url', () => ({
  pathToFileURL: state.pathToFileURL,
}));

describe('ExtensionManager.lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts nested config values and falls back safely', async () => {
    const { extractConfigValue } = await import('@server/extensions/ExtensionManager.lifecycle');
    const ctx = {
      config: {
        plugins: {
          sample: {
            enabled: true,
          },
        },
      },
    };

    expect(extractConfigValue(ctx as never, 'plugins.sample.enabled', false)).toBe(true);
    expect(extractConfigValue(ctx as never, 'plugins.sample.missing', 'fallback')).toBe('fallback');
    expect(extractConfigValue({ config: null } as never, 'plugins.sample.enabled', false)).toBe(
      false
    );
  });

  it('creates a fresh file URL with reloadTs and logs the load', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const { createFreshImportUrl } = await import('@server/extensions/ExtensionManager.lifecycle');

    const result = createFreshImportUrl('D:\\plugin\\manifest.ts', 'plugin');

    expect(result).toContain('file:///D:/plugin/manifest.ts');
    expect(result).toContain('reloadTs=12345');
    expect(state.logger.debug).toHaveBeenCalledWith(
      '[extensions] Loading fresh plugin module: D:\\plugin\\manifest.ts'
    );
  });

  it('clears loaded extension tools and tolerates deactivation or removal failures', async () => {
    const { clearLoadedExtensionTools } =
      await import('@server/extensions/ExtensionManager.lifecycle');
    const deactivateOk = vi.fn(async () => undefined);
    const deactivateFail = vi.fn(async () => {
      throw new Error('deactivate failed');
    });
    const removeOk = vi.fn();
    const removeFail = vi.fn(() => {
      throw new Error('remove failed');
    });
    const ctx = {
      extensionPluginRuntimeById: new Map([
        [
          'ok-plugin',
          {
            plugin: { onDeactivateHandler: deactivateOk },
            lifecycleContext: { pluginId: 'ok-plugin' },
            state: 'activated',
          },
        ],
        [
          'fail-plugin',
          {
            plugin: { onDeactivateHandler: deactivateFail },
            lifecycleContext: { pluginId: 'fail-plugin' },
            state: 'activated',
          },
        ],
      ]),
      extensionToolsByName: new Map([
        [
          'tool-a',
          {
            name: 'tool-a',
            registeredTool: { remove: removeOk },
          },
        ],
        [
          'tool-b',
          {
            name: 'tool-b',
            registeredTool: { remove: removeFail },
          },
        ],
      ]),
      extensionPluginsById: new Map([['plugin', {}]]),
      extensionWorkflowsById: new Map([['workflow', {}]]),
      extensionWorkflowRuntimeById: new Map([['workflow', {}]]),
      activatedToolNames: new Set(['tool-a', 'tool-b']),
      activatedRegisteredTools: new Map([
        ['tool-a', {}],
        ['tool-b', {}],
      ]),
      router: {
        removeHandler: vi.fn(),
      },
    };

    await expect(clearLoadedExtensionTools(ctx as never)).resolves.toBe(2);
    expect(deactivateOk).toHaveBeenCalled();
    expect(deactivateFail).toHaveBeenCalled();
    expect(removeOk).toHaveBeenCalled();
    expect(removeFail).toHaveBeenCalled();
    expect(ctx.router.removeHandler).toHaveBeenCalledTimes(2);
    expect(ctx.extensionToolsByName.size).toBe(0);
    expect(ctx.extensionPluginRuntimeById.size).toBe(0);
    expect(ctx.extensionPluginsById.size).toBe(0);
    expect(ctx.extensionWorkflowsById.size).toBe(0);
    expect(ctx.extensionWorkflowRuntimeById.size).toBe(0);
    expect(ctx.activatedToolNames.size).toBe(0);
    expect(ctx.activatedRegisteredTools.size).toBe(0);
    expect(state.logger.warn).toHaveBeenCalled();
  });

  it('builds list results from current extension maps', async () => {
    const { buildListResult } = await import('@server/extensions/ExtensionManager.lifecycle');
    const ctx = {
      extensionPluginsById: new Map([['plugin-a', { id: 'plugin-a', name: 'Plugin A' }]]),
      extensionWorkflowsById: new Map([
        ['workflow-a', { id: 'workflow-a', displayName: 'Workflow A' }],
      ]),
      extensionToolsByName: new Map([
        ['tool-a', { name: 'tool-a', domain: 'browser', source: '/plugin/tool-a' }],
      ]),
      lastExtensionReloadAt: '2026-03-15T00:00:00.000Z',
    };

    expect(buildListResult(ctx as never, ['/plugins'], ['/workflows'])).toEqual({
      pluginRoots: ['/plugins'],
      workflowRoots: ['/workflows'],
      pluginCount: 1,
      workflowCount: 1,
      toolCount: 1,
      lastReloadAt: '2026-03-15T00:00:00.000Z',
      plugins: [{ id: 'plugin-a', name: 'Plugin A' }],
      workflows: [{ id: 'workflow-a', displayName: 'Workflow A' }],
      tools: [{ name: 'tool-a', domain: 'browser', source: '/plugin/tool-a' }],
    });
  });
});

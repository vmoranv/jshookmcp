import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  allTools: [{ name: 'allowed_tool' }, { name: 'other_tool' }],
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  parseRoots: vi.fn((raw: string | undefined, fallback: string[]) => (raw ? [raw] : fallback)),
  resolveRoots: vi.fn((roots: string[]) => roots.map((root) => `resolved:${root}`)),
  sha256Hex: vi.fn(),
  normalizeHex: vi.fn((value: string) => value.trim().toLowerCase()),
  isPluginStrictLoad: vi.fn(),
  parseDigestAllowlist: vi.fn(),
  verifyPluginIntegrity: vi.fn(),
  isExtensionBuilder: vi.fn(),
  isWorkflowContract: vi.fn(),
  discoverPluginFiles: vi.fn(),
  discoverWorkflowFiles: vi.fn(),
  extractConfigValue: vi.fn(),
  createFreshImportUrl: vi.fn(),
  clearLoadedExtensionTools: vi.fn(),
  buildListResult: vi.fn(),
}));

vi.mock('@server/ToolCatalog', () => ({
  allTools: state.allTools,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

vi.mock('@server/extensions/ExtensionManager.roots', () => ({
  DEFAULT_PLUGIN_ROOTS: ['default-plugin-root'],
  DEFAULT_WORKFLOW_ROOTS: ['default-workflow-root'],
  parseRoots: state.parseRoots,
  resolveRoots: state.resolveRoots,
}));

vi.mock('@server/extensions/ExtensionManager.integrity', () => ({
  sha256Hex: state.sha256Hex,
  normalizeHex: state.normalizeHex,
  isPluginStrictLoad: state.isPluginStrictLoad,
  parseDigestAllowlist: state.parseDigestAllowlist,
  verifyPluginIntegrity: state.verifyPluginIntegrity,
}));

vi.mock('@server/extensions/ExtensionManager.guards', () => ({
  isExtensionBuilder: state.isExtensionBuilder,
  isWorkflowContract: state.isWorkflowContract,
}));

vi.mock('@server/extensions/ExtensionManager.discovery', () => ({
  discoverPluginFiles: state.discoverPluginFiles,
  discoverWorkflowFiles: state.discoverWorkflowFiles,
}));

vi.mock('@server/extensions/ExtensionManager.lifecycle', () => ({
  extractConfigValue: state.extractConfigValue,
  createFreshImportUrl: state.createFreshImportUrl,
  clearLoadedExtensionTools: state.clearLoadedExtensionTools,
  buildListResult: state.buildListResult,
}));

function makeDataModule(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      mcp: {
        version: '1.2.3',
      },
    },
    baseTier: 'workflow',
    extensionToolsByName: new Map(),
    extensionPluginsById: new Map(),
    extensionPluginRuntimeById: new Map(),
    extensionWorkflowsById: new Map(),
    extensionWorkflowRuntimeById: new Map(),
    activatedToolNames: new Set<string>(),
    activatedRegisteredTools: new Map(),
    router: {
      has: vi.fn(() => false),
      removeHandler: vi.fn(),
    },
    executeToolWithTracking: vi.fn(async (name: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify({ success: true, name, args }) }],
    })),
    server: {
      sendToolListChanged: vi.fn(async () => undefined),
    },
    ...overrides,
  } as any;
}

describe('ExtensionManager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete (globalThis as Record<string, unknown>).__pluginCtx;
    delete (globalThis as Record<string, unknown>).__rolledBack;
    vi.resetModules();
    vi.clearAllMocks();
    state.parseDigestAllowlist.mockReturnValue(new Set());
    state.isPluginStrictLoad.mockReturnValue(false);
    state.clearLoadedExtensionTools.mockResolvedValue(0);
    state.discoverPluginFiles.mockResolvedValue([]);
    state.discoverWorkflowFiles.mockResolvedValue([]);
    state.buildListResult.mockImplementation(
      (ctx: any, pluginRoots: string[], workflowRoots: string[]) => ({
        pluginRoots,
        workflowRoots,
        pluginCount: ctx.extensionPluginsById.size,
        workflowCount: ctx.extensionWorkflowsById.size,
        toolCount: ctx.extensionToolsByName.size,
        lastReloadAt: ctx.lastExtensionReloadAt,
        plugins: [...ctx.extensionPluginsById.values()],
        workflows: [...ctx.extensionWorkflowsById.values()],
        tools: [...ctx.extensionToolsByName.values()],
      })
    );
    state.extractConfigValue.mockImplementation((ctx: any, path: string, fallback: unknown) => {
      const segments = path.split('.');
      let current: unknown = ctx.config;
      for (const segment of segments) {
        current =
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[segment]
            : undefined;
      }
      return current ?? fallback;
    });
    state.isExtensionBuilder.mockImplementation(
      (value: unknown) =>
        !!value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).id === 'string' &&
        Array.isArray((value as Record<string, unknown>).tools)
    );
    state.isWorkflowContract.mockImplementation(
      (value: unknown) =>
        !!value &&
        typeof value === 'object' &&
        (value as Record<string, unknown>).kind === 'workflow-contract' &&
        typeof (value as Record<string, unknown>).build === 'function'
    );
    state.sha256Hex.mockResolvedValue('digest-1');
    state.verifyPluginIntegrity.mockResolvedValue({ ok: true, warnings: [], errors: [] });
    state.createFreshImportUrl.mockImplementation(
      (_modulePath: string, kind: 'plugin' | 'workflow') => {
        if (kind === 'workflow') {
          return makeDataModule(`
          export default {
            kind: 'workflow-contract',
            version: 1,
            id: 'wf-1',
            displayName: 'Workflow One',
            build() {
              return { kind: 'sequence', id: 'root', steps: [] };
            },
          };
        `);
        }
        return makeDataModule(`
        export default {
          id: 'plugin-1',
          version: '1.0.0',
          pluginName: 'Plugin One',
          compatibleCoreRange: '^1.0.0',
          allowedTools: ['allowed_tool', 'missing_builtin'],
          mergeMetadata() {
            return this;
          },
          tools: [],
          async onLoadHandler(ctx) {
            globalThis.__pluginCtx = ctx;
          },
          async onActivateHandler() {},
        };
      `);
      }
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('uses resolved roots and delegates list construction', async () => {
    process.env.MCP_PLUGIN_ROOTS = 'custom-plugins';
    process.env.MCP_WORKFLOW_ROOTS = 'custom-workflows';
    const ctx = createCtx();
    const { listExtensions } = await import('@server/extensions/ExtensionManager');

    const result = listExtensions(ctx);

    expect(state.parseRoots).toHaveBeenNthCalledWith(1, 'custom-plugins', ['default-plugin-root']);
    expect(state.parseRoots).toHaveBeenNthCalledWith(2, 'custom-workflows', [
      'default-workflow-root',
    ]);
    expect(state.resolveRoots).toHaveBeenNthCalledWith(1, ['custom-plugins']);
    expect(state.resolveRoots).toHaveBeenNthCalledWith(2, ['custom-workflows']);
    expect(state.buildListResult).toHaveBeenCalledWith(
      ctx,
      ['resolved:custom-plugins'],
      ['resolved:custom-workflows']
    );
    expect(result.pluginRoots).toEqual(['resolved:custom-plugins']);
    expect(result.workflowRoots).toEqual(['resolved:custom-workflows']);
  });

  it('blocks plugin loading in strict mode without an allowlist but still loads workflows', async () => {
    state.isPluginStrictLoad.mockReturnValue(true);
    state.discoverWorkflowFiles.mockResolvedValue(['/workflows/wf-1.ts']);
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.addedTools).toBe(0);
    expect(result.errors[0]).toContain('MCP_PLUGIN_ALLOWED_DIGESTS is required');
    expect(result.workflowCount).toBe(1);
    expect(ctx.extensionWorkflowsById.has('wf-1')).toBe(true);
    expect(ctx.lastExtensionReloadAt).toBeDefined();
    expect(state.logger.error).toHaveBeenCalled();
    expect(state.discoverPluginFiles).not.toHaveBeenCalled();
  });

  it('warns when loading without an allowlist in non-strict mode', async () => {
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.errors).toEqual([]);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('WITHOUT MCP_PLUGIN_ALLOWED_DIGESTS allowlist')
    );
  });

  it('builds plugin lifecycle context and enforces invokeTool restrictions', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-1.ts']);
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);
    const lifecycleContext = (globalThis as Record<string, unknown>).__pluginCtx as {
      invokeTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
      getConfig: (path: string, fallback?: unknown) => unknown;
      setRuntimeData: (key: string, value: unknown) => void;
      getRuntimeData: (key: string) => unknown;
    };

    expect(result.pluginCount).toBe(1);
    expect(ctx.extensionPluginsById.has('plugin-1')).toBe(true);
    expect(lifecycleContext).toBeDefined();

    await expect(lifecycleContext.invokeTool('')).rejects.toThrow(
      'invokeTool requires a non-empty tool name'
    );
    await expect(lifecycleContext.invokeTool('denied_tool')).rejects.toThrow(
      'Plugin "plugin-1" is not allowed to invoke "denied_tool".'
    );
    await expect(lifecycleContext.invokeTool('missing_builtin')).rejects.toThrow(
      'can only invoke built-in tools'
    );

    ctx.router.has.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(lifecycleContext.invokeTool('allowed_tool')).rejects.toThrow(
      'Tool "allowed_tool" is not available in the current active profile.'
    );
    await expect(lifecycleContext.invokeTool('allowed_tool', { hello: 'world' })).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, name: 'allowed_tool', args: { hello: 'world' } }),
        },
      ],
    });

    expect(lifecycleContext.getConfig('mcp.version', 'missing')).toBe('1.2.3');
    lifecycleContext.setRuntimeData('flag', 42);
    expect(lifecycleContext.getRuntimeData('flag')).toBe(42);
  });

  it('rolls back activated plugins when activation fails', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-bad.ts']);
    state.createFreshImportUrl.mockImplementationOnce(() =>
      makeDataModule(`
        export default {
          id: 'plugin-bad',
          version: '1.0.0',
          pluginName: 'Plugin Bad',
          compatibleCoreRange: '^1.0.0',
          allowedTools: ['*'],
          mergeMetadata() {
            return this;
          },
          tools: [],
          async onActivateHandler() {
            throw new Error('activate failed');
          },
          async onDeactivateHandler() {
            globalThis.__rolledBack = true;
          },
        };
      `)
    );
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.errors).toEqual([
      expect.stringContaining('Plugin lifecycle failed for plugin-bad: Error: activate failed'),
    ]);
    expect((globalThis as Record<string, unknown>).__rolledBack).toBeUndefined();
    expect(ctx.extensionPluginsById.size).toBe(0);
  });

  it('releases the reload mutex after a failure so later reloads can proceed', async () => {
    state.clearLoadedExtensionTools
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValueOnce(0);
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    await expect(reloadExtensions(ctx)).rejects.toThrow('cleanup failed');
    await expect(reloadExtensions(ctx)).resolves.toMatchObject({
      addedTools: 0,
      removedTools: 0,
    });
  });
});

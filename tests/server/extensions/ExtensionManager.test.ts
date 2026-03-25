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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/ToolCatalog', () => ({
  allTools: state.allTools,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/ExtensionManager.roots', () => ({
  DEFAULT_PLUGIN_ROOTS: ['default-plugin-root'],
  DEFAULT_WORKFLOW_ROOTS: ['default-workflow-root'],
  parseRoots: state.parseRoots,
  resolveRoots: state.resolveRoots,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/ExtensionManager.integrity', () => ({
  sha256Hex: state.sha256Hex,
  normalizeHex: state.normalizeHex,
  isPluginStrictLoad: state.isPluginStrictLoad,
  parseDigestAllowlist: state.parseDigestAllowlist,
  verifyPluginIntegrity: state.verifyPluginIntegrity,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/ExtensionManager.guards', () => ({
  isExtensionBuilder: state.isExtensionBuilder,
  isWorkflowContract: state.isWorkflowContract,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/ExtensionManager.discovery', () => ({
  discoverPluginFiles: state.discoverPluginFiles,
  discoverWorkflowFiles: state.discoverWorkflowFiles,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.parseDigestAllowlist.mockReturnValue(new Set());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isPluginStrictLoad.mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.clearLoadedExtensionTools.mockResolvedValue(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.discoverPluginFiles.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.discoverWorkflowFiles.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.buildListResult.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (ctx: any, pluginRoots: string[], workflowRoots: string[]) => ({
        pluginRoots,
        workflowRoots,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        pluginCount: ctx.extensionPluginsById.size,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        workflowCount: ctx.extensionWorkflowsById.size,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        toolCount: ctx.extensionToolsByName.size,
        lastReloadAt: ctx.lastExtensionReloadAt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        plugins: [...ctx.extensionPluginsById.values()],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        workflows: [...ctx.extensionWorkflowsById.values()],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        tools: [...ctx.extensionToolsByName.values()],
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.extractConfigValue.mockImplementation((ctx: any, path: string, fallback: any) => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isExtensionBuilder.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (value: any) =>
        !!value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).id === 'string' &&
        Array.isArray((value as Record<string, unknown>).tools),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isWorkflowContract.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (value: any) =>
        !!value &&
        typeof value === 'object' &&
        (value as Record<string, unknown>).kind === 'workflow-contract' &&
        typeof (value as Record<string, unknown>).build === 'function',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.sha256Hex.mockResolvedValue('digest-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.verifyPluginIntegrity.mockResolvedValue({ ok: true, warnings: [], errors: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.createFreshImportUrl.mockImplementation(
      (_modulePath: string, kind: 'plugin' | 'workflow') => {
        if (kind === 'workflow') {
          return makeDataModule(`
          export default {
            kind: 'workflow-contract',
            version: 1,
            id: 'wf-1',
            displayName: 'Workflow One',
            route: {
              kind: 'workflow',
              triggerPatterns: [/workflow one/i],
              requiredDomains: ['workflow'],
              priority: 80,
              steps: [],
            },
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
          workflows: [],
          async onLoadHandler(ctx) {
            globalThis.__pluginCtx = ctx;
          },
          async onActivateHandler() {},
        };
      `);
      },
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
      ['resolved:custom-workflows'],
    );
    expect(result.pluginRoots).toEqual(['resolved:custom-plugins']);
    expect(result.workflowRoots).toEqual(['resolved:custom-workflows']);
  });

  it('blocks plugin loading in strict mode without an allowlist but still loads workflows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isPluginStrictLoad.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.discoverWorkflowFiles.mockResolvedValue(['/workflows/wf-1.ts']);
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.addedTools).toBe(0);
    expect(result.errors[0]).toContain('MCP_PLUGIN_ALLOWED_DIGESTS is required');
    expect(result.workflowCount).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.extensionWorkflowsById.has('wf-1')).toBe(true);
    expect(ctx.extensionWorkflowsById.get('wf-1')?.route?.kind).toBe('workflow');
    expect(ctx.extensionWorkflowRuntimeById.get('wf-1')?.route?.priority).toBe(80);
    expect(ctx.lastExtensionReloadAt).toBeDefined();
    expect(state.logger.error).toHaveBeenCalled();
    expect(state.discoverPluginFiles).not.toHaveBeenCalled();
  });

  it('lazily loads workflows once without performing a full extension reload', async () => {
    state.discoverWorkflowFiles.mockResolvedValue(['/workflows/wf-1.ts']);
    const ctx = createCtx();
    const { ensureWorkflowsLoaded } = await import('@server/extensions/ExtensionManager');

    await ensureWorkflowsLoaded(ctx);
    await ensureWorkflowsLoaded(ctx);

    expect(state.discoverWorkflowFiles).toHaveBeenCalledTimes(1);
    expect(ctx.extensionWorkflowsById.has('wf-1')).toBe(true);
    expect(ctx.extensionWorkflowRuntimeById.get('wf-1')?.route?.priority).toBe(80);
    expect(state.clearLoadedExtensionTools).not.toHaveBeenCalled();
  });

  it('lazily loads plugin-contributed workflows without executing plugin lifecycle', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-with-workflow/dist/index.js']);
    state.discoverWorkflowFiles.mockResolvedValue([]);
    state.createFreshImportUrl.mockImplementation(
      (modulePath: string, kind: 'plugin' | 'workflow') => {
        if (kind === 'plugin' && modulePath.includes('plugin-with-workflow')) {
          return makeDataModule(`
          export default {
            id: 'plugin-with-workflow',
            version: '1.0.0',
            pluginName: 'Plugin With Workflow',
            compatibleCoreRange: '^1.0.0',
            allowedTools: ['allowed_tool'],
            mergeMetadata() {
              return this;
            },
            tools: [],
            workflows: [
              {
                kind: 'workflow-contract',
                version: 1,
                id: 'plugin-workflow-lazy',
                displayName: 'Plugin Workflow Lazy',
                route: {
                  kind: 'workflow',
                  triggerPatterns: [/plugin workflow lazy/i],
                  requiredDomains: ['workflow'],
                  priority: 81,
                  steps: [],
                },
                build() {
                  return { kind: 'sequence', id: 'plugin-root', steps: [] };
                },
              },
            ],
            async onLoadHandler() {
              globalThis.__pluginCtx = 'executed';
            },
          };
        `);
        }

        return makeDataModule(`
        export default {
          kind: 'workflow-contract',
          version: 1,
          id: 'wf-1',
          displayName: 'Workflow One',
          route: {
            kind: 'workflow',
            triggerPatterns: [/workflow one/i],
            requiredDomains: ['workflow'],
            priority: 80,
            steps: [],
          },
          build() {
            return { kind: 'sequence', id: 'root', steps: [] };
          },
        };
      `);
      },
    );

    const ctx = createCtx();
    const { ensureWorkflowsLoaded } = await import('@server/extensions/ExtensionManager');

    await ensureWorkflowsLoaded(ctx);
    await ensureWorkflowsLoaded(ctx);

    expect(state.discoverPluginFiles).toHaveBeenCalledTimes(1);
    expect(ctx.extensionWorkflowsById.has('plugin-workflow-lazy')).toBe(true);
    expect(ctx.extensionPluginsById.get('plugin-with-workflow')?.workflows).toEqual([
      'plugin-workflow-lazy',
    ]);
    expect((globalThis as Record<string, unknown>).__pluginCtx).toBeUndefined();
    expect(state.clearLoadedExtensionTools).not.toHaveBeenCalled();
  });

  it('warns when loading without an allowlist in non-strict mode', async () => {
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.errors).toEqual([]);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('WITHOUT MCP_PLUGIN_ALLOWED_DIGESTS allowlist'),
    );
  });

  it('builds plugin lifecycle context and enforces invokeTool restrictions', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-1/dist/index.js']);
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);
    const lifecycleContext = (globalThis as Record<string, unknown>).__pluginCtx as {
      pluginRoot: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      invokeTool: (name: string, args?: Record<string, unknown>) => Promise<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getConfig: (path: string, fallback?: any) => unknown;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      setRuntimeData: (key: string, value: any) => void;
      getRuntimeData: (key: string) => unknown;
    };

    expect(result.pluginCount).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.extensionPluginsById.has('plugin-1')).toBe(true);
    expect(lifecycleContext).toBeDefined();
    expect(lifecycleContext.pluginRoot.replace(/\\/g, '/')).toContain('/plugins/plugin-1');

    await expect(lifecycleContext.invokeTool('')).rejects.toThrow(
      'invokeTool requires a non-empty tool name',
    );
    await expect(lifecycleContext.invokeTool('denied_tool')).rejects.toThrow(
      'Plugin "plugin-1" is not allowed to invoke "denied_tool".',
    );
    await expect(lifecycleContext.invokeTool('missing_builtin')).rejects.toThrow(
      'can only invoke built-in tools',
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.router.has.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(lifecycleContext.invokeTool('allowed_tool')).rejects.toThrow(
      'Tool "allowed_tool" is not available in the current active profile.',
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

  it('registers plugin-contributed workflows and associates them with the plugin record', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-with-workflow/dist/index.js']);
    state.discoverWorkflowFiles.mockResolvedValue([]);
    state.createFreshImportUrl.mockImplementation(
      (modulePath: string, kind: 'plugin' | 'workflow') => {
        if (kind === 'plugin' && modulePath.includes('plugin-with-workflow')) {
          return makeDataModule(`
          export default {
            id: 'plugin-with-workflow',
            version: '1.0.0',
            pluginName: 'Plugin With Workflow',
            compatibleCoreRange: '^1.0.0',
            allowedTools: ['allowed_tool'],
            mergeMetadata() {
              return this;
            },
            tools: [],
            workflows: [
              {
                kind: 'workflow-contract',
                version: 1,
                id: 'plugin-workflow-1',
                displayName: 'Plugin Workflow One',
                route: {
                  kind: 'preset',
                  triggerPatterns: [/plugin workflow/i],
                  requiredDomains: ['workflow'],
                  priority: 77,
                  steps: [],
                },
                build() {
                  return { kind: 'sequence', id: 'plugin-root', steps: [] };
                },
              },
            ],
          };
        `);
        }

        if (kind === 'workflow') {
          return makeDataModule(`
          export default {
            kind: 'workflow-contract',
            version: 1,
            id: 'wf-1',
            displayName: 'Workflow One',
            route: {
              kind: 'workflow',
              triggerPatterns: [/workflow one/i],
              requiredDomains: ['workflow'],
              priority: 80,
              steps: [],
            },
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
          workflows: [],
          async onLoadHandler(ctx) {
            globalThis.__pluginCtx = ctx;
          },
          async onActivateHandler() {},
        };
      `);
      },
    );

    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.pluginCount).toBe(1);
    expect(result.workflowCount).toBe(1);
    expect(ctx.extensionWorkflowsById.get('plugin-workflow-1')).toMatchObject({
      id: 'plugin-workflow-1',
      displayName: 'Plugin Workflow One',
      route: expect.objectContaining({ kind: 'preset', priority: 77 }),
    });
    expect(ctx.extensionWorkflowRuntimeById.get('plugin-workflow-1')?.source).toContain(
      '#workflow:plugin-workflow-1',
    );
    expect(ctx.extensionPluginsById.get('plugin-with-workflow')?.workflows).toEqual([
      'plugin-workflow-1',
    ]);
  });

  it('rolls back activated plugins when activation fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-bad.ts']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      `),
    );
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);

    expect(result.errors).toEqual([
      expect.stringContaining('Plugin lifecycle failed for plugin-bad: Error: activate failed'),
    ]);
    expect((globalThis as Record<string, unknown>).__rolledBack).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.extensionPluginsById.size).toBe(0);
  });

  it('releases the reload mutex after a failure so later reloads can proceed', async () => {
    state.clearLoadedExtensionTools
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockRejectedValueOnce(new Error('cleanup failed'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

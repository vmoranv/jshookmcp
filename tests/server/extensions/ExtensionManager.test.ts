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
    state.clearLoadedExtensionTools.mockImplementation(async (ctx: any) => {
      const removed = ctx.extensionToolsByName.size;
      ctx.extensionToolsByName.clear();
      ctx.extensionPluginsById.clear();
      ctx.extensionPluginRuntimeById.clear();
      ctx.extensionWorkflowsById.clear();
      ctx.extensionWorkflowRuntimeById.clear();
      return removed;
    });
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
      }),
    );
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
    state.isExtensionBuilder.mockImplementation(
      (value: any) =>
        !!value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).id === 'string' &&
        Array.isArray((value as Record<string, unknown>).tools),
    );
    state.isWorkflowContract.mockImplementation(
      (value: any) =>
        !!value &&
        typeof value === 'object' &&
        (value as Record<string, unknown>).kind === 'workflow-contract' &&
        typeof (value as Record<string, unknown>).build === 'function',
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
    state.isPluginStrictLoad.mockReturnValue(true);
    state.discoverWorkflowFiles.mockResolvedValue(['/workflows/wf-1.ts']);
    const ctx = createCtx();
    const { ensureWorkflowsLoaded, reloadExtensions } =
      await import('@server/extensions/ExtensionManager');

    await ensureWorkflowsLoaded(ctx);
    const result = await reloadExtensions(ctx);

    expect(result.addedTools).toBe(0);
    expect(result.errors[0]).toContain('MCP_PLUGIN_ALLOWED_DIGESTS is required');
    expect(result.workflowCount).toBe(1);
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

    // Trigger concurrently to hit the inner mutex lock double-check
    await Promise.all([ensureWorkflowsLoaded(ctx), ensureWorkflowsLoaded(ctx)]);
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
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-1/dist/index.js']);
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

    const result = await reloadExtensions(ctx);
    const lifecycleContext = (globalThis as Record<string, unknown>).__pluginCtx as {
      pluginRoot: string;
      state: string;
      hasPermission: (capability: string) => boolean;
      invokeTool: (name: string, args?: Record<string, unknown>) => Promise<any>;
      getConfig: (path: string, fallback?: any) => unknown;
      setRuntimeData: (key: string, value: any) => void;
      getRuntimeData: (key: string) => unknown;
    };

    expect(result.pluginCount).toBe(1);
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
    expect(lifecycleContext.state).toBe('activated');
    expect(lifecycleContext.hasPermission('test')).toBe(true);
    (lifecycleContext as any).registerMetric('test-metric');
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
      `),
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

  it('skips plugin if onValidateHandler returns valid: false', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-invalid.ts']);
    state.createFreshImportUrl.mockImplementationOnce(() =>
      makeDataModule(`
        export default {
          id: 'plugin-invalid',
          version: '1.0.0',
          pluginName: 'Plugin Invalid',
          compatibleCoreRange: '^1.0.0',
          allowedTools: ['*'],
          mergeMetadata() { return this; },
          tools: [],
          workflows: [],
          async onValidateHandler() {
            return { valid: false, errors: ['missing secret'] };
          },
        };
      `),
    );
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');
    const result = await reloadExtensions(ctx);
    expect(result.warnings).toContain('Plugin plugin-invalid validation failed: missing secret');
    expect(ctx.extensionPluginsById.size).toBe(0);
  });

  it('rolls back and deactivates if an error is thrown after activation', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-rollback.ts']);
    state.createFreshImportUrl.mockImplementationOnce(() =>
      makeDataModule(`
        export default {
          id: 'plugin-rollback',
          version: '1.0.0',
          pluginName: 'Plugin Rollback',
          compatibleCoreRange: '^1.0.0',
          allowedTools: ['*'],
          mergeMetadata() { return this; },
          tools: [],
          workflows: [],
          async onActivateHandler() {
            globalThis.__activated = true;
          },
          async onDeactivateHandler() {
            globalThis.__rolledBack = true;
          },
        };
      `),
    );
    const ctx = createCtx();
    ctx.extensionPluginRuntimeById.set = vi.fn(() => {
      throw new Error('map set failure');
    });

    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');
    await reloadExtensions(ctx);

    expect((globalThis as any).__activated).toBe(true);
    expect((globalThis as any).__rolledBack).toBe(true);
  });

  it('tolerates deactivation failure during rollback', async () => {
    state.discoverPluginFiles.mockResolvedValue(['/plugins/plugin-deactivate-fail.ts']);
    state.createFreshImportUrl.mockImplementationOnce(() =>
      makeDataModule(`
        export default {
          id: 'plugin-deactivate-fail',
          version: '1.0.0',
          pluginName: 'Plugin Deactivate Fail',
          compatibleCoreRange: '^1.0.0',
          allowedTools: ['*'],
          mergeMetadata() { return this; },
          tools: [],
          workflows: [],
          async onActivateHandler() {},
          async onDeactivateHandler() {
            throw new Error('deactivate boom');
          },
        };
      `),
    );
    const ctx = createCtx();
    ctx.extensionPluginRuntimeById.set = vi.fn(() => {
      throw new Error('map set failure');
    });

    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');
    await reloadExtensions(ctx);

    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Plugin onDeactivate failed during rollback for plugin-deactivate-fail:',
      ),
      expect.any(Error),
    );
  });

  it('parses meta.yaml successfully and skips invalid lines', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = path.resolve(__dirname, '../../tmp/fixtures', 'ext-mgr-yaml');
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'meta.yaml'),
      '# comment\nvalid: value\n  invalidline  \n:badkey\n    good : ok\n',
    );

    state.discoverPluginFiles.mockResolvedValue([path.join(tmpDir, 'plugin-yaml.ts')]);
    state.createFreshImportUrl.mockImplementationOnce(() =>
      makeDataModule(`
        export default {
          id: 'plugin-yaml',
          version: '1.0.0',
          compatibleCoreRange: '^1.0.0',
          allowedTools: [],
          tools: [],
          workflows: [],
          mergeMetadata(meta) { 
            globalThis.__parsedMeta = meta; 
          },
        };
      `),
    );
    const ctx = createCtx();
    const { reloadExtensions } = await import('@server/extensions/ExtensionManager');
    await reloadExtensions(ctx);

    expect((globalThis as any).__parsedMeta).toEqual({
      valid: 'value',
      good: 'ok',
    });
  });

  it('executes granular edge cases for verification, duplicate tracking, and lazy workflows', async () => {
    // We cover line 113 by using 'dist' in the path, and line 95 by using .jshook-install.json
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = path.resolve(__dirname, '../../tmp/fixtures', 'ext-mgr-edge');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.jshook-install.json'), '{}');

    // Mocks for multiple files
    state.discoverPluginFiles.mockResolvedValue([
      path.join(tmpDir, 'dist', 'plugin-a.js'),
      '/plugins/plugin-fallback/dist/index.js',
      '/plugins/plugin-duplicate.js',
      '/plugins/plugin-unverified.js',
      '/plugins/plugin-throw-verify.js',
      '/plugins/plugin-bad-workflow.js',
      '/plugins/plugin-valid-workflow.js',
      '/plugins/plugin-valid-workflow.js',
      '/plugins/plugin-invalid-builder.js',
      '/plugins/plugin-hash-error.js',
      '/plugins/plugin-not-in-allowlist.js',
      '/plugins/plugin-bad-import.js',
    ]);
    state.discoverWorkflowFiles.mockResolvedValue([
      '/workflows/wf-bad-import.js',
      '/workflows/wf-not-contract.js',
    ]);

    // Pre-populate Duplicate map is removed, because reloadExtensions clears the map anyway.
    const ctx = createCtx();

    // Server exception for Tool List loop
    ctx.extensionToolsByName.set('foo', {});
    ctx.server.sendToolListChanged.mockRejectedValueOnce(new Error('network error'));

    // Mock verify fail
    state.verifyPluginIntegrity.mockImplementation(async (plugin: any) => {
      if (plugin.id === 'plugin-unverified') {
        return { ok: false, warnings: [], errors: ['integrity boom'] };
      }
      if (plugin.id === 'plugin-throw-verify') {
        throw new Error('thrown verify boom');
      }
      return { ok: true, warnings: [], errors: [] };
    });

    state.parseDigestAllowlist.mockReturnValue(new Set(['digest-1']));
    state.sha256Hex.mockImplementation(async (file: string) => {
      if (file.includes('plugin-hash-error')) throw new Error('hash failure');
      if (file.includes('plugin-not-in-allowlist')) return 'digest-2';
      return 'digest-1';
    });

    state.createFreshImportUrl.mockImplementation(
      (filePath: string, kind: 'plugin' | 'workflow') => {
        if (kind === 'workflow') {
          if (filePath.includes('wf-bad-import')) {
            return makeDataModule(`throw new Error('bad string module');`);
          }
          return makeDataModule(`export default { kind: 'not-a-contract' };`);
        }

        if (filePath.includes('plugin-bad-import')) {
          return makeDataModule(`throw new Error('bad plugin module');`);
        }

        const idStr = path.basename(filePath, path.extname(filePath));
        if (idStr === 'plugin-a' || idStr === 'index') {
          return makeDataModule(`
          export default {
            id: 'plugin-${idStr}', version: '1.0.0', compatibleCoreRange: '^1.0',
            allowedTools: ['allowed_tool'], mergeMetadata() { return this; },
            tools: [], workflows: [], async onLoadHandler(lCtx) {
              await lCtx.invokeTool('allowed_tool', null);
              await lCtx.invokeTool('allowed_tool'); 
            }
          };
        `);
        }
        if (idStr === 'plugin-valid-workflow') {
          return makeDataModule(`
          export default {
            id: 'plugin-valid-workflow', version: '1.0.0', compatibleCoreRange: '^1.0',
            allowedTools: [], mergeMetadata() { return this; },
            tools: [], 
            workflows: [
              'this-is-not-an-object',
              { kind: 'workflow-contract', id: 'wf-duplicate', build() {} },
              { kind: 'workflow-contract', id: 'wf-duplicate', build() {} }
            ],
            async onValidateHandler() {
              return { valid: true };
            }
          };
        `);
        }

        return makeDataModule(`
        export default {
          id: 'plugin-${idStr.replace('plugin-', '')}', version: '1.0.0', compatibleCoreRange: '^1.0',
          allowedTools: [], mergeMetadata() { return this; },
          tools: [], workflows: ['this-is-not-an-object'],
        };
      `);
      },
    );

    // Create an invalid builder mock for plugin-invalid-builder (omits tools array)
    state.isExtensionBuilder.mockImplementation((val) => {
      if (val && val.id === 'plugin-invalid-builder') return false;
      return true;
    });

    const { ensureWorkflowsLoaded, reloadExtensions } =
      await import('@server/extensions/ExtensionManager');

    // First: Lazy Loader
    await ensureWorkflowsLoaded(ctx);

    // Second: Reload Extensions
    const result = await reloadExtensions(ctx);

    expect(state.logger.warn).toHaveBeenCalledWith(
      'sendToolListChanged failed after extension reload:',
      expect.any(Error),
    );
    expect(result.errors).toContain('integrity boom');
    expect(result.errors).toContain(
      'Failed to verify plugin plugin-throw-verify: Error: thrown verify boom',
    );
    expect(result.warnings).toContain(
      'Skip plugin "plugin-valid-workflow" from /plugins/plugin-valid-workflow.js: duplicate plugin id',
    );
  });
});

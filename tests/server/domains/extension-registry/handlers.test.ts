import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionRegistryHandlers } from '@server/domains/extension-registry/handlers.impl';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

describe('ExtensionRegistryHandlers', () => {
  let tempDir: string;
  let registry: {
    listInstalled: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    getInstalled: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
    loadPlugin: ReturnType<typeof vi.fn>;
    unloadPlugin: ReturnType<typeof vi.fn>;
  };
  let webhook: {
    sendEvent: ReturnType<typeof vi.fn>;
  };
  let handlers: ExtensionRegistryHandlers;

  beforeEach(() => {
    tempDir = '';
    registry = {
      listInstalled: vi.fn().mockReturnValue([]),
      register: vi.fn().mockResolvedValue('plugin-1'),
      getInstalled: vi.fn().mockReturnValue({
        id: 'plugin-1',
        name: 'test-plugin',
        version: '1.0.0',
        entry: '/tmp/plugin.mjs',
        permissions: [],
        status: 'unloaded',
      }),
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

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('installs an inline plugin manifest into the registry', async () => {
    const body = parseJson<any>(
      await handlers.handleInstall({
        manifest: {
          id: 'plugin-1',
          name: 'test-plugin',
          version: '1.0.0',
          entry: '/tmp/plugin.mjs',
          permissions: ['network'],
        },
      } as any),
    );

    expect(registry.register).toHaveBeenCalledWith({
      id: 'plugin-1',
      name: 'test-plugin',
      version: '1.0.0',
      entry: '/tmp/plugin.mjs',
      permissions: ['network'],
    });
    expect(body.success).toBe(true);
    expect(body.pluginId).toBe('plugin-1');
    expect(webhook.sendEvent).toHaveBeenCalledWith('extension.installed', { pluginId: 'plugin-1' });
  });

  it('installs from a local package.json source without importing plugin code', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-extension-install-'));
    const pluginDir = path.join(tempDir, 'plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(path.join(pluginDir, 'entry.mjs'), 'export default {};', 'utf8');
    await writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({
        name: '@team/source-plugin',
        version: '2.1.0',
        jshookmcp: {
          entry: 'entry.mjs',
          permissions: ['filesystem'],
        },
      }),
      'utf8',
    );

    await handlers.handleInstall({ source: pluginDir } as any);

    expect(registry.register).toHaveBeenCalledWith({
      id: '@team/source-plugin',
      name: '@team/source-plugin',
      version: '2.1.0',
      entry: pathToFileURL(path.join(pluginDir, 'entry.mjs')).href,
      permissions: ['filesystem'],
    });
    expect(registry.loadPlugin).not.toHaveBeenCalled();
  });

  it('discovers dist/manifest.js when package.json has no entry pointer (kimi-cu P2-7)', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-extension-install-'));
    const pluginDir = path.join(tempDir, 'ghidra-bridge');
    await mkdir(path.join(pluginDir, 'dist'), { recursive: true });
    await writeFile(path.join(pluginDir, 'dist', 'manifest.js'), 'export default {};', 'utf8');
    // The extension-sdk plugin template: package.json carries name/version and
    // build scripts, but no main/module/exports/jshookmcp.entry pointer.
    await writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'plugin-ghidra-bridge', version: '0.1.0', scripts: {} }),
      'utf8',
    );

    await handlers.handleInstall({ source: pluginDir } as any);

    expect(registry.register).toHaveBeenCalledWith({
      id: 'plugin-ghidra-bridge',
      name: 'plugin-ghidra-bridge',
      version: '0.1.0',
      entry: pathToFileURL(path.join(pluginDir, 'dist', 'manifest.js')).href,
      permissions: [],
    });
  });

  it('falls back to dist/index.js when dist/manifest.js is absent', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-extension-install-'));
    const pluginDir = path.join(tempDir, 'plugin');
    await mkdir(path.join(pluginDir, 'dist'), { recursive: true });
    await writeFile(path.join(pluginDir, 'dist', 'index.js'), 'export default {};', 'utf8');
    await writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'index-plugin', version: '1.2.3' }),
      'utf8',
    );

    await handlers.handleInstall({ source: pluginDir } as any);

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: pathToFileURL(path.join(pluginDir, 'dist', 'index.js')).href,
      }),
    );
  });

  it('still fails with a actionable error when no entry exists anywhere', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-extension-install-'));
    const pluginDir = path.join(tempDir, 'empty-plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'empty-plugin', version: '0.0.1' }),
      'utf8',
    );

    const body = parseJson<any>(await handlers.handleInstallTool({ source: pluginDir } as any));

    expect(body.success).toBe(false);
    expect(body.error).toContain('requires name and entry');
  });

  it('installs from a JSON manifest source with top-level entry', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-extension-manifest-'));
    await writeFile(path.join(tempDir, 'plugin.mjs'), 'export default {};', 'utf8');
    const manifestPath = path.join(tempDir, 'extension.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: 'json-plugin',
        name: 'JSON Plugin',
        version: '3.0.0',
        entry: 'plugin.mjs',
        permissions: ['network'],
      }),
      'utf8',
    );

    await handlers.handleInstall({ source: manifestPath } as any);

    expect(registry.register).toHaveBeenCalledWith({
      id: 'json-plugin',
      name: 'JSON Plugin',
      version: '3.0.0',
      entry: pathToFileURL(path.join(tempDir, 'plugin.mjs')).href,
      permissions: ['network'],
    });
  });

  it('lists installed plugins', async () => {
    const result = await handlers.handleListInstalled();
    expect(registry.listInstalled).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
  });

  it('returns installed plugin info without loading it', async () => {
    const body = parseJson<any>(await handlers.handleInfo({ pluginId: 'plugin-1' } as any));

    expect(registry.getInstalled).toHaveBeenCalledWith('plugin-1');
    expect(registry.loadPlugin).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.manifest.entry).toBe('/tmp/plugin.mjs');
  });

  it('throws when plugin info is missing', async () => {
    registry.getInstalled.mockReturnValueOnce(undefined);

    await expect(handlers.handleInfo({ pluginId: 'missing' } as any)).rejects.toThrow(
      'Plugin not found: missing',
    );
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

  it('does not resolve "constructor" to the Object built-in via prototype chain', async () => {
    const body = parseJson<any>(
      await handlers.handleExecuteInContextTool({
        pluginId: 'plugin-1',
        contextName: 'constructor',
        args: {},
      } as any),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('was not found');
  });

  describe('ToolResponse wrappers', () => {
    it('preserves list_installed ToolResponse results without double wrapping', async () => {
      registry.listInstalled.mockReturnValue([{ id: 'plugin-1', name: 'test-plugin' }]);

      const body = parseJson<any>(await handlers.handleListInstalledTool());

      expect(body.success).toBe(true);
      expect(body.plugins).toEqual([{ id: 'plugin-1', name: 'test-plugin' }]);
      expect(body.content).toBeUndefined();
    });

    it('converts thrown registry errors into structured ToolResponse failures', async () => {
      registry.loadPlugin.mockRejectedValue(new Error('load failed'));

      const body = parseJson<any>(
        await handlers.handleExecuteInContextTool({
          pluginId: 'plugin-1',
          contextName: 'default',
          args: {},
        } as any),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('load failed');
      expect(body.message).toBe('load failed');
    });
  });
});

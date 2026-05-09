import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '@modules/extension-registry/PluginRegistry';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('PluginRegistry', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'jshook-plugin-registry-'));
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('registers plugins, sanitizes ids, and persists installed manifests', async () => {
    const registry = new PluginRegistry(tempDir);

    const pluginId = await registry.register({
      id: 'Team/Feature Plugin!!',
      name: 'Feature Plugin',
      version: '1.2.3',
      entry: './plugin.mjs',
      permissions: ['network'],
    });

    expect(pluginId).toBe('team-feature-plugin-');
    expect(registry.listInstalled()).toEqual([
      {
        id: 'team-feature-plugin-',
        name: 'Feature Plugin',
        version: '1.2.3',
        permissions: ['network'],
        status: 'unloaded',
      },
    ]);

    const disk = JSON.parse(await readFile(path.join(tempDir, 'plugins.json'), 'utf8')) as Array<{
      id: string;
      name: string;
      version: string;
      entry: string;
      permissions: string[];
      status: string;
    }>;
    expect(disk[0]).toMatchObject({
      id: 'team-feature-plugin-',
      name: 'Feature Plugin',
      version: '1.2.3',
      permissions: ['network'],
      status: 'unloaded',
    });
  });

  it('loads local file-url plugins, caches exports, unloads, and unregisters them', async () => {
    const registry = new PluginRegistry(tempDir);
    const modulePath = path.join(tempDir, 'local-plugin.mjs');
    await writeFile(
      modulePath,
      'export const marker = 42; export default { marker }; export const ping = () => "pong";',
      'utf8',
    );

    const pluginId = await registry.register({
      id: 'local-plugin',
      name: 'Local Plugin',
      version: '0.0.1',
      entry: pathToFileURL(modulePath).href,
    });

    const firstLoad = await registry.loadPlugin(pluginId);
    const secondLoad = await registry.loadPlugin(pluginId);

    expect(firstLoad.manifest).toMatchObject({
      id: 'local-plugin',
      name: 'Local Plugin',
      version: '0.0.1',
      entry: pathToFileURL(modulePath).href,
      permissions: [],
    });
    expect(firstLoad.exports['marker']).toBe(42);
    expect(typeof firstLoad.exports['ping']).toBe('function');
    expect(secondLoad.exports).toBe(firstLoad.exports);
    expect(registry.listInstalled()[0]?.status).toBe('loaded');

    await registry.unloadPlugin(pluginId);
    expect(registry.listInstalled()[0]?.status).toBe('unloaded');

    await registry.unregister(pluginId);
    expect(registry.listInstalled()).toEqual([]);
  });

  it('downloads remote plugin modules into the local cache before loading them', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        'export const remoteValue = "remote"; export default { remoteValue }; export const probe = () => "ok";',
    });
    vi.stubGlobal('fetch', fetchMock);

    const registry = new PluginRegistry(tempDir);
    const pluginId = await registry.register({
      id: 'remote/plugin',
      name: 'Remote Plugin',
      version: '1.0.0',
      entry: withPath(TEST_URLS.root, 'remote-plugin.mjs'),
    });

    const loaded = await registry.loadPlugin(pluginId);

    expect(fetchMock).toHaveBeenCalledWith(withPath(TEST_URLS.root, 'remote-plugin.mjs'));
    expect(loaded.exports['remoteValue']).toBe('remote');
    expect(existsSync(path.join(tempDir, 'modules', 'remote-plugin.mjs'))).toBe(true);
  });

  it('rejects remote plugin downloads when fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const registry = new PluginRegistry(tempDir);
    const pluginId = await registry.register({
      id: 'remote-plugin',
      name: 'Remote Plugin',
      version: '1.0.0',
      entry: withPath(TEST_URLS.root, 'remote-plugin.mjs'),
    });

    await expect(registry.loadPlugin(pluginId)).rejects.toThrow(
      'Failed to download plugin module: 503 Service Unavailable',
    );
  });

  it('supports legacy plugin discovery, search, install, and dependency lookups', async () => {
    const pluginsRoot = path.join(tempDir, 'legacy-plugins');
    const alphaDir = path.join(pluginsRoot, 'alpha');
    const betaDir = path.join(pluginsRoot, 'beta');
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });

    await writeFile(
      path.join(alphaDir, 'package.json'),
      JSON.stringify({
        name: 'Alpha Plugin',
        version: '1.0.0',
        description: 'Handles network captures',
        capabilities: ['network', 'capture'],
        dependencies: { chalk: '^5.0.0' },
      }),
      'utf8',
    );
    await writeFile(
      path.join(betaDir, 'package.json'),
      JSON.stringify({
        name: 'Beta Plugin',
        version: '2.0.0',
        capabilities: ['analysis'],
      }),
      'utf8',
    );

    const registry = new PluginRegistry({} as Record<string, unknown>, [pluginsRoot]);

    expect(registry.listPlugins()).toHaveLength(2);
    expect(registry.searchPlugins('capture')).toHaveLength(1);
    expect(registry.searchPlugins('chalk')).toHaveLength(1);
    expect(registry.searchPlugins('')).toHaveLength(2);
    expect(registry.getPluginInfo('alpha-plugin')?.name).toBe('Alpha Plugin');
    expect(registry.getPluginDependencies('alpha-plugin')).toEqual(['chalk']);
    expect(registry.getPluginDependencies('missing-plugin')).toEqual([]);

    const installedByName = await registry.installPlugin('alpha');
    expect(installedByName.name).toBe('Alpha Plugin');

    const installedByPath = await registry.installPlugin(alphaDir);
    expect(installedByPath.name).toBe('Alpha Plugin');

    const gitPlugin = await registry.installPlugin('https://github.com/example/plugin.git');
    expect(gitPlugin).toMatchObject({
      id: 'git-plugin',
      name: 'plugin',
      version: '0.0.0',
    });

    await expect(registry.installPlugin('invalid-url')).rejects.toThrow('Invalid git URL');
    await expect(registry.installPlugin('missing')).rejects.toThrow('Plugin not found');
    await expect(registry.installPlugin(path.join(tempDir, 'missing-path'))).rejects.toThrow(
      'No package.json',
    );
  });
});

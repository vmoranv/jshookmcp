import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginRegistry } from '@modules/extension-registry/PluginRegistry';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { existsSync, readFileSync, readdirSync } from 'node:fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);

describe('PluginRegistry', () => {
  const mockCtx = {} as Record<string, unknown>;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('listPlugins', () => {
    it('should return plugins from plugin roots', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'plugin-a', isDirectory: () => true },
        { name: 'plugin-b', isDirectory: () => true },
        { name: '.hidden', isDirectory: () => true },
      ] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ name: 'plugin-a', version: '1.0.0', description: 'Test plugin' }),
      );

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const plugins = registry.listPlugins();

      expect(plugins).toHaveLength(2);
      expect(plugins[0]!.name).toBe('plugin-a');
    });

    it('should skip missing plugin roots', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new PluginRegistry(mockCtx as any, ['/nonexistent']);
      const plugins = registry.listPlugins();
      expect(plugins).toEqual([]);
    });

    it('should skip directories without package.json', () => {
      mockExistsSync.mockReturnValueOnce(true);
      mockExistsSync.mockReturnValueOnce(false);
      mockReaddirSync.mockReturnValue([{ name: 'plugin-no-pkg', isDirectory: () => true }] as any);

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const plugins = registry.listPlugins();
      expect(plugins).toEqual([]);
    });

    it('should handle malformed package.json', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'bad-plugin', isDirectory: () => true }] as any);
      mockReadFileSync.mockReturnValue('not valid json');

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const plugins = registry.listPlugins();
      expect(plugins).toEqual([]);
    });
  });

  describe('searchPlugins', () => {
    it('should filter plugins by name', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'auth-plugin', isDirectory: () => true },
        { name: 'network-plugin', isDirectory: () => true },
      ] as any);
      mockReadFileSync
        .mockReturnValueOnce(JSON.stringify({ name: 'auth-plugin', description: 'Auth' }))
        .mockReturnValueOnce(JSON.stringify({ name: 'network-plugin', description: 'Network' }));

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const results = registry.searchPlugins('auth');

      expect(results).toHaveLength(1);
      // @ts-expect-error
      expect(results[0].name).toBe('auth-plugin');
    });

    it('should filter plugins by capability', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'cap-plugin', isDirectory: () => true }] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ name: 'cap-plugin', capabilities: ['memory', 'debug'] }),
      );

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const results = registry.searchPlugins('memory');
      expect(results).toHaveLength(1);
    });
  });

  describe('installPlugin', () => {
    it('should install from git URL', async () => {
      const registry = new PluginRegistry(mockCtx as any, []);
      const result = await registry.installPlugin('https://github.com/user/plugin.git');
      expect(result.id).toBe('git-plugin');
      expect(result.name).toBe('plugin');
    });

    it('should install from git@ URL', async () => {
      const registry = new PluginRegistry(mockCtx as any, []);
      const result = await registry.installPlugin('git@github.com:user/plugin.git');
      expect(result.id).toBe('git-plugin');
    });

    it('should install from file path', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'local-plugin', version: '2.0.0' }));

      const registry = new PluginRegistry(mockCtx as any, []);
      const result = await registry.installPlugin('/path/to/plugin');
      expect(result.name).toBe('local-plugin');
    });

    it('should resolve plugin name against roots', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'named-plugin', version: '1.0.0' }));

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const result = await registry.installPlugin('my-plugin');
      expect(result.name).toBe('named-plugin');
    });

    it('should throw if source not found', async () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new PluginRegistry(mockCtx as any, []);
      await expect(registry.installPlugin('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw if invalid git URL', async () => {
      const registry = new PluginRegistry(mockCtx as any, []);
      await expect(registry.installPlugin('invalid-url')).rejects.toThrow('Invalid git URL');
    });

    it('should throw if path has no package.json', async () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new PluginRegistry(mockCtx as any, []);
      await expect(registry.installPlugin('/no-pkg')).rejects.toThrow('No package.json');
    });
  });

  describe('getPluginInfo', () => {
    it('should return plugin info by ID', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'info-plugin', isDirectory: () => true }] as any);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'info-plugin', version: '3.0.0' }));

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const info = registry.getPluginInfo('info-plugin');
      expect(info).toBeDefined();
      expect(info?.name).toBe('info-plugin');
    });

    it('should return undefined for unknown plugin', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new PluginRegistry(mockCtx as any, []);
      const info = registry.getPluginInfo('unknown');
      expect(info).toBeUndefined();
    });
  });

  describe('getPluginDependencies', () => {
    it('should return dependencies', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'dep-plugin', isDirectory: () => true }] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          name: 'dep-plugin',
          dependencies: { lodash: '^4.0.0', express: '^4.0.0' },
        }),
      );

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const deps = registry.getPluginDependencies('dep-plugin');
      expect(deps).toContain('lodash');
      expect(deps).toContain('express');
    });

    it('should return empty array for unknown plugin', () => {
      const registry = new PluginRegistry(mockCtx as any, []);
      const deps = registry.getPluginDependencies('unknown');
      expect(deps).toEqual([]);
    });
  });

  describe('uninstallPlugin', () => {
    it('should log uninstall (no-op for now)', async () => {
      const registry = new PluginRegistry(mockCtx as any, []);
      await registry.uninstallPlugin('test-plugin');
    });
  });

  describe('discoverPluginRoots', () => {
    it('should use JSHOOKMCP_PLUGIN_ROOT env var', () => {
      process.env.JSHOOKMCP_PLUGIN_ROOT = '/custom/plugins';
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const registry = new PluginRegistry(mockCtx as any);
      registry.listPlugins();

      delete process.env.JSHOOKMCP_PLUGIN_ROOT;
    });
  });

  describe('derivePluginId', () => {
    it('should handle scoped package names', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'scoped', isDirectory: () => true }] as any);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@scope/plugin' }));

      const registry = new PluginRegistry(mockCtx as any, ['/plugins']);
      const plugins = registry.listPlugins();
      // @ts-expect-error
      expect(plugins[0].id).toBe('@scope-plugin');
    });
  });
});

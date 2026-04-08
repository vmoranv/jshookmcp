import { describe, expect, it, vi } from 'vitest';
import { invokePlugin, getAvailablePlugins } from '@modules/binary-instrument/ExtensionBridge';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ExtensionBridgeConfig } from '@modules/binary-instrument/types';

describe('ExtensionBridge', () => {
  function createMockContext(plugins: string[] = []) {
    const runtimeById = new Map();
    for (const pluginId of plugins) {
      runtimeById.set(pluginId, {
        lifecycleContext: {
          invokeTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify({ success: true, data: 'ok' }) }],
          }),
        },
      });
    }
    return {
      extensionPluginsById: new Map(plugins.map((p) => [p, {}])),
      extensionPluginRuntimeById: runtimeById,
    } as unknown as MCPServerContext;
  }

  describe('invokePlugin', () => {
    it('returns error when plugin is not installed', async () => {
      const ctx = createMockContext([]);
      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: { pid: '1234' },
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({
        success: false,
        tool: 'binary-instrument',
        action: 'frida_attach',
      });
      expect((result as { error?: string }).error).toContain('not installed');
    });

    it('returns success when plugin is available', async () => {
      const ctx = createMockContext(['plugin_frida_bridge']);
      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: { pid: '1234' },
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({ success: true });
    });

    it('handles plugin invokeTool errors', async () => {
      const runtimeById = new Map();
      runtimeById.set('plugin_frida_bridge', {
        lifecycleContext: {
          invokeTool: vi.fn().mockRejectedValue(new Error('Frida process crashed')),
        },
      });
      const ctx = {
        extensionPluginsById: new Map([['plugin_frida_bridge', {}]]),
        extensionPluginRuntimeById: runtimeById,
      } as unknown as MCPServerContext;

      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: {},
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({
        success: false,
        error: 'Frida process crashed',
      });
    });

    it('handles non-JSON text response from plugin', async () => {
      const runtimeById = new Map();
      runtimeById.set('plugin_frida_bridge', {
        lifecycleContext: {
          invokeTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'plain text response' }],
          }),
        },
      });
      const ctx = {
        extensionPluginsById: new Map([['plugin_frida_bridge', {}]]),
        extensionPluginRuntimeById: runtimeById,
      } as unknown as MCPServerContext;

      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: {},
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({
        success: true,
        data: 'plain text response',
      });
    });

    it('handles empty text content from plugin', async () => {
      const runtimeById = new Map();
      runtimeById.set('plugin_frida_bridge', {
        lifecycleContext: {
          invokeTool: vi.fn().mockResolvedValue({
            content: [],
          }),
        },
      });
      const ctx = {
        extensionPluginsById: new Map([['plugin_frida_bridge', {}]]),
        extensionPluginRuntimeById: runtimeById,
      } as unknown as MCPServerContext;

      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: {},
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({
        success: false,
        error: 'Plugin returned no text content',
      });
    });

    it('normalizes plugin id with underscores to dashes', async () => {
      const ctx = createMockContext(['plugin-frida-bridge']);
      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: {},
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({ success: true });
    });

    it('detects plugins via KNOWN_PLUGINS fallback', async () => {
      const ctx = createMockContext(['frida_bridge']);
      const config: ExtensionBridgeConfig = {
        pluginId: 'plugin_frida_bridge',
        toolName: 'frida_attach',
        args: {},
      };

      const result = await invokePlugin(ctx, config);

      expect(result).toMatchObject({ success: true });
    });
  });

  describe('getAvailablePlugins', () => {
    it('returns empty array when no plugins installed', () => {
      const ctx = createMockContext([]);
      const available = getAvailablePlugins(ctx);
      expect(available).toEqual([]);
    });

    it('returns installed plugin names', () => {
      const ctx = createMockContext(['plugin_frida_bridge', 'plugin_ghidra_bridge']);
      const available = getAvailablePlugins(ctx);
      expect(available).toContain('plugin-frida-bridge');
      expect(available).toContain('plugin-ghidra-bridge');
    });
  });
});

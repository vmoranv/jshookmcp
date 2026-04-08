import type { MCPServerContext } from '@server/MCPServer.context';
import type { ExtensionBridgeConfig, ExtensionBridgeResult } from './types';

interface TextContentItem {
  type: string;
  text?: string;
}

interface PluginInvokeResult {
  content?: TextContentItem[];
}

interface PluginLifecycleContext {
  invokeTool(toolName: string, args: Record<string, unknown>): Promise<PluginInvokeResult>;
}

interface PluginRuntime {
  lifecycleContext?: PluginLifecycleContext;
}

export async function invokePlugin(
  ctx: MCPServerContext,
  config: ExtensionBridgeConfig,
): Promise<ExtensionBridgeResult> {
  const available = getAvailablePlugins(ctx);
  const normalizedRequested = normalizePluginId(config.pluginId);
  const actualPluginId = resolvePluginId(normalizedRequested, available);

  if (!actualPluginId) {
    return {
      success: false,
      tool: 'binary-instrument',
      action: config.toolName,
      error: `Plugin ${normalizedRequested} is not installed`,
    };
  }

  const runtime = findRuntime(ctx, actualPluginId);
  if (!runtime?.lifecycleContext) {
    return {
      success: false,
      tool: 'binary-instrument',
      action: config.toolName,
      error: `Plugin ${actualPluginId} is installed but has no runtime`,
    };
  }

  try {
    const response = await runtime.lifecycleContext.invokeTool(config.toolName, config.args);
    const firstText = response.content?.find((item) => item.type === 'text')?.text;

    if (!firstText) {
      return {
        success: false,
        tool: 'binary-instrument',
        action: config.toolName,
        error: 'Plugin returned no text content',
      };
    }

    try {
      const parsed = JSON.parse(firstText);
      if (isResultRecord(parsed)) {
        return {
          tool: 'binary-instrument',
          action: config.toolName,
          success: readBoolean(parsed, 'success') ?? true,
          data: parsed['data'],
          error: readString(parsed, 'error'),
        };
      }
    } catch {
      return {
        success: true,
        tool: 'binary-instrument',
        action: config.toolName,
        data: firstText,
      };
    }

    return {
      success: true,
      tool: 'binary-instrument',
      action: config.toolName,
      data: firstText,
    };
  } catch (error) {
    return {
      success: false,
      tool: 'binary-instrument',
      action: config.toolName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getAvailablePlugins(ctx: MCPServerContext): string[] {
  const installed = Array.from(ctx.extensionPluginsById.keys());
  return installed.map(normalizePluginId);
}

function normalizePluginId(pluginId: string): string {
  return pluginId.replaceAll('_', '-');
}

function resolvePluginId(requested: string, installed: string[]): string | undefined {
  const requestedWithoutPrefix = requested.replace(/^plugin-/, '');

  for (const installedId of installed) {
    const installedWithoutPrefix = installedId.replace(/^plugin-/, '');
    if (installedId === requested || installedWithoutPrefix === requestedWithoutPrefix) {
      return installedId;
    }
  }

  return undefined;
}

function findRuntime(ctx: MCPServerContext, normalizedPluginId: string): PluginRuntime | undefined {
  for (const [pluginId, runtime] of ctx.extensionPluginRuntimeById.entries()) {
    if (normalizePluginId(pluginId) === normalizedPluginId) {
      return isPluginRuntime(runtime) ? runtime : undefined;
    }
  }

  return undefined;
}

function isPluginRuntime(value: unknown): value is PluginRuntime {
  return typeof value === 'object' && value !== null;
}

function isResultRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

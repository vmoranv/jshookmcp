/**
 * Extension lifecycle helpers — import, cleanup, config extraction, list building.
 */
import { pathToFileURL } from 'node:url';
import { logger } from '@utils/logger';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ExtensionListResult } from '@server/extensions/types';

export function extractConfigValue<T = unknown>(
  ctx: MCPServerContext,
  path: string,
  fallback?: T
): T {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = ctx.config as unknown as Record<string, unknown>;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return fallback as T;
    current = (current as Record<string, unknown>)[segment];
  }
  return (current as T) ?? (fallback as T);
}

export function createFreshImportUrl(modulePath: string, kind: 'plugin' | 'workflow'): string {
  const moduleUrl = new URL(pathToFileURL(modulePath).href);
  moduleUrl.searchParams.set('reloadTs', String(Date.now()));
  logger.debug(`[extensions] Loading fresh ${kind} module: ${modulePath}`);
  return moduleUrl.href;
}

export async function clearLoadedExtensionTools(ctx: MCPServerContext): Promise<number> {
  let removed = 0;

  for (const [pluginId, runtime] of ctx.extensionPluginRuntimeById.entries()) {
    try {
      if (runtime.plugin.onDeactivateHandler && runtime.state === 'activated') {
        await runtime.plugin.onDeactivateHandler(runtime.lifecycleContext);
        runtime.state = 'deactivated';
      }
    } catch (error) {
      logger.warn(`Plugin onDeactivate failed for "${pluginId}":`, error);
    }
    try {
      if (runtime.plugin.onDeactivateHandler) {
        runtime.state = 'unloaded';
      }
    } catch (error) {
      logger.warn(`Plugin onUnload failed for "${pluginId}":`, error);
    }
  }

  for (const record of ctx.extensionToolsByName.values()) {
    try {
      record.registeredTool?.remove();
    } catch (error) {
      logger.warn(`Failed to remove extension tool "${record.name}":`, error);
    }
    ctx.router.removeHandler(record.name);
    ctx.activatedToolNames.delete(record.name);
    ctx.activatedRegisteredTools.delete(record.name);
    removed++;
  }
  ctx.extensionToolsByName.clear();
  ctx.extensionPluginsById.clear();
  ctx.extensionPluginRuntimeById.clear();
  ctx.extensionWorkflowsById.clear();
  ctx.extensionWorkflowRuntimeById.clear();
  return removed;
}

export function buildListResult(
  ctx: MCPServerContext,
  pluginRoots: string[],
  workflowRoots: string[]
): ExtensionListResult {
  return {
    pluginRoots,
    workflowRoots,
    pluginCount: ctx.extensionPluginsById.size,
    workflowCount: ctx.extensionWorkflowsById.size,
    toolCount: ctx.extensionToolsByName.size,
    lastReloadAt: ctx.lastExtensionReloadAt,
    plugins: [...ctx.extensionPluginsById.values()],
    workflows: [...ctx.extensionWorkflowsById.values()],
    tools: [...ctx.extensionToolsByName.values()].map((record) => ({
      name: record.name,
      domain: record.domain,
      source: record.source,
    })),
  };
}

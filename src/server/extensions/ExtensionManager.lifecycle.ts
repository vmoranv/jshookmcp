/**
 * Extension lifecycle helpers — import, cleanup, config extraction, list building.
 */
import { pathToFileURL } from 'node:url';
import { clearDomainTtl } from '@server/MCPServer.activation.ttl';
import { logger } from '@utils/logger';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ExtensionListResult } from '@server/extensions/types';
import type { ToolProfileId } from '@server/registry/contracts';
import { unregisterExtensionToolRecord } from '@server/extensions/ExtensionManager.tools';
import { shouldAutoRegisterExtensionTool } from '@server/extensions/ExtensionManager.tools';

export function extractConfigValue<T = unknown>(
  ctx: MCPServerContext,
  path: string,
  fallback?: T,
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
  const extensionDomains = new Set<string>();

  for (const [pluginId, runtime] of ctx.extensionPluginRuntimeById.entries()) {
    try {
      if (runtime.plugin.onDeactivateHandler && runtime.state === 'activated') {
        await runtime.plugin.onDeactivateHandler(runtime.lifecycleContext);
        runtime.state = 'deactivated';
      }
    } catch (error) {
      logger.warn(`Plugin onDeactivate failed for "${pluginId}":`, error);
    }
    // Only mark the runtime as unloaded when teardown actually succeeded: a
    // plugin whose onDeactivate threw above is still 'activated'.
    if (runtime.state === 'deactivated') {
      runtime.state = 'unloaded';
    }
  }

  for (const record of ctx.extensionToolsByName.values()) {
    extensionDomains.add(record.domain);
    try {
      unregisterExtensionToolRecord(ctx, record, {
        onRemoveError: (error) => {
          logger.warn(`Failed to remove extension tool "${record.name}":`, error);
        },
      });
    } catch (error) {
      logger.warn(`Failed to remove extension tool "${record.name}":`, error);
    }
    removed++;
  }
  for (const domain of extensionDomains) {
    clearDomainTtl(ctx, domain);
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
  workflowRoots: string[],
): ExtensionListResult {
  const defaultProfiles: readonly ToolProfileId[] = ['full'];
  const tools = [...ctx.extensionToolsByName.values()].map((record) => ({
    name: record.name,
    domain: record.domain,
    source: record.source,
    profiles:
      record.profiles && record.profiles.length > 0 ? [...record.profiles] : defaultProfiles,
    visibleInCurrentProfile: shouldAutoRegisterExtensionTool(ctx.baseTier, record),
    active: ctx.activatedToolNames.has(record.name),
    activationSource: record.activationSource,
    activatedAt: record.activatedAt,
  }));

  return {
    pluginRoots,
    workflowRoots,
    pluginCount: ctx.extensionPluginsById.size,
    workflowCount: ctx.extensionWorkflowsById.size,
    toolCount: ctx.extensionToolsByName.size,
    activeToolCount: tools.filter((tool) => tool.active).length,
    currentProfile: ctx.baseTier,
    lastReloadAt: ctx.lastExtensionReloadAt,
    plugins: [...ctx.extensionPluginsById.values()],
    workflows: [...ctx.extensionWorkflowsById.values()],
    tools,
  };
}

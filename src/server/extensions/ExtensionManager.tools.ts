import { getToolDomain } from '@server/registry/views';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolProfileId } from '@server/registry/contracts';
import type { ExtensionToolRecord } from '@server/extensions/types';
import { deactivateToolCore } from '@server/tool-lifecycle';

const DEFAULT_EXTENSION_PROFILES: readonly ToolProfileId[] = ['search', 'workflow', 'full'];

function resolveExtensionToolProfiles(
  record: Pick<ExtensionToolRecord, 'profiles'>,
): readonly ToolProfileId[] {
  return record.profiles && record.profiles.length > 0
    ? record.profiles
    : DEFAULT_EXTENSION_PROFILES;
}

function hasActiveToolInDomain(ctx: MCPServerContext, domain: string): boolean {
  for (const selectedTool of ctx.selectedTools) {
    if (getToolDomain(selectedTool.name) === domain) {
      return true;
    }
  }

  for (const toolName of ctx.activatedToolNames) {
    const extensionRecord = ctx.extensionToolsByName.get(toolName);
    if (extensionRecord) {
      if (extensionRecord.domain === domain) {
        return true;
      }
      continue;
    }

    if (getToolDomain(toolName) === domain) {
      return true;
    }
  }

  return false;
}

function syncEnabledDomain(ctx: MCPServerContext, domain: string): void {
  if (hasActiveToolInDomain(ctx, domain)) {
    ctx.enabledDomains.add(domain);
    return;
  }

  ctx.enabledDomains.delete(domain);
}

export function shouldAutoRegisterExtensionTool(
  baseTier: ToolProfileId,
  record: Pick<ExtensionToolRecord, 'profiles'>,
): boolean {
  return resolveExtensionToolProfiles(record).includes(baseTier);
}

export function registerExtensionToolRecord(
  ctx: MCPServerContext,
  record: ExtensionToolRecord,
  activationSource: 'reload' | 'activate_tools' | 'activate_domain' = 'activate_tools',
): boolean {
  if (ctx.activatedToolNames.has(record.name)) {
    ctx.enabledDomains.add(record.domain);
    record.activationSource ??= activationSource;
    record.activatedAt ??= new Date().toISOString();
    return false;
  }

  const registeredTool = ctx.registerSingleTool(record.tool);
  ctx.activatedToolNames.add(record.name);
  ctx.activatedRegisteredTools.set(record.name, registeredTool);
  record.registeredTool = registeredTool;
  record.activationSource = activationSource;
  record.activatedAt = new Date().toISOString();
  ctx.enabledDomains.add(record.domain);

  if (record.handler) {
    ctx.router.addHandlers({
      [record.name]: record.handler as Parameters<typeof ctx.router.addHandlers>[0][string],
    });
  }

  return true;
}

export function unregisterExtensionToolRecord(
  ctx: MCPServerContext,
  record: ExtensionToolRecord,
  options: {
    removeDefinition?: boolean;
    skipRegisteredToolRemoval?: boolean;
    onRemoveError?: (error: unknown) => void;
  } = {},
): boolean {
  const trackedRegisteredTool = ctx.activatedRegisteredTools.get(record.name);
  const registeredTool = record.registeredTool ?? trackedRegisteredTool;
  const wasActive =
    Boolean(registeredTool) ||
    ctx.activatedToolNames.has(record.name) ||
    ctx.activatedRegisteredTools.has(record.name);

  // `registerExtensionToolRecord` stores the same handle in both places, and
  // `deactivateToolCore` already removes the tracked one. Only remove here when
  // this record holds an untracked handle, otherwise we would call `remove()`
  // twice for the same tool.
  if (
    registeredTool &&
    !options.skipRegisteredToolRemoval &&
    registeredTool !== trackedRegisteredTool
  ) {
    try {
      registeredTool.remove();
    } catch (error) {
      options.onRemoveError?.(error);
    }
  }

  deactivateToolCore(record.name, {
    activatedToolNames: ctx.activatedToolNames,
    activatedRegisteredTools: ctx.activatedRegisteredTools,
    router: ctx.router,
    extensionToolsByName: ctx.extensionToolsByName,
  });
  record.registeredTool = undefined;
  record.activationSource = undefined;
  record.activatedAt = undefined;

  if (options.removeDefinition) {
    ctx.extensionToolsByName.delete(record.name);
  }

  syncEnabledDomain(ctx, record.domain);
  return wasActive;
}

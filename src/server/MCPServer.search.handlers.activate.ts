/**
 * Handlers for activate_tools and deactivate_tools meta-tools.
 */
import { logger } from '@utils/logger';
import { asTextResponse } from '@server/domains/shared/response';
import { getToolDomain } from '@server/ToolCatalog';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { normalizeToolName, validateToolNameArray } from '@server/MCPServer.search.validation';
import { getActiveToolNames, getToolByName } from '@server/MCPServer.search.helpers';

interface ActivationSummary {
  activated: string[];
  alreadyActive: string[];
  notFound: string[];
  totalActive: number;
}

async function notifyToolListChanged(ctx: MCPServerContext, changed: boolean): Promise<void> {
  if (!changed) {
    return;
  }

  try {
    await ctx.server.sendToolListChanged();
  } catch (e) {
    logger.warn('sendToolListChanged failed:', e);
  }
}

export async function activateToolNames(
  ctx: MCPServerContext,
  names: string[]
): Promise<ActivationSummary> {
  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];
  const alreadyActive: string[] = [];
  const notFound: string[] = [];

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    if (activeNames.has(name)) {
      alreadyActive.push(name);
      continue;
    }

    const toolDef = getToolByName(ctx).get(name);
    if (!toolDef) {
      notFound.push(name);
      continue;
    }

    const registeredTool = ctx.registerSingleTool(toolDef);
    ctx.activatedToolNames.add(name);
    ctx.activatedRegisteredTools.set(name, registeredTool);

    const extensionRecord = ctx.extensionToolsByName.get(name);
    if (extensionRecord) {
      extensionRecord.registeredTool = registeredTool;
    }

    const domain = getToolDomain(name) ?? ctx.extensionToolsByName.get(name)?.domain;
    if (domain) {
      ctx.enabledDomains.add(domain);
    }

    // Use stored handler for extension tools; built-in handler map for core tools.
    if (extensionRecord?.handler) {
      ctx.router.addHandlers({
        [name]: extensionRecord.handler as Parameters<typeof ctx.router.addHandlers>[0][string],
      });
    } else {
      const newToolNames = new Set([name]);
      const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
      ctx.router.addHandlers(newHandlers);
    }

    activated.push(name);
    activeNames.add(name);
  }

  await notifyToolListChanged(ctx, activated.length > 0);

  logger.info(
    `activate_tools: activated ${activated.length}, already_active ${alreadyActive.length}, not_found ${notFound.length}`
  );

  return {
    activated,
    alreadyActive,
    notFound,
    totalActive: activeNames.size,
  };
}

/* ---------- activate_tools handler ---------- */

export async function handleActivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { names, error } = validateToolNameArray(args);
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const result = await activateToolNames(ctx, names);

  return asTextResponse(
    JSON.stringify({
      success: true,
      ...result,
      hint:
        result.activated.length > 0
          ? 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.'
          : undefined,
    })
  );
}

/* ---------- deactivate_tools handler ---------- */

export async function handleDeactivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { names, error } = validateToolNameArray(args);
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const deactivated: string[] = [];
  const notActivated: string[] = [];

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    if (!ctx.activatedToolNames.has(name)) {
      notActivated.push(name);
      continue;
    }

    const registeredTool = ctx.activatedRegisteredTools.get(name);
    if (registeredTool) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`Failed to remove activated tool "${name}":`, e);
      }
    }

    ctx.router.removeHandler(name);
    ctx.activatedToolNames.delete(name);
    ctx.activatedRegisteredTools.delete(name);
    const extensionRecord = ctx.extensionToolsByName.get(name);
    if (extensionRecord) {
      extensionRecord.registeredTool = undefined;
    }
    deactivated.push(name);
  }

  await notifyToolListChanged(ctx, deactivated.length > 0);

  logger.info(
    `deactivate_tools: deactivated ${deactivated.length}, not_activated ${notActivated.length}`
  );

  return asTextResponse(
    JSON.stringify({
      success: true,
      deactivated,
      notActivated,
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    })
  );
}

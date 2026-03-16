/**
 * Handler for the activate_domain meta-tool.
 */
import { logger } from '@utils/logger';
import { asTextResponse } from '@server/domains/shared/response';
import { getToolsByDomains } from '@server/ToolCatalog';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { ALL_DOMAINS } from '@server/registry/index';
import { getActiveToolNames } from '@server/MCPServer.search.helpers';
import { startDomainTtl } from '@server/MCPServer.activation.ttl';
import { ACTIVATION_TTL_MINUTES } from '@src/constants';

export async function handleActivateDomain(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const domain = typeof args.domain === 'string' ? args.domain : '';
  if (!domain) {
    return asTextResponse(
      JSON.stringify({ success: false, error: 'domain must be a non-empty string' })
    );
  }
  const validDomains = new Set<string>(ALL_DOMAINS);
  for (const record of ctx.extensionToolsByName.values()) {
    validDomains.add(record.domain);
  }

  if (!validDomains.has(domain)) {
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: `Unknown domain "${domain}". Valid: ${[...validDomains].join(', ')}`,
      })
    );
  }

  const ttlMinutes = typeof args.ttlMinutes === 'number' ? args.ttlMinutes : ACTIVATION_TTL_MINUTES;

  const domainTools = [
    ...getToolsByDomains([domain]),
    ...[...ctx.extensionToolsByName.values()]
      .filter((record) => record.domain === domain)
      .map((record) => record.tool),
  ];
  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];

  ctx.enabledDomains.add(domain);

  for (const toolDef of domainTools) {
    if (activeNames.has(toolDef.name)) continue;

    const registeredTool = ctx.registerSingleTool(toolDef);
    ctx.activatedToolNames.add(toolDef.name);
    ctx.activatedRegisteredTools.set(toolDef.name, registeredTool);
    const extensionRecord = ctx.extensionToolsByName.get(toolDef.name);
    if (extensionRecord) {
      extensionRecord.registeredTool = registeredTool;
    }
    activated.push(toolDef.name);
  }

  if (activated.length > 0) {
    // Built-in tools: use handler map; extension tools: use stored handlers
    const builtinNames = new Set(activated.filter((n) => !ctx.extensionToolsByName.has(n)));
    if (builtinNames.size > 0) {
      const newHandlers = createToolHandlerMap(ctx.handlerDeps, builtinNames);
      ctx.router.addHandlers(newHandlers);
    }
    for (const name of activated) {
      const extRecord = ctx.extensionToolsByName.get(name);
      if (extRecord?.handler) {
        ctx.router.addHandlers({ [name]: extRecord.handler as Parameters<typeof ctx.router.addHandlers>[0][string] });
      }
    }

    // Start TTL timer for this domain activation
    startDomainTtl(ctx, domain, ttlMinutes, activated);

    try {
      await ctx.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed:', e);
    }
  }

  logger.info(`activate_domain: domain="${domain}", activated ${activated.length} tools, ttl=${ttlMinutes}min`);

  return asTextResponse(
    JSON.stringify({
      success: true,
      domain,
      activated: activated.length,
      activatedTools: activated,
      totalDomainTools: domainTools.length,
      ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 'no expiry',
      hint: activated.length > 0
        ? 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.'
        : undefined,
    })
  );
}

/**
 * Handler for the activate_domain meta-tool.
 */
import { logger } from '@utils/logger';
import { asTextResponse } from '@server/domains/shared/response';
import { getToolsByDomains } from '@server/ToolCatalog';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { registerExtensionToolRecord } from '@server/extensions/ExtensionManager.tools';
import { getAllKnownDomains, ensureDomainLoaded } from '@server/registry/index';
import {
  createActivationBudgetTracker,
  estimateToolTokens,
  getActiveToolNames,
  summarizeActivationBudget,
} from '@server/MCPServer.search.helpers';
import { evictForBudget, precheckActivation } from '@server/MCPServer.search.handlers.activate';
import { startDomainTtl } from '@server/MCPServer.activation.ttl';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';
import { ACTIVATION_TTL_MINUTES } from '@src/constants';

export async function handleActivateDomain(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const domain = typeof args.domain === 'string' ? args.domain : '';
  if (!domain) {
    return asTextResponse(
      JSON.stringify({ success: false, error: 'domain must be a non-empty string' }),
    );
  }
  const validDomains = new Set<string>(getAllKnownDomains());
  for (const record of ctx.extensionToolsByName.values()) {
    validDomains.add(record.domain);
  }

  if (!validDomains.has(domain)) {
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: `Unknown domain "${domain}". Valid: ${[...validDomains].join(', ')}`,
      }),
    );
  }

  // Ensure the domain manifest is loaded before accessing tools/handlers
  await ensureDomainLoaded(domain, ctx.eventBus);

  const ttlMinutes = typeof args.ttlMinutes === 'number' ? args.ttlMinutes : ACTIVATION_TTL_MINUTES;

  const domainTools = [
    ...getToolsByDomains([domain]),
    ...[...ctx.extensionToolsByName.values()]
      .filter((record) => record.domain === domain)
      .map((record) => record.tool),
  ];
  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];
  const budgetExceeded: string[] = [];
  const evicted: string[] = [];
  const budget = await createActivationBudgetTracker(ctx);

  ctx.enabledDomains.add(domain);

  // Budget precheck (kimi-cu report P2-4): dry-run the whole domain batch
  // without touching state, so agents can see what would be evicted first.
  if (args.precheck === true) {
    const names = domainTools.map((t) => t.name);
    const pre = await precheckActivation(ctx, names);
    return asTextResponse(JSON.stringify({ success: true, domain, ...pre }));
  }

  // Tools owned by this domain must survive LRU eviction while it activates.
  const protectedNames = new Set(domainTools.map((t) => t.name));

  for (const toolDef of domainTools) {
    if (activeNames.has(toolDef.name)) continue;

    const extensionRecord = ctx.extensionToolsByName.get(toolDef.name);
    if (extensionRecord) {
      if (!budget.admit(extensionRecord.tool)) {
        evicted.push(
          ...(await evictForBudget(ctx, budget, protectedNames, {
            tools: 1,
            tokens: estimateToolTokens(extensionRecord.tool),
          })),
        );
        if (!budget.admit(extensionRecord.tool)) {
          budgetExceeded.push(toolDef.name);
          continue;
        }
      }
      registerExtensionToolRecord(ctx, extensionRecord, 'activate_domain');
    } else {
      if (!budget.admit(toolDef)) {
        evicted.push(
          ...(await evictForBudget(ctx, budget, protectedNames, {
            tools: 1,
            tokens: estimateToolTokens(toolDef),
          })),
        );
        if (!budget.admit(toolDef)) {
          budgetExceeded.push(toolDef.name);
          continue;
        }
      }
      const registeredTool = ctx.registerSingleTool(toolDef);
      ctx.activatedToolNames.add(toolDef.name);
      ctx.activatedRegisteredTools.set(toolDef.name, registeredTool);
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
        ctx.router.addHandlers({
          [name]: extRecord.handler as Parameters<typeof ctx.router.addHandlers>[0][string],
        });
      }
    }

    // Start TTL timer for this domain activation
    startDomainTtl(ctx, domain, ttlMinutes, activated);
    getRuntimeState(ctx)?.setPendingDomainActivation(domain, ttlMinutes, activated);

    try {
      await ctx.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed:', e);
    }
  }

  logger.info(
    `activate_domain: domain="${domain}", activated ${activated.length} tools, ` +
      `budget_exceeded ${budgetExceeded.length}, ttl=${ttlMinutes}min`,
  );
  ctx.mcpLog.info('jshookmcp', {
    event: 'domain_activated',
    domain,
    toolCount: activated.length,
    budgetExcluded: budgetExceeded.length,
  });

  const budgetSummary = summarizeActivationBudget(budget);

  return asTextResponse(
    JSON.stringify({
      success: true,
      domain,
      activated: activated.length,
      activatedTools: activated,
      budgetExceeded,
      evicted,
      budget: budgetSummary,
      totalDomainTools: domainTools.length,
      ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 'no expiry',
      hint:
        budgetExceeded.length > 0
          ? `Skipped ${budgetExceeded.length} tool(s) over the activation budget ` +
            `(used ${budgetSummary.usedTokens}/${budgetSummary.maxTokens} tokens, ` +
            `${budgetSummary.activeTools}/${budgetSummary.maxTools} tools): ` +
            `${budgetExceeded.join(', ')}. Deactivate unused tools first or raise ` +
            `MCP_TOOL_ACTIVATION_BUDGET_TOKENS / MCP_TOOL_MAX_ACTIVE_TOOLS.`
          : activated.length > 0
            ? 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} ' +
              '}) to invoke them.'
            : undefined,
    }),
  );
}

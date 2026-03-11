/**
 * Search and activation meta-tool handlers for progressive tool discovery.
 *
 * Provides:
 *  - search_tools: BM25 search across all tools
 *  - activate_tools: register specific tools by name
 *  - deactivate_tools: unregister specific activated tools
 *  - activate_domain: register all tools in a domain
 */
import { z } from 'zod';
import { logger } from '@utils/logger';
import { asErrorResponse, asTextResponse } from '@server/domains/shared/response';
import { allTools, getToolDomain, getToolsByDomains } from '@server/ToolCatalog';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import { ToolSearchEngine } from '@server/ToolSearch';
import type { ToolResponse } from '@server/types';
import { ALL_DOMAINS, ALL_REGISTRATIONS } from '@server/registry/index';
import {
  SEARCH_WORKFLOW_BOOST_TIERS,
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER,
} from '@src/constants';

/* ---------- helpers ---------- */

function getActiveToolNames(ctx: MCPServerContext): Set<string> {
  const names = new Set(ctx.selectedTools.map((t) => t.name));
  for (const name of ctx.boostedToolNames) names.add(name);
  for (const name of ctx.activatedToolNames) names.add(name);
  return names;
}

function getExtensionDomainMap(ctx: MCPServerContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of ctx.extensionToolsByName.values()) {
    map.set(record.name, record.domain);
  }
  return map;
}

function getCombinedTools(ctx: MCPServerContext): typeof allTools {
  const tools = new Map(allTools.map((tool) => [tool.name, tool]));
  for (const record of ctx.extensionToolsByName.values()) {
    tools.set(record.name, record.tool);
  }
  return [...tools.values()];
}

/* ---------- ToolSearchEngine build cache ---------- */

interface CachedSearchEngine {
  signature: string;
  engine: ToolSearchEngine;
}

const searchEngineCache = new WeakMap<MCPServerContext, CachedSearchEngine>();

/**
 * Build a cache signature from all inputs that affect ToolSearchEngine construction.
 * Changes in tier, extension tools, or workflow runtime state invalidate the cache.
 */
export function buildSearchSignature(ctx: MCPServerContext): string {
  // Extension tool identity + domain mapping
  const extParts: string[] = [];
  for (const [name, record] of ctx.extensionToolsByName) {
    extParts.push(`${name}:${record.domain}`);
  }
  extParts.sort();

  return [
    ctx.currentTier,
    ctx.extensionWorkflowRuntimeById.size,
    extParts.join('|'),
  ].join('::');
}

export function getSearchEngine(ctx: MCPServerContext): ToolSearchEngine {
  const signature = buildSearchSignature(ctx);
  const cached = searchEngineCache.get(ctx);
  if (cached && cached.signature === signature) return cached.engine;

  const tools = getCombinedTools(ctx);
  const extensionDomains = getExtensionDomainMap(ctx);
  const domainScoreMultipliers = new Map<string, number>();
  const toolScoreMultipliers = new Map<string, number>();
  for (const record of ctx.extensionToolsByName.values()) {
    toolScoreMultipliers.set(record.name, 1.12);
  }
  if (SEARCH_WORKFLOW_BOOST_TIERS.has(ctx.currentTier)) {
    domainScoreMultipliers.set('workflow', SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER);
  }
  if (ctx.extensionWorkflowRuntimeById.size > 0) {
    toolScoreMultipliers.set('run_extension_workflow', 1.35);
    toolScoreMultipliers.set('list_extension_workflows', 1.25);
  }

  const engine = new ToolSearchEngine(tools, extensionDomains, domainScoreMultipliers, toolScoreMultipliers);
  searchEngineCache.set(ctx, { signature, engine });
  return engine;
}

function getToolByName(ctx: MCPServerContext): Map<string, typeof allTools[number]> {
  return new Map(getCombinedTools(ctx).map((tool) => [tool.name, tool]));
}

/** Generate domain summary description from discovered manifests. */
function buildDomainDescription(ctx: MCPServerContext): string {
  const groups: Record<string, number> = {};
  for (const r of ALL_REGISTRATIONS) {
    groups[r.domain] = (groups[r.domain] ?? 0) + 1;
  }
  for (const record of ctx.extensionToolsByName.values()) {
    groups[record.domain] = (groups[record.domain] ?? 0) + 1;
  }
  const totalTools = ALL_REGISTRATIONS.length + ctx.extensionToolsByName.size;
  const parts = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => `${domain} (${count})`)
    .join(' | ');
  const extensionCount = ctx.extensionToolsByName.size;
  const workflowBias = SEARCH_WORKFLOW_BOOST_TIERS.has(ctx.currentTier)
    ? ` ${ctx.currentTier}-tier sessions boost ranking for workflow-domain results.`
    : '';
  return `Search ${totalTools} tools across ${Object.keys(groups).length} capability domains. ` +
    `This includes built-in tools plus any loaded plugin/workflow tools (${extensionCount} currently loaded). ` +
    `Search before attempting unfamiliar tasks, and prioritize plugin/workflow matches when they fit the task.${workflowBias} ` +
    `Domains: ${parts}.`;
}

/* ---------- input validation ---------- */

function validateToolNameArray(args: Record<string, unknown>): { names: string[]; error?: string } {
  const raw = args.names;
  if (!Array.isArray(raw)) {
    return { names: [], error: 'names must be an array' };
  }
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) {
      return { names: [], error: 'invalid tool name: expected non-empty string' };
    }
    names.push(item);
  }
  return { names };
}

/* ---------- search_tools handler ---------- */

async function handleSearchTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const query = args.query as string;
  const topK = (args.top_k as number | undefined) ?? 10;

  const engine = getSearchEngine(ctx);
  const activeNames = getActiveToolNames(ctx);
  const results = engine.search(query, topK, activeNames);

  return asTextResponse(
    JSON.stringify(
      {
        query,
        resultCount: results.length,
        results,
        hint: 'Use extensions_reload first to load plugin/workflow tools, then activate_tools for specific matches or activate_domain for an entire domain.',
      },
      null,
      2
    )
  );
}

/* ---------- activate_tools handler ---------- */

async function handleActivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { names, error } = validateToolNameArray(args);
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];
  const alreadyActive: string[] = [];
  const notFound: string[] = [];

  for (const name of names) {
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

    // Use stored handler for extension tools; built-in handler map for core tools
    if (extensionRecord?.handler) {
      ctx.router.addHandlers({ [name]: extensionRecord.handler as Parameters<typeof ctx.router.addHandlers>[0][string] });
    } else {
      const newToolNames = new Set([name]);
      const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
      ctx.router.addHandlers(newHandlers);
    }

    activated.push(name);
    activeNames.add(name);
  }

  if (activated.length > 0) {
    try {
      await ctx.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed:', e);
    }
  }

  logger.info(`activate_tools: activated ${activated.length}, already_active ${alreadyActive.length}, not_found ${notFound.length}`);

  return asTextResponse(
    JSON.stringify({
      success: true,
      activated,
      alreadyActive,
      notFound,
      totalActive: activeNames.size,
    })
  );
}

/* ---------- deactivate_tools handler ---------- */

async function handleDeactivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { names, error } = validateToolNameArray(args);
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const deactivated: string[] = [];
  const notActivated: string[] = [];

  for (const name of names) {
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

  if (deactivated.length > 0) {
    try {
      await ctx.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed:', e);
    }
  }

  logger.info(`deactivate_tools: deactivated ${deactivated.length}, not_activated ${notActivated.length}`);

  return asTextResponse(
    JSON.stringify({
      success: true,
      deactivated,
      notActivated,
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    })
  );
}

/* ---------- activate_domain handler ---------- */

async function handleActivateDomain(
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

    try {
      await ctx.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed:', e);
    }
  }

  logger.info(`activate_domain: domain="${domain}", activated ${activated.length} tools`);

  return asTextResponse(
    JSON.stringify({
      success: true,
      domain,
      activated: activated.length,
      activatedTools: activated,
      totalDomainTools: domainTools.length,
    })
  );
}

async function handleExtensionsReload(ctx: MCPServerContext): Promise<ToolResponse> {
  const result = await ctx.reloadExtensions();
  return asTextResponse(JSON.stringify(result, null, 2));
}

async function handleExtensionsList(ctx: MCPServerContext): Promise<ToolResponse> {
  const result = ctx.listExtensions();
  return asTextResponse(JSON.stringify(result, null, 2));
}

/* ---------- registration ---------- */

export function registerSearchMetaTools(ctx: MCPServerContext): void {
  ctx.server.registerTool(
    'search_tools',
    {
      description: buildDomainDescription(ctx),
      inputSchema: {
        query: z.string().describe('Search query: keywords, tool name, domain name, or description fragment'),
        top_k: z.number().optional().describe('Max results to return (default: 10, max: 30)'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleSearchTools(ctx, args);
      } catch (error) {
        logger.error('search_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'activate_tools',
    {
      description:
        'Dynamically register specific tools by name. ' +
        'Use after search_tools to enable exactly the tools you need. ' +
        'Activated tools appear in the tool list immediately.',
      inputSchema: {
        names: z.array(z.string()).describe('Array of tool names to activate (from search_tools results)'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleActivateTools(ctx, args);
      } catch (error) {
        logger.error('activate_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'deactivate_tools',
    {
      description:
        'Remove previously activated tools to free context. ' +
        'Only affects tools added via activate_tools, not base profile tools.',
      inputSchema: {
        names: z.array(z.string()).describe('Array of tool names to deactivate'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleDeactivateTools(ctx, args);
      } catch (error) {
        logger.error('deactivate_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'activate_domain',
    {
      description:
        `Activate all tools in a domain at once. ` +
        `Domains: ${[...ALL_DOMAINS].join(', ')}. ` +
        `Use extensions_reload first to include external plugin/workflow domains.`,
      inputSchema: {
        domain: z.string().describe('Domain name to activate (e.g. "debugger", "network")'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleActivateDomain(ctx, args);
      } catch (error) {
        logger.error('activate_domain failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'extensions_list',
    {
      description:
        'List dynamically loaded extensions from plugins/workflows directories. ' +
        'Shows loaded plugins, extension workflows, extension tools, and active roots.',
    },
    async () => {
      try {
        return await handleExtensionsList(ctx);
      } catch (error) {
        logger.error('extensions_list failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'extensions_reload',
    {
      description:
        'Reload external extensions from plugins/ and workflows/ (or MCP_PLUGIN_ROOTS/MCP_WORKFLOW_ROOTS). ' +
        'Dynamically registers extension tools and refreshes tool list.',
    },
    async () => {
      try {
        return await handleExtensionsReload(ctx);
      } catch (error) {
        logger.error('extensions_reload failed', error);
        return asErrorResponse(error);
      }
    }
  );
}

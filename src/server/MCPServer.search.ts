/**
 * Search and activation meta-tool handlers for progressive tool discovery.
 *
 * Provides:
 *  - search_tools: BM25 search across all 226 tools
 *  - activate_tools: register specific tools by name
 *  - deactivate_tools: unregister specific activated tools
 *  - activate_domain: register all tools in a domain
 */
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { asErrorResponse, asTextResponse } from './domains/shared/response.js';
import { allTools, getToolDomain, getToolsByDomains, type ToolDomain } from './ToolCatalog.js';
import { createToolHandlerMap } from './ToolHandlerMap.js';
import type { MCPServerContext } from './MCPServer.context.js';
import { ToolSearchEngine } from './ToolSearch.js';
import type { ToolResponse } from './types.js';

/* ---------- shared state ---------- */

let searchEngine: ToolSearchEngine | null = null;

function getSearchEngine(): ToolSearchEngine {
  if (!searchEngine) {
    searchEngine = new ToolSearchEngine();
  }
  return searchEngine;
}

/* ---------- helpers ---------- */

/** Collect all currently active (registered) tool names. */
function getActiveToolNames(ctx: MCPServerContext): Set<string> {
  const names = new Set(ctx.selectedTools.map((t) => t.name));
  for (const name of ctx.boostedToolNames) names.add(name);
  for (const name of ctx.activatedToolNames) names.add(name);
  return names;
}

/** Build a tool lookup map from allTools for fast name→Tool resolution. Lazy-initialised. */
let _toolByName: Map<string, typeof allTools[number]> | null = null;
function getToolByName(): Map<string, typeof allTools[number]> {
  if (!_toolByName) {
    _toolByName = new Map(allTools.map((t) => [t.name, t]));
  }
  return _toolByName;
}

/* ---------- search_tools handler ---------- */

async function handleSearchTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const query = args.query as string;
  const topK = (args.top_k as number | undefined) ?? 10;

  const engine = getSearchEngine();
  const activeNames = getActiveToolNames(ctx);
  const results = engine.search(query, topK, activeNames);

  return asTextResponse(
    JSON.stringify(
      {
        query,
        resultCount: results.length,
        results,
        hint: 'Use activate_tools to register specific tools, or activate_domain for an entire domain.',
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
  const names = args.names as string[];
  if (!Array.isArray(names) || names.length === 0) {
    return asTextResponse(JSON.stringify({ success: false, error: 'names must be a non-empty array' }));
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
    const toolDef = getToolByName().get(name);
    if (!toolDef) {
      notFound.push(name);
      continue;
    }
    // Register the tool with MCP SDK
    const registeredTool = ctx.registerSingleTool(toolDef);
    ctx.activatedToolNames.add(name);
    ctx.activatedRegisteredTools.set(name, registeredTool);

    // Ensure domain is enabled
    const domain = getToolDomain(name);
    if (domain) {
      ctx.enabledDomains.add(domain);
    }

    // Add handler to router
    const newToolNames = new Set([name]);
    const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
    ctx.router.addHandlers(newHandlers);

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
  const names = args.names as string[];
  if (!Array.isArray(names) || names.length === 0) {
    return asTextResponse(JSON.stringify({ success: false, error: 'names must be a non-empty array' }));
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
  const domain = args.domain as string;
  const validDomains = new Set<string>([
    'core', 'browser', 'debugger', 'network', 'hooks', 'maintenance',
    'process', 'workflow', 'wasm', 'streaming', 'encoding', 'antidebug',
    'graphql', 'platform', 'sourcemap', 'transform',
  ]);

  if (!validDomains.has(domain)) {
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: `Unknown domain "${domain}". Valid: ${[...validDomains].join(', ')}`,
      })
    );
  }

  const domainTools = getToolsByDomains([domain as ToolDomain]);
  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];

  ctx.enabledDomains.add(domain as ToolDomain);

  for (const toolDef of domainTools) {
    if (activeNames.has(toolDef.name)) continue;

    const registeredTool = ctx.registerSingleTool(toolDef);
    ctx.activatedToolNames.add(toolDef.name);
    ctx.activatedRegisteredTools.set(toolDef.name, registeredTool);
    activated.push(toolDef.name);
  }

  if (activated.length > 0) {
    const newToolNames = new Set(activated);
    const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
    ctx.router.addHandlers(newHandlers);

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

/* ---------- registration ---------- */

export function registerSearchMetaTools(ctx: MCPServerContext): void {
  ctx.server.tool(
    'search_tools',
    'Search all available tools (226 total across 16 domains) by keyword. ' +
      'Returns ranked matches with name, domain, and short description. ' +
      'Use this to discover tools before activating them. ' +
      'Supports multi-word queries, tool names (e.g. "breakpoint"), ' +
      'domains (e.g. "debugger"), or descriptions (e.g. "websocket monitor").',
    {
      query: z.string().describe('Search query: keywords, tool name, domain name, or description fragment'),
      top_k: z.number().optional().describe('Max results to return (default: 10, max: 30)'),
    } as unknown as Record<string, z.ZodAny>,
    async (args: Record<string, unknown>) => {
      try {
        return await handleSearchTools(ctx, args);
      } catch (error) {
        logger.error('search_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.tool(
    'activate_tools',
    'Dynamically register specific tools by name. ' +
      'Use after search_tools to enable exactly the tools you need. ' +
      'Activated tools appear in the tool list immediately.',
    {
      names: z.array(z.string()).describe('Array of tool names to activate (from search_tools results)'),
    } as unknown as Record<string, z.ZodAny>,
    async (args: Record<string, unknown>) => {
      try {
        return await handleActivateTools(ctx, args);
      } catch (error) {
        logger.error('activate_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.tool(
    'deactivate_tools',
    'Remove previously activated tools to free context. ' +
      'Only affects tools added via activate_tools, not base profile tools.',
    {
      names: z.array(z.string()).describe('Array of tool names to deactivate'),
    } as unknown as Record<string, z.ZodAny>,
    async (args: Record<string, unknown>) => {
      try {
        return await handleDeactivateTools(ctx, args);
      } catch (error) {
        logger.error('deactivate_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.tool(
    'activate_domain',
    'Activate all tools in a domain at once. ' +
      'Domains: core, browser, debugger, network, hooks, maintenance, process, ' +
      'workflow, wasm, streaming, encoding, antidebug, graphql, platform, sourcemap, transform.',
    {
      domain: z.string().describe('Domain name to activate (e.g. "debugger", "network")'),
    } as unknown as Record<string, z.ZodAny>,
    async (args: Record<string, unknown>) => {
      try {
        return await handleActivateDomain(ctx, args);
      } catch (error) {
        logger.error('activate_domain failed', error);
        return asErrorResponse(error);
      }
    }
  );
}

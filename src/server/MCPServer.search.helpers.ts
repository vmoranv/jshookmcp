/**
 * Helper utilities for the search meta-tool module.
 *
 * Provides tool name resolution, search engine construction with caching,
 * and domain description generation.
 */
import { allTools } from '@server/ToolCatalog';
import type { MCPServerContext } from '@server/MCPServer.context';
import { ToolSearchEngine } from '@server/ToolSearch';
import { getAllRegistrations } from '@server/registry/index';
import { SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER } from '@src/constants';

// ── active-tool helpers ──

export function getActiveToolNames(ctx: MCPServerContext): Set<string> {
  const names = new Set(ctx.selectedTools.map((t) => t.name));
  for (const name of ctx.activatedToolNames) names.add(name);
  return names;
}

export function getExtensionDomainMap(ctx: MCPServerContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of ctx.extensionToolsByName.values()) {
    map.set(record.name, record.domain);
  }
  return map;
}

export function getCombinedTools(ctx: MCPServerContext): typeof allTools {
  const tools = new Map(allTools.map((tool) => [tool.name, tool]));
  for (const record of ctx.extensionToolsByName.values()) {
    tools.set(record.name, record.tool);
  }
  return [...tools.values()];
}

export function getToolByName(ctx: MCPServerContext): Map<string, (typeof allTools)[number]> {
  return new Map(getCombinedTools(ctx).map((tool) => [tool.name, tool]));
}

// ── ToolSearchEngine build cache ──

interface CachedSearchEngine {
  signature: string;
  engine: ToolSearchEngine;
}

const searchEngineCache = new WeakMap<MCPServerContext, CachedSearchEngine>();

/**
 * Build a cache signature from all inputs that affect ToolSearchEngine construction.
 * Changes in extension tools or workflow runtime state invalidate the cache.
 */
export function buildSearchSignature(ctx: MCPServerContext): string {
  // Extension tool identity + domain mapping
  const extParts: string[] = [];
  for (const [name, record] of ctx.extensionToolsByName) {
    extParts.push(`${name}:${record.domain}`);
  }
  extParts.sort();

  return [ctx.extensionWorkflowRuntimeById.size, extParts.join('|')].join('::');
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
  // Apply workflow domain boost when workflow tools are at runtime
  if (ctx.extensionWorkflowRuntimeById.size > 0) {
    domainScoreMultipliers.set('workflow', SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER);
    toolScoreMultipliers.set('run_extension_workflow', 1.35);
    toolScoreMultipliers.set('list_extension_workflows', 1.25);
  }

  const engine = new ToolSearchEngine(
    tools,
    extensionDomains,
    domainScoreMultipliers,
    toolScoreMultipliers,
    ctx.config.search
  );
  searchEngineCache.set(ctx, { signature, engine });
  return engine;
}

// ── domain description ──

/** Generate domain summary description from discovered manifests. */
export function buildDomainDescription(ctx: MCPServerContext): string {
  const groups: Record<string, number> = {};
  for (const r of getAllRegistrations()) {
    groups[r.domain!] = (groups[r.domain!] ?? 0) + 1;
  }
  for (const record of ctx.extensionToolsByName.values()) {
    groups[record.domain] = (groups[record.domain] ?? 0) + 1;
  }
  const totalTools = getAllRegistrations().length + ctx.extensionToolsByName.size;
  const parts = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => `${domain} (${count})`)
    .join(' | ');
  return (
    `Search ${totalTools} tools across ${Object.keys(groups).length} capability domains. ` +
    `This includes built-in tools plus any loaded plugin/workflow tools (${ctx.extensionToolsByName.size} currently loaded). ` +
    `In search-tier sessions, call this before assuming a capability is unavailable. ` +
    `Use activate_tools for exact matches, activate_domain for an entire domain. ` +
    `Domains: ${parts}.`
  );
}

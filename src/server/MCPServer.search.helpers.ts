/**
 * Helper utilities for the search meta-tool module.
 *
 * Provides tool name resolution, search engine construction with caching,
 * and domain description generation.
 */
import { getProfileDomains, getToolDomain, getToolsForProfile } from '@server/ToolCatalog';
import type { Tool } from '@modelcontextprotocol/server';
import type { ToolProfile } from '@server/ToolCatalog';
import type { MCPServerContext } from '@server/MCPServer.context';
import { ToolSearchEngine } from '@server/ToolSearch';
import { DOMAIN_TOOL_COUNT_MAP } from '@server/registry/generated-domains';
import { loadSearchCatalog } from '@server/registry/SearchCatalog';
import {
  SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER,
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER,
  SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER,
  SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER,
} from '@src/constants';

// ── active-tool helpers ──

export function getActiveToolNames(ctx: MCPServerContext): Set<string> {
  const names = new Set(ctx.selectedTools.map((t) => t.name));
  for (const name of ctx.activatedToolNames) names.add(name);
  return names;
}

/**
 * Resolve the set of domains visible to the caller under their current profile
 * tier (`baseTier`), unioned with any domains already activated via TTL-backed
 * activation. Drives the tier-aware ranking penalty inside `ToolSearchEngine`.
 *
 * Returns an empty set only when both the base profile and activation state
 * are empty, which disables the penalty (search behaves tier-agnostic).
 */
export function getVisibleDomainsForTier(ctx: MCPServerContext): ReadonlySet<string> {
  const visible = new Set<string>(getProfileDomains(ctx.baseTier));
  for (const domain of ctx.enabledDomains) visible.add(domain);
  for (const record of ctx.extensionToolsByName.values()) {
    visible.add(record.domain);
  }
  for (const toolName of getActiveToolNames(ctx)) {
    const extensionDomain = ctx.extensionToolsByName.get(toolName)?.domain;
    if (extensionDomain) {
      visible.add(extensionDomain);
      continue;
    }
    const toolDomain = getToolDomain(toolName);
    if (toolDomain) visible.add(toolDomain);
  }
  return visible;
}

export function getVisibleToolNamesForTier(ctx: MCPServerContext): ReadonlySet<string> {
  const visible = new Set(getToolsForProfile(ctx.baseTier).map((tool) => tool.name));
  for (const name of ctx.activatedToolNames) visible.add(name);
  for (const tool of ctx.selectedTools) visible.add(tool.name);
  for (const record of ctx.extensionToolsByName.values()) {
    visible.add(record.name);
  }
  return visible;
}

export function getBaseTier(ctx: MCPServerContext): ToolProfile {
  return ctx.baseTier;
}

export function getExtensionDomainMap(ctx: MCPServerContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of ctx.extensionToolsByName.values()) {
    map.set(record.name, record.domain);
  }
  return map;
}

export async function getCombinedTools(ctx: MCPServerContext): Promise<Tool[]> {
  const catalog = await loadSearchCatalog();
  const tools = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  for (const record of ctx.extensionToolsByName.values()) {
    tools.set(record.name, record.tool);
  }
  return [...tools.values()];
}

export async function getToolByName(ctx: MCPServerContext): Promise<Map<string, Tool>> {
  return new Map((await getCombinedTools(ctx)).map((tool) => [tool.name, tool]));
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

export async function getSearchEngine(ctx: MCPServerContext): Promise<ToolSearchEngine> {
  const signature = buildSearchSignature(ctx);
  const cached = searchEngineCache.get(ctx);
  if (cached?.signature === signature) return cached.engine;

  const catalog = await loadSearchCatalog();
  const tools = await getCombinedTools(ctx);
  const toolDomains = new Map(catalog.domainByToolName);
  for (const [name, domain] of getExtensionDomainMap(ctx)) toolDomains.set(name, domain);
  const domainScoreMultipliers = new Map<string, number>();
  const toolScoreMultipliers = new Map<string, number>();
  for (const record of ctx.extensionToolsByName.values()) {
    toolScoreMultipliers.set(record.name, SEARCH_EXTENSION_TOOL_BOOST_MULTIPLIER);
  }
  // Apply workflow domain boost when workflow tools are at runtime
  if (ctx.extensionWorkflowRuntimeById.size > 0) {
    domainScoreMultipliers.set('workflow', SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER);
    toolScoreMultipliers.set('run_extension_workflow', SEARCH_WORKFLOW_TOOL_BOOST_MULTIPLIER);
    toolScoreMultipliers.set(
      'list_extension_workflows',
      SEARCH_WORKFLOW_LIST_TOOL_BOOST_MULTIPLIER,
    );
  }

  const engine = new ToolSearchEngine(
    tools,
    toolDomains,
    domainScoreMultipliers,
    toolScoreMultipliers,
    ctx.config.search,
    catalog.sceneKeywordsByToolName,
  );
  engine.extensionEtag = signature;
  searchEngineCache.set(ctx, { signature, engine });
  return engine;
}

// ── domain description ──

/** Generate domain summary description. Uses metadata when not all domains are loaded. */
export function buildDomainDescription(ctx: MCPServerContext): string {
  const groups: Record<string, number> = { ...DOMAIN_TOOL_COUNT_MAP };
  for (const record of ctx.extensionToolsByName.values()) {
    groups[record.domain] = (groups[record.domain] ?? 0) + 1;
  }
  const loadedCount = Object.values(DOMAIN_TOOL_COUNT_MAP).reduce((sum, count) => sum + count, 0);
  const extensionCount = ctx.extensionToolsByName.size;
  const totalTools = loadedCount + extensionCount;
  const domainCount = Object.keys(groups).length;

  const parts = Object.entries(groups)
    .toSorted((a, b) => b[1] - a[1])
    .map(([domain, count]) => `${domain} (${count})`)
    .join(' | ');

  return (
    `Search ${totalTools} tools across ${domainCount} capability domains. ` +
    `This includes built-in tools plus any loaded plugin/workflow tools (${extensionCount} currently loaded). ` +
    `In search-tier sessions, call this before assuming a capability is unavailable. ` +
    `Use activate_tools for exact matches, activate_domain for an entire domain. ` +
    `Domains: ${parts}. ` +
    `Query tip: before searching, distill your intent into key concepts (action verb + target + domain). ` +
    `The engine combines token matching, fuzzy names, profile context, and optional static embeddings.`
  );
}

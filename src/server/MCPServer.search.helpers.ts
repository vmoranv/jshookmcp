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
import { registerSearchSnapshotSourcesFromCtx } from '@server/search/snapshotRegistration';
import {
  MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
  MCP_TOOL_MAX_ACTIVE_TOOLS,
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

  // Expose the engine + its quality tracker to synchronous consumers: the
  // tool-call feedback and search-quality association hooks in
  // MCPServer.execution read them via getDomainInstance. Before this wiring
  // execution saw a separately-constructed tracker that never received a
  // single recordSearch, so associateLastSearch was a permanent no-op.
  // Registered on every (re)construction so extension reloads swap the live
  // instances; a signature-stable cache hit skips re-registration because the
  // instances are unchanged.
  if (typeof ctx.setDomainInstance === 'function') {
    ctx.setDomainInstance('searchEngine', engine);
    ctx.setDomainInstance('searchQualityTracker', engine.getSearchQualityTracker());
  }
  // Persistence registration lives here so every construction path (not just
  // the search_tools / call_tool handlers) wires the snapshot scheduler.
  // Awaited: registerAsync completes the restore before the engine is handed
  // out, so the first recordSearch can never race (and be clobbered by) a
  // still-in-flight restoreSnapshot.
  await registerSearchSnapshotSourcesFromCtx(ctx, engine);

  return engine;
}

// ── tool activation budget ──

/** Minimal definition shape needed for token estimation (structural subset of Tool). */
export type ToolTokenEstimateInput = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

/**
 * Rough token estimate of a tool definition as it would appear in a
 * tools/list payload: ceil((name + description + JSON input schema) / 4).
 */
export function estimateToolTokens(def: ToolTokenEstimateInput): number {
  const schemaJson = def.inputSchema === undefined ? '' : JSON.stringify(def.inputSchema);
  return Math.ceil(`${def.name}${def.description ?? ''}${schemaJson}`.length / 4);
}

export interface ActivationBudgetLimits {
  maxTokens: number;
  maxTools: number;
}

/** Resolve the budget limits from config; constants remain the fallback for bare test contexts. */
export function getActivationBudgetLimits(ctx: MCPServerContext): ActivationBudgetLimits {
  return {
    maxTokens: ctx.config?.mcp?.toolActivationBudgetTokens ?? MCP_TOOL_ACTIVATION_BUDGET_TOKENS,
    maxTools: ctx.config?.mcp?.toolActivationMaxTools ?? MCP_TOOL_MAX_ACTIVE_TOOLS,
  };
}

export interface ActivationBudgetTracker extends ActivationBudgetLimits {
  /** Budget only gates dynamic activation in search-tier sessions (base profile tools are never limited). */
  readonly enforced: boolean;
  usedTokens: number;
  activeTools: number;
  /**
   * Reserve the tool when it fits the remaining budget; returns false without
   * reserving when the budget would be exceeded. Usage accumulates even when
   * enforcement is off so summaries stay accurate.
   */
  admit(def: ToolTokenEstimateInput): boolean;
  /**
   * Return a previously admitted tool's footprint to the tracker (LRU
   * eviction path) so the running counts stay accurate after a deactivate.
   */
  release(def: ToolTokenEstimateInput): void;
}

// ── tool last-use tracking (LRU eviction input) ──

/**
 * Per-context map of tool name → epoch ms of the last executeToolWithTracking
 * call. A WeakMap keyed on the context keeps server and test contexts
 * isolated without growing the MCPServerContext interface. Tools missing
 * from the map count as oldest (never used).
 */
const toolLastUsedByContext = new WeakMap<MCPServerContext, Map<string, number>>();

/** Record a tool invocation for LRU eviction ordering. Called on every tool execution. */
export function recordToolUse(ctx: MCPServerContext, toolName: string): void {
  let map = toolLastUsedByContext.get(ctx);
  if (!map) {
    map = new Map();
    toolLastUsedByContext.set(ctx, map);
  }
  map.set(toolName, Date.now());
}

/** Read the last-use timestamps for a context (shared map, do not mutate). */
export function getToolLastUsedAt(ctx: MCPServerContext): Map<string, number> {
  return toolLastUsedByContext.get(ctx) ?? new Map();
}

/** Sum estimated tokens of the dynamically activated tools (never base profile tools). */
async function measureActivatedToolUsage(ctx: MCPServerContext): Promise<{
  usedTokens: number;
  activeTools: number;
}> {
  const catalog = await loadSearchCatalog();
  let usedTokens = 0;
  for (const name of ctx.activatedToolNames) {
    const def = ctx.extensionToolsByName.get(name)?.tool ?? catalog.toolByName.get(name);
    if (def) {
      usedTokens += estimateToolTokens(def);
    }
  }
  return { usedTokens, activeTools: ctx.activatedToolNames.size };
}

export async function createActivationBudgetTracker(
  ctx: MCPServerContext,
): Promise<ActivationBudgetTracker> {
  const initial = await measureActivatedToolUsage(ctx);
  const limits = getActivationBudgetLimits(ctx);
  const enforced = ctx.baseTier === 'search';
  let usedTokens = initial.usedTokens;
  let activeTools = initial.activeTools;

  return {
    enforced,
    maxTokens: limits.maxTokens,
    maxTools: limits.maxTools,
    get usedTokens() {
      return usedTokens;
    },
    get activeTools() {
      return activeTools;
    },
    admit(def: ToolTokenEstimateInput): boolean {
      const tokens = estimateToolTokens(def);
      if (enforced) {
        if (activeTools + 1 > limits.maxTools) {
          return false;
        }
        if (usedTokens + tokens > limits.maxTokens) {
          return false;
        }
      }
      activeTools += 1;
      usedTokens += tokens;
      return true;
    },
    release(def: ToolTokenEstimateInput): void {
      activeTools = Math.max(0, activeTools - 1);
      usedTokens = Math.max(0, usedTokens - estimateToolTokens(def));
    },
  };
}

/** Budget summary embedded in activate_tools / activate_domain responses. */
export interface ActivationBudgetSummary {
  usedTokens: number;
  maxTokens: number;
  activeTools: number;
  maxTools: number;
}

export function summarizeActivationBudget(
  tracker: ActivationBudgetTracker,
): ActivationBudgetSummary {
  return {
    usedTokens: tracker.usedTokens,
    maxTokens: tracker.maxTokens,
    activeTools: tracker.activeTools,
    maxTools: tracker.maxTools,
  };
}

/** Budget section appended to coverage_report responses. */
export interface ToolBudgetSnapshot {
  activeTools: number;
  estimatedTokens: number;
  budget: number;
  maxTools: number;
  headroom: number;
}

export async function getActivationBudgetSnapshot(
  ctx: MCPServerContext,
): Promise<ToolBudgetSnapshot> {
  const { usedTokens, activeTools } = await measureActivatedToolUsage(ctx);
  const { maxTokens, maxTools } = getActivationBudgetLimits(ctx);
  return {
    activeTools,
    estimatedTokens: usedTokens,
    budget: maxTokens,
    maxTools,
    headroom: Math.max(0, maxTokens - usedTokens),
  };
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

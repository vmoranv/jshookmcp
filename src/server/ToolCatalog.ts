import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { coreTools } from './domains/analysis/index.js';
import { browserTools, advancedBrowserToolDefinitions } from './domains/browser/index.js';
import { debuggerTools } from './domains/debugger/index.js';
import { advancedTools } from './domains/network/index.js';
import { aiHookTools, hookPresetTools } from './domains/hooks/index.js';
import { tokenBudgetTools, cacheTools } from './domains/maintenance/index.js';
import { processToolDefinitions } from './domains/process/index.js';
import { workflowToolDefinitions } from './domains/workflow/index.js';
import { wasmTools } from './domains/wasm/index.js';
import { streamingTools } from './domains/streaming/index.js';
import { encodingTools } from './domains/encoding/index.js';
import { antidebugTools } from './domains/antidebug/index.js';
import { graphqlTools } from './domains/graphql/index.js';
import { platformTools } from './domains/platform/index.js';
import { sourcemapTools } from './domains/sourcemap/index.js';
import { transformTools } from './domains/transform/index.js';

export type ToolDomain =
  | 'core'
  | 'browser'
  | 'debugger'
  | 'network'
  | 'hooks'
  | 'maintenance'
  | 'process'
  | 'workflow'
  | 'wasm'
  | 'streaming'
  | 'encoding'
  | 'antidebug'
  | 'graphql'
  | 'platform'
  | 'sourcemap'
  | 'transform';

export type ToolProfile = 'minimal' | 'full' | 'workflow' | 'reverse' | 'search';

const TOOL_GROUPS: Record<ToolDomain, Tool[]> = {
  core: coreTools,
  browser: [...browserTools, ...advancedBrowserToolDefinitions],
  debugger: debuggerTools,
  network: advancedTools,
  hooks: [...aiHookTools, ...hookPresetTools],
  maintenance: [...tokenBudgetTools, ...cacheTools],
  process: processToolDefinitions,
  workflow: workflowToolDefinitions,
  wasm: wasmTools,
  streaming: streamingTools,
  encoding: encodingTools,
  antidebug: antidebugTools,
  graphql: graphqlTools,
  platform: platformTools,
  sourcemap: sourcemapTools,
  transform: transformTools,
};

const TOOL_DOMAIN_BY_NAME: ReadonlyMap<string, ToolDomain> = (() => {
  const map = new Map<string, ToolDomain>();
  for (const [domain, tools] of Object.entries(TOOL_GROUPS) as Array<[ToolDomain, Tool[]]>) {
    for (const tool of tools) {
      if (!map.has(tool.name)) {
        map.set(tool.name, domain);
      }
    }
  }
  return map;
})();

export const allTools: Tool[] = [
  ...TOOL_GROUPS.core,
  ...TOOL_GROUPS.browser,
  ...TOOL_GROUPS.debugger,
  ...TOOL_GROUPS.network,
  ...TOOL_GROUPS.hooks,
  ...TOOL_GROUPS.maintenance,
  ...TOOL_GROUPS.process,
  ...TOOL_GROUPS.workflow,
  ...TOOL_GROUPS.wasm,
  ...TOOL_GROUPS.streaming,
  ...TOOL_GROUPS.encoding,
  ...TOOL_GROUPS.antidebug,
  ...TOOL_GROUPS.graphql,
  ...TOOL_GROUPS.platform,
  ...TOOL_GROUPS.sourcemap,
  ...TOOL_GROUPS.transform,
];

/**
 * Three-tier hierarchy: min ⊂ workflow ⊂ full.
 * Each higher tier is a strict superset of the previous one.
 *
 *   min      — page browsing, DOM, console, screenshots
 *   workflow — + code analysis, debugger, network, streaming, encoding, graphql, workflows
 *   full     — + hooks, process, wasm, antidebug, platform, sourcemap, transform
 *   reverse  — legacy alias kept for backward compatibility
 */
const PROFILE_DOMAINS: Record<ToolProfile, ToolDomain[]> = {
  /** Search profile: minimal tools + meta-tools for search-based discovery. */
  search: ['maintenance'],
  minimal: ['browser', 'maintenance'],
  workflow: ['browser', 'maintenance', 'core', 'debugger', 'network', 'streaming', 'encoding', 'graphql', 'workflow'],
  full: ['core', 'browser', 'debugger', 'network', 'hooks', 'maintenance', 'process', 'wasm', 'streaming', 'encoding', 'antidebug', 'graphql', 'platform', 'sourcemap', 'transform', 'workflow'],
  reverse: ['core', 'browser', 'debugger', 'network', 'hooks', 'wasm', 'streaming', 'encoding', 'antidebug', 'sourcemap', 'transform', 'platform'],
};

/**
 * Ordered tier list for progressive boost / downgrade.
 * Index determines tier level (0 = lowest).
 */
export const TIER_ORDER: readonly ToolProfile[] = ['search', 'minimal', 'workflow', 'full'] as const;

/** Default auto-unboost TTL (minutes) per tier. 0 = no auto-unboost. */
export const TIER_DEFAULT_TTL: Readonly<Record<ToolProfile, number>> = {
  search: 0,
  minimal: 0,
  workflow: 60,
  full: 30,
  reverse: 30,
};

/** Return the tier index (0-based) or -1 if not a tiered profile. */
export function getTierIndex(profile: ToolProfile): number {
  return (TIER_ORDER as readonly string[]).indexOf(profile);
}

function dedupeTools(tools: Tool[]): Tool[] {
  const map = new Map<string, Tool>();
  for (const tool of tools) {
    map.set(tool.name, tool);
  }
  return Array.from(map.values());
}

export function parseToolDomains(raw: string | undefined): ToolDomain[] | null {
  if (!raw?.trim()) {
    return null;
  }

  const validDomains = new Set<ToolDomain>(Object.keys(TOOL_GROUPS) as ToolDomain[]);
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item): item is ToolDomain => validDomains.has(item as ToolDomain));

  return parsed.length > 0 ? (Array.from(new Set(parsed)) as ToolDomain[]) : null;
}

export function getToolsByDomains(domains: ToolDomain[]): Tool[] {
  const tools = domains.flatMap((domain) => TOOL_GROUPS[domain] ?? []);
  return dedupeTools(tools);
}

export function getToolsForProfile(profile: ToolProfile): Tool[] {
  const domains = PROFILE_DOMAINS[profile];
  return getToolsByDomains(domains);
}

export function getToolDomain(toolName: string): ToolDomain | null {
  return TOOL_DOMAIN_BY_NAME.get(toolName) ?? null;
}

export function getProfileDomains(profile: ToolProfile): ToolDomain[] {
  return PROFILE_DOMAINS[profile] ?? [];
}

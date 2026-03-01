import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildToolGroups, buildToolDomainMap, buildAllTools, ALL_DOMAINS } from './registry/index.js';

// Re-export ToolDomain from registry/types.ts for backward compatibility.
// ToolDomain is canonically defined in registry/types.ts now.
export type { ToolDomain } from './registry/types.js';
import type { ToolDomain } from './registry/types.js';

export type ToolProfile = 'minimal' | 'full' | 'workflow' | 'reverse' | 'search';

// Derived from registry — no more manual imports from 16 domain definitions.
const TOOL_GROUPS: Record<ToolDomain, Tool[]> = buildToolGroups();

const TOOL_DOMAIN_BY_NAME: ReadonlyMap<string, ToolDomain> = buildToolDomainMap();

export const allTools: Tool[] = buildAllTools();

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

  const validDomains = ALL_DOMAINS;
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

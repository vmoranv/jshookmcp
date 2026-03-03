import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  buildToolGroups,
  buildToolDomainMap,
  buildAllTools,
  buildProfileDomains,
  ALL_DOMAINS,
} from './registry/index.js';
import type { ToolProfileId } from './registry/contracts.js';

// Re-export ToolDomain as string for backward compatibility.
export type ToolDomain = string;
export type ToolProfile = ToolProfileId;

// Derived from registry — lazily built on first access (after initRegistry).
let _toolGroups: Record<string, Tool[]> | null = null;
let _toolDomainByName: ReadonlyMap<string, string> | null = null;
let _profileDomains: Record<ToolProfile, string[]> | null = null;
let _allTools: Tool[] | null = null;

function getToolGroups(): Record<string, Tool[]> {
  if (!_toolGroups) _toolGroups = buildToolGroups();
  return _toolGroups;
}

function getToolDomainByName(): ReadonlyMap<string, string> {
  if (!_toolDomainByName) _toolDomainByName = buildToolDomainMap();
  return _toolDomainByName;
}

function getProfileDomainsMap(): Record<ToolProfile, string[]> {
  if (!_profileDomains) _profileDomains = buildProfileDomains();
  return _profileDomains;
}

// Proxy so that consumers can import allTools normally but values resolve lazily.
export const allTools: Tool[] = new Proxy([] as Tool[], {
  get(_t, p) {
    if (!_allTools) _allTools = buildAllTools();
    const real = _allTools as unknown as Record<string | symbol, unknown>;
    const v = real[p as string];
    return typeof v === 'function' ? (v as Function).bind(real) : v;
  },
});

/**
 * Tier hierarchy: search ⊂ min ⊂ workflow ⊂ full.
 * 'reverse' is a special alias, not in the linear tier order.
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

export function parseToolDomains(raw: string | undefined): string[] | null {
  if (!raw?.trim()) {
    return null;
  }

  const validDomains = ALL_DOMAINS;
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => validDomains.has(item));

  return parsed.length > 0 ? (Array.from(new Set(parsed))) : null;
}

export function getToolsByDomains(domains: string[]): Tool[] {
  const tools = domains.flatMap((domain) => getToolGroups()[domain] ?? []);
  return dedupeTools(tools);
}

export function getToolsForProfile(profile: ToolProfile): Tool[] {
  const domains = getProfileDomainsMap()[profile];
  if (!domains) return [];
  return getToolsByDomains(domains);
}

export function getToolDomain(toolName: string): string | null {
  return getToolDomainByName().get(toolName) ?? null;
}

export function getProfileDomains(profile: ToolProfile): string[] {
  return getProfileDomainsMap()[profile] ?? [];
}

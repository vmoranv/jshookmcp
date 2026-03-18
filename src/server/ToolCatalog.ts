import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  buildToolGroups,
  buildToolDomainMap,
  buildAllTools,
  buildProfileDomains,
  ALL_DOMAINS,
  ALL_REGISTRATIONS,
} from '@server/registry/index';
import type { ToolProfileId } from '@server/registry/contracts';

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

/** Tier hierarchy: search ⊂ workflow ⊂ full. */
export const TIER_ORDER = ['search', 'workflow', 'full'] as const satisfies readonly ToolProfile[];

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

  return parsed.length > 0 ? Array.from(new Set(parsed)) : null;
}

export function getToolsByDomains(domains: string[]): Tool[] {
  const tools = domains.flatMap((domain) => getToolGroups()[domain] ?? []);
  return dedupeTools(tools);
}

export function getToolsForProfile(profile: ToolProfile): Tool[] {
  const domains = getProfileDomainsMap()[profile];
  if (!domains) return [];
  const domainSet = new Set(domains);
  // Filter registrations by domain AND per-registration profiles (if set).
  const tools = [...ALL_REGISTRATIONS]
    .filter((r) => {
      if (!domainSet.has(r.domain)) return false;
      // Per-registration profile override: if set, the tool is only included
      // in the profiles listed on the registration itself.
      if (r.profiles && !r.profiles.includes(profile)) return false;
      return true;
    })
    .map((r) => r.tool);
  return dedupeTools(tools);
}

export function getToolDomain(toolName: string): string | null {
  return getToolDomainByName().get(toolName) ?? null;
}

export function getProfileDomains(profile: ToolProfile): string[] {
  return getProfileDomainsMap()[profile] ?? [];
}

/**
 * Get the minimal tier that includes this tool.
 * Respects per-registration profile overrides: if a registration declares its
 * own profiles array, those profiles take precedence over the domain-level profiles.
 * Returns null if tool not found or domain not in any profile.
 */
export function getToolMinimalTier(toolName: string): ToolProfile | null {
  // Check for per-registration profile override first.
  const registration = [...ALL_REGISTRATIONS].find((r) => r.tool.name === toolName);
  if (registration?.profiles) {
    for (const tier of TIER_ORDER) {
      if (registration.profiles.includes(tier)) {
        return tier;
      }
    }
    return null;
  }

  // Fall back to domain-level resolution.
  const domain = getToolDomain(toolName);
  if (!domain) return null;

  for (const tier of TIER_ORDER) {
    const domains = getProfileDomains(tier);
    if (domains.includes(domain)) {
      return tier;
    }
  }
  return null;
}

/**
 * Calculate the minimal satisfying tier for a list of tool names.
 * Returns the highest minimal tier among all tools (since tiers are ordered search→workflow→full).
 * Ignores tools without a known tier.
 */
export function getMinSatisfyingTier(toolNames: string[]): ToolProfile | null {
  if (toolNames.length === 0) return null;

  let maxTierIndex = -1;
  for (const name of toolNames) {
    const tier = getToolMinimalTier(name);
    if (!tier) continue;

    const idx = getTierIndex(tier);
    if (idx > maxTierIndex) {
      maxTierIndex = idx;
    }
  }

  return maxTierIndex >= 0 ? TIER_ORDER[maxTierIndex]! : null;
}

/**
 * Central tool registry — single source of truth with lazy domain loading.
 *
 * Startup loads only manifests for the active profile tier.
 * Additional domains are loaded on-demand via ensureDomainLoaded().
 */
function isSubset(a: string[], b: string[]): boolean {
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
}

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  DomainManifest,
  ToolHandlerDeps,
  ToolRegistration,
  ToolProfileId,
} from '@server/registry/contracts';
import type { ToolHandler } from '@server/types';
import {
  discoverDomainManifests,
  loadSingleManifest,
  getDomainsForProfile,
  getAllKnownDomainNames,
} from '@server/registry/discovery';
import { DOMAIN_PROFILE_MAP } from '@server/registry/generated-domains.js';
import { logger } from '@utils/logger';

// ── Lazy-init singleton ──

let _manifests: DomainManifest[] | null = null;
let _registrations: ToolRegistration[] | null = null;
let _initPromise: Promise<void> | null = null;

// Cached views — materialized once after init, updated on lazy loads.
let _domainsView: Set<string> | null = null;
let _toolNamesView: ReadonlySet<string> | null = null;
let _registrationsByName: Map<string, ToolRegistration> | null = null;

async function init(profile?: ToolProfileId): Promise<void> {
  if (_manifests !== null) return;
  if (_initPromise) {
    await _initPromise;
    return;
  }
  _initPromise = (async () => {
    const domainsToLoad = profile ? getDomainsForProfile(profile) : undefined;
    const discovered = await discoverDomainManifests(domainsToLoad);
    _manifests = discovered;

    _registrationsByName = new Map();
    for (const m of discovered) {
      for (const r of m.registrations) {
        const registration: ToolRegistration = r.domain ? r : { ...r, domain: m.domain };
        const existing = _registrationsByName.get(registration.tool.name);
        if (existing) {
          logger.warn(
            `[registry] Duplicate tool name "${registration.tool.name}": domain "${registration.domain}" conflicts with "${existing.domain}" — keeping first`,
          );
        } else {
          _registrationsByName.set(registration.tool.name, registration);
        }
      }
    }
    _registrations = [..._registrationsByName.values()];

    _domainsView = new Set(_manifests.map((m) => m.domain));
    _toolNamesView = new Set(_registrations.map((r) => r.tool.name));
  })();
  await _initPromise;
}

// ── Public initialiser (call before first use) ──

export async function initRegistry(profile?: ToolProfileId): Promise<void> {
  await init(profile);
}

// ── On-demand loading ──

/**
 * Ensure a single domain's manifest is loaded.
 * Loads the manifest, adds its registrations, and updates cached views.
 * Returns the manifest or null if loading failed.
 */
export async function ensureDomainLoaded(domainName: string): Promise<DomainManifest | null> {
  if (!_manifests) throw new Error('[registry] Not initialised - call initRegistry() first.');

  // Already loaded
  if (_manifests.some((m) => m.domain === domainName)) {
    return _manifests.find((m) => m.domain === domainName)!;
  }

  const manifest = await loadSingleManifest(domainName);
  if (!manifest) return null;

  // Add to manifests array
  _manifests.push(manifest);
  _domainsView!.add(manifest.domain);

  // Add registrations
  for (const r of manifest.registrations) {
    const registration: ToolRegistration = r.domain ? r : { ...r, domain: manifest.domain };
    if (!_registrationsByName!.has(registration.tool.name)) {
      _registrationsByName!.set(registration.tool.name, registration);
    }
  }
  _registrations = [..._registrationsByName!.values()];

  // Update tool names view
  for (const r of manifest.registrations) {
    (_toolNamesView as Set<string>).add(r.tool.name);
  }

  return manifest;
}

/**
 * Ensure ALL domain manifests are loaded.
 * Useful for search_tools which needs to index all tools.
 * No-op if all domains are already loaded.
 */
export async function ensureAllDomainsLoaded(): Promise<void> {
  if (!_manifests) throw new Error('[registry] Not initialised - call initRegistry() first.');

  const allDomains = getAllKnownDomainNames();
  const loaded = new Set(_manifests.map((m) => m.domain));
  const missing = [...allDomains].filter((d) => !loaded.has(d));

  if (missing.length === 0) return;

  logger.info(`[registry] Loading ${missing.length} remaining domains for full discovery`);
  await Promise.all(missing.map((d) => ensureDomainLoaded(d)));
}

// ── Accessors ──

function getManifests(): DomainManifest[] {
  if (!_manifests) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _manifests;
}

function getRegistrations(): ToolRegistration[] {
  if (!_registrations) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _registrations;
}

// ── Public read-only views ──

export function getAllManifests(): readonly DomainManifest[] {
  return getManifests();
}

export function getAllRegistrations(): readonly ToolRegistration[] {
  return getRegistrations();
}

/** Returns domain names of LOADED manifests only. */
export function getAllDomains(): ReadonlySet<string> {
  if (!_domainsView) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _domainsView;
}

/** Returns ALL known domain names from build-time metadata (no loading needed). */
export function getAllKnownDomains(): ReadonlySet<string> {
  return getAllKnownDomainNames();
}

export function getAllToolNames(): ReadonlySet<string> {
  if (!_toolNamesView) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _toolNamesView;
}

/** O(1) lookup of a single ToolRegistration by tool name. */
export function getRegistrationByName(name: string): ToolRegistration | undefined {
  if (!_registrationsByName) {
    _registrationsByName = new Map(getRegistrations().map((r) => [r.tool.name, r]));
  }
  return _registrationsByName.get(name);
}

// ── Builders ──

export function buildToolGroups(): Record<string, Tool[]> {
  const groups: Record<string, Tool[]> = {};
  for (const r of getRegistrations()) {
    (groups[r.domain!] ??= []).push(r.tool);
  }
  return groups;
}

export function buildToolDomainMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const r of getRegistrations()) {
    if (!map.has(r.tool.name)) map.set(r.tool.name, r.domain!);
  }
  return map;
}

export function buildAllTools(): Tool[] {
  return getRegistrations().map((r) => r.tool);
}

export function buildHandlerMapFromRegistry(
  deps: ToolHandlerDeps,
  selectedToolNames?: ReadonlySet<string>,
): Record<string, ToolHandler> {
  const regs = selectedToolNames
    ? getRegistrations().filter((r) => selectedToolNames.has(r.tool.name))
    : [...getRegistrations()];
  const entries: [string, ToolHandler][] = [];
  for (const r of regs) {
    try {
      entries.push([r.tool.name, r.bind(deps) as ToolHandler]);
    } catch {
      // Tool's handler is unavailable (missing dependencies) — skip it
    }
  }
  return Object.fromEntries(entries);
}

export function buildProfileDomains(): Record<ToolProfileId, string[]> {
  const profiles: Record<string, Set<string>> = {
    search: new Set(),
    workflow: new Set(),
    full: new Set(),
  };

  // Use build-time metadata as single source of truth — works even when
  // manifests haven't been loaded yet (search profile starts with 0 loaded).
  for (const [domain, domainProfiles] of Object.entries(DOMAIN_PROFILE_MAP)) {
    for (const p of domainProfiles) {
      profiles[p]?.add(domain);
    }
  }

  const result: Record<string, string[]> = {};
  for (const [p, domains] of Object.entries(profiles)) {
    result[p] = [...(domains as Set<string>)];
  }

  // Validate tier hierarchy
  if (!isSubset(result['search']!, result['workflow']!)) {
    logger.warn('[registry] Profile hierarchy: search not subset of workflow');
  }
  if (!isSubset(result['workflow']!, result['full']!)) {
    logger.warn('[registry] Profile hierarchy: workflow not subset of full');
  }

  return result as Record<ToolProfileId, string[]>;
}

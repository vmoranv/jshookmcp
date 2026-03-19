/**
 * Central tool registry - single source of truth.
 *
 * Uses runtime discovery: scans domains/STAR/manifest.js on startup,
 * dynamically imports each DomainManifest, and builds all derived data
 * structures (tool groups, domain map, handler map, profile domains).
 *
 * No more manual imports - add a new domain by creating its manifest.ts.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  DomainManifest,
  ToolHandlerDeps,
  ToolRegistration,
  ToolProfileId,
} from '@server/registry/contracts';
import type { ToolHandler } from '@server/types';
import { discoverDomainManifests } from '@server/registry/discovery';
import { logger } from '@utils/logger';

/* ---------- Lazy-init singleton ---------- */

let _manifests: DomainManifest[] | null = null;
let _registrations: ToolRegistration[] | null = null;
let _initPromise: Promise<void> | null = null;

// Cached views — materialized once after init, never rebuilt.
let _domainsView: ReadonlySet<string> | null = null;
let _toolNamesView: ReadonlySet<string> | null = null;

async function init(): Promise<void> {
  if (_manifests !== null) return;
  if (_initPromise) {
    await _initPromise;
    return;
  }
  _initPromise = (async () => {
    const discovered = await discoverDomainManifests();
    _manifests = discovered;

    const uniqueByToolName = new Map<string, ToolRegistration>();
    for (const m of discovered) {
      for (const r of m.registrations) {
        const existing = uniqueByToolName.get(r.tool.name);
        if (existing) {
          logger.warn(
            `[registry] Duplicate tool name "${r.tool.name}": domain "${r.domain}" conflicts with "${existing.domain}" — keeping first`
          );
        } else {
          uniqueByToolName.set(r.tool.name, r);
        }
      }
    }
    _registrations = [...uniqueByToolName.values()];

    // Materialize cached views once — avoids rebuilding on every access
    _domainsView = new Set(_manifests.map((m) => m.domain));
    _toolNamesView = new Set(_registrations.map((r) => r.tool.name));
  })();
  await _initPromise;
}

/* ---------- Public initialiser (call before first use) ---------- */

export async function initRegistry(): Promise<void> {
  await init();
}

/* ---------- Accessors ---------- */

function getManifests(): DomainManifest[] {
  if (!_manifests) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _manifests;
}

function getRegistrations(): ToolRegistration[] {
  if (!_registrations) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _registrations;
}

/* ---------- Public read-only views ---------- */

export function getAllManifests(): readonly DomainManifest[] {
  return getManifests();
}

export function getAllRegistrations(): readonly ToolRegistration[] {
  return getRegistrations();
}

export function getAllDomains(): ReadonlySet<string> {
  if (!_domainsView) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _domainsView;
}

export function getAllToolNames(): ReadonlySet<string> {
  if (!_toolNamesView) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return _toolNamesView;
}

/* ---------- Builders ---------- */

export function buildToolGroups(): Record<string, Tool[]> {
  const groups: Record<string, Tool[]> = {};
  for (const r of getRegistrations()) {
    (groups[r.domain] ??= []).push(r.tool);
  }
  return groups;
}

export function buildToolDomainMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const r of getRegistrations()) {
    if (!map.has(r.tool.name)) map.set(r.tool.name, r.domain);
  }
  return map;
}

export function buildAllTools(): Tool[] {
  return getRegistrations().map((r) => r.tool);
}

export function buildHandlerMapFromRegistry(
  deps: ToolHandlerDeps,
  selectedToolNames?: ReadonlySet<string>
): Record<string, ToolHandler> {
  const regs = selectedToolNames
    ? getRegistrations().filter((r) => selectedToolNames.has(r.tool.name))
    : [...getRegistrations()];
  return Object.fromEntries(regs.map((r) => [r.tool.name, r.bind(deps) as ToolHandler]));
}

export function buildProfileDomains(): Record<ToolProfileId, string[]> {
  const profiles: Record<string, Set<string>> = {
    search: new Set(),
    workflow: new Set(),
    full: new Set(),
  };

  for (const m of getManifests()) {
    for (const p of m.profiles) {
      profiles[p]?.add(m.domain);
    }
  }

  const result: Record<string, string[]> = {};
  for (const [p, domains] of Object.entries(profiles)) {
    result[p] = [...(domains as Set<string>)];
  }

  // Validate tier hierarchy
  const isSubset = (a: string[], b: string[]) => {
    const bSet = new Set(b);
    return a.every((x) => bSet.has(x));
  };
  if (!isSubset(result['search']!, result['workflow']!)) {
    logger.warn('[registry] Profile hierarchy: search not subset of workflow');
  }
  if (!isSubset(result['workflow']!, result['full']!)) {
    logger.warn('[registry] Profile hierarchy: workflow not subset of full');
  }

  return result as Record<ToolProfileId, string[]>;
}



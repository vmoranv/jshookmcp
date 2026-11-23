/**
 * Central tool registry — single source of truth with lazy domain loading.
 *
 * Startup loads only manifests for the active profile tier.
 * Additional domains are loaded on-demand via ensureDomainLoaded().
 */
import type { DomainManifest, ToolRegistration, ToolProfileId } from '@server/registry/contracts';
import { registerCompiledValidator } from '@server/registry/compiled-validators';
import {
  discoverDomainManifests,
  loadSingleManifest,
  getDomainsForProfile,
  getAllKnownDomainNames,
} from '@server/registry/discovery';
import { emitBusEvent, type EventBus, type ServerEventMap } from '@server/EventBus';
import { logger } from '@utils/logger';

// ── Cache invalidation listeners ──
//
// Moved to registry/state.ts together with the manifests/registrations
// caches, so read-only consumers (ToolRouter.policy, ToolRouter.intent) can
// import the leaf state module instead of this barrel — the barrel's import
// graph reaches every domain manifest via discovery.ts → generated-domains.ts.

import {
  appendLoadedRegistrations,
  getLoadedManifests,
  isRegistryInitialised,
  notifyRegistryInvalidation,
  pushLoadedManifest,
  setRegistryCaches,
} from '@server/registry/state';

// ── Lazy-init singleton ──

let initPromise: Promise<void> | null = null;

// Cached views — materialized once after init, updated on lazy loads.
let domainsView: Set<string> | null = null;
let toolNamesView: ReadonlySet<string> | null = null;
let registrationsByName: Map<string, ToolRegistration> | null = null;

async function init(profile?: ToolProfileId, eventBus?: EventBus<ServerEventMap>): Promise<void> {
  if (isRegistryInitialised()) return;
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    const domainsToLoad = profile ? getDomainsForProfile(profile) : undefined;
    const discovered = await discoverDomainManifests(domainsToLoad, eventBus);

    registrationsByName = new Map();
    for (const m of discovered) {
      for (const r of m.registrations) {
        const registration: ToolRegistration = r.domain ? r : { ...r, domain: m.domain };
        const existing = registrationsByName.get(registration.tool.name);
        if (existing) {
          logger.warn(
            `[registry] Duplicate tool name "${registration.tool.name}": domain "${registration.domain}" conflicts ` +
              `with "${existing.domain}" — keeping first`,
          );
        } else {
          registrationsByName.set(registration.tool.name, registration);
        }
        registerCompiledValidator(registration.tool);
      }
    }
    const registrations = [...registrationsByName.values()];
    setRegistryCaches(discovered, registrations);

    domainsView = new Set(discovered.map((m) => m.domain));
    toolNamesView = new Set(registrations.map((r) => r.tool.name));
  })();
  try {
    await initPromise;
  } catch (error) {
    // A transient manifest-load failure must not poison the singleton: every
    // later call would re-throw the same stale error with no retry path.
    initPromise = null;
    logger.error('[registry] Initialisation failed', error);
    throw error;
  }
}

// ── Public initialiser (call before first use) ──

export async function initRegistry(
  profile?: ToolProfileId,
  eventBus?: EventBus<ServerEventMap>,
): Promise<void> {
  await init(profile, eventBus);
}

// ── On-demand loading ──

/**
 * Ensure a single domain's manifest is loaded.
 * Loads the manifest, adds its registrations, and updates cached views.
 * Returns the manifest or null if loading failed.
 */
export async function ensureDomainLoaded(
  domainName: string,
  eventBus?: EventBus<ServerEventMap>,
): Promise<DomainManifest | null> {
  if (!isRegistryInitialised())
    throw new Error('[registry] Not initialised - call initRegistry() first.');

  const manifests = getLoadedManifests() as DomainManifest[];

  // Already loaded
  if (manifests.some((m) => m.domain === domainName)) {
    return manifests.find((m) => m.domain === domainName)!;
  }

  const manifest = await loadSingleManifest(domainName);
  if (!manifest) return null;

  // Add to manifests array
  pushLoadedManifest(manifest);
  domainsView!.add(manifest.domain);

  // Add registrations
  const newRegistrations: ToolRegistration[] = [];
  for (const r of manifest.registrations) {
    const registration: ToolRegistration = r.domain ? r : { ...r, domain: manifest.domain };
    if (!registrationsByName!.has(registration.tool.name)) {
      registrationsByName!.set(registration.tool.name, registration);
      newRegistrations.push(registration);
    }
    registerCompiledValidator(registration.tool);
  }
  // Router-layer consumers (getRegistrationByName / buildHandlerMapFromRegistry)
  // read the shared cache in state.ts, not the local map above. Keep both in
  // sync so a lazily loaded domain's tools are actually resolvable/activatable.
  appendLoadedRegistrations(newRegistrations);
  // Invalidate the ToolCatalog toolGroups cache so the next getToolsByDomains
  // call picks up the newly registered tools for this domain.
  notifyRegistryInvalidation();

  // Update tool names view
  for (const r of manifest.registrations) {
    (toolNamesView as Set<string>).add(r.tool.name);
  }

  emitBusEvent(eventBus, 'domain:loaded', {
    domain: manifest.domain,
    toolCount: manifest.registrations.length,
    timestamp: new Date().toISOString(),
  });

  return manifest;
}

/**
 * Ensure ALL domain manifests are loaded.
 * Useful for search_tools which needs to index all tools.
 * No-op if all domains are already loaded.
 */
export async function ensureAllDomainsLoaded(eventBus?: EventBus<ServerEventMap>): Promise<void> {
  const allDomains = getAllKnownDomainNames();
  const loaded = new Set(getLoadedManifests().map((m) => m.domain));
  const missing = [...allDomains].filter((d) => !loaded.has(d));

  if (missing.length === 0) return;

  logger.info(`[registry] Loading ${missing.length} remaining domains for full discovery`);
  await Promise.all(missing.map((d) => ensureDomainLoaded(d, eventBus)));
}

// ── Accessors ──

// ── Public read-only views ──
// Backed by registry/state.ts (leaf module) so router-layer consumers can
// bypass this barrel entirely.

export {
  getLoadedManifests as getAllManifests,
  getLoadedRegistrations as getAllRegistrations,
} from '@server/registry/state';
export { getLoadedDomainNames as getAllDomains } from '@server/registry/views';

/** Returns ALL known domain names from build-time metadata (no loading needed). */
export function getAllKnownDomains(): ReadonlySet<string> {
  return getAllKnownDomainNames();
}

export function getAllToolNames(): ReadonlySet<string> {
  if (!toolNamesView) throw new Error('[registry] Not initialised - call initRegistry() first.');
  return toolNamesView;
}

// ── Builders moved to registry/views.ts (leaf module) so ToolCatalog /
// ToolHandlerMap can derive caches without importing this barrel — the
// barrel's import graph reaches every domain manifest via
// discovery.ts → generated-domains.ts, which re-created the
// registry↔catalog cycle family.
export {
  buildAllTools,
  buildHandlerMapFromRegistry,
  getRegistrationByName,
} from '@server/registry/views';
export { buildProfileDomains } from '@server/registry/profiles';

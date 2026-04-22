// Runtime domain discovery via static generated index
import { logger } from '@utils/logger';
import type { DomainManifest } from '@server/registry/contracts';
import { generatedManifestLoaders, DOMAIN_PROFILE_MAP } from './generated-domains.js';

// ── validation ──

function isDomainManifest(value: unknown): value is DomainManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    m['kind'] === 'domain-manifest' &&
    m['version'] === 1 &&
    typeof m['domain'] === 'string' &&
    typeof m['depKey'] === 'string' &&
    Array.isArray(m['profiles']) &&
    Array.isArray(m['registrations']) &&
    typeof m['ensure'] === 'function'
  );
}

function extractManifest(mod: unknown): DomainManifest | null {
  if (!mod || typeof mod !== 'object') return null;
  const m = mod as Record<string, unknown>;
  for (const key of ['default', 'manifest', 'domainManifest']) {
    const candidate = m[key];
    if (isDomainManifest(candidate)) return candidate;
  }
  return null;
}

// ── profile helpers ──

/** Return the set of domain names that belong to a given profile tier. */
export function getDomainsForProfile(profile: string): ReadonlySet<string> {
  const result = new Set<string>();
  for (const [domain, profiles] of Object.entries(DOMAIN_PROFILE_MAP)) {
    if (profiles.includes(profile)) result.add(domain);
  }
  return result;
}

/** Return ALL known domain names from build-time metadata (no loading required). */
export function getAllKnownDomainNames(): ReadonlySet<string> {
  return new Set(Object.keys(DOMAIN_PROFILE_MAP));
}

// ── public API ──

export interface DomainLoaderMeta {
  readonly domain: string;
  readonly depKey: string;
  readonly profiles: readonly string[];
  readonly secondaryDepKeys: readonly string[];
  readonly load: () => Promise<unknown>;
}

/** Return the full loader metadata array (no loading). */
export function getLoaderMetadata(): readonly DomainLoaderMeta[] {
  return generatedManifestLoaders;
}

/**
 * Load manifests for a specific set of domains.
 * Skips domains that fail validation with a warning.
 */
export async function discoverDomainManifests(
  domainsToLoad?: ReadonlySet<string>,
): Promise<DomainManifest[]> {
  const manifests: DomainManifest[] = [];
  const seenDomains = new Set<string>();
  const seenDepKeys = new Set<string>();

  for (const { domain: domainName, load } of generatedManifestLoaders) {
    if (domainsToLoad && !domainsToLoad.has(domainName)) continue;

    try {
      const mod = await load();
      const manifest = extractManifest(mod);
      if (!manifest) {
        logger.warn(`[discovery] Skipping domain "${domainName}": no valid DomainManifest export`);
        continue;
      }

      if (seenDomains.has(manifest.domain)) {
        logger.warn(
          '[discovery] Duplicate domain "' +
            manifest.domain +
            '" in generated manifests - skipping',
        );
        continue;
      }
      if (seenDepKeys.has(manifest.depKey)) {
        logger.warn(
          '[discovery] Duplicate depKey "' +
            manifest.depKey +
            '" in generated manifests - skipping',
        );
        continue;
      }

      seenDomains.add(manifest.domain);
      seenDepKeys.add(manifest.depKey);
      manifests.push(manifest);
      logger.info(
        '[discovery] Loaded domain "' +
          manifest.domain +
          '" (' +
          String(manifest.registrations.length) +
          ' tools)',
      );
    } catch (err) {
      logger.error(`[discovery] Failed to load domain "${domainName}"`, err);
      if (process.env.DISCOVERY_STRICT === 'true') {
        throw err;
      }
    }
  }

  const totalTools = manifests.reduce((n, m) => n + m.registrations.length, 0);
  logger.info(
    '[discovery] Discovered ' +
      String(manifests.length) +
      ' domains, ' +
      String(totalTools) +
      ' tools total',
  );
  return manifests;
}

/**
 * Load a single domain manifest by name.
 * Returns null if the domain doesn't exist or fails validation.
 */
export async function loadSingleManifest(domainName: string): Promise<DomainManifest | null> {
  const loader = generatedManifestLoaders.find((l) => l.domain === domainName);
  if (!loader) return null;

  try {
    const mod = await loader.load();
    const manifest = extractManifest(mod);
    if (!manifest) {
      logger.warn(`[discovery] Domain "${domainName}": no valid DomainManifest export`);
      return null;
    }
    logger.info(
      '[discovery] On-demand loaded domain "' +
        manifest.domain +
        '" (' +
        String(manifest.registrations.length) +
        ' tools)',
    );
    return manifest;
  } catch (err) {
    logger.error(`[discovery] Failed to load domain "${domainName}"`, err);
    return null;
  }
}

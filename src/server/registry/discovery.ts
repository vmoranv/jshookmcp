// Runtime domain discovery via static generated index
import { logger } from '@utils/logger';
import type { DomainManifest } from '@server/registry/contracts';
import { generatedManifestLoaders } from './generated-domains.js';

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

// ── public API ──

// Dynamically imports each domain manifest via the generated loader array.
// Each manifest ends up in its own Rolldown chunk, enabling per-domain lazy loading.
export async function discoverDomainManifests(): Promise<DomainManifest[]> {
  const manifests: DomainManifest[] = [];
  const seenDomains = new Set<string>();
  const seenDepKeys = new Set<string>();

  for (const { domain: domainName, load } of generatedManifestLoaders) {
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

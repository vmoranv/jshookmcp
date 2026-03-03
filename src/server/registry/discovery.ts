// Runtime domain discovery - scans domains/STAR/manifest.js and loads them
// via dynamic ESM import. Replaces the static 16-import array.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../../utils/logger.js';
import type { DomainManifest } from './contracts.js';

/* ---------- validation ---------- */

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

/* ---------- path discovery ---------- */

async function discoverManifestPaths(): Promise<string[]> {
  const domainsDir = fileURLToPath(new URL('../domains/', import.meta.url));
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(domainsDir, { withFileTypes: true });
  } catch (err) {
    logger.error('[discovery] Cannot read domains directory:', err);
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Try .js first (compiled), then .ts (source, e.g. vitest)
    for (const ext of ['manifest.js', 'manifest.ts']) {
      const manifestPath = join(domainsDir, entry.name, ext);
      try {
        const s = await stat(manifestPath);
        if (s.isFile()) {
          paths.push(manifestPath);
          break; // prefer .js if both exist
        }
      } catch {
        // Not found with this extension - try next
      }
    }
  }
  return paths;
}

/* ---------- public API ---------- */

// Scan all domain subdirectories for manifest.js, dynamically import each,
// validate the exported DomainManifest contract, and return all valid manifests.
// A failing manifest is logged and skipped - it does NOT crash the server.
export async function discoverDomainManifests(): Promise<DomainManifest[]> {
  const files = await discoverManifestPaths();
  const manifests: DomainManifest[] = [];
  const seenDomains = new Set<string>();
  const seenDepKeys = new Set<string>();

  for (const absPath of files) {
    try {
      // Windows requires file:// URL for absolute paths in ESM dynamic import
      const mod: unknown = await import(pathToFileURL(absPath).href);
      const manifest = extractManifest(mod);
      if (!manifest) {
        logger.warn('[discovery] Skipping ' + absPath + ': no valid DomainManifest export');
        continue;
      }

      if (seenDomains.has(manifest.domain)) {
        logger.warn('[discovery] Duplicate domain "' + manifest.domain + '" in ' + absPath + ' - skipping');
        continue;
      }
      if (seenDepKeys.has(manifest.depKey)) {
        logger.warn('[discovery] Duplicate depKey "' + manifest.depKey + '" in ' + absPath + ' - skipping');
        continue;
      }

      seenDomains.add(manifest.domain);
      seenDepKeys.add(manifest.depKey);
      manifests.push(manifest);
      logger.info('[discovery] Loaded domain "' + manifest.domain + '" (' + String(manifest.registrations.length) + ' tools)');
    } catch (err) {
      logger.error('[discovery] Failed to load manifest: ' + absPath, err);
    }
  }

  const totalTools = manifests.reduce((n, m) => n + m.registrations.length, 0);
  logger.info('[discovery] Discovered ' + String(manifests.length) + ' domains, ' + String(totalTools) + ' tools total');
  return manifests;
}

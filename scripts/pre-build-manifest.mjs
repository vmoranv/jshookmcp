#!/usr/bin/env node
/**
 * pre-build-manifest.mjs — generate a static tool manifest at build time.
 *
 * Scans all domain subdirectories for manifest.{js,ts} files, dynamically imports
 * them, and writes a consolidated `generated/tool-manifest.json` that the server
 * can read at startup instead of performing runtime FS scanning + dynamic imports.
 *
 * Usage:
 *   node scripts/pre-build-manifest.mjs [--out <path>]
 *
 * Default output: <projectRoot>/generated/tool-manifest.json
 */
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outputPath = outIdx >= 0 && args[outIdx + 1]
  ? args[outIdx + 1]
  : join(projectRoot, 'generated', 'tool-manifest.json');

// ── Discovery ──

async function discoverManifestPaths() {
  const domainsDir = join(projectRoot, 'src', 'server', 'domains');
  const entries = await readdir(domainsDir, { withFileTypes: true });
  const directories = entries.filter((e) => e.isDirectory());

  const paths = [];
  for (const dir of directories) {
    for (const ext of ['manifest.js', 'manifest.ts']) {
      const manifestPath = join(domainsDir, dir.name, ext);
      try {
        const s = await stat(manifestPath);
        if (s.isFile()) {
          paths.push(manifestPath);
          break;
        }
      } catch {
        // Not found
      }
    }
  }
  return paths;
}

function toImportSpec(absPath) {
  return pathToFileURL(absPath).href;
}

function extractManifest(mod) {
  if (!mod || typeof mod !== 'object') return null;
  for (const key of ['default', 'manifest', 'domainManifest']) {
    const candidate = mod[key];
    if (
      candidate &&
      typeof candidate === 'object' &&
      candidate.kind === 'domain-manifest' &&
      candidate.version === 1
    ) {
      return candidate;
    }
  }
  return null;
}

// ── Main ──

async function main() {
  console.log('[pre-build-manifest] Scanning for domain manifests...');
  const manifestPaths = await discoverManifestPaths();
  const result = {
    generatedAt: new Date().toISOString(),
    domains: [],
  };

  for (const absPath of manifestPaths) {
    try {
      const mod = await import(toImportSpec(absPath));
      const manifest = extractManifest(mod);
      if (!manifest) {
        console.warn(`  [skip] No valid DomainManifest in ${absPath}`);
        continue;
      }
      const relPath = relative(projectRoot, absPath).split(sep).join('/');
      result.domains.push({
        domain: manifest.domain,
        depKey: manifest.depKey,
        profiles: manifest.profiles,
        toolCount: manifest.registrations?.length ?? 0,
        tools: (manifest.registrations ?? []).map((reg) => ({
          name: typeof reg.tool === 'function' ? reg.tool()?.name : reg.tool?.name,
          domain: manifest.domain,
        })),
        source: relPath,
      });
      console.log(`  [ok] ${manifest.domain} (${manifest.registrations?.length ?? 0} tools)`);
    } catch (error) {
      console.error(`  [error] Failed to import ${absPath}:`, error.message);
    }
  }

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  const totalTools = result.domains.reduce((n, d) => n + d.toolCount, 0);
  console.log(
    `[pre-build-manifest] Done! ${result.domains.length} domains, ${totalTools} tools → ${outputPath}`
  );
}

main().catch((err) => {
  console.error('[pre-build-manifest] Fatal error:', err);
  process.exit(1);
});

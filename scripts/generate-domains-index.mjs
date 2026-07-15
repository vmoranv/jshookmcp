import { promises as fs } from 'fs';
import path from 'path';

const DOMAINS_DIR = path.resolve('src/server/domains');
const OUT_FILE = path.resolve('src/server/registry/generated-domains.ts');

/**
 * Extract a string value from a const assignment like:
 *   const DEP_KEY = 'browserHandlers' as const;
 *   const DEP_KEY = 'adbBridgeHandlers';
 */
function extractConstString(source, varName) {
  // Try const DEP_KEY = '...'
  const re = new RegExp('const\\s+' + varName + '\\s*=\\s*[\'"]([^\'"]+)[\'"]');
  const m = source.match(re);
  if (m) return m[1];
  return null;
}

function extractObjectString(source, propName) {
  const re = new RegExp(propName + '\\s*:\\s*[\'"]([^\'"]+)[\'"]');
  const m = source.match(re);
  return m ? m[1] : null;
}

function extractConstArray(source, varName) {
  const re = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([^\\]]*)\\]`);
  const m = source.match(re);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/['"`]/g, ''))
    .filter(Boolean);
}

/**
 * Extract an array literal from source like:
 *   profiles: ['workflow', 'full'],
 */
function extractStringArray(searchSource, propName, fullSource = searchSource) {
  const re = new RegExp(`${propName}\\s*:\\s*\\[([^\\]]*)\\]`);
  const m = searchSource.match(re);
  if (m) {
    return m[1]
      .split(',')
      .map((s) => s.trim().replace(/['"`]/g, ''))
      .filter(Boolean);
  }

  const constRef = searchSource.match(new RegExp(`${propName}\\s*:\\s*([A-Z0-9_]+)`));
  if (!constRef) return [];

  return extractConstArray(fullSource, constRef[1]) ?? [];
}

/**
 * Format an object property key, quoting it only when it isn't a valid JS
 * identifier (e.g. 'adb-bridge'). Matches oxfmt's as-needed quote style so
 * regenerated output stays format-clean and produces no diff on rebuild.
 */
function formatPropertyKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${key}'`;
}

function formatLoaderEntry(e) {
  const profilesStr = e.profiles.map((p) => `'${p}'`).join(', ');
  const secondaryStr = e.secondaryDepKeys.map((k) => `'${k}'`).join(', ');
  const singleLine = `  { domain: '${e.domain}', depKey: '${e.depKey}', profiles: [${profilesStr}] as const, secondaryDepKeys: [${secondaryStr}] as const, load: () => import('../domains/${e.directory}/manifest.js') },`;
  if (singleLine.length <= 120) return singleLine;
  return [
    `  {`,
    `    domain: '${e.domain}',`,
    `    depKey: '${e.depKey}',`,
    `    profiles: [${profilesStr}] as const,`,
    `    secondaryDepKeys: [${secondaryStr}] as const,`,
    `    load: () => import('../domains/${e.directory}/manifest.js'),`,
    `  },`,
  ].join('\n');
}

async function main() {
  const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
  const domains = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const manifestPathTs = path.join(DOMAINS_DIR, entry.name, 'manifest.ts');
      const manifestPathJs = path.join(DOMAINS_DIR, entry.name, 'manifest.js');
      const found =
        (await fs
          .stat(manifestPathTs)
          .then((s) => s.isFile())
          .catch(() => false)) ||
        (await fs
          .stat(manifestPathJs)
          .then((s) => s.isFile())
          .catch(() => false));
      if (found) {
        domains.push(entry.name);
      }
    }
  }

  const loaderEntries = [];

  for (const domain of domains) {
    const manifestPath = path.join(DOMAINS_DIR, domain, 'manifest.ts');
    let source = '';
    try {
      source = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      continue;
    }

    // Follow re-exports: "export { default } from './handlers/impl'"
    if (!source.includes('DEP_KEY') && !source.includes('depKey')) {
      const reexportMatch = source.match(/from\s+['"]\.\/([^'"]+)['"]/);
      if (reexportMatch) {
        const implPath = path.join(DOMAINS_DIR, domain, reexportMatch[1] + '.ts');
        try {
          source = await fs.readFile(implPath, 'utf-8');
        } catch {
          /* keep original source */
        }
      }
    }

    const manifestStart = source.indexOf('const manifest');
    const manifestSource = manifestStart >= 0 ? source.slice(manifestStart) : source;

    const manifestDomain =
      extractConstString(source, 'DOMAIN') ?? extractObjectString(source, 'domain') ?? domain;
    const depKey =
      extractConstString(source, 'DEP_KEY') ??
      extractObjectString(manifestSource, 'depKey') ??
      `${domain}Handlers`;
    const profiles = extractStringArray(manifestSource, 'profiles', source);
    const secondaryDepKeys = extractStringArray(manifestSource, 'secondaryDepKeys', source);

    loaderEntries.push({
      directory: domain,
      domain: manifestDomain,
      depKey,
      profiles: profiles.length > 0 ? profiles : ['full'],
      secondaryDepKeys,
    });
  }

  const loaders = loaderEntries.map(formatLoaderEntry).join('\n');

  const array = `\nexport const generatedManifestLoaders = [\n${loaders}\n] as const;`;
  const content = `// AUTO-GENERATED BY scripts/generate-domains-index.mjs\n// DO NOT EDIT DIRECTLY\n${array}\n`;
  const metaLines = loaderEntries.map(
    (e) => `  ${formatPropertyKey(e.domain)}: [${e.profiles.map((p) => `'${p}'`).join(', ')}],`,
  );
  const metaExport = `\n/** Domains included in each profile tier (derived at build time from manifest sources). */\nexport const DOMAIN_PROFILE_MAP: Readonly<Record<string, readonly string[]>> = {\n${metaLines.join('\n')}\n};\n`;

  await fs.writeFile(OUT_FILE, content + metaExport, 'utf-8');
  console.log(`[generate-domains-index] Generated registry with ${domains.length} domains.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

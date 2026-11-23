#!/usr/bin/env node
// Per-domain 6-dimension health scanner. Output: scripts/audit/domain-audit.json
//
// KEYED BY DOMAIN, NOT BY DIRECTORY.
//
// This used to key by directory name, which was wrong in two ways at once:
//   - `src/server/domains/analysis/` declares `const DOMAIN = 'core'`, so the
//     report carried a phantom domain `analysis` and no `core` entry at all.
//     The tools the core domain owns were invisible under their real name.
//   - The report was a snapshot of whichever directories existed when it was
//     last run, so `session` and `tasks` were simply absent.
//
// The domain -> directory mapping now comes from `generatedManifestLoaders`
// (`src/server/registry/generated-domains.ts`), the same generated artifact the
// registry itself loads manifests from. A renamed domain or directory therefore
// cannot drift out of the report.
//
// The directory is still used for every *lookup*, because D1-D5 are
// directory-scoped by nature: test files live under
// `tests/server/domains/<dir>/`, coverage globs point at
// `src/server/domains/<dir>/...`, and source files live in the directory. Only
// the key and the report label use the domain name.
//
// Dimensions:
//   D1 tool count
//   D2 test files (rough proxy for coverage)
//   D3 coverage-excluded files (from vitest.config.ts)
//   D4 catch blocks with no error binding (error-handling honesty)
//   D5 handleSafe references
//   D6 manifest metadata — workflowRule / prerequisites / toolDependencies.
//      This used to look for a `CLAUDE.md` in each domain directory and read
//      "Audit Score" / "Prerequisites" / "Tool Dependencies" headings out of it.
//      No domain directory has ever had one (the repo holds exactly two
//      `CLAUDE.md` files, in `src/constants/` and `tests/`), so the dimension
//      reported `false` four times over for all 36 domains. The fields those
//      headings described are declared on the manifest itself, so read them
//      there instead.
//
// Exits non-zero when the domain/directory mapping is incomplete, because the
// report would then be silently wrong — the exact failure this rewrite removes.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const DOMAIN_DIR = 'src/server/domains';
const OUTPUT_PATH = 'scripts/audit/domain-audit.json';
const require = createRequire(import.meta.url);

// ── domain -> directory, and per-domain manifest metadata ────────────────────

// `load` is a generated arrow of the fixed shape
//   () => import('../domains/<dir>/manifest.js')
// so the directory is readable off its source. The shape is asserted rather
// than assumed: a silent miss would put a wrong or missing domain into the
// report, which is precisely the bug this file no longer has.
const REGISTRY_PROBE = `
import { initRegistry, ensureAllDomainsLoaded, getAllManifests } from './src/server/registry/index.ts';
import { generatedManifestLoaders } from './src/server/registry/generated-domains.ts';

(async () => {
  await initRegistry();
  await ensureAllDomainsLoaded();

  const loaders = generatedManifestLoaders.map((entry) => ({
    domain: entry.domain,
    load: String(entry.load),
  }));
  const manifests = getAllManifests().map((manifest) => ({
    domain: manifest.domain,
    hasWorkflowRule: Boolean(manifest.workflowRule),
    hasPrerequisites: Boolean(manifest.prerequisites),
    hasToolDependencies: Boolean(manifest.toolDependencies),
  }));

  console.log('__JSON__' + JSON.stringify({ loaders, manifests }));
})();
`;

function loadRegistryState() {
  const tsxCliPath = path.join(
    path.dirname(require.resolve('tsx/package.json')),
    'dist',
    'cli.mjs',
  );
  const result = spawnSync(process.execPath, [tsxCliPath, '--eval', REGISTRY_PROBE], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, JSHOOK_REGISTRY_PLATFORM: 'win32', LOG_LEVEL: 'error' },
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`[audit] registry probe failed.${details ? `\n${details}` : ''}`);
  }
  const marker = result.stdout.indexOf('__JSON__');
  if (marker === -1) {
    throw new Error(`[audit] registry probe produced no payload.\nstdout:\n${result.stdout}`);
  }
  return JSON.parse(result.stdout.slice(marker + '__JSON__'.length).trim());
}

const { loaders, manifests } = loadRegistryState();

const manifestMetaByDomain = new Map(manifests.map((m) => [m.domain, m]));

const domainDirs = loaders
  .map(({ domain, load }) => {
    const match = load.match(/domains\/([^/'"]+)\/manifest\.[jt]s/);
    if (!match) {
      throw new Error(
        `[audit] cannot derive the source directory for domain "${domain}" from its loader: ${load}`,
      );
    }
    if (!manifestMetaByDomain.has(domain)) {
      throw new Error(
        `[audit] domain "${domain}" is loaded by the generated loaders but declares no manifest, ` +
          'so its metadata cannot be read.',
      );
    }
    return { domain, dir: match[1] };
  })
  .toSorted((a, b) => a.domain.localeCompare(b.domain));

// ── mapping integrity ────────────────────────────────────────────────────────

function listDomainDirs() {
  return fs.readdirSync(DOMAIN_DIR).filter((d) => {
    const dir = path.join(DOMAIN_DIR, d);
    const hasManifest =
      fs.existsSync(path.join(dir, 'manifest.ts')) || fs.existsSync(path.join(dir, 'manifest.js'));
    const hasLegacyToolSurface =
      fs.existsSync(path.join(dir, 'definitions.ts')) && fs.existsSync(path.join(dir, 'index.ts'));
    return hasManifest || hasLegacyToolSurface;
  });
}

const presentDirs = listDomainDirs();
const claimedDirs = new Set(domainDirs.map((entry) => entry.dir));
const unclaimedDirs = presentDirs.filter((dir) => !claimedDirs.has(dir)).toSorted();
const absentDirs = domainDirs.filter((entry) => !presentDirs.includes(entry.dir));

// ── dimension helpers ────────────────────────────────────────────────────────

const vitestConfig = fs.readFileSync('vitest.config.ts', 'utf8');

// Node-native recursive walk — `find` is unreliable on Windows.
function listTs(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(root);
  return out;
}

// Test files are directory-scoped: the suite mirrors `src/server/domains/<dir>/`
// as `tests/server/domains/<dir>/` (see `tests/server/domains/analysis/` for the
// `core` domain). Keying this off the domain name would report zero for `core`.
function countTestFiles(dir) {
  const roots = [`tests/server/domains/${dir}`, `tests/modules/${dir}`];
  let n = 0;
  for (const r of roots) {
    if (fs.existsSync(r)) {
      n += listTs(r).filter((f) => f.endsWith('.test.ts')).length;
    }
  }
  return n;
}

function countMatches(content, pattern) {
  return (content.match(pattern) || []).length;
}

function isDefinitionScope(file) {
  const normalized = file.split(path.sep).join('/');
  return (
    path.basename(file) === 'definitions.ts' ||
    normalized.includes('/definitions/') ||
    normalized.endsWith('/definitions/index.ts')
  );
}

function countToolDefinitions(files) {
  let n = 0;
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');

    // Tool definitions use several local styles:
    // - registry builder: tool('name', ...)
    // - TLS object wrapper: objectTool('name', ...)
    // - raw MCP Tool objects in definitions files: { name: 'name', ... }
    n += countMatches(content, /\btool\(\s*['"`]/g);
    n += countMatches(content, /\bobjectTool\(\s*['"`]/g);
    if (isDefinitionScope(f)) {
      n += countMatches(content, /\bname\s*:\s*['"`][a-zA-Z0-9_.:-]+['"`]/g);
    }
  }
  return n;
}

// Resolved through the installed package rather than PATH: `oxfmt` is not a
// global command here, and a formatter that silently never runs is how the
// committed JSON drifts away from what this script writes. The path is built by
// hand because oxfmt's `exports` map does not expose its own bin subpath.
function formatGeneratedJson(file) {
  const oxfmtBin = path.resolve('node_modules', 'oxfmt', 'bin', 'oxfmt');
  if (!fs.existsSync(oxfmtBin)) {
    console.warn(`[audit] warning: generated ${file}, but oxfmt was not found at ${oxfmtBin}`);
    return;
  }
  const result = spawnSync(process.execPath, [oxfmtBin, file, '--write'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.warn(`[audit] warning: generated ${file}, but oxfmt formatting was unavailable`);
  }
}

// ── scan ─────────────────────────────────────────────────────────────────────

const audit = {};

for (const { domain, dir } of domainDirs) {
  const dirPath = path.join(DOMAIN_DIR, dir);
  const entry = { domain, dir, dims: {} };

  // D1 tool count — count supported definition styles across domain source.
  const srcTsFiles = listTs(dirPath);
  entry.dims.d1_toolCount = countToolDefinitions(srcTsFiles);

  // D2 test files
  entry.dims.d2_testFiles = countTestFiles(dir);

  // D3 coverage-excluded files for this domain
  const excludeRe = new RegExp(`src/server/domains/${dir}/[^'"]+`, 'g');
  const excluded = vitestConfig.match(excludeRe) || [];
  entry.dims.d3_coverageExcluded = [...new Set(excluded)];

  // D4 catch blocks with no error binding.
  // Matches: `catch {`, and `catch ( ) {` — both swallow the error.
  let bareCatch = 0;
  for (const f of srcTsFiles) {
    const c = fs.readFileSync(f, 'utf8');
    bareCatch += (c.match(/\bcatch\s*\(\s*\)\s*\{/g) || []).length;
    bareCatch += (c.match(/\bcatch\s*\{/g) || []).length;
  }
  entry.dims.d4_bareCatch = bareCatch;

  // D5 handleSafe references
  let handleSafeCount = 0;
  for (const f of srcTsFiles) {
    const c = fs.readFileSync(f, 'utf8');
    handleSafeCount += (c.match(/\bhandleSafe\b/g) || []).length;
  }
  entry.dims.d5_handleSafeRefs = handleSafeCount;

  // D6 manifest metadata
  const meta = manifestMetaByDomain.get(domain);
  entry.dims.d6_manifestMeta = {
    hasWorkflowRule: meta.hasWorkflowRule,
    hasPrerequisites: meta.hasPrerequisites,
    hasToolDependencies: meta.hasToolDependencies,
  };

  audit[domain] = entry;
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(audit, null, 2) + '\n');
formatGeneratedJson(OUTPUT_PATH);

// ── report ───────────────────────────────────────────────────────────────────

const metaFlag = (value, letter) => (value ? letter : '-');

console.log(`Audited ${domainDirs.length} domains → ${OUTPUT_PATH}`);
for (const [domain, entry] of Object.entries(audit)) {
  const meta = entry.dims.d6_manifestMeta;
  const label = entry.dir === domain ? domain : `${domain} (src/${entry.dir})`;
  console.log(
    `${label.padEnd(34)} tools=${String(entry.dims.d1_toolCount).padStart(3)} ` +
      `tests=${String(entry.dims.d2_testFiles).padStart(3)} ` +
      `catch=${String(entry.dims.d4_bareCatch).padStart(3)} ` +
      `hs=${String(entry.dims.d5_handleSafeRefs).padStart(3)} ` +
      `exc=${String(entry.dims.d3_coverageExcluded.length).padStart(2)} ` +
      `meta=${metaFlag(meta.hasWorkflowRule, 'W')}${metaFlag(meta.hasPrerequisites, 'P')}${metaFlag(meta.hasToolDependencies, 'T')}`,
  );
}

if (unclaimedDirs.length === 0 && absentDirs.length === 0) {
  console.log(
    `\n[audit] OK: every one of the ${presentDirs.length} domain directories is claimed by exactly one domain.`,
  );
  process.exit(0);
}

console.error(
  '\n[audit] FAIL: the domain/directory mapping is incomplete, so this report is wrong.',
);
if (unclaimedDirs.length > 0) {
  console.error(`  directories no domain loads: ${unclaimedDirs.join(', ')}`);
}
if (absentDirs.length > 0) {
  console.error(
    `  domains whose directory is missing: ${absentDirs
      .map((e) => `${e.domain} (expected src/${e.dir})`)
      .join(', ')}`,
  );
}
console.error(
  '  hint: run `node scripts/generate/domains-index.mjs` to refresh the generated loaders',
);
process.exit(1);

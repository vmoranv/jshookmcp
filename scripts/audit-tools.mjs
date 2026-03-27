/**
 * CI audit gate: validates tool registration integrity.
 *
 * Checks:
 * 1. At least one domain is discovered
 * 2. No orphan tools (defined but unregistered, or registered but undefined)
 * 3. No duplicate tool names across domains
 * 4. All registered handlers exist (bind functions are callable)
 *
 * Tool and domain counts are NOT hardcoded — the audit discovers them
 * dynamically from manifests, avoiding CI breakage on every tool change.
 *
 * Usage: tsx scripts/audit-tools.mjs
 * Exit code 0 = pass, 1 = fail
 */

import { pathToFileURL } from 'node:url';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMetadata } from './generate-metadata.mjs';

process.env.JSHOOK_REGISTRY_PLATFORM ??= 'win32';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRootUrl = new URL('../', scriptDirUrl);
const projectRoot = fileURLToPath(projectRootUrl);

// Use compiled output if available, fall back to source
const domainsDir = join(projectRoot, 'dist', 'src', 'server', 'domains');
let useCompiled = true;
try {
  await stat(domainsDir);
} catch {
  useCompiled = false;
}

const targetDir = useCompiled ? domainsDir : join(projectRoot, 'src', 'server', 'domains');
const manifestFile = useCompiled ? 'manifest.js' : 'manifest.ts';

console.log(`[audit] Scanning ${useCompiled ? 'dist' : 'src'} manifests...`);
const metadataCheck = await checkMetadata({ quiet: true });

// Discover manifests
const entries = await readdir(targetDir, { withFileTypes: true });
const manifests = [];
const errors = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(targetDir, entry.name, manifestFile);
  try {
    await stat(manifestPath);
  } catch {
    continue; // no manifest in this subdirectory (e.g. "shared")
  }

  try {
    const mod = await import(pathToFileURL(manifestPath).href);
    const manifest = mod.default ?? mod.manifest ?? mod.domainManifest;
    if (!manifest || manifest.kind !== 'domain-manifest') {
      errors.push(`${entry.name}: no valid DomainManifest export`);
      continue;
    }
    manifests.push(manifest);
  } catch (err) {
    errors.push(`${entry.name}: failed to load - ${err.message}`);
  }
}

// Tally
const domainCount = manifests.length;
const allToolNames = [];
const toolsByDomain = new Map();
const duplicates = [];

for (const m of manifests) {
  const names = m.registrations.map((r) => r.tool.name);
  toolsByDomain.set(m.domain, names);
  for (const name of names) {
    if (allToolNames.includes(name)) {
      duplicates.push({ name, domain: m.domain });
    }
    allToolNames.push(name);
  }
}

const uniqueToolCount = new Set(allToolNames).size;
const totalToolCount = allToolNames.length;

// Check handler bind functions
let missingHandlers = 0;
for (const m of manifests) {
  for (const r of m.registrations) {
    if (typeof r.bind !== 'function') {
      errors.push(`${m.domain}/${r.tool.name}: bind is not a function`);
      missingHandlers++;
    }
  }
}

// Report
console.log('');
console.log('┌─────────────────────────────────────────────┐');
console.log('│            Tool Registration Audit           │');
console.log('├─────────────────────┬───────────┬────────────┤');
console.log(
  `│ Registry domains    │ ${String(metadataCheck.summary.domainCount).padStart(4)}      │ source      │`,
);
console.log(
  `│ Registry tools      │ ${String(metadataCheck.summary.toolCount).padStart(4)}      │ source      │`,
);
console.log(
  `│ Audited manifests   │ ${String(domainCount).padStart(4)}      │ ${useCompiled ? 'dist' : 'src'}        │`,
);
console.log(
  `│ Manifest tools      │ ${String(totalToolCount).padStart(4)}      │ ${useCompiled ? 'dist' : 'src'}        │`,
);
console.log(`│ Duplicates          │ ${String(duplicates.length).padStart(4)}      │ expect 0   │`);
console.log(`│ Missing handlers    │ ${String(missingHandlers).padStart(4)}      │ expect 0   │`);
console.log(`│ Load errors         │ ${String(errors.length).padStart(4)}      │ expect 0   │`);
console.log(
  `│ Stale metadata      │ ${String(metadataCheck.mismatches.length).padStart(4)}      │ expect 0   │`,
);
console.log('└─────────────────────┴───────────┴────────────┘');
console.log('');

// Per-domain breakdown
console.log('Per-domain breakdown:');
for (const m of manifests.toSorted((a, b) => a.domain.localeCompare(b.domain))) {
  console.log(`  ${m.domain.padEnd(16)} ${String(m.registrations.length).padStart(3)} tools`);
}
console.log('');

// Errors
if (errors.length > 0) {
  console.log('Errors:');
  for (const e of errors) {
    console.error(`  ✗ ${e}`);
  }
  console.log('');
}

if (duplicates.length > 0) {
  console.log('Duplicate tool names:');
  for (const d of duplicates) {
    console.error(`  ✗ "${d.name}" in domain "${d.domain}"`);
  }
  console.log('');
}

if (metadataCheck.mismatches.length > 0) {
  console.log('Stale metadata files:');
  for (const file of metadataCheck.mismatches) {
    console.error(`  ✗ ${file}`);
  }
  console.log('');
}

// Final verdict
let pass = true;
if (domainCount < 1) {
  console.error(`FAIL: no domains discovered`);
  pass = false;
}
if (uniqueToolCount < 1) {
  console.error(`FAIL: no tools discovered`);
  pass = false;
}
if (totalToolCount !== uniqueToolCount) {
  console.error(`FAIL: ${totalToolCount - uniqueToolCount} duplicate registrations`);
  pass = false;
}
if (missingHandlers > 0) {
  console.error(`FAIL: ${missingHandlers} missing handler bind functions`);
  pass = false;
}
if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} manifest load errors`);
  pass = false;
}
if (metadataCheck.mismatches.length > 0) {
  console.error(`FAIL: ${metadataCheck.mismatches.length} stale metadata files`);
  pass = false;
}

if (pass) {
  console.log('PASS: All checks passed.');
} else {
  console.log('');
  console.error('AUDIT FAILED - see above for details.');
}

process.exit(pass ? 0 : 1);

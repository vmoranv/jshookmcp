#!/usr/bin/env node
// Domain integrity audit.
//
// WHY THIS EXISTS
// ---------------
// The cross-domain workflow layer needs two facts:
//
//   - which domain owns a given tool  (`inferDomainsForTool`)
//   - which domains exist at all       (the capability list)
//
// Both used to be hand-maintained inside `handlers.impl.ts` — a prefix table and
// a `V5_DOMAIN_NAMES` array. Parallel copies of the registry rot silently: when
// a tool or a domain is renamed, no test fails and `metadata:check` stays green.
// The symptom is a workflow that can no longer be suggested, or a capability
// list that advertises a domain which does not exist. Both had actually rotted.
//
// They are now generated (`src/server/registry/generated-tool-domains.ts`), so
// the remaining risks are different ones, and this is what this audit covers:
//
// FAILS THE BUILD
//   1. generated-tool-domains.ts must match the registry built by initRegistry().
//   2. every workflow step's tool name must resolve to a registered domain.
//   3. every tool name in the cross-domain synonym graph must be registered.
//
// REPORTED ONLY
//   4. per-workflow resolved domain requirements.
//
// Checks 2 and 3 catch the same class of authoring mistake: a hand-written list
// of tool names that references a tool which does not exist (typo, or a tool
// that was renamed). A workflow step does it silently — the step contributes no
// required domain, so the workflow looks satisfiable while it is not. A synonym
// group does it loudly — `cross_domain_synonyms` returns the dead names to the
// caller as `recommendedTools`. The graph had in fact rotted: three `mojo_*`
// tools, `native_emulator_launch` and `syscall_get_events` were all renamed
// upstream while the graph kept recommending the old names.
//
// Usage:
//   node scripts/audit/domain-integrity.mjs
//   node scripts/audit/domain-integrity.mjs --quiet

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRoot = fileURLToPath(new URL('../../', scriptDirUrl));
const require = createRequire(import.meta.url);

const QUIET = process.argv.includes('--quiet');

const registryProbe = `
import { initRegistry, getAllRegistrations } from './src/server/registry/index.ts';
import {
  GENERATED_TOOL_DOMAIN_MAP,
  GENERATED_DOMAIN_NAMES,
} from './src/server/registry/generated-tool-domains.ts';
import { WORKFLOWS } from './src/server/domains/cross-domain/workflows/missions.ts';
import { getSynonymGraphGroups } from './src/server/domains/cross-domain/handlers/synonym-engine.ts';

(async () => {
  await initRegistry();
  const registryPairs = [...getAllRegistrations()].map((r) => [r.tool.name, r.domain]);
  const workflows = Object.entries(WORKFLOWS).map(([key, workflow]) => ({
    key,
    id: workflow.id,
    steps: workflow.steps.map((step) => step.tool),
  }));
  const synonymGroups = getSynonymGraphGroups().map((group) => ({
    concept: group.concept,
    tools: [...group.tools],
  }));
  console.log(
    '__JSON__' +
      JSON.stringify({
        registryPairs,
        generatedMap: GENERATED_TOOL_DOMAIN_MAP,
        generatedNames: GENERATED_DOMAIN_NAMES,
        workflows,
        synonymGroups,
      }),
  );
})();
`;

function loadRegistryState() {
  const tsxCliPath = join(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCliPath, '--eval', registryProbe], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, JSHOOK_REGISTRY_PLATFORM: 'win32', LOG_LEVEL: 'error' },
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Registry probe failed.${details ? `\n${details}` : ''}`);
  }
  const marker = result.stdout.indexOf('__JSON__');
  if (marker === -1) {
    throw new Error(`Registry probe produced no payload.\nstdout:\n${result.stdout}`);
  }
  return JSON.parse(result.stdout.slice(marker + '__JSON__'.length).trim());
}

const { registryPairs, generatedMap, generatedNames, workflows, synonymGroups } =
  loadRegistryState();
const registryMap = new Map(registryPairs);
const failures = [];

// 1. the generated map must be in sync with the live registry
{
  const missing = [];
  const extra = [];
  const mismatched = [];
  for (const [tool, domain] of registryMap) {
    const generated = Object.hasOwn(generatedMap, tool) ? generatedMap[tool] : undefined;
    if (generated === undefined) missing.push(tool);
    else if (generated !== domain) mismatched.push({ tool, registry: domain, generated });
  }
  for (const tool of Object.keys(generatedMap)) {
    if (!registryMap.has(tool)) extra.push(tool);
  }
  const generatedNameSet = new Set(generatedNames);
  const domainsMissing = [...new Set(registryPairs.map(([, d]) => d))].filter(
    (d) => !generatedNameSet.has(d),
  );
  const domainsExtra = generatedNames.filter(
    (d) => !new Set(registryPairs.map(([, x]) => x)).has(d),
  );

  if (
    missing.length ||
    extra.length ||
    mismatched.length ||
    domainsMissing.length ||
    domainsExtra.length
  ) {
    failures.push({
      check: 'generated-tool-domains.ts is out of sync with the registry',
      hint: 'run `node scripts/generate/domains-index.mjs`',
      missing,
      extra,
      mismatched,
      domainsMissing,
      domainsExtra,
    });
  }
}

// 2. every workflow step must resolve to a registered domain
const unresolved = [];
for (const workflow of workflows) {
  for (const tool of workflow.steps) {
    if (!registryMap.has(tool)) unresolved.push({ workflow: workflow.key, tool });
  }
}
if (unresolved.length > 0) {
  failures.push({
    check: 'workflow steps reference tools that are not registered',
    hint: 'these steps contribute no required domain, so coverage is overstated',
    unresolved,
  });
}

// 3. every tool name in the synonym graph must be registered
const deadSynonymTools = [];
for (const group of synonymGroups) {
  for (const tool of group.tools) {
    if (!registryMap.has(tool)) deadSynonymTools.push({ concept: group.concept, tool });
  }
}
if (deadSynonymTools.length > 0) {
  failures.push({
    check: 'synonym graph references tools that are not registered',
    hint: 'cross_domain_synonyms returns these names to the caller as recommendedTools',
    deadSynonymTools,
  });
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(
  `[domain-integrity] registry: ${new Set(registryPairs.map(([, d]) => d)).size} domains, ` +
    `${registryPairs.length} tools; generated map: ${Object.keys(generatedMap).length} tools, ` +
    `${generatedNames.length} domain names; workflows: ${workflows.length}; ` +
    `synonym groups: ${synonymGroups.length} ` +
    `(${synonymGroups.reduce((n, g) => n + g.tools.length, 0)} tool refs)`,
);

/**
 * One labelled line of a failure's value list, truncated at 8 so a whole-domain
 * mismatch does not bury the other checks. Hoisted to module scope: it captures
 * nothing from the reporting block, so defining it inside the loop rebuilt the
 * closure on every failure.
 */
function printFailureList(label, values, format = (v) => v) {
  if (!values?.length) return;
  const shown = values.slice(0, 8).map(format);
  const more = values.length > 8 ? ` (+${values.length - 8} more)` : '';
  console.error(`  ${label}: ${shown.join(', ')}${more}`);
}

if (failures.length === 0) {
  console.log(
    '[domain-integrity] OK: generated map matches the registry, and every workflow step ' +
      'and synonym-graph tool reference resolves.',
  );
} else {
  for (const failure of failures) {
    console.error(`\n[domain-integrity] FAIL: ${failure.check}`);
    if (failure.hint) console.error(`  hint: ${failure.hint}`);
    printFailureList('missing from generated map', failure.missing);
    printFailureList('present in generated map but not registered', failure.extra);
    printFailureList(
      'domain mismatch',
      failure.mismatched,
      (m) => `${m.tool} (registry=${m.registry}, generated=${m.generated})`,
    );
    printFailureList('domains missing from generated names', failure.domainsMissing);
    printFailureList('domain names not backed by any tool', failure.domainsExtra);
    printFailureList('unresolved steps', failure.unresolved, (u) => `${u.workflow}:${u.tool}`);
    printFailureList(
      'dead synonym tool references',
      failure.deadSynonymTools,
      (d) => `${d.concept}:${d.tool}`,
    );
  }
}

if (!QUIET) {
  console.log('\n[domain-integrity] resolved domain requirements per workflow:');
  for (const workflow of workflows) {
    const domains = [
      ...new Set(workflow.steps.map((tool) => registryMap.get(tool)).filter(Boolean)),
    ].toSorted();
    console.log(`  ${workflow.key} (${workflow.id}): [${domains.join(', ')}]`);
  }
}

process.exit(failures.length === 0 ? 0 : 1);

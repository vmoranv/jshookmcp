/**
 * Existing-test-asset benchmark — quantifies the audit/test suite AS a benchmark.
 *
 * The repo already carries 1000+ handler tests plus e2e real-task tests. Instead of
 * duplicating them, this suite converts them into a quantifiable per-tool coverage
 * matrix: for each of the 736 registry tools, does the existing test asset reference
 * its handler method or tool name (unit tests + e2e real tasks)?
 *
 * Output: per-domain covered/total ratios → artifacts/benchmarks/existing-test-coverage.{md,json}
 * This is the "breadth" layer of the benchmark; suites/*.suite.ts provide the "depth" layer
 * (deterministic vectors) and tests/e2e provide the live-task layer.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { body, type BenchCase, type BenchSuite } from './harness';

const ROOT = resolve_repo_root();

function resolve_repo_root(): string {
  // tests/benchmarks/ → repo root is two levels up
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

interface ToolRef {
  tool: string;
  domain: string;
  methods: string[];
}

function loadToolRefs(): ToolRef[] {
  // Full 736-tool universe comes from the generated registry map (domain per tool);
  // manifest.ts files add the tool→handler-method binding where one exists.
  const domainsText = readFileSync(
    join(ROOT, 'src/server/registry/generated-tool-domains.ts'),
    'utf8',
  );
  const mapRe = /([a-z0-9_]+):\s*'([a-z0-9-]+)'/g;
  const refs = new Map<string, ToolRef>();
  for (const m of domainsText.matchAll(mapRe)) {
    refs.set(m[1]!, { tool: m[1]!, domain: m[2]!, methods: [] });
  }
  const domainsDir = join(ROOT, 'src/server/domains');
  for (const domain of readdirSync(domainsDir)) {
    const manifestPath = join(domainsDir, domain, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    const text = readFileSync(manifestPath, 'utf8');
    const pairRe = /tool:\s*'([^']+)'[\s\S]{0,120}?method:\s*'([^']+)'/g;
    for (const m of text.matchAll(pairRe)) {
      const tool = m[1]!;
      const entry = refs.get(tool);
      if (entry && !entry.methods.includes(m[2]!)) entry.methods.push(m[2]!);
    }
  }
  return [...refs.values()];
}

/**
 * Registry domain → source directory name, read from the generated loader list.
 *
 * A domain's directory is NOT always its registry name: `core` lives in
 * `src/server/domains/analysis/` (and `tests/server/domains/analysis/`). Keying
 * the test asset by the registry name alone silently scored that whole domain as
 * zero-covered, so the mapping is taken from the authoritative generated file
 * rather than a hand-maintained alias table that would drift.
 */
function loadDomainDirNames(): Map<string, string> {
  const text = readFileSync(join(ROOT, 'src/server/registry/generated-domains.ts'), 'utf8');
  // `domain: 'x'` is followed by `load: () => import('../domains/<dir>/manifest.js')`.
  const re =
    /domain:\s*'([a-z0-9-]+)'[\s\S]*?import\('\.\.\/domains\/([a-z0-9-]+)\/manifest\.js'\)/g;
  const byDomain = new Map<string, string>();
  for (const m of text.matchAll(re)) byDomain.set(m[1]!, m[2]!);
  return byDomain;
}

/** Every `*.test.ts` under `dir`, at any depth. */
function collectTestFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // Nested subdirectories carry real handler tests (memory/handlers,
    // coordination/state-board, binary-instrument/apk-packer, ...); a
    // one-level scan misses them and under-reports the domain as uncovered.
    if (entry.isDirectory()) collectTestFiles(path, out);
    else if (entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/**
 * Test assets keyed by REGISTRY domain name.
 *
 * The scan walks `tests/server/domains/<dir>/`, where `<dir>` is the source
 * directory (may differ from the registry domain), then re-keys the text to the
 * registry domain via {@link loadDomainDirNames} so `computeCoverage()` can look
 * it up by `ref.domain`.
 */
function loadTestAssets(): { unit: Map<string, string>; e2e: string } {
  const unit = new Map<string, string>();
  const domainsTests = join(ROOT, 'tests/server/domains');
  const dirByDomain = loadDomainDirNames();
  const domainByDir = new Map<string, string>();
  for (const [domain, dir] of dirByDomain) domainByDir.set(dir, domain);

  if (existsSync(domainsTests)) {
    for (const entry of readdirSync(domainsTests, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const text = collectTestFiles(join(domainsTests, entry.name))
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
      if (!text) continue;
      // Nested test dirs are named after the source directory; anything without
      // a registry counterpart (shared/, fixtures) keeps its own name.
      const domain = domainByDir.get(entry.name) ?? entry.name;
      unit.set(domain, `${unit.get(domain) ?? ''}\n${text}`);
    }
  }

  const e2eDir = join(ROOT, 'tests/e2e');
  const e2e = collectTestFiles(e2eDir)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  return { unit, e2e };
}

function baseMethodNames(methods: string[]): string[] {
  const names = new Set<string>();
  for (const m of methods) {
    names.add(m);
    names.add(m.replace(/Tool$/, ''));
  }
  return [...names];
}

interface DomainCoverage {
  domain: string;
  total: number;
  covered: number;
  uncovered: string[];
  e2eCovered: number;
  /** Split of `covered`: executed assertions vs. merely skipped in a bench suite. */
  exercised?: number;
  referencedOnly?: number;
  skippedOnly?: string[];
}

/**
 * Tools whose ONLY benchmark appearance is a skipped case.
 *
 * A `skip` case never runs an assertion, so counting it as "covered" inflates
 * the breadth number: `misc-residual` reports 100% because 9 of its 11 cases
 * skip, yet those 9 tools exercise nothing. This scans the suites for tools
 * that appear exclusively under `skip:` predicates and reports them
 * separately, so the headline percentage only counts tools with a real
 * assertion behind them.
 */
function loadSkippedOnlyTools(): Set<string> {
  const skippedOnly = new Set<string>();
  const suitesDir = join(ROOT, 'tests/benchmarks/suites');
  if (!existsSync(suitesDir)) return skippedOnly;

  for (const file of readdirSync(suitesDir)) {
    if (!file.endsWith('.suite.ts')) continue;
    const text = readFileSync(join(suitesDir, file), 'utf8');
    const exercised = new Set<string>();
    const alwaysSkipped = new Set<string>();

    // Split into case blocks on `name:` boundaries so `tool:` and `skip:` are
    // attributed to the same case.
    const blocks = text.split(/\n\s*\{\s*\n\s*name:\s*'/).slice(1);
    for (const block of blocks) {
      const tool = block.match(/\btool:\s*'([a-z0-9_]+)'/)?.[1];
      if (!tool || tool.startsWith('*')) continue;
      // Only an UNCONDITIONAL skip means the case never runs. A conditional
      // skip (env-gated, platform-gated) still executes in the default run,
      // so it must not be demoted — treat it as exercised.
      const skip = block.match(/\bskip:\s*(\([^)]*\)\s*=>[^,}]+)/)?.[1] ?? '';
      const unconditional = /^\s*\([^)]*\)\s*=>\s*true\s*$/.test(skip.trim());
      if (unconditional) alwaysSkipped.add(tool);
      else exercised.add(tool);
    }
    for (const tool of alwaysSkipped) if (!exercised.has(tool)) skippedOnly.add(tool);
  }
  return skippedOnly;
}

function computeCoverage(): {
  domains: DomainCoverage[];
  totalTools: number;
  totalCovered: number;
  totalTotalE2eCovered?: never;
  totalE2eCovered: number;
  totalExercised: number;
  totalSkippedOnly: number;
} {
  const toolRefs = loadToolRefs();
  const { unit, e2e } = loadTestAssets();
  const skippedOnly = loadSkippedOnlyTools();
  const byDomain = new Map<string, ToolRef[]>();
  for (const ref of toolRefs) {
    const list = byDomain.get(ref.domain) ?? [];
    list.push(ref);
    byDomain.set(ref.domain, list);
  }
  const domains: DomainCoverage[] = [];
  let totalTools = 0;
  let totalCovered = 0;
  let totalE2eCovered = 0;
  let totalExercised = 0;
  let totalSkippedOnly = 0;
  for (const [domain, refs] of [...byDomain.entries()].toSorted()) {
    const asset = unit.get(domain) ?? '';
    const uncovered: string[] = [];
    let covered = 0;
    let e2eCovered = 0;
    for (const ref of refs) {
      totalTools += 1;
      const names = [...baseMethodNames(ref.methods), ref.tool];
      const inUnit = names.some((n) => asset.includes(n));
      const inE2e = e2e.includes(`'${ref.tool}'`) || e2e.includes(`"${ref.tool}"`);
      if (inUnit) covered += 1;
      else uncovered.push(ref.tool);
      if (inE2e) e2eCovered += 1;
    }
    totalCovered += covered;
    totalE2eCovered += e2eCovered;
    // Split the covered set: a tool whose only bench appearance is a skipped
    // case has a reference but no executed assertion behind it.
    const skippedHere = refs.filter((r) => skippedOnly.has(r.tool)).map((r) => r.tool);
    const exercisedHere = covered - skippedHere.length;
    totalExercised += exercisedHere;
    totalSkippedOnly += skippedHere.length;
    domains.push({
      domain,
      total: refs.length,
      covered,
      uncovered,
      e2eCovered,
      exercised: exercisedHere,
      referencedOnly: skippedHere.length,
      skippedOnly: skippedHere,
    });
  }
  return { domains, totalTools, totalCovered, totalE2eCovered, totalExercised, totalSkippedOnly };
}

let cache: ReturnType<typeof computeCoverage> | null = null;
function coverage(): ReturnType<typeof computeCoverage> {
  if (!cache) cache = computeCoverage();
  return cache;
}

function writeReport(): string {
  const { domains, totalTools, totalCovered, totalE2eCovered, totalExercised, totalSkippedOnly } =
    coverage();
  const pct = (n: number) => (totalTools ? ((n / totalTools) * 100).toFixed(1) : '0');
  const lines: string[] = [
    '# Existing Test Asset → Tool Coverage Matrix',
    '',
    `Unit-test coverage: **${totalCovered}/${totalTools}** tools (${pct(totalCovered)}%) referenced by domain handler tests.`,
    `  - of which **exercised** by a benchmark assertion: **${totalExercised}/${totalTools}** (${pct(totalExercised)}%)`,
    `  - of which appear **only as a skipped case**: **${totalSkippedOnly}** — referenced, but no assertion runs`,
    `e2e real-task coverage: **${totalE2eCovered}/${totalTools}** tools invoked by name in tests/e2e.`,
    '',
    '| Domain | Tools | Unit-tested | → exercised | → skipped-only | e2e-touched | Unit % |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const d of domains) {
    lines.push(
      `| ${d.domain} | ${d.total} | ${d.covered} | ${d.exercised ?? 0} | ${d.referencedOnly ?? 0} | ${d.e2eCovered} | ${d.total ? ((d.covered / d.total) * 100).toFixed(0) : '0'}% |`,
    );
  }
  lines.push('');
  const fullyUncovered = domains.filter((d) => d.covered === 0);
  if (fullyUncovered.length > 0) {
    lines.push('## Domains with zero unit-test coverage');
    lines.push('');
    for (const d of fullyUncovered) lines.push(`- **${d.domain}** (${d.total} tools)`);
    lines.push('');
  }
  const outDir = join(ROOT, 'artifacts/benchmarks');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'existing-test-coverage.md'), `${lines.join('\n')}\n`);
  writeFileSync(
    join(outDir, 'existing-test-coverage.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), domains, totalTools, totalCovered, totalExercised, totalSkippedOnly, totalE2eCovered }, null, 2)}\n`,
  );
  return lines.join('\n');
}

export const existingTestsSuite: BenchSuite = {
  name: 'existing-tests-coverage',
  domain: '*audit*',
  description:
    'Converts the existing handler-test + e2e asset into a per-tool coverage benchmark (breadth layer)',
  cases: [
    {
      name: 'existing-tests/matrix-computed',
      tool: '*all*',
      origin: 'homemade',
      reference: 'registry manifests × tests/server/domains + tests/e2e static reference scan',
      run: async () => {
        const {
          totalTools,
          totalCovered,
          totalE2eCovered,
          totalExercised,
          totalSkippedOnly,
          domains,
        } = coverage();
        return {
          totalTools,
          totalCovered,
          totalE2eCovered,
          totalExercised,
          totalSkippedOnly,
          domains,
        };
      },
      validate: (v) => {
        const b = body(v);
        const total = Number(b.totalTools ?? 0);
        const covered = Number(b.totalCovered ?? 0);
        if (total < 700) return `expected ≥700 registry tools, got ${total}`;
        const ratio = covered / total;
        return ratio >= 0.5
          ? true
          : `unit-test asset covers only ${(ratio * 100).toFixed(1)}% of tools (${covered}/${total}) — extend domain tests or record an explicit waiver`;
      },
    } satisfies BenchCase,
    {
      name: 'existing-tests/exercised-vs-skipped-accounting',
      tool: '*all*',
      origin: 'homemade',
      reference:
        'the covered set must split into exercised (a real assertion runs) and skipped-only (the only bench case skips)',
      // Regression: skipped cases used to count as coverage, so a suite where
      // 9 of 11 cases skip reported 100% and its tools read as "covered" while
      // no assertion ever executed.
      run: async () => {
        const { totalCovered, totalExercised, totalSkippedOnly, domains } = coverage();
        const withSkips = domains.filter((d) => (d.referencedOnly ?? 0) > 0);
        return {
          totalCovered,
          totalExercised,
          totalSkippedOnly,
          withSkips: withSkips.map((d) => `${d.domain}:${d.referencedOnly}`).join(','),
        };
      },
      validate: (v) => {
        const b = body(v);
        const covered = Number(b.totalCovered ?? 0);
        const exercised = Number(b.totalExercised ?? 0);
        const skipped = Number(b.totalSkippedOnly ?? 0);
        if (exercised + skipped !== covered) {
          return `exercised(${exercised}) + skippedOnly(${skipped}) must equal covered(${covered})`;
        }
        return exercised < covered
          ? true
          : 'expected at least one skipped-only tool (misc-residual skips 9) — the split is not being applied';
      },
    } satisfies BenchCase,
    {
      name: 'existing-tests/e2e-real-task-layer',
      tool: '*e2e*',
      origin: 'homemade',
      reference: 'tests/e2e real-task tests reference a meaningful subset of tools by name',
      run: async () => {
        const { totalE2eCovered } = coverage();
        return { totalE2eCovered };
      },
      validate: (v) => {
        const b = body(v);
        const e2e = Number(b.totalE2eCovered ?? 0);
        return e2e >= 20
          ? true
          : `e2e real-task layer only touches ${e2e} tools by name — grow tests/e2e or wire task benchmarks (BrowserGym/AndroidWorld)`;
      },
    } satisfies BenchCase,
    {
      name: 'existing-tests/domain-dir-aliasing',
      tool: '*all*',
      origin: 'homemade',
      reference:
        'registry domain name resolves to its source directory, not a same-named path under tests/',
      // Regression: `core` is implemented in `src/server/domains/analysis/` with
      // tests in `tests/server/domains/analysis/`. Keying the asset by the
      // registry name alone scored all 25 core tools as uncovered — a silent
      // 3.4-point undercount that read like a genuine coverage gap.
      run: async () => {
        const { domains } = coverage();
        const core = domains.find((d) => d.domain === 'core');
        return { coreTotal: core?.total ?? 0, coreCovered: core?.covered ?? 0 };
      },
      validate: (v) => {
        const b = body(v);
        const total = Number(b.coreTotal ?? 0);
        const covered = Number(b.coreCovered ?? 0);
        if (total === 0) return 'core domain missing from the coverage matrix';
        const ratio = covered / total;
        return ratio >= 0.5
          ? true
          : `core domain resolves to ${covered}/${total} covered — its tests live in tests/server/domains/analysis/, check the domain→dir mapping`;
      },
    } satisfies BenchCase,
    {
      name: 'existing-tests/nested-test-dirs-scanned',
      tool: '*all*',
      origin: 'homemade',
      reference:
        'handlers tested in nested subdirectories (memory/handlers, coordination/state-board) count',
      // Regression: the scan walked one level below tests/server/domains/<domain>,
      // so the 69 test files in nested dirs were invisible and their tools
      // reported as uncovered.
      run: async () => {
        const { domains } = coverage();
        const pick = (name: string) => domains.find((d) => d.domain === name);
        return {
          coordination: pick('coordination')?.covered ?? 0,
          memory: pick('memory')?.covered ?? 0,
        };
      },
      validate: (v) => {
        const b = body(v);
        // coordination's state-board handlers and memory's handler suite are both
        // nested-only; a one-level scan scores them at 8/12 and 45/75 respectively.
        const coordination = Number(b.coordination ?? 0);
        const memory = Number(b.memory ?? 0);
        if (coordination <= 8) {
          return `coordination covered ${coordination}/12 — nested tests/server/domains/coordination/state-board/ not scanned`;
        }
        if (memory <= 45) {
          return `memory covered ${memory}/75 — nested tests/server/domains/memory/handlers/ not scanned`;
        }
        return true;
      },
    } satisfies BenchCase,
    {
      name: 'existing-tests/tool-inventory-in-sync',
      tool: '*all*',
      origin: 'homemade',
      reference: 'tool-inventory.md totals must match the registry (no generator; hand-maintained)',
      // tool-inventory.md is the human-readable inventory and has no generator,
      // so it drifts silently whenever a tool is added (it sat at 735 while the
      // registry carried 736). Checking it here keeps the doc honest.
      run: async () => {
        const inventoryPath = join(ROOT, 'tests/benchmarks/tool-inventory.md');
        if (!existsSync(inventoryPath)) return { ok: false, detail: 'tool-inventory.md missing' };
        const text = readFileSync(inventoryPath, 'utf8');
        const sections = [...text.matchAll(/^## (\S+) \((\d+)\)$/gm)].map((m) => ({
          domain: m[1]!,
          declared: Number(m[2]!),
        }));
        const declaredTotal = sections.reduce((sum, s) => sum + s.declared, 0);
        const registryByDomain = new Map<string, number>();
        for (const ref of loadToolRefs()) {
          registryByDomain.set(ref.domain, (registryByDomain.get(ref.domain) ?? 0) + 1);
        }
        const drifted = sections
          .filter((s) => s.declared !== (registryByDomain.get(s.domain) ?? 0))
          .map((s) => `${s.domain} ${s.declared}→${registryByDomain.get(s.domain) ?? 0}`);
        const declaredTrailer = Number(text.match(/^TOTAL: (\d+) tools/m)?.[1] ?? 0);
        const registryTotal = [...registryByDomain.values()].reduce((a, b) => a + b, 0);
        return { drift: drifted.join(', '), declaredTotal, declaredTrailer, registryTotal };
      },
      validate: (v) => {
        const b = body(v);
        if (String(b.drift ?? '')) return `per-domain counts drifted: ${b.drift}`;
        const trailer = Number(b.declaredTrailer ?? 0);
        const total = Number(b.registryTotal ?? 0);
        if (Number(b.declaredTotal ?? 0) !== total) {
          return `section headers sum to ${b.declaredTotal}, registry has ${total}`;
        }
        return trailer === total ? true : `TOTAL trailer says ${trailer}, registry has ${total}`;
      },
    } satisfies BenchCase,
    {
      name: 'existing-tests/report-written',
      tool: '*all*',
      origin: 'homemade',
      reference:
        'coverage matrix persisted to artifacts/benchmarks/existing-test-coverage.{md,json}',
      run: async () => ({ report: writeReport().length }),
      validate: (v) => {
        const b = body(v);
        return Number(b.report ?? 0) > 500 ? true : 'report suspiciously small';
      },
    } satisfies BenchCase,
  ],
};

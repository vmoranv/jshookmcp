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

export interface ToolRef {
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

function loadTestAssets(): { unit: Map<string, string>; e2e: string } {
  const unit = new Map<string, string>();
  const domainsTests = join(ROOT, 'tests/server/domains');
  if (existsSync(domainsTests)) {
    for (const domain of readdirSync(domainsTests, { withFileTypes: true })) {
      if (!domain.isDirectory()) continue;
      const dir = join(domainsTests, domain.name);
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.test.ts')) {
          const prev = unit.get(domain.name) ?? '';
          unit.set(domain.name, `${prev}\n${readFileSync(join(dir, f), 'utf8')}`);
        }
      }
    }
  }
  const e2eDir = join(ROOT, 'tests/e2e');
  let e2e = '';
  if (existsSync(e2eDir)) {
    for (const f of readdirSync(e2eDir)) {
      if (f.endsWith('.test.ts')) e2e += `\n${readFileSync(join(e2eDir, f), 'utf8')}`;
    }
  }
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
}

function computeCoverage(): {
  domains: DomainCoverage[];
  totalTools: number;
  totalCovered: number;
  totalE2eCovered: number;
} {
  const toolRefs = loadToolRefs();
  const { unit, e2e } = loadTestAssets();
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
    domains.push({ domain, total: refs.length, covered, uncovered, e2eCovered });
  }
  return { domains, totalTools, totalCovered, totalE2eCovered };
}

let cache: ReturnType<typeof computeCoverage> | null = null;
function coverage(): ReturnType<typeof computeCoverage> {
  if (!cache) cache = computeCoverage();
  return cache;
}

function writeReport(): string {
  const { domains, totalTools, totalCovered, totalE2eCovered } = coverage();
  const lines: string[] = [
    '# Existing Test Asset → Tool Coverage Matrix',
    '',
    `Unit-test coverage: **${totalCovered}/${totalTools}** tools (${totalTools ? ((totalCovered / totalTools) * 100).toFixed(1) : '0'}%) referenced by domain handler tests.`,
    `e2e real-task coverage: **${totalE2eCovered}/${totalTools}** tools invoked by name in tests/e2e.`,
    '',
    '| Domain | Tools | Unit-tested | e2e-touched | Unit % |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const d of domains) {
    lines.push(
      `| ${d.domain} | ${d.total} | ${d.covered} | ${d.e2eCovered} | ${d.total ? ((d.covered / d.total) * 100).toFixed(0) : '0'}% |`,
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
    `${JSON.stringify({ generatedAt: new Date().toISOString(), domains, totalTools, totalCovered, totalE2eCovered }, null, 2)}\n`,
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
        const { totalTools, totalCovered, totalE2eCovered, domains } = coverage();
        return { totalTools, totalCovered, totalE2eCovered, domains };
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

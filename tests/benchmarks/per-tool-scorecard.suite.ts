/**
 * Per-tool scorecard — NATIVE metrics for every registry tool, in each metric's own unit.
 *
 * No letter grades, no single composite score: each layer keeps its own unit because
 * collapsing them loses meaning (retrieval quality is a percentage, latency is time,
 * correctness is vectors-passed/total, coverage is a fraction executed).
 *
 * Columns (all measured, "—" when a layer has no measurement yet):
 *   correctness  x/y vectors   — deterministic vector-bench cases actually executed & passed
 *   throughput   µs/call       — wall time of those executed cases (measured, not modeled)
 *   handler-fn   %             — V8 function-level coverage: bound handler functions executed
 *                               in a real `vitest --coverage` run (pnpm bench:coverage)
 *   e2e-tasks    count         — real-task e2e files that passed while invoking the tool
 *                               (pnpm bench:e2e → artifacts/benchmarks/e2e-results.json)
 *   retrieval    MRR@10/P@1    — live evaluation on the search-quality query set
 *                               (tests/server/benchmarks/retrieval-metrics.test.ts)
 *
 * Output: artifacts/benchmarks/per-tool-scorecard.{md,json}
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchSuite, body, type BenchSuite } from './harness';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COVERAGE_FILE = join(ROOT, 'coverage', 'coverage-final.json');
const E2E_RESULTS_FILE = join(ROOT, 'artifacts/benchmarks/e2e-results.json');
const RETRIEVAL_FILE = join(ROOT, 'artifacts/benchmarks/retrieval-metrics.json');

const DOMAIN_ENVIRONMENT: Record<string, string> = {
  'adb-bridge': 'device/emulator',
  'binary-instrument': 'offline core · jadx/ghidra/frida/unidbg optional',
  browser: 'live browser (CDP)',
  canvas: 'live browser (canvas/WebGL)',
  coordination: 'offline',
  core: 'offline',
  'cross-domain': 'offline',
  'dart-inspector': 'offline parse · arm64 emulation optional',
  debugger: 'live browser (CDP)',
  encoding: 'offline',
  'exploit-dev': 'offline · target binary for gadget paths',
  'extension-registry': 'offline',
  graphql: 'live graphql target (local server ok)',
  instrumentation: 'offline core · live browser for capture',
  maintenance: 'offline',
  memory: 'offline pure-TS · live Win32 for scanning',
  'mojo-ipc': 'offline codec · live Chromium for capture',
  'native-bridge': 'external backend (Ghidra/IDA/Rizin/BN)',
  'native-emulator': 'offline decode · arm64 fixtures for execution',
  network: 'offline frames/fingerprints · live sockets for probes',
  platform: 'offline',
  process: 'offline static scans · admin for native ops',
  'protocol-analysis': 'offline',
  proxy: 'loopback target',
  session: 'offline',
  sourcemap: 'offline',
  streaming: 'live browser (streams)',
  'syscall-hook': 'live Linux (root/bpftrace)',
  tasks: 'offline',
  'tls-inspector': 'offline parse/keylog · live sockets for sessions',
  trace: 'offline (sqlite) · debugger session to record',
  transform: 'offline',
  'v8-inspector': 'live browser (CDP)',
  wasm: 'offline core · wabt/wasmtime optional',
  webgpu: 'live browser (WebGPU)',
  workflow: 'offline',
};

interface ToolMetrics {
  tool: string;
  domain: string;
  correctness: string; // "14/14 vectors" or "—"
  throughput: string; // "1.2ms/call" or "—"
  handlerFn: string; // "100%" or "not measured"
  e2eTasks: string; // "3 tasks" or "not measured"
  retrieval: string; // "MRR@10 78.4% / P@1 64.7%" (engine-level) or "—"
  evaluation: string;
}

interface CoverageMeta {
  available: boolean;
  fnHit: Map<string, number>;
  fnTotal: Map<string, number>;
  instrumentedDomains: Set<string>;
}

function loadCoverageMeta(): CoverageMeta {
  const fnHit = new Map<string, number>();
  const fnTotal = new Map<string, number>();
  const instrumentedDomains = new Set<string>();
  if (!existsSync(COVERAGE_FILE)) return { available: false, fnHit, fnTotal, instrumentedDomains };
  const raw = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8')) as Record<
    string,
    { fnMap?: Record<string, { name?: string }>; f?: Record<string, number> }
  >;
  for (const [fileKey, entry] of Object.entries(raw)) {
    const domainMatch = fileKey.match(/src[/\\]server[/\\]domains[/\\]([a-z0-9-]+)[/\\]/);
    const fnMap = entry.fnMap ?? {};
    const f = entry.f ?? {};
    if (domainMatch && Object.values(fnMap).some((fn) => (fn.name ?? '').startsWith('handle'))) {
      instrumentedDomains.add(domainMatch[1]!);
    }
    for (const [fnId, fn] of Object.entries(fnMap)) {
      const name = fn.name ?? '';
      if (!name) continue;
      fnTotal.set(name, (fnTotal.get(name) ?? 0) + 1);
      if ((f[fnId] ?? 0) > 0) fnHit.set(name, (fnHit.get(name) ?? 0) + 1);
    }
  }
  return { available: true, fnHit, fnTotal, instrumentedDomains };
}

interface ExecStats {
  passed: number;
  total: number;
  totalMs: number;
}

/**
 * RE-EXECUTE every vector-bench suite — the correctness and throughput columns are
 * measured fresh on this run, never carried over from a previous report.
 */
async function measureVectorBenches(): Promise<Map<string, ExecStats>> {
  const stats = new Map<string, ExecStats>();
  for (const suite of depthSuites) {
    if (suite.name === 'existing-tests-coverage' || suite.name === 'per-tool-scorecard') continue;
    const result = await runBenchSuite(suite);
    for (const c of result.cases) {
      if (c.tool.startsWith('*')) continue;
      const cur = stats.get(c.tool) ?? { passed: 0, total: 0, totalMs: 0 };
      cur.total += 1;
      if (c.status === 'pass') cur.passed += 1;
      cur.totalMs += c.ms;
      stats.set(c.tool, cur);
    }
  }
  return stats;
}

let vectorStatsCache = new Map<string, ExecStats>();
let cache: ToolMetrics[] | null = null;
let depthSuites: readonly BenchSuite[] = [];

async function refreshMeasurements(suites: readonly BenchSuite[]): Promise<void> {
  depthSuites = suites;
  vectorStatsCache = await measureVectorBenches();
  cache = null;
}

interface Loaders {
  cov: CoverageMeta;
  e2eByTool: Map<string, number>;
  e2eAvailable: boolean;
  retrieval: { mrrAt10: number; pAt1: number } | null;
  methodMap: Map<string, string[]>;
}

const RETRIEVAL_TOOLS = new Set([
  'tool_search',
  'search_tools',
  'cross_domain_synonym',
  'workflow_suggest',
]);

function loadE2eCoverage(): { byTool: Map<string, number>; available: boolean } {
  const byTool = new Map<string, number>();
  if (!existsSync(E2E_RESULTS_FILE)) return { byTool, available: false };
  try {
    // toolFileCounts is produced by the real e2e run (bench:e2e): files whose real-task
    // pass-rate ≥90% count as measured; each tool carries the count of measured files
    // that exercise it.
    const parsed = JSON.parse(readFileSync(E2E_RESULTS_FILE, 'utf8')) as {
      toolFileCounts?: Record<string, number>;
    };
    for (const [tool, count] of Object.entries(parsed.toolFileCounts ?? {})) {
      byTool.set(tool, count);
    }
    return { byTool, available: Object.keys(parsed.toolFileCounts ?? {}).length > 0 };
  } catch {
    return { byTool, available: false };
  }
}

function loadRetrievalMetrics(): { mrrAt10: number; pAt1: number } | null {
  if (!existsSync(RETRIEVAL_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(RETRIEVAL_FILE, 'utf8')) as {
      mrrAt10?: number;
      pAt1?: number;
    };
    return typeof parsed.mrrAt10 === 'number'
      ? { mrrAt10: parsed.mrrAt10, pAt1: parsed.pAt1 ?? 0 }
      : null;
  } catch {
    return null;
  }
}

function loadRegistryToolRefs(): Array<{ tool: string; domain: string }> {
  const domainsText = readFileSync(
    join(ROOT, 'src/server/registry/generated-tool-domains.ts'),
    'utf8',
  );
  const mapRe = /([a-z0-9_]+):\s*'([a-z0-9-]+)'/g;
  const all: Array<{ tool: string; domain: string }> = [];
  for (const m of domainsText.matchAll(mapRe)) all.push({ tool: m[1]!, domain: m[2]! });
  return all;
}

function loadMethodMap(): Map<string, string[]> {
  const methodMap = new Map<string, string[]>();
  const domainsDir = join(ROOT, 'src/server/domains');
  if (!existsSync(domainsDir)) return methodMap;
  const add = (tool: string, method: string): void => {
    const methods = methodMap.get(tool) ?? [];
    if (!methods.includes(method)) methods.push(method);
    methodMap.set(tool, methods);
  };
  const pairRe = /tool:\s*'([^']+)'[\s\S]{0,120}?method:\s*'([^']+)'/g;
  const bindRe =
    /tool:\s*toolByName\('([^']+)'\)[\s\S]{0,200}?bind:\s*bindByKey\(\(h,\s*a\)\s*=>\s*h\.(\w+)\(a\)\)/g;
  const tBindRe = /t\('([a-z0-9_]+)'\)[\s\S]{0,400}?bind:\s*b\(\(h,\s*a\)\s*=>\s*h\.(\w+)\(a\)\)/g;
  for (const domain of readdirSync(domainsDir)) {
    const manifestPath = join(domainsDir, domain, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    const text = readFileSync(manifestPath, 'utf8');
    for (const m of text.matchAll(pairRe)) add(m[1]!, m[2]!);
    for (const m of text.matchAll(bindRe)) add(m[1]!, m[2]!);
    for (const m of text.matchAll(tBindRe)) add(m[1]!, m[2]!);
  }
  return methodMap;
}

function summarizeTool(
  tool: string,
  domain: string,
  loaders: Loaders,
  exec: ExecStats | undefined,
): ToolMetrics {
  const methods = loaders.methodMap.get(tool) ?? [];

  const correctness = exec && exec.total > 0 ? `${exec.passed}/${exec.total} vectors` : '—';
  let throughput = '—';
  if (exec && exec.passed > 0 && exec.totalMs > 0) {
    const usPerCall = (exec.totalMs / exec.passed) * 1000;
    throughput =
      usPerCall >= 1000
        ? `${(usPerCall / 1000).toFixed(1)}ms/call`
        : `${usPerCall.toFixed(0)}µs/call`;
  }

  const handlerFn = summarizeHandlerFn(loaders.cov, domain, methods);
  const e2eCount = loaders.e2eByTool.get(tool) ?? 0;
  const e2eTasks = loaders.e2eAvailable
    ? `${e2eCount} task${e2eCount === 1 ? '' : 's'}`
    : 'not measured';
  const retrievalStr =
    loaders.retrieval && RETRIEVAL_TOOLS.has(tool)
      ? `MRR@10 ${(loaders.retrieval.mrrAt10 * 100).toFixed(1)}% / P@1 ${(loaders.retrieval.pAt1 * 100).toFixed(1)}% (engine-level)`
      : '—';

  const missing: string[] = [];
  if (!exec) missing.push('no vector case');
  if (handlerFn === 'not measured') missing.push('coverage not measured (pnpm bench:coverage)');
  if (handlerFn === 'no manifest binding') missing.push('inline binding (method not extractable)');
  if (!loaders.e2eAvailable) missing.push('e2e not measured (pnpm bench:e2e)');

  return {
    tool,
    domain,
    correctness,
    throughput,
    handlerFn,
    e2eTasks,
    retrieval: retrievalStr,
    evaluation: missing.length === 0 ? 'all layers measured' : `missing: ${missing.join('; ')}`,
  };
}

function summarizeHandlerFn(cov: CoverageMeta, domain: string, methods: string[]): string {
  if (!cov.available) return 'not measured';
  if (methods.length === 0) return 'no manifest binding';
  let hit = 0;
  let total = 0;
  for (const m of methods) {
    hit += cov.fnHit.get(m) ?? 0;
    total += cov.fnTotal.get(m) ?? 0;
  }
  if (total > 0) return `${Math.round((hit / total) * 100)}%`;
  if (hit > 0) return '100%';
  if (!cov.instrumentedDomains.has(domain)) return 'excluded (env-gated file not instrumented)';
  return '0% (fns not found in coverage)';
}

function perToolMetrics(): ToolMetrics[] {
  if (cache) return cache;
  const loaders: Loaders = {
    cov: loadCoverageMeta(),
    e2eByTool: new Map(),
    e2eAvailable: false,
    retrieval: loadRetrievalMetrics(),
    methodMap: loadMethodMap(),
  };
  const e2e = loadE2eCoverage();
  loaders.e2eByTool = e2e.byTool;
  loaders.e2eAvailable = e2e.available;

  const metrics = loadRegistryToolRefs().map(({ tool, domain }) =>
    summarizeTool(tool, domain, loaders, vectorStatsCache.get(tool)),
  );
  cache = metrics;
  return metrics;
}

function renderPerToolScorecard(): { md: string; stats: Record<string, number> } {
  const metrics = perToolMetrics();
  const withVectors = metrics.filter((m) => m.correctness !== '—').length;
  const withCoverage = metrics.filter(
    (m) => m.handlerFn.endsWith('%') || m.handlerFn.startsWith('excluded'),
  ).length;
  const withE2e = metrics.filter(
    (m) => m.e2eTasks !== 'not measured' && m.e2eTasks !== '0 tasks',
  ).length;
  const fullyMeasured = metrics.filter((m) => m.evaluation === 'all layers measured').length;

  const lines: string[] = [
    '# Per-Tool Benchmark Scorecard — native metrics (736 tools)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'No composite score, no letter grades: every column keeps its native unit.',
    '',
    `Vector-bench measured: **${withVectors}** tools · handler coverage measured: **${withCoverage}** · e2e real tasks: **${withE2e}** tools · fully measured: **${fullyMeasured}**`,
    '',
  ];
  const byDomain = new Map<string, ToolMetrics[]>();
  for (const m of metrics) {
    const list = byDomain.get(m.domain) ?? [];
    list.push(m);
    byDomain.set(m.domain, list);
  }
  for (const [domain, list] of [...byDomain.entries()].toSorted()) {
    lines.push(
      `## ${domain} (${list.length} tools · env: ${DOMAIN_ENVIRONMENT[domain] ?? 'offline'})`,
    );
    lines.push('');
    lines.push(
      '| Tool | Correctness | Throughput | Handler-fn | e2e tasks | Retrieval | Missing |',
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const m of [...list].toSorted((a, b) => a.tool.localeCompare(b.tool))) {
      lines.push(
        `| ${m.tool} | ${m.correctness} | ${m.throughput} | ${m.handlerFn} | ${m.e2eTasks} | ${m.retrieval} | ${m.evaluation === 'all layers measured' ? '' : m.evaluation.replace('missing: ', '')} |`,
      );
    }
    lines.push('');
  }
  return {
    md: lines.join('\n'),
    stats: { total: metrics.length, withVectors, withCoverage, withE2e, fullyMeasured },
  };
}

export function createPerToolScorecardSuite(allSuites: readonly BenchSuite[]): BenchSuite {
  depthSuites = allSuites;
  return {
    name: 'per-tool-scorecard',
    domain: '*all*',
    description:
      'Native-unit metrics for every registry tool (correctness/throughput/coverage/e2e/retrieval)',
    cases: [
      {
        name: 'per-tool/complete-coverage',
        tool: '*all*',
        origin: 'homemade',
        reference: 'registry 736 tools × native-metric columns',
        run: async () => {
          await refreshMeasurements(depthSuites);
          const metrics = perToolMetrics();
          const depthTools = new Set(
            depthSuites
              .flatMap((s) => s.cases.map((c) => c.tool))
              .filter((t) => !t.startsWith('*')),
          );
          const registry = new Set(metrics.map((m) => m.tool));
          const orphans = [...depthTools].filter((t) => !registry.has(t));
          return { total: metrics.length, orphans };
        },
        validate: (v) => {
          const b = body(v);
          const total = Number(b.total ?? 0);
          if (total !== 736) return `expected exactly 736 scored tools, got ${total}`;
          const orphans = (b.orphans ?? []) as string[];
          return orphans.length === 0
            ? true
            : `benchmark suites reference tools absent from the registry: ${orphans.join(', ')}`;
        },
      },
      {
        name: 'per-tool/layers-actually-measured',
        tool: '*all*',
        origin: 'homemade',
        reference: 'coverage + e2e + retrieval layers must come from real runs, not static guesses',
        // These three artefacts come from separate benchmark runs, not from
        // `pnpm test`. Demanding them on a plain local run makes `pnpm test`
        // fail for anyone who has not run `bench:coverage` / `bench:e2e`
        // first, which is most contributors. CI always produces them, so the
        // gate stays strict there — locally it degrades to "not measured"
        // instead of "failed".
        skip: () =>
          !process.env.CI &&
          !/^(1|true)$/i.test(String(process.env.COVERAGE_FULL ?? '')) &&
          !(
            existsSync(COVERAGE_FILE) &&
            existsSync(E2E_RESULTS_FILE) &&
            existsSync(RETRIEVAL_FILE)
          ),
        skipReason:
          'bench artefacts absent (coverage/e2e/retrieval) — run pnpm bench:coverage, bench:e2e first; CI enforces this',
        run: async () => {
          const cov = loadCoverageMeta();
          return {
            coverageMeasured: cov.available,
            e2eMeasured: existsSync(E2E_RESULTS_FILE),
            retrievalMeasured: existsSync(RETRIEVAL_FILE),
            vectorBenchTools: perToolMetrics().filter((m) => m.correctness !== '—').length,
          };
        },
        validate: (v) => {
          const b = body(v);
          if (b.coverageMeasured !== true) {
            // The coverage-gate run (COVERAGE_FULL=true) empties the coverage directory at
            // startup and writes coverage-final.json when it finishes — during such a run
            // the file is being (re)generated by this very process, which is measurement,
            // not a missing measurement.
            if (/^(1|true)$/i.test(String(process.env.COVERAGE_FULL ?? ''))) return true;
            return 'coverage/coverage-final.json missing — run `pnpm bench:coverage` (unit layer must be measured, never guessed)';
          }
          if (b.e2eMeasured !== true)
            return 'e2e-results.json missing — run `pnpm bench:e2e` (task layer must be measured)';
          if (b.retrievalMeasured !== true)
            return 'retrieval-metrics.json missing — run the retrieval benchmark (native % metrics)';
          return true;
        },
      },
      {
        name: 'per-tool/scorecard-written',
        tool: '*all*',
        origin: 'homemade',
        reference:
          '736-row native-metric scorecard persisted to artifacts/benchmarks/per-tool-scorecard.{md,json}',
        run: async () => {
          const { md, stats } = renderPerToolScorecard();
          const outDir = join(ROOT, 'artifacts/benchmarks');
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, 'per-tool-scorecard.md'), `${md}\n`);
          writeFileSync(
            join(outDir, 'per-tool-scorecard.json'),
            `${JSON.stringify({ generatedAt: new Date().toISOString(), stats, tools: perToolMetrics() }, null, 2)}\n`,
          );
          return { rows: (md.match(/^\| [a-z]/gm) ?? []).length, stats };
        },
        validate: (v) => {
          const b = body(v);
          const rows = Number(b.rows ?? 0);
          if (rows < 736) return `scorecard has ${rows} tool rows, expected 736`;
          const stats = b.stats as Record<string, number> | undefined;
          if (!stats || Number(stats.total ?? 0) !== 736) return 'stats block missing/incorrect';
          return true;
        },
      },
    ],
  };
}

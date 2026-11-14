/**
 * Per-tool scorecard — NATIVE metrics for every registry tool, in each metric's own unit.
 *
 * No letter grades, no single composite score: each layer keeps its own unit because
 * collapsing them loses meaning (retrieval quality is a percentage, latency is time,
 * correctness is vectors-passed/total, coverage is a fraction executed).
 *
 * Columns (all measured, "—" when a layer has no measurement yet):
 *   correctness  x/y vectors   — deterministic vector-bench cases actually executed & passed.
 *                               Env-gated `skipped` cases are excluded: a skip is not a
 *                               measurement (same accounting as suite-level scoring).
 *                               Stats are derived from the gate run's already-collected
 *                               results — suites are NOT re-executed here (re-executing
 *                               dirtied module-level-state suites and doubled gate time).
 *   throughput   µs/call       — wall time of those executed cases (measured, not modeled)
 *   handler-fn   %             — V8 function-level coverage: bound handler functions executed
 *                               in a real `vitest --coverage` run (pnpm bench:coverage)
 *   e2e-tasks    count         — real-task e2e files that passed while invoking the tool
 *                               (pnpm bench:e2e → artifacts/benchmarks/e2e-results.json)
 *   retrieval    MRR / best rank — PER-TOOL evidence from the search-quality
 *                               query set (tests/server/benchmarks/retrieval-metrics.test.ts
 *                               → artifacts/benchmarks/retrieval-per-tool.json).
 *                               The engine-wide aggregate describes the search
 *                               layer, not any single tool, so it is never copied
 *                               onto a tool row.
 *
 * Output: artifacts/benchmarks/per-tool-scorecard.{md,json}
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { body, type BenchSuite, type BenchSuiteResult } from './harness';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COVERAGE_FILE = join(ROOT, 'coverage', 'coverage-final.json');
const E2E_RESULTS_FILE = join(ROOT, 'artifacts/benchmarks/e2e-results.json');
const RETRIEVAL_FILE = join(ROOT, 'artifacts/benchmarks/retrieval-metrics.json');

// Preferred per-tool evidence source: the registry-corpus benchmark (736
// tools, real descriptions + expansion). Falls back to the legacy
// search-quality evidence (114 tools, proxy corpus) when the registry run
// has not been executed yet.
const RETRIEVAL_PER_TOOL_EVIDENCE_FILE = join(
  ROOT,
  'artifacts/benchmarks/registry-retrieval-per-tool.json',
);
const LEGACY_RETRIEVAL_PER_TOOL_EVIDENCE_FILE = join(
  ROOT,
  'artifacts/benchmarks/retrieval-per-tool.json',
);

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

export interface CoverageMeta {
  available: boolean;
  fnHit: Map<string, number>;
  fnTotal: Map<string, number>;
  instrumentedDomains: Set<string>;
  /**
   * Position index for the instrumented domain files, keyed by
   * `<domain>/<rel path>` (forward slashes) then by fn decl start line.
   *
   * Needed because V8 does not name every handler: a class-property arrow
   * (`handleX = (args) => …`) is recorded in fnMap as `(anonymous_N)` — not
   * as `handleX` — so the name-keyed maps cannot see it. Its `decl.start.line`
   * is still the property's own source line (measured: network
   * handlers.impl.ts line 126 `handleConsoleBuffersDispatch` ↔ fnMap
   * `(anonymous_20)` at line 126), which makes file+line a stable secondary
   * key. Values aggregate hit/total of every fn declared on that line.
   */
  fnsByPos: Map<string, Map<number, { hit: number; total: number }>>;
}

function loadCoverageMeta(): CoverageMeta {
  const fnHit = new Map<string, number>();
  const fnTotal = new Map<string, number>();
  const instrumentedDomains = new Set<string>();
  const fnsByPos = new Map<string, Map<number, { hit: number; total: number }>>();
  if (!existsSync(COVERAGE_FILE))
    return { available: false, fnHit, fnTotal, instrumentedDomains, fnsByPos };
  const raw = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8')) as Record<
    string,
    {
      fnMap?: Record<string, { name?: string; decl?: { start?: { line?: number } } }>;
      f?: Record<string, number>;
    }
  >;
  const domainPathRe = /src[/\\]server[/\\]domains[/\\]([a-z0-9-]+)[/\\](.+)$/;
  for (const [fileKey, entry] of Object.entries(raw)) {
    const domainMatch = fileKey.match(/src[/\\]server[/\\]domains[/\\]([a-z0-9-]+)[/\\]/);
    const fnMap = entry.fnMap ?? {};
    const f = entry.f ?? {};
    if (domainMatch && Object.values(fnMap).some((fn) => (fn.name ?? '').startsWith('handle'))) {
      instrumentedDomains.add(domainMatch[1]!);
    }
    const pathMatch = fileKey.match(domainPathRe);
    if (pathMatch) {
      // Checkout-independent key: the coverage run's absolute prefix (its own
      // clone path) is dropped; `<domain>/<rel>` matches this checkout's tree.
      const relKey = `${pathMatch[1]}/${pathMatch[2]!.replace(/\\/g, '/')}`;
      let byLine = fnsByPos.get(relKey);
      if (!byLine) {
        byLine = new Map();
        fnsByPos.set(relKey, byLine);
      }
      for (const [fnId, fn] of Object.entries(fnMap)) {
        const line = fn.decl?.start?.line;
        if (line === undefined) continue;
        const cur = byLine.get(line) ?? { hit: 0, total: 0 };
        cur.total += 1;
        if ((f[fnId] ?? 0) > 0) cur.hit += 1;
        byLine.set(line, cur);
      }
    }
    for (const [fnId, fn] of Object.entries(fnMap)) {
      const name = fn.name ?? '';
      if (!name) continue;
      fnTotal.set(name, (fnTotal.get(name) ?? 0) + 1);
      if ((f[fnId] ?? 0) > 0) fnHit.set(name, (fnHit.get(name) ?? 0) + 1);
    }
  }
  return { available: true, fnHit, fnTotal, instrumentedDomains, fnsByPos };
}

export interface ExecStats {
  passed: number;
  total: number;
  totalMs: number;
  /** Env-gated cases skipped locally — tracked for the Missing note, NEVER counted into `total`. */
  skipped: number;
}

/** Suites whose cases must not feed the per-tool correctness/throughput columns. */
const STATS_EXCLUDED_SUITES: ReadonlySet<string> = new Set([
  'existing-tests-coverage',
  'per-tool-scorecard',
]);

/**
 * Derive per-tool correctness/throughput stats from ALREADY-RUN gate results.
 *
 * The gate loop (tests/server/benchmarks/tools-benchmark.test.ts) executes every
 * suite exactly once and collects BenchSuiteResults; this function is a pure
 * reduction over them. Two accounting rules, both locked by
 * tests/server/benchmarks/per-tool-scorecard.stats.test.ts:
 *   - `skipped` cases are excluded from `total` — a skip is not a measurement
 *     (suite-level scoring has always excluded them; the per-tool layer used to
 *     disagree, showing "0/1 vectors" for tools whose only cases are env-gated).
 *   - suites are not re-executed — the previous `measureVectorBenches` re-run
 *     dirtied module-level-state suites (session ledger singleton, tls tmpdir
 *     fixtures), which both reported false per-tool failures on the second pass
 *     and added ~42s to every `pnpm bench:tools`.
 */
export function statsFromSuiteResults(
  results: readonly BenchSuiteResult[],
): Map<string, ExecStats> {
  const stats = new Map<string, ExecStats>();
  for (const result of results) {
    if (STATS_EXCLUDED_SUITES.has(result.suite)) continue;
    for (const c of result.cases) {
      if (c.tool.startsWith('*')) continue;
      const cur = stats.get(c.tool) ?? { passed: 0, total: 0, totalMs: 0, skipped: 0 };
      if (c.status === 'skipped') {
        cur.skipped += 1;
      } else {
        cur.total += 1;
        if (c.status === 'pass') cur.passed += 1;
        cur.totalMs += c.ms;
      }
      stats.set(c.tool, cur);
    }
  }
  return stats;
}

let vectorStatsCache = new Map<string, ExecStats>();
let cache: ToolMetrics[] | null = null;
let depthSuites: readonly BenchSuite[] = [];
let getGateResults: () => readonly BenchSuiteResult[] = () => [];

function refreshMeasurements(): void {
  vectorStatsCache = statsFromSuiteResults(getGateResults());
  cache = null;
}

interface Loaders {
  cov: CoverageMeta;
  e2eByTool: Map<string, number>;
  e2eAvailable: boolean;
  retrieval: { mrrAt10: number; pAt1: number } | null;
  perToolEvidence: Record<string, PerToolRetrievalEvidence> | null;
  methodMap: Map<string, string[]>;
}

interface PerToolRetrievalEvidence {
  queries: number;
  hitAt3: number;
  hitAt10: number;
  bestRank: number | null;
  mrr: number;
}

function loadPerToolRetrievalEvidence(): Record<string, PerToolRetrievalEvidence> | null {
  // Registry-corpus evidence first (736 tools, real descriptions); fall back
  // to the legacy search-quality evidence when the registry run has not been
  // executed in this checkout yet.
  for (const file of [RETRIEVAL_PER_TOOL_EVIDENCE_FILE, LEGACY_RETRIEVAL_PER_TOOL_EVIDENCE_FILE]) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, PerToolRetrievalEvidence>;
    } catch {
      // try the next source
    }
  }
  return null;
}

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

/** A `handle*` function's definition site, in coverage-index coordinates. */
export interface MethodSite {
  fileRel: string; // `<domain>/<rel path>`, forward slashes — matches fnsByPos keys
  line: number; // 1-based decl line in the source file
}

const DOMAIN_DIR = join(ROOT, 'src/server/domains');

/**
 * Matches a `handle*` DEFINITION line only — anchored at line start with the
 * declaration modifiers accepted (`export async function handleX(`,
 * `async handleX(args…)`, `handleX = (args) => …`), so call sites
 * (`this.handleX(…)`, `return f(handleX)`) never match. Definition lines are
 * exactly the positions the coverage fn-map records via `decl.start`.
 */
const HANDLE_DEF_LINE_RE =
  /^[ \t]*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+)*(?:async\s+)*(?:get\s+|set\s+)?(?:function\s+)?(handle[A-Za-z0-9_]+)\s*(?:=|\()/;

const methodSiteCache = new Map<string, Map<string, MethodSite[]>>();

/**
 * Locate every `handle*` definition in a domain's source tree, lazily and
 * cached per domain. This is the bridge between a manifest binding name and
 * the position key the coverage fn-map uses for nameless arrow-property
 * handlers. Excluded from the domain tree: nothing — `.d.ts` has no bodies and
 * src/ carries no tests, so every .ts file is a candidate.
 */
function domainMethodSites(domain: string): Map<string, MethodSite[]> {
  const cached = methodSiteCache.get(domain);
  if (cached) return cached;
  const sites = new Map<string, MethodSite[]>();
  const dir = join(DOMAIN_DIR, domain);
  if (existsSync(dir)) {
    for (const dirent of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!dirent.isFile() || !dirent.name.endsWith('.ts') || dirent.name.endsWith('.d.ts')) {
        continue;
      }
      const parent = dirent.parentPath ?? '';
      // parentPath is absolute on Node ≥22 (relative on 20.x) — normalize to
      // a path relative to the domain dir, then to forward slashes. The key
      // shape must equal loadCoverageMeta's fnsByPos keys:
      // `<domain>/<rel path with forward slashes>`.
      const relParent = (parent.startsWith(dir) ? parent.slice(dir.length) : parent).replace(
        /\\/g,
        '/',
      );
      const fileRel = [relParent.replace(/^\//, ''), dirent.name]
        .filter((part) => part !== '')
        .join('/');
      const fileRelKey = `${domain}/${fileRel}`;
      const text = readFileSync(join(dir, relParent, dirent.name), 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(HANDLE_DEF_LINE_RE);
        if (!m) continue;
        const list = sites.get(m[1]!) ?? [];
        list.push({ fileRel: fileRelKey, line: i + 1 });
        sites.set(m[1]!, list);
      }
    }
  }
  methodSiteCache.set(domain, sites);
  return sites;
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
  const retrievalEvidence = loaders.perToolEvidence;
  const perTool = retrievalEvidence?.[tool];
  const retrievalStr = perTool
    ? `MRR ${(perTool.mrr * 100).toFixed(1)}% · ${perTool.queries}q · best@${perTool.bestRank ?? '—'} · hit@3 ${perTool.hitAt3}/${perTool.queries}`
    : '—';

  const missing: string[] = [];
  if (!exec) missing.push('no vector case');
  else if (exec.total === 0 && exec.skipped > 0)
    missing.push(`all ${exec.skipped} vector case(s) skipped in this env — not measurements`);
  else if (exec.skipped > 0) missing.push(`${exec.skipped} vector case(s) skipped in this env`);
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

/**
 * Handler-fn coverage for one tool's bound methods, in resolution order:
 *
 *   1. exact fn-map name           — named methods (`handleX(…) { … }`), the
 *                                    historical path, numbers unchanged;
 *   2. decl-position (arrow fn)    — class-property arrows carry no fn-map
 *                                    name (`(anonymous_N)`), but their decl
 *                                    line is the property's source line, so
 *                                    file+line resolves them;
 *   3. delegate name (`XTool`→`X`) — facade bindings whose own file is NOT in
 *                                    coverage (explicitly excluded as
 *                                    env-gated) mapping to their same-named
 *                                    minus-suffix delegate in an instrumented
 *                                    file;
 *   4. excluded-domain short-circuit — a domain with no `handle*` fn-map
 *                                    entries at all stays "excluded", whatever
 *                                    the fallbacks could theoretically find.
 *
 * Steps 2–3 only run after 1 found nothing, so every previously-reported
 * percentage is untouched; only "unmapped" rows can gain values, from real
 * measured functions.
 *
 * `resolveSites` is injectable for unit tests; production uses the source-tree
 * scan (`domainMethodSites`).
 */
export function summarizeHandlerFn(
  cov: CoverageMeta,
  domain: string,
  methods: string[],
  resolveSites: (domain: string) => Map<string, MethodSite[]> = domainMethodSites,
): string {
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
  let fbHit = 0;
  let fbTotal = 0;
  let resolved = 0;
  const uncoveredFiles: string[] = [];
  const noSiteFound: string[] = [];
  const allSites = resolveSites(domain);
  for (const m of methods) {
    let done = false;
    for (const site of allSites.get(m) ?? []) {
      const fn = cov.fnsByPos.get(site.fileRel)?.get(site.line);
      if (fn) {
        fbHit += fn.hit;
        fbTotal += fn.total;
        resolved += 1;
        done = true;
        break;
      }
    }
    if (done) continue;
    if (m.endsWith('Tool')) {
      const stripped = m.slice(0, -'Tool'.length);
      if ((cov.fnTotal.get(stripped) ?? 0) > 0 || (cov.fnHit.get(stripped) ?? 0) > 0) {
        fbHit += cov.fnHit.get(stripped) ?? 0;
        fbTotal += cov.fnTotal.get(stripped) ?? 0;
        resolved += 1;
        continue;
      }
    }
    const sites = allSites.get(m) ?? [];
    if (sites.length > 0) uncoveredFiles.push(`${sites[0]!.fileRel}:${sites[0]!.line}`);
    else noSiteFound.push(m);
  }
  if (resolved > 0) {
    if (fbTotal > 0) return `${Math.round((fbHit / fbTotal) * 100)}%`;
    return '100%';
  }
  if (uncoveredFiles.length > 0) {
    // The bound handler exists but its file is absent from the coverage run
    // (explicitly coverage-excluded as env-gated — raw sockets, native FFI —
    // or a barrel-only index.ts). A real mapping gap, NOT a proven-never-
    // executed handler; rendering "0%" would contradict the correctness
    // column for several of these tools. Name the file so the gap is auditable.
    return `unmapped (handler fn defined in ${uncoveredFiles[0]!} — file absent from coverage fn-map)`;
  }
  // The domain file IS instrumented but none of the tool's bound method names
  // appear in its fn-map and no definition site resolved — report the mapping
  // gap honestly instead of inventing a number.
  return 'unmapped (handler fns absent from coverage fn-map)';
}

function perToolMetrics(): ToolMetrics[] {
  if (cache) return cache;
  const loaders: Loaders = {
    cov: loadCoverageMeta(),
    e2eByTool: new Map(),
    e2eAvailable: false,
    retrieval: loadRetrievalMetrics(),
    perToolEvidence: loadPerToolRetrievalEvidence(),
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

/**
 * @param allSuites the gate's full suite list — used for the orphan check
 *   (benchmark cases referencing tools absent from the registry).
 * @param gateResults accessor for the gate loop's already-collected first-run
 *   results. The per-tool suite runs LAST in the gate, so by the time its cases
 *   execute the array holds every other suite's result. Passing them in here is
 *   what removed the double execution — see `statsFromSuiteResults`.
 */
export function createPerToolScorecardSuite(
  allSuites: readonly BenchSuite[],
  gateResults: () => readonly BenchSuiteResult[],
): BenchSuite {
  depthSuites = allSuites;
  getGateResults = gateResults;
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
          refreshMeasurements();
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

/**
 * Search parameter tuning — single self-contained script.
 *
 * Two modes:
 *   Orchestrator (default): generates trial param combinations, spawns worker
 *     processes with SEARCH_* env vars, collects results, applies best to .env.
 *   Worker (--worker):  env vars already set by orchestrator → imports search
 *     engine (constants.ts reads env at module load) → runs eval cases → JSON
 *     output on stdout.
 *
 * Each trial runs as a **separate process** so that `export const` values in
 * constants.ts are re-evaluated from process.env on every trial.
 *
 * Usage:
 *   npx tsx scripts/search-tune/optimize.ts [--seed 42] [--phase1-trials 800] [--dataset fixture|realtime]
 *   --dataset fixture  (default) phases evaluate against the synthetic fixture
 *                      (phase 1/2 lexical cases, phase 3 profile-tier, phase 4
 *                      rerank-state).
 *   --dataset realtime phases 1-4 all evaluate against real traffic history
 *                      persisted at ~/.jshookmcp/state/search-quality.json
 *                      (records with usedTool+usedToolRank only). Fails fast
 *                      if no usable records have accumulated yet.
 *   --regularization N (default 0.01) λ for the objective penalty
 *                      Σ|param−default|/(max−min) — 0 disables.
 *   --no-prune         disable freezing low-sensitivity params to shipped
 *                      defaults after phase 1 (pruner).
 *   --vector           enable the dense-vector signal in every worker
 *                      (SEARCH_VECTOR_ENABLED=true) and include the two
 *                      vector-scoring params in phase-1 sampling. Without it,
 *                      workers run vectorEnabled=false and the vector params
 *                      are excluded — sampling them in a lexical run fits
 *                      noise on a dead dimension.
 *   --dry-run          run the full pipeline but do NOT write .env.
 */
import { execFile } from 'node:child_process';
import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import {
  loadSearchSpace,
  getPhaseParams,
  sampleRandomParams,
  buildLocalRefinementGrid,
  normalizeParams,
  type TrialParams,
  type TunableParamKey,
} from './search-space';
import { deriveFrozenParams, regularizedScore } from './pruner';
import { isDuplicateRegion, loadHistory, DEFAULT_TOLERANCE_STEPS } from './regression-history';

const scriptDir = pathResolve(fileURLToPath(import.meta.url), '..');
const ROOT = pathResolve(scriptDir, '..', '..');
const SELF = pathResolve(scriptDir, 'optimize.ts');
const CPU_COUNT = cpus().length;

// ═══════════════════════════════════════════════════════
// WORKER MODE — run inside a child process with env vars
// ═══════════════════════════════════════════════════════

async function runWorker(): Promise<void> {
  const spec = JSON.parse(process.env.TRIAL_SPEC_ENV!) as TrialSpec;
  const startMs = Date.now();

  const { initRegistry } = await import('../../src/server/registry/index');
  await initRegistry();

  const { ToolSearchEngine } = await import('../../src/server/search/ToolSearchEngineImpl');
  const { buildSearchQualityFixture } =
    await import('../../tests/server/search/fixtures/search-quality.fixture');
  const { rerankResultsForContext } = await import('../../src/server/ToolRouter.policy');

  const fixture = buildSearchQualityFixture();
  const fixtureEngine = new ToolSearchEngine(
    [...fixture.tools],
    fixture.domainByToolName,
    undefined,
    undefined,
    undefined,
  );

  // Full-registry engine for rerank-state cases that need browser_launch,
  // network_monitor, and other tools not in the fixture subset.
  const { getAllManifests } = await import('../../src/server/registry/index');
  const allTools: any[] = [];
  const fullDomainMap = new Map<string, string>();
  for (const m of getAllManifests()) {
    for (const r of m.registrations) {
      allTools.push(r.tool);
      fullDomainMap.set(r.tool.name, m.domain);
    }
  }
  const fullEngine = new ToolSearchEngine(allTools, fullDomainMap, undefined, undefined, undefined);

  const lexicalCases = fixture.cases;
  const profileCases = [
    {
      id: 'p-search-tls',
      query: 'call tls_keylog_enable',
      topK: 10,
      expectations: [{ tool: 'tls_keylog_enable', gain: 3 as const }],
      baseTier: 'search' as const,
      visibleDomains: ['browser'],
    },
    {
      id: 'p-search-frida',
      query: 'attach Frida to process',
      topK: 10,
      expectations: [{ tool: 'frida_attach', gain: 3 as const }],
      baseTier: 'search' as const,
      visibleDomains: ['browser'],
    },
    {
      id: 'p-search-browser',
      query: 'navigate to URL and click',
      topK: 10,
      expectations: [
        { tool: 'page_navigate', gain: 3 as const },
        { tool: 'page_click', gain: 3 as const },
      ],
      baseTier: 'search' as const,
      visibleDomains: ['browser'],
    },
    {
      id: 'p-workflow-v8',
      query: 'extract V8 bytecode',
      topK: 10,
      expectations: [{ tool: 'v8_bytecode_extract', gain: 3 as const }],
      baseTier: 'workflow' as const,
      visibleDomains: ['browser', 'network', 'debugger'],
    },
    {
      id: 'p-workflow-net',
      query: 'capture network requests',
      topK: 10,
      expectations: [{ tool: 'network_enable', gain: 3 as const }],
      baseTier: 'workflow' as const,
      visibleDomains: ['browser', 'network', 'debugger'],
    },
    {
      id: 'p-workflow-syscall',
      query: 'call syscall_start_monitor',
      topK: 10,
      expectations: [{ tool: 'syscall_start_monitor', gain: 3 as const }],
      baseTier: 'workflow' as const,
      visibleDomains: ['browser', 'network', 'debugger'],
    },
    {
      id: 'p-search-generic',
      query: 'debug JavaScript code',
      topK: 10,
      expectations: [{ tool: 'debug_pause', gain: 2 as const }],
      baseTier: 'search' as const,
      visibleDomains: ['browser'],
    },
  ];

  // Rerank-state cases — exercise rerank multipliers with varied runtime states.
  // These use the full engine so tools like browser_launch, network_monitor exist.
  const rerankStateCases = [
    // Browser launch boost: no browser active → browser_launch should rank high
    {
      id: 'r-browser-launch',
      query: 'open browser for automation',
      topK: 10,
      expectations: [{ tool: 'browser_launch', gain: 3 as const }],
      rerankState: { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 },
    },
    {
      id: 'r-browser-launch-2',
      query: 'launch chrome to analyze page',
      topK: 10,
      expectations: [{ tool: 'browser_launch', gain: 3 as const }],
      rerankState: { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 },
    },
    // Network monitor boost: active page, no network → network_monitor boosted
    {
      id: 'r-network-monitor',
      query: 'monitor network traffic',
      topK: 10,
      expectations: [{ tool: 'network_monitor', gain: 3 as const }],
      rerankState: { hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 },
    },
    {
      id: 'r-network-monitor-2',
      query: 'enable network capture',
      topK: 10,
      expectations: [{ tool: 'network_enable', gain: 3 as const }],
      rerankState: { hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 },
    },
    // Network get requests boost: active page, network enabled, has captured requests
    {
      id: 'r-network-get',
      query: 'get captured network requests',
      topK: 10,
      expectations: [{ tool: 'network_get_requests', gain: 3 as const }],
      rerankState: { hasActivePage: true, networkEnabled: true, capturedRequestCount: 5 },
    },
    // Stateless compute: boost compute tools, penalize interactive domains
    {
      id: 'r-stateless-decode',
      query: 'decode base64 payload',
      topK: 10,
      expectations: [{ tool: 'binary_decode', gain: 3 as const }],
      rerankState: { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 },
    },
    {
      id: 'r-stateless-detect',
      query: 'detect encoding format of bytes',
      topK: 10,
      expectations: [{ tool: 'binary_detect_format', gain: 3 as const }],
      rerankState: { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 },
    },
  ];

  // Engine dispatch: use full engine for rerank-state cases, fixture engine otherwise.
  type EvalCaseExt = EvalCase & {
    useFullEngine?: boolean;
    rerankState?: { hasActivePage: boolean; networkEnabled: boolean; capturedRequestCount: number };
    baseTier?: string;
    visibleDomains?: string[];
  };

  let evalCases: EvalCaseExt[];
  let evolveSlice: EvalCaseExt[] | null = null;
  let holdoutSlice: EvalCaseExt[] | null = null;
  if (spec.evaluateHoldout === true && spec.dataset === 'search-quality') {
    // RRSI: the candidate is tuned on the evolve slice and judged on the
    // disjoint holdout slice. Both slices come from the SAME split so the two
    // scores are comparable — scoring evolve on the full fixture and holdout
    // on a subset would make the gap meaningless.
    const { splitEvolveHoldout } = await import('./holdout');
    const split = splitEvolveHoldout(fixture.cases, { evolveRatio: 0.7, seed: 42 });
    evolveSlice = split.evolve as EvalCaseExt[];
    holdoutSlice = split.holdout as EvalCaseExt[];
    evalCases = evolveSlice;
  } else if (spec.dataset === 'search-quality') {
    evalCases = lexicalCases as EvalCaseExt[];
  } else if (spec.dataset === 'profile-tier') {
    // Phase 3: both profile-tier cases + rerank-state cases to give rerank params signal
    evalCases = [...profileCases, ...rerankStateCases] as EvalCaseExt[];
  } else if (spec.dataset === 'realtime') {
    // Phase B3: real traffic history. Cases run on the FULL registry engine —
    // their idealTools are real tool names from recorded usage, most of which
    // don't exist in the 85-tool fixture subset. Cases whose idealTool is no
    // longer registered (renamed/removed tools) are unanswerable noise.
    const { loadRealtimeDataset } = await import('../../scripts/search-tune/datasets/realtime');
    const realtime = await loadRealtimeDataset();
    const fullToolNames = new Set(allTools.map((t) => t.name));
    const usable = realtime.cases.filter(
      (c) => c.idealTool !== undefined && fullToolNames.has(c.idealTool),
    );
    if (usable.length < realtime.cases.length) {
      process.stderr.write(
        `[realtime] dropped ${realtime.cases.length - usable.length}/${realtime.cases.length} cases: idealTool not in registry (renamed/removed tool)\n`,
      );
    }
    if (usable.length === 0) {
      // Fail the trial instead of evaluating zero cases: a score-0 "winner"
      // would let garbage params reach .env via applyToEnv.
      process.stdout.write(JSON.stringify({ error: 'realtime: no usable cases' }) + '\n');
      process.exit(1);
    }
    evalCases = usable.map((c) => ({ ...c, useFullEngine: true })) as EvalCaseExt[];
  } else {
    // Phase 4: rerank-state only
    evalCases = rerankStateCases as EvalCaseExt[];
  }

  if (spec.onlyTags !== undefined && spec.onlyTags.length > 0) {
    const wanted = new Set(spec.onlyTags);
    const tagged = (fixture.cases as EvalCaseExt[]).filter((c) =>
      (c as { tags?: readonly string[] }).tags?.some((t) => wanted.has(t)),
    );
    if (tagged.length === 0) {
      process.stdout.write(
        JSON.stringify({ error: `onlyTags matched no cases: ${spec.onlyTags.join(',')}` }) + '\n',
      );
      process.exit(1);
    }
    evalCases = tagged;
  }

  const caseMetrics: CaseMetrics[] = [];

  for (const tc of evalCases) {
    const actualEngine = tc.rerankState
      ? fullEngine
      : tc.useFullEngine
        ? fullEngine
        : fixtureEngine;
    const profile = tc.baseTier as 'search' | 'workflow' | 'full' | undefined;
    const vd = tc.visibleDomains;
    const visibleSet = vd ? new Set(vd) : undefined;
    const results = await actualEngine.search(tc.query, tc.topK, undefined, visibleSet, profile);
    const reranked = rerankResultsForContext(
      results,
      tc.query,
      null,
      tc.rerankState ?? { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 },
    );
    caseMetrics.push(evaluateCase(reranked, tc));
  }

  // RRSI regularization: when the trial carries a holdout split, the SAME
  // candidate is also scored on cases it never tuned against. The orchestrator
  // uses these metrics to run the critic (gap / regression / noise-floor
  // checks) and the rejected-region history, so an evolve winner that stalls
  // or regresses out-of-distribution is never written to .env.
  let holdoutMetrics: AggregateMetrics | null = null;
  if (holdoutSlice !== null) {
    const holdoutCaseMetrics: CaseMetrics[] = [];
    for (const tc of holdoutSlice) {
      const results = await fixtureEngine.search(tc.query, tc.topK);
      const reranked = rerankResultsForContext(results, tc.query, null, {
        hasActivePage: false,
        networkEnabled: false,
        capturedRequestCount: 0,
      });
      holdoutCaseMetrics.push(evaluateCase(reranked, tc));
    }
    holdoutMetrics = aggregateMetrics(holdoutCaseMetrics);
  }

  const metrics = aggregateMetrics(caseMetrics);
  process.stdout.write(
    JSON.stringify({
      trialId: spec.trialId,
      phase: spec.phase,
      dataset: spec.dataset,
      params: spec.params,
      metrics,
      holdoutMetrics,
      holdoutCaseCount: holdoutSlice?.length ?? null,
      elapsedMs: Date.now() - startMs,
    }) + '\n',
  );
}

// ═══════════════════════════════════════════════════════
// METRICS (inlined — shared by worker)
// ═══════════════════════════════════════════════════════

interface CaseMetrics {
  reciprocalRankAt10: number;
  ndcgAt10: number;
  hitAt1: 0 | 1;
  hitAt3: 0 | 1;
  hitAt5: 0 | 1;
}

interface EvalCase {
  query: string;
  topK: number;
  expectations: readonly { tool: string; gain: number }[];
}

function evaluateCase(
  results: readonly { name: string; score: number; domain: string | null }[],
  tc: EvalCase,
): CaseMetrics {
  const topK = results.slice(0, 10);
  const relevantSet = new Set(tc.expectations.filter((e) => e.gain >= 2).map((e) => e.tool));
  let firstRelevantRank: number | null = null;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i]!.name)) {
      firstRelevantRank = i;
      break;
    }
  }
  const reciprocalRankAt10 = firstRelevantRank !== null ? 1 / (firstRelevantRank + 1) : 0;
  const gainMap = new Map(tc.expectations.map((e) => [e.tool, e.gain]));
  let dcg = 0;
  for (let i = 0; i < topK.length && i < 10; i++) {
    const gain = gainMap.get(topK[i]!.name) ?? 0;
    dcg += gain / Math.log2(i + 2);
  }
  const sortedGains = [...gainMap.values()].toSorted((a, b) => b - a);
  let idcg = 0;
  for (let i = 0; i < sortedGains.length && i < 10; i++) {
    idcg += sortedGains[i]! / Math.log2(i + 2);
  }
  const ndcgAt10 = idcg > 0 ? dcg / idcg : 0;
  return {
    reciprocalRankAt10,
    ndcgAt10,
    hitAt1: topK.slice(0, 1).some((r) => relevantSet.has(r.name)) ? 1 : 0,
    hitAt3: topK.slice(0, 3).some((r) => relevantSet.has(r.name)) ? 1 : 0,
    hitAt5: topK.slice(0, 5).some((r) => relevantSet.has(r.name)) ? 1 : 0,
  };
}

function aggregateMetrics(cms: CaseMetrics[]) {
  const n = cms.length || 1;
  const mrrAt10 = cms.reduce((s, m) => s + m.reciprocalRankAt10, 0) / n;
  const ndcgAt10 = cms.reduce((s, m) => s + m.ndcgAt10, 0) / n;
  const pAt1 = cms.reduce((s, m) => s + m.hitAt1, 0) / n;
  const pAt3 = cms.reduce((s, m) => s + m.hitAt3, 0) / n;
  const pAt5 = cms.reduce((s, m) => s + m.hitAt5, 0) / n;
  const objectiveScore = 0.45 * mrrAt10 + 0.25 * ndcgAt10 + 0.15 * pAt1 + 0.15 * pAt3;
  return { mrrAt10, ndcgAt10, pAt1, pAt3, pAt5, objectiveScore };
}

// ═══════════════════════════════════════════════════════
// ORCHESTRATOR MODE
// ═══════════════════════════════════════════════════════

interface TrialSpec {
  trialId: string;
  phase: 1 | 2 | 3 | 4;
  dataset: 'search-quality' | 'profile-tier' | 'rerank-state' | 'realtime';
  params: Record<string, number>;
  seed: number;
  /** RRSI regularization: also score the candidate on the held-out slice. */
  evaluateHoldout?: boolean;
  /** Source trial id when this spec is a holdout-verification re-run. */
  sourceTrialId?: string;
  /**
   * Whether the worker runs with the dense-vector signal on. Propagated to a
   * deterministic SEARCH_VECTOR_ENABLED env override (explicit 'false' in
   * lexical runs, so a shell-leaked SEARCH_VECTOR_ENABLED cannot silently
   * flip a lexical run into a vector run).
   */
  vectorEnabled?: boolean;
  /**
   * Restrict scoring to cases carrying one of these tags. Used by the OOD
   * domain holdout so the trial measures domains the candidate was never
   * tuned on, instead of the whole fixture.
   */
  onlyTags?: string[];
}

interface TrialResult {
  trialId: string;
  phase: number;
  dataset: string;
  params: Record<string, number>;
  metrics: {
    mrrAt10: number;
    ndcgAt10: number;
    pAt1: number;
    pAt3: number;
    pAt5: number;
    objectiveScore: number;
  };
  /** Same candidate scored on the held-out slice (RRSI OOD check). */
  holdoutMetrics?: {
    mrrAt10: number;
    ndcgAt10: number;
    pAt1: number;
    pAt3: number;
    pAt5: number;
    objectiveScore: number;
  } | null;
  /** Size of the holdout slice actually scored, for the noise-floor estimate. */
  holdoutCaseCount?: number | null;
  elapsedMs: number;
}

interface OptimizeOptions {
  seed: number;
  outDir: string;
  phase1Trials: number;
  phase2TopN: number;
  concurrency: number;
  dataset: 'fixture' | 'realtime';
  /** λ for the default-drift penalty; 0 disables regularization. */
  regularization: number;
  /** Freeze low-sensitivity params to shipped defaults after phase 1. */
  prune: boolean;
  /** Enable the dense-vector signal in workers (phase-1 vector params join). */
  vector: boolean;
  /** Run the pipeline without writing .env. */
  dryRun: boolean;
}

function parseOptions(): OptimizeOptions {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : fallback;
  };
  const has = (flag: string): boolean => args.includes(flag);
  const datasetRaw = get('--dataset', 'fixture');
  const dataset =
    datasetRaw === 'fixture' ? 'fixture' : datasetRaw === 'realtime' ? 'realtime' : null;
  if (dataset === null) {
    console.error(`Unknown --dataset "${datasetRaw}". Expected "fixture" (default) or "realtime".`);
    process.exit(1);
  }
  return {
    seed: parseInt(get('--seed', '42'), 10),
    outDir: get('--out-dir', 'artifacts/search-tuning'),
    phase1Trials: parseInt(get('--phase1-trials', '800'), 10),
    phase2TopN: parseInt(get('--phase2-top-n', '20'), 10),
    concurrency: parseInt(get('--concurrency', String(CPU_COUNT)), 10),
    dataset,
    regularization: parseFloat(get('--regularization', '0.01')),
    prune: !has('--no-prune'),
    vector: has('--vector'),
    dryRun: has('--dry-run'),
  };
}

/**
 * Spawn a single worker process with SEARCH_* env vars set.
 * Constants.ts reads process.env at module load, so each worker
 * process gets the correct parameter values.
 */
function spawnWorker(spec: TrialSpec): Promise<TrialResult | null> {
  const envOverrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(spec.params)) {
    envOverrides[key] = String(value);
  }
  // Deterministic vector switch: explicit in BOTH modes so a shell-exported
  // SEARCH_VECTOR_ENABLED can never flip a lexical run (or mute a --vector
  // run) halfway through the trial population.
  envOverrides.SEARCH_VECTOR_ENABLED = spec.vectorEnabled ? 'true' : 'false';
  // Tuning workers must never report telemetry: with opt-out telemetry ON by
  // default, thousands of trial searches would flood the real ingress and
  // pollute the production dataset.
  envOverrides.JSHOOK_OBSERVABILITY_EXPORTER = 'none';
  envOverrides.TRIAL_SPEC_ENV = JSON.stringify(spec);

  return new Promise((res) => {
    const child = execFile(
      'npx',
      ['tsx', SELF, '--worker'],
      {
        env: { ...process.env, ...envOverrides },
        cwd: ROOT,
        maxBuffer: 10 * 1024 * 1024,
        shell: true,
      },
      (error, stdout, _stderr) => {
        if (error) {
          res(null);
          return;
        }
        for (const line of stdout.split('\n').toReversed()) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const parsed = JSON.parse(trimmed) as TrialResult;
            if (parsed.metrics) {
              res(parsed);
              return;
            }
          } catch {
            /* skip */
          }
        }
        res(null);
      },
    );
    child.stdin?.end();
  });
}

/**
 * Run trials with bounded concurrency (semaphore pattern).
 */
async function runTrials(
  specs: TrialSpec[],
  concurrency: number,
  label: string,
  outFile: string,
): Promise<TrialResult[]> {
  console.log(`\n[${label}] ${specs.length} trials, ${concurrency} concurrent workers`);
  const results: TrialResult[] = [];
  let done = 0;
  let running = 0;
  let idx = 0;

  return new Promise((res) => {
    function tryNext(): void {
      while (running < concurrency && idx < specs.length) {
        const spec = specs[idx]!;
        idx++;
        running++;
        spawnWorker(spec).then(async (result) => {
          running--;
          done++;
          if (result) {
            results.push(result);
            await appendFile(outFile, JSON.stringify(result) + '\n', 'utf-8');
          }
          if (done % Math.max(1, Math.floor(specs.length / 20)) === 0 || done === specs.length) {
            process.stdout.write(
              `  ${done}/${specs.length} (best so far: ${results.length > 0 ? results.reduce((b, r) => (r.metrics.objectiveScore > b ? r.metrics.objectiveScore : b), 0).toFixed(4) : 'n/a'})\n`,
            );
          }
          if (done === specs.length) {
            res(results);
          } else {
            tryNext();
          }
        });
      }
    }
    if (specs.length === 0) {
      res(results);
      return;
    }
    tryNext();
  });
}

// ── main orchestrator ──

type SearchSpaceDefs = Awaited<ReturnType<typeof loadSearchSpace>>;
type TuneOptions = ReturnType<typeof parseOptions>;

/** Shared context threaded through the per-phase functions. */
interface TunePhaseContext {
  options: TuneOptions;
  outFile: string;
  defs: SearchSpaceDefs;
  phase1Defs: SearchSpaceDefs;
  phase3Defs: SearchSpaceDefs;
  phase4Defs: SearchSpaceDefs;
  sampleFresh: (phaseDefs: SearchSpaceDefs, seed: number) => TrialParams;
  rankScore: (t: { params: Record<string, number>; metrics: { objectiveScore: number } }) => number;
}

/** Mutable pruner state — frozen params are written after phase 1. */
interface FrozenParamsRef {
  current: Partial<Record<TunableParamKey, number>>;
}

function datasetArg(options: TuneOptions, dataset: string): string {
  return options.dataset === 'realtime' ? 'realtime' : dataset;
}

/** Verify usable realtime traffic exists before spending any trial budget. */
async function verifyRealtimeDataset(options: TuneOptions): Promise<void> {
  if (options.dataset !== 'realtime') return;
  const { loadRealtimeDataset } = await import('./datasets/realtime');
  const realtime = await loadRealtimeDataset();
  if (realtime.cases.length === 0) {
    console.error(
      `[realtime] no usable evaluation cases in ${realtime.sourceFile} — ` +
        'the snapshot is missing or contains no SearchQueryRecord with usedTool+usedToolRank. ' +
        'Run the server to accumulate search traffic, then retry, or drop --dataset to use the synthetic fixture.',
    );
    process.exit(1);
  }
  console.log(
    `[realtime] evaluating against ${realtime.cases.length} real-traffic cases from ${realtime.sourceFile}`,
  );
}

function logTuningPlan(ctx: TunePhaseContext): void {
  console.log(
    `Search tuning: ${ctx.defs.length} params (${ctx.phase1Defs.length} lexical, ${ctx.phase3Defs.length} profile, ${ctx.phase4Defs.length} rerank)`,
  );
  console.log(
    ctx.options.vector
      ? 'Vector signal: ENABLED (workers run SEARCH_VECTOR_ENABLED=true; vector-scoring params join phase 1)'
      : 'Vector signal: disabled (lexical run; vector-scoring params excluded from sampling)',
  );
  console.log(`Using ${ctx.options.concurrency} CPU cores, seed=${ctx.options.seed}`);
}

function createRejectionAvoidingSampler(
  ctx: TunePhaseContext,
  rejectionHistory: Awaited<ReturnType<typeof loadHistory>>,
  frozenRef: FrozenParamsRef,
): TunePhaseContext['sampleFresh'] {
  const applyFrozen = (params: TrialParams): TrialParams =>
    Object.keys(frozenRef.current).length === 0
      ? params
      : normalizeParams({ ...params, ...frozenRef.current } as TrialParams);
  return (phaseDefs: SearchSpaceDefs, seed: number): TrialParams => {
    let params = sampleRandomParams(phaseDefs, seed);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const verdict = isDuplicateRegion(params, rejectionHistory, {
        tolerance: DEFAULT_TOLERANCE_STEPS,
        defs: ctx.defs,
      });
      if (!verdict.duplicate) return applyFrozen(params);
      params = sampleRandomParams(phaseDefs, seed + attempt * 1000003);
    }
    return applyFrozen(params);
  };
}

function buildPhase1Specs(ctx: TunePhaseContext): TrialSpec[] {
  const specs: TrialSpec[] = [];
  for (let i = 0; i < ctx.options.phase1Trials; i++) {
    const params = ctx.sampleFresh(ctx.phase1Defs, ctx.options.seed + i);
    specs.push({
      trialId: `p1-${String(i).padStart(4, '0')}`,
      phase: 1,
      dataset: datasetArg(ctx.options, 'search-quality'),
      params: params as Record<string, number>,
      seed: ctx.options.seed + i,
      vectorEnabled: ctx.options.vector || undefined,
    });
  }
  return specs;
}

/**
 * Pruner: freeze low-sensitivity params to shipped defaults after phase 1.
 * Complements the RRSI gates from the other side: instead of rejecting an
 * overfit winner, it stops spending trial budget on dimensions that
 * provably do not move the objective and pins them to the defaults (which
 * also minimizes the regularization penalty for the final .env params).
 * Empty during phase 1 itself, so freezing never biases its own sensitivity
 * data. Returns the frozen key set for phase 2 grid exclusion.
 */
function freezeLowSensitivityParams(
  ctx: TunePhaseContext,
  p1Results: TrialResult[],
  frozenRef: FrozenParamsRef,
): Set<TunableParamKey> {
  if (!ctx.options.prune) return new Set();
  const pruned = deriveFrozenParams(
    p1Results.map((t) => ({ params: t.params, objectiveScore: t.metrics.objectiveScore })),
  );
  frozenRef.current = pruned.frozen;
  if (pruned.rationale.length > 0) {
    console.log(
      `  [pruner] froze ${pruned.rationale.length} low-sensitivity param(s) to shipped defaults:`,
    );
    for (const entry of pruned.rationale) {
      console.log(
        `    ${entry.key} → ${entry.frozenTo} (spread ${entry.spread.toFixed(4)}, ${entry.buckets} buckets)`,
      );
    }
  } else {
    console.log('  [pruner] nothing froze (no param met the low-sensitivity threshold)');
  }
  return new Set(Object.keys(frozenRef.current) as TunableParamKey[]);
}

function logBestTrial(prefix: string, trial: TrialResult | undefined, extended: boolean): void {
  if (!trial) return;
  if (extended) {
    console.log(
      `  ${prefix}: ${trial.trialId} score=${trial.metrics.objectiveScore.toFixed(4)} MRR=${trial.metrics.mrrAt10.toFixed(3)} P@1=${trial.metrics.pAt1.toFixed(3)}`,
    );
  } else {
    console.log(`  ${prefix}: ${trial.trialId} score=${trial.metrics.objectiveScore.toFixed(4)}`);
  }
}

/** Phase 2: Local refinement around top-N. */
async function runPhase2Refinement(
  ctx: TunePhaseContext,
  sortedP1: TrialResult[],
  frozenKeySet: Set<TunableParamKey>,
): Promise<TrialResult[]> {
  const topN = sortedP1.slice(0, ctx.options.phase2TopN);
  const specs: TrialSpec[] = [];
  let idx = 0;
  for (const base of topN) {
    // Frozen params keep their pinned value — the grid never proposes ±step
    // variants for a dimension the pruner retired.
    const grid = buildLocalRefinementGrid(base.params as TrialParams, ctx.phase1Defs, frozenKeySet);
    for (const params of grid) {
      specs.push({
        trialId: `p2-${String(idx).padStart(4, '0')}`,
        phase: 2,
        dataset: datasetArg(ctx.options, 'search-quality'),
        params: params as Record<string, number>,
        seed: ctx.options.seed + 10000 + idx,
        vectorEnabled: ctx.options.vector || undefined,
      });
      idx++;
    }
  }
  return runTrials(specs, ctx.options.concurrency, 'Phase 2 — Refinement', ctx.outFile);
}

/**
 * RRSI gate: the evolve winner is not trusted until it survives the held-out
 * slice. Re-score the top candidates with evaluateHoldout, run the critic
 * (gap / regression / noise-floor), and write rejections into the
 * regression history so re-sampling a dead region is blocked. A candidate
 * that wins evolve but stalls on holdout is overfit — RRSI's whole point —
 * and must not reach .env.
 * Returns the holdout-verified best, or null when nothing passed.
 */
async function runRrsiHoldoutVerification(
  ctx: TunePhaseContext,
  allLexical: TrialResult[],
): Promise<TrialResult | null> {
  const holdoutVerifyCount = 5;
  const holdoutSpecs: TrialSpec[] = allLexical.slice(0, holdoutVerifyCount).map((trial, i) => ({
    trialId: `h${String(i).padStart(2, '0')}`,
    phase: 2,
    dataset: 'search-quality',
    params: trial.params,
    seed: ctx.options.seed + 40000 + i,
    evaluateHoldout: true,
    sourceTrialId: trial.trialId,
    vectorEnabled: ctx.options.vector || undefined,
  }));
  const sourceByHoldoutId = new Map(holdoutSpecs.map((s) => [s.trialId, s.sourceTrialId] as const));
  const evolveScoreByTrialId = new Map(
    allLexical.map((t) => [t.trialId, t.metrics.objectiveScore] as const),
  );
  const holdoutResults = await runTrials(
    holdoutSpecs,
    Math.max(1, Math.floor(ctx.options.concurrency / 2)),
    'RRSI holdout verification',
    ctx.outFile,
  );
  const { appendRejection, buildRejectionEntry, DEFAULT_HISTORY_PATH } =
    await import('./regression-history');
  const acceptScores: TrialResult[] = [];
  for (const trial of holdoutResults) {
    if (!trial.holdoutMetrics) continue;
    const sourceTrialId = sourceByHoldoutId.get(trial.trialId);
    const evolveScore =
      (sourceTrialId !== undefined ? evolveScoreByTrialId.get(sourceTrialId) : undefined) ?? 0;
    const holdoutScore = trial.holdoutMetrics.objectiveScore;
    const gap = evolveScore - holdoutScore;
    const reasons: string[] = [];
    // The ONLY reject signal at the aggregate level: evolve beats the disjoint
    // holdout by more than the tolerance, i.e. the candidate fit the evolve
    // slice. Small positive gaps are sampling noise on a ~30-case slice and are
    // not evidence of overfitting; a negative gap means the holdout scored
    // higher than evolve, which is generalization.
    if (gap > 0.15) {
      reasons.push(`overfit: evolve/holdout gap ${gap.toFixed(3)} > 0.15`);
    }
    const accepted = reasons.length === 0;
    if (!accepted) {
      await appendRejection(
        buildRejectionEntry(
          trial.trialId,
          trial.params as TrialParams,
          evolveScore,
          holdoutScore,
          reasons,
        ),
      );
    }
    console.log(
      `  [RRSI] ${trial.trialId} evolve=${evolveScore.toFixed(4)} holdout=${holdoutScore.toFixed(4)} gap=${gap.toFixed(3)} → ${accepted ? 'ACCEPT' : 'REJECT ' + reasons.join('; ')}`,
    );
    if (accepted) {
      acceptScores.push({ ...trial, params: trial.params });
    }
  }
  if (acceptScores.length === 0) {
    console.warn(
      `  [RRSI] no candidate passed holdout verification; keeping raw evolve best — rejections logged to ${DEFAULT_HISTORY_PATH}`,
    );
    return null;
  }
  // Pick the accepted candidate with the best HOLDOUT score, not the first
  // to finish — runTrials returns results in completion order.
  const verifiedBest = acceptScores.toSorted(
    (a, b) => (b.holdoutMetrics?.objectiveScore ?? 0) - (a.holdoutMetrics?.objectiveScore ?? 0),
  )[0]!;
  console.log(
    `  RRSI verified best: ${verifiedBest.trialId} (evolve score ${verifiedBest.metrics.objectiveScore.toFixed(4)} accepted on holdout)`,
  );
  return verifiedBest;
}

/**
 * OOD confirmation: the winning candidate is scored on domains the evolve
 * split never trained it on (v8-inspector / webgpu / dart-inspector). This is
 * the benchmark-disjoint check — a candidate that only wins inside the
 * domains it was tuned against shows up here as a drop. Reported, not gated:
 * with three domains the slice is too small to reject on.
 */
async function logOodConfirmation(ctx: TunePhaseContext, bestLexical: TrialResult): Promise<void> {
  if (ctx.options.dataset === 'realtime') return;
  const { loadDomainHoldoutDataset } = await import('./datasets/domain-holdout');
  const ood = await loadDomainHoldoutDataset({
    holdOutTags: ['v8-inspector', 'webgpu', 'dart-inspector'],
  });
  if (ood.cases.length === 0) return;
  const oodResult = await runTrials(
    [
      {
        trialId: 'ood-0',
        phase: 2,
        dataset: 'search-quality',
        params: bestLexical.params,
        seed: ctx.options.seed + 50000,
        onlyTags: [...ood.heldOutTags],
        vectorEnabled: ctx.options.vector || undefined,
      },
    ],
    1,
    'RRSI OOD domain holdout',
    ctx.outFile,
  );
  const oodScore = oodResult[0]?.metrics.objectiveScore;
  if (oodScore !== undefined) {
    console.log(
      `  [RRSI] OOD domain holdout (${ood.cases.length} cases, ${ood.heldOutTags.join('/')}): ${oodScore.toFixed(4)} vs in-split ${bestLexical.metrics.objectiveScore.toFixed(4)}`,
    );
  }
}

/** Phase 3: Profile penalty tuning (profile-tier includes rerank-state cases
 * so rerank params also get partial signal here). */
async function runPhase3Profile(
  ctx: TunePhaseContext,
  bestLexical: TrialResult,
): Promise<TrialResult[]> {
  const count = 80;
  const specs: TrialSpec[] = [];
  for (let i = 0; i < count; i++) {
    const penaltyParams = ctx.sampleFresh(ctx.phase3Defs, ctx.options.seed + 20000 + i);
    const merged = normalizeParams({
      ...bestLexical.params,
      ...penaltyParams,
    } as TrialParams);
    specs.push({
      trialId: `p3-${String(i).padStart(4, '0')}`,
      phase: 3,
      dataset: datasetArg(ctx.options, 'profile-tier'),
      params: merged as Record<string, number>,
      seed: ctx.options.seed + 20000 + i,
      vectorEnabled: ctx.options.vector || undefined,
    });
  }
  return runTrials(specs, ctx.options.concurrency, 'Phase 3 — Profile', ctx.outFile);
}

/** Phase 4: Rerank-specific tuning — rerank-state dataset with varied runtime
 * states to directly optimize rerank multipliers. */
async function runPhase4Rerank(
  ctx: TunePhaseContext,
  bestPhase3Params: Record<string, number>,
): Promise<TrialResult[]> {
  const count = 60;
  const specs: TrialSpec[] = [];
  for (let i = 0; i < count; i++) {
    const rerankParams = ctx.sampleFresh(ctx.phase4Defs, ctx.options.seed + 30000 + i);
    const merged = normalizeParams({
      ...bestPhase3Params,
      ...rerankParams,
    } as TrialParams);
    specs.push({
      trialId: `p4-${String(i).padStart(4, '0')}`,
      phase: 4,
      dataset: datasetArg(ctx.options, 'rerank-state'),
      params: merged as Record<string, number>,
      seed: ctx.options.seed + 30000 + i,
      vectorEnabled: ctx.options.vector || undefined,
    });
  }
  return runTrials(specs, ctx.options.concurrency, 'Phase 4 — Rerank', ctx.outFile);
}

function logPhaseParams(label: string, trial: TrialResult | undefined, metrics: boolean): void {
  if (!trial) return;
  console.log(`\n${label} (score=${trial.metrics.objectiveScore.toFixed(4)}):`);
  for (const [k, v] of Object.entries(trial.params).toSorted()) {
    if (v !== undefined) console.log(`  ${k} = ${v}`);
  }
  if (metrics) {
    console.log(
      `  MRR@10=${trial.metrics.mrrAt10.toFixed(3)} NDCG@10=${trial.metrics.ndcgAt10.toFixed(3)} P@1=${trial.metrics.pAt1.toFixed(3)} P@3=${trial.metrics.pAt3.toFixed(3)}`,
    );
  }
}

/**
 * Auto-apply best params to .env.
 * Merge by phase rather than taking one trial's full param set: lexical
 * params come from the best lexical trial, then profile/rerank overrides
 * are layered on top.  This prevents the small profile/rerank datasets
 * from silently degrading the lexical defaults through cross-phase param
 * spill (e.g. SEARCH_RRF_BM25_BLEND being pulled from a profile trial).
 */
async function applyBestParamsToEnv(
  options: TuneOptions,
  outFile: string,
  bestLexical: TrialResult | undefined,
  bestProfile: TrialResult | undefined,
  bestRerank: TrialResult | undefined,
  frozenParams: Partial<Record<TunableParamKey, number>>,
): Promise<void> {
  console.log(`\nResults: ${outFile}`);
  const mergedParams: Record<string, number> = {
    ...bestLexical?.params,
  };
  if (bestProfile) Object.assign(mergedParams, bestProfile.params);
  if (bestRerank) Object.assign(mergedParams, bestRerank.params);
  // Frozen params win over everything: they were pinned to the shipped
  // defaults because no evidence supports drifting them.
  Object.assign(mergedParams, frozenParams);
  const envPath = pathResolve(ROOT, '.env');
  if (options.dryRun) {
    console.log(
      `[dry-run] skipping .env apply (score=${bestLexical?.metrics.objectiveScore.toFixed(4) ?? 'n/a'})`,
    );
  } else {
    await applyToEnv(envPath, mergedParams, bestLexical?.metrics.objectiveScore ?? 0);
  }
}

async function orchestrate(): Promise<void> {
  const options = parseOptions();
  const outFile = pathResolve(options.outDir, 'trials.jsonl');
  await mkdir(options.outDir, { recursive: true });
  await verifyRealtimeDataset(options);

  // Clear old results
  await writeFile(outFile, '', 'utf-8');

  const defs = await loadSearchSpace();
  const frozenRef: FrozenParamsRef = { current: {} };
  const rankScore = (t: { params: Record<string, number>; metrics: { objectiveScore: number } }) =>
    regularizedScore(
      { params: t.params, objectiveScore: t.metrics.objectiveScore },
      options.regularization,
    );
  const rejectionHistory = await loadHistory();
  const ctx: TunePhaseContext = {
    options,
    outFile,
    defs,
    phase1Defs: getPhaseParams(defs, 1, { vectorEnabled: options.vector }),
    phase3Defs: getPhaseParams(defs, 3, { vectorEnabled: options.vector }),
    phase4Defs: getPhaseParams(defs, 4, { vectorEnabled: options.vector }),
    sampleFresh: () => ({}) as TrialParams, // replaced below (needs frozenRef)
    rankScore,
  };
  ctx.sampleFresh = createRejectionAvoidingSampler(ctx, rejectionHistory, frozenRef);
  logTuningPlan(ctx);
  if (rejectionHistory.length > 0) {
    console.log(
      `[RRSI] ${rejectionHistory.length} rejected region(s) loaded — resampling avoids them`,
    );
  }

  // Phase 1: Random search
  const p1Results = await runTrials(
    buildPhase1Specs(ctx),
    options.concurrency,
    'Phase 1 — Random',
    outFile,
  );

  const frozenKeySet = freezeLowSensitivityParams(ctx, p1Results, frozenRef);
  const sortedP1 = [...p1Results].toSorted((a, b) => rankScore(b) - rankScore(a));
  const bestP1 = sortedP1[0];
  logBestTrial('Best', bestP1, true);

  // Phase 2: Local refinement around top-N
  const p2Results = await runPhase2Refinement(ctx, sortedP1, frozenKeySet);
  const allLexical = [...p1Results, ...p2Results].toSorted((a, b) => rankScore(b) - rankScore(a));
  let bestLexical = allLexical[0];
  logBestTrial('Best lexical', bestLexical, false);
  if (!bestLexical) {
    console.error('[search-tune] no lexical trials succeeded — aborting before .env is touched');
    process.exit(1);
  }

  const verifiedBest = await runRrsiHoldoutVerification(ctx, allLexical);
  if (verifiedBest) {
    bestLexical = verifiedBest;
  }

  await logOodConfirmation(ctx, bestLexical);

  // Phase 3: Profile penalty tuning
  const p3Results = await runPhase3Profile(ctx, bestLexical);
  const bestProfile = [...p3Results].toSorted((a, b) => rankScore(b) - rankScore(a))[0];

  // Phase 4: Rerank-specific tuning
  const bestPhase3Params = bestProfile?.params ?? bestLexical?.params ?? {};
  const p4Results = await runPhase4Rerank(ctx, bestPhase3Params);
  const bestRerank = [...p4Results].toSorted((a, b) => rankScore(b) - rankScore(a))[0];

  // ── Summary ──
  const totalTrials = p1Results.length + p2Results.length + p3Results.length + p4Results.length;
  console.log('\n═══ Optimization Summary ═══');
  console.log(`Total trials: ${totalTrials}`);
  logPhaseParams('Best lexical', bestLexical, true);
  logPhaseParams('Best profile', bestProfile, false);
  logPhaseParams('Best rerank', bestRerank, false);

  await applyBestParamsToEnv(
    options,
    outFile,
    bestLexical,
    bestProfile,
    bestRerank,
    frozenRef.current,
  );
}

async function applyToEnv(
  envPath: string,
  params: Record<string, number>,
  score: number,
): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(envPath, 'utf-8');
  } catch {
    /* file may not exist */
  }

  const lines = existing.split('\n');
  const written = new Set<string>();

  // Remove old search-tune header and deduplicate: keep last occurrence of each key
  let cleaned = lines.filter((l) => !l.startsWith('# [search-tune]'));
  const seenKeys = new Set<string>();
  cleaned = cleaned
    .toReversed()
    .filter((line) => {
      const m = line.match(/^(?:\s*)(SEARCH_[A-Z_]+|RERANK_[A-Z_]+)(?:\s*=\s*)/);
      if (!m) return true;
      const k = m[1]!;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    })
    .toReversed();

  const newLines = cleaned.map((line) => {
    const match = line.match(/^(\s*)(SEARCH_[A-Z_]+|RERANK_[A-Z_]+)(\s*=\s*)(.*)$/);
    if (!match) return line;
    const [, prefix, key, eq] = match;
    const val = params[key!];
    if (val !== undefined) {
      written.add(key!);
      return `${prefix}${key}${eq}${val}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(params)) {
    if (!written.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  const header = `# [search-tune] score=${score.toFixed(4)} — ${new Date().toISOString()}`;
  const content = newLines.join('\n').trimEnd() + '\n' + header + '\n';

  await writeFile(envPath, content, 'utf-8');
  console.log(`Applied optimal params to ${envPath}`);
}

// ── entry point ──

if (process.argv.includes('--worker')) {
  runWorker().catch((e) => {
    process.stdout.write(JSON.stringify({ error: String(e) }) + '\n');
    process.exit(1);
  });
} else {
  orchestrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

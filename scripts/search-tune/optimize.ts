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
 *   npx tsx scripts/search-tune/optimize.ts [--seed 42] [--phase1-trials 800]
 */
import { execFile } from 'child_process';
import { mkdir, appendFile, readFile, writeFile } from 'fs/promises';
import { resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';
import { cpus } from 'os';
import {
  loadSearchSpace,
  getPhaseParams,
  sampleRandomParams,
  buildLocalRefinementGrid,
  normalizeParams,
  type TrialParams,
} from './search-space';

const __dirname = pathResolve(fileURLToPath(import.meta.url), '..');
const ROOT = pathResolve(__dirname, '..', '..');
const SELF = pathResolve(__dirname, 'optimize.ts');
const CPU_COUNT = cpus().length;

// ═══════════════════════════════════════════════════════
// WORKER MODE — run inside a child process with env vars
// ═══════════════════════════════════════════════════════

async function runWorker(): Promise<void> {
  const spec = JSON.parse(process.env.__TRIAL_SPEC!) as TrialSpec;
  const startMs = Date.now();

  const { initRegistry } = await import('../../src/server/registry/index');
  await initRegistry();

  const { ToolSearchEngine } = await import('../../src/server/search/ToolSearchEngineImpl');
  const { buildSearchQualityFixture } =
    await import('../../tests/server/search/fixtures/search-quality.fixture');

  const fixture = buildSearchQualityFixture();
  const engine = new ToolSearchEngine(
    [...fixture.tools],
    fixture.domainByToolName,
    undefined,
    undefined,
    undefined,
  );

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

  const cases = spec.dataset === 'search-quality' ? lexicalCases : profileCases;
  const caseMetrics: CaseMetrics[] = [];

  for (const tc of cases) {
    const profile = (tc as { baseTier?: string }).baseTier as
      | 'search'
      | 'workflow'
      | 'full'
      | undefined;
    const vd = (tc as { visibleDomains?: string[] }).visibleDomains;
    const visibleSet = vd ? new Set(vd) : undefined;
    const results = await engine.search(tc.query, tc.topK, undefined, visibleSet, profile);
    caseMetrics.push(evaluateCase(results, tc));
  }

  const metrics = aggregateMetrics(caseMetrics);
  process.stdout.write(
    JSON.stringify({
      trialId: spec.trialId,
      phase: spec.phase,
      dataset: spec.dataset,
      params: spec.params,
      metrics,
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
  phase: 1 | 2 | 3;
  dataset: 'search-quality' | 'profile-tier';
  params: Record<string, number>;
  seed: number;
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
  elapsedMs: number;
}

interface OptimizeOptions {
  seed: number;
  outDir: string;
  phase1Trials: number;
  phase2TopN: number;
  concurrency: number;
}

function parseOptions(): OptimizeOptions {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : fallback;
  };
  return {
    seed: parseInt(get('--seed', '42'), 10),
    outDir: get('--out-dir', 'artifacts/search-tuning'),
    phase1Trials: parseInt(get('--phase1-trials', '800'), 10),
    phase2TopN: parseInt(get('--phase2-top-n', '20'), 10),
    concurrency: parseInt(get('--concurrency', String(CPU_COUNT)), 10),
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
  envOverrides.__TRIAL_SPEC = JSON.stringify(spec);

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

async function orchestrate(): Promise<void> {
  const options = parseOptions();
  const outFile = resolve(options.outDir, 'trials.jsonl');
  await mkdir(options.outDir, { recursive: true });

  // Clear old results
  await writeFile(outFile, '', 'utf-8');

  const defs = await loadSearchSpace();
  const phase1Defs = getPhaseParams(defs, 1);
  const phase3Defs = getPhaseParams(defs, 3);
  console.log(
    `Search tuning: ${defs.length} parameters (${phase1Defs.length} lexical, ${phase3Defs.length} profile)`,
  );
  console.log(`Using ${options.concurrency} CPU cores, seed=${options.seed}`);

  // Phase 1: Random search
  const p1Specs: TrialSpec[] = [];
  for (let i = 0; i < options.phase1Trials; i++) {
    const params = sampleRandomParams(phase1Defs, options.seed + i);
    p1Specs.push({
      trialId: `p1-${String(i).padStart(4, '0')}`,
      phase: 1,
      dataset: 'search-quality',
      params: params as Record<string, number>,
      seed: options.seed + i,
    });
  }
  const p1Results = await runTrials(p1Specs, options.concurrency, 'Phase 1 — Random', outFile);
  const sortedP1 = [...p1Results].toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  );
  const bestP1 = sortedP1[0];
  if (bestP1) {
    console.log(
      `  Best: ${bestP1.trialId} score=${bestP1.metrics.objectiveScore.toFixed(4)} MRR=${bestP1.metrics.mrrAt10.toFixed(3)} P@1=${bestP1.metrics.pAt1.toFixed(3)}`,
    );
  }

  // Phase 2: Local refinement around top-N
  const topN = sortedP1.slice(0, options.phase2TopN);
  const p2Specs: TrialSpec[] = [];
  let p2idx = 0;
  for (const base of topN) {
    const grid = buildLocalRefinementGrid(base.params as TrialParams, phase1Defs);
    for (const params of grid) {
      p2Specs.push({
        trialId: `p2-${String(p2idx).padStart(4, '0')}`,
        phase: 2,
        dataset: 'search-quality',
        params: params as Record<string, number>,
        seed: options.seed + 10000 + p2idx,
      });
      p2idx++;
    }
  }
  const p2Results = await runTrials(p2Specs, options.concurrency, 'Phase 2 — Refinement', outFile);
  const allLexical = [...p1Results, ...p2Results].toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  );
  const bestLexical = allLexical[0];
  if (bestLexical) {
    console.log(
      `  Best lexical: ${bestLexical.trialId} score=${bestLexical.metrics.objectiveScore.toFixed(4)}`,
    );
  }

  // Phase 3: Profile penalty tuning
  const p3Specs: TrialSpec[] = [];
  const p3Count = 80;
  for (let i = 0; i < p3Count; i++) {
    const penaltyParams = sampleRandomParams(phase3Defs, options.seed + 20000 + i);
    const merged = normalizeParams({
      ...bestLexical.params,
      ...penaltyParams,
    } as TrialParams);
    p3Specs.push({
      trialId: `p3-${String(i).padStart(4, '0')}`,
      phase: 3,
      dataset: 'profile-tier',
      params: merged as Record<string, number>,
      seed: options.seed + 20000 + i,
    });
  }
  const p3Results = await runTrials(p3Specs, options.concurrency, 'Phase 3 — Profile', outFile);
  const bestProfile = [...p3Results].toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  )[0];

  // ── Summary ──
  const totalTrials = p1Results.length + p2Results.length + p3Results.length;
  console.log('\n═══ Optimization Summary ═══');
  console.log(`Total trials: ${totalTrials}`);

  if (bestLexical) {
    console.log(`\nBest lexical (score=${bestLexical.metrics.objectiveScore.toFixed(4)}):`);
    for (const [k, v] of Object.entries(bestLexical.params).toSorted()) {
      if (v !== undefined) console.log(`  ${k} = ${v}`);
    }
    console.log(
      `  MRR@10=${bestLexical.metrics.mrrAt10.toFixed(3)} NDCG@10=${bestLexical.metrics.ndcgAt10.toFixed(3)} P@1=${bestLexical.metrics.pAt1.toFixed(3)} P@3=${bestLexical.metrics.pAt3.toFixed(3)}`,
    );
  }
  if (bestProfile) {
    console.log(`\nBest profile (score=${bestProfile.metrics.objectiveScore.toFixed(4)}):`);
    for (const [k, v] of Object.entries(bestProfile.params).toSorted()) {
      if (v !== undefined) console.log(`  ${k} = ${v}`);
    }
  }
  console.log(`\nResults: ${outFile}`);

  // Auto-apply best params to .env
  const best = bestProfile ?? bestLexical;
  if (best) {
    const envPath = resolve(ROOT, '.env');
    await applyToEnv(envPath, best.params, best.metrics.objectiveScore);
  }
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

  // Remove old search-tune header
  const cleaned = lines.filter((l) => !l.startsWith('# [search-tune]'));

  const newLines = cleaned.map((line) => {
    const match = line.match(/^(\s*)(SEARCH_[A-Z_]+)(\s*=\s*)(.*)$/);
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

/**
 * Stem-mode scan harness for the retrieval scene-rank campaign
 * (.ccg/tasks/retrieval-scene-rank-fix/experiments.json).
 *
 * Sweeps the discrete SEARCH_STEM_MODE variants in-process and measures each
 * against BOTH corpora: the 109-query search-quality fixture (no scene
 * keywords — mirrors retrieval-metrics.test.ts) and the 736-tool registry
 * coverage set (lexical-only, matching the registry-retrieval benchmark).
 * Mode 'off' runs first as the in-process baseline; every other variant is
 * reported with aggregate movement, per-expectation rank drift, and the
 * campaign's 13-target lexical scorecard.
 *
 * Usage: corepack pnpm exec tsx scripts/search-tune/stem-scan.ts [--quick]
 *   --quick: fixture corpus only (fast triage; skips the 736 corpus)
 */
import { GENERATED_TOOL_CATALOG } from '../../src/server/registry/generated-tool-catalog';
import { GENERATED_TOOL_DOMAIN_MAP } from '../../src/server/registry/generated-tool-domains';
import { initRegistry } from '../../src/server/registry/index';
import type { StemMode } from '../../src/server/search/QueryNormalizer';
import { ToolSearchEngine } from '../../src/server/search/ToolSearchEngineImpl';
import { buildSearchQualityFixture } from '../../tests/server/search/fixtures/search-quality.fixture';
import { buildRegistryCoverageCases } from '../../tests/server/search/fixtures/registry-coverage.fixture';
import { aggregateSearchMetrics, evaluateCase, type RankedResult } from './metrics';

/** (stem mode, drift threshold) joint variants — the scan's search space. */
const VARIANTS: readonly { readonly mode: StemMode; readonly th: number }[] = [
  { mode: 'off', th: 2 },
  { mode: 'verb', th: 2 },
  { mode: 'verb', th: 1 },
  { mode: 'tokenset-verb', th: 1 },
  { mode: 'tokenset-verb', th: 2 },
  { mode: 'plural', th: 1 },
  { mode: 'tokenset-plural', th: 1 },
];

const TARGETS13: readonly string[] = [
  'network_get_status',
  'asar_deobfuscate',
  'captcha_config',
  'get_collection_stats',
  'debugger_run_to_location',
  'process_get',
  'process_suspend',
  'memory_auto_assemble_disable',
  'memory_find_accesses',
  'memory_trace_code',
  'nemu_capabilities',
  'nemu_disassemble',
  'nemu_load_library',
];

const QUICK = process.argv.includes('--quick');

interface EvalCaseLike {
  readonly id: string;
  readonly query: string;
  readonly topK: number;
  readonly expectations: readonly { readonly tool: string }[];
}

interface CorpusResult {
  readonly mrrAt10: number;
  readonly ndcgAt10: number;
  readonly pAt1: number;
  readonly targetMrr: Map<string, number>;
  readonly ranksByCase: Map<string, Map<string, number>>;
}

async function evalCorpus(
  engine: ToolSearchEngine,
  cases: readonly EvalCaseLike[],
): Promise<CorpusResult> {
  const metrics = [];
  const ranksByCase = new Map<string, Map<string, number>>();
  const targetAcc = new Map<string, { queries: number; ranks: number[] }>();
  for (const c of cases) {
    const results = await engine.search(c.query, Math.max(c.topK, 10));
    const ranked: RankedResult[] = results.map((r) => ({
      name: r.name,
      score: Number(r.score ?? 0),
      domain: null,
    }));
    metrics.push(evaluateCase(ranked, c as never));
    const nameRank = new Map<string, number>();
    ranked.forEach((r, i) => nameRank.set(r.name, i + 1));
    const rankMap = new Map<string, number>();
    for (const exp of c.expectations) {
      const rank = nameRank.get(exp.tool) ?? 99;
      rankMap.set(exp.tool, rank);
      const acc = targetAcc.get(exp.tool) ?? { queries: 0, ranks: [] };
      acc.queries += 1;
      if (rank <= 10) acc.ranks.push(rank);
      targetAcc.set(exp.tool, acc);
    }
    ranksByCase.set(c.id, rankMap);
  }
  const agg = aggregateSearchMetrics(metrics);
  const targetMrr = new Map<string, number>();
  for (const [tool, acc] of targetAcc) {
    const mrr = acc.ranks.length > 0 ? acc.ranks.reduce((s, r) => s + 1 / r, 0) / acc.queries : 0;
    targetMrr.set(tool, mrr);
  }
  return { mrrAt10: agg.mrrAt10, ndcgAt10: agg.ndcgAt10, pAt1: agg.pAt1, targetMrr, ranksByCase };
}

interface Drift {
  readonly moved: number;
  readonly worse: number;
  readonly better: number;
  readonly bigWorse: number;
}

function driftVsBaseline(baseline: CorpusResult, variant: CorpusResult): Drift {
  let moved = 0;
  let worse = 0;
  let better = 0;
  let bigWorse = 0;
  for (const [caseId, baseRanks] of baseline.ranksByCase) {
    const varRanks = variant.ranksByCase.get(caseId);
    if (!varRanks) continue;
    for (const [tool, baseRank] of baseRanks) {
      const varRank = varRanks.get(tool) ?? 99;
      const d = varRank - baseRank;
      if (Math.abs(d) > 2) {
        moved += 1;
        if (d > 0) {
          worse += 1;
          if (d >= 10) bigWorse += 1;
        } else {
          better += 1;
        }
      }
    }
  }
  return { moved, worse, better, bigWorse };
}

function targetsZero(mrr: Map<string, number>): string[] {
  return TARGETS13.filter((t) => (mrr.get(t) ?? 0) === 0);
}

async function main(): Promise<void> {
  // indexTool falls back to the registry domain map; it must be initialised
  // before any engine is constructed.
  await initRegistry('full');
  const fixture = buildSearchQualityFixture();
  const fixtureCases = fixture.cases as unknown as readonly EvalCaseLike[];
  const regCases = (QUICK
    ? []
    : buildRegistryCoverageCases()) as unknown as readonly EvalCaseLike[];
  const tools736 = GENERATED_TOOL_CATALOG.map((e) => e.tool);
  const dom736 = new Map(Object.entries(GENERATED_TOOL_DOMAIN_MAP));
  const sk736 = new Map<string, readonly string[]>();
  for (const entry of GENERATED_TOOL_CATALOG) {
    if (entry.sceneKeywords?.length) sk736.set(entry.tool.name, entry.sceneKeywords);
  }

  let baselineFixture: CorpusResult | null = null;
  let baselineReg: CorpusResult | null = null;
  const rows: string[] = [];

  for (const variant of VARIANTS) {
    process.env['SEARCH_STEM_MODE'] = variant.mode;
    process.env['SEARCH_STEM_DRIFT_THRESHOLD'] = String(variant.th);
    const fixtureEngine = new ToolSearchEngine([...fixture.tools]);
    const fixtureRes = await evalCorpus(fixtureEngine, fixtureCases);

    let regRes: CorpusResult | null = null;
    if (regCases.length > 0) {
      const regEngine = new ToolSearchEngine(
        tools736,
        dom736,
        undefined,
        undefined,
        { vectorEnabled: false } as never,
        sk736,
      );
      regRes = await evalCorpus(regEngine, regCases);
    }

    const regDelta =
      baselineReg && regRes
        ? {
            mrr: ((regRes.mrrAt10 - baselineReg.mrrAt10) * 100).toFixed(2),
            drift: driftVsBaseline(baselineReg, regRes),
          }
        : null;
    const fixDelta =
      baselineFixture && variant.mode !== 'off'
        ? { mrr: ((fixtureRes.mrrAt10 - baselineFixture.mrrAt10) * 100).toFixed(2) }
        : null;
    const label = `${variant.mode}@${variant.th}`.padEnd(18);

    rows.push(
      [
        label,
        `fxMRR ${(fixtureRes.mrrAt10 * 100).toFixed(2)}${fixDelta ? ` (${Number(fixDelta.mrr) >= 0 ? '+' : ''}${fixDelta.mrr})` : ' (base)'}`.padEnd(
          28,
        ),
        `fxZero13 ${targetsZero(fixtureRes.targetMrr).length}`.padEnd(12),
        regRes
          ? `regMRR ${(regRes.mrrAt10 * 100).toFixed(2)}${regDelta ? ` (${Number(regDelta.mrr) >= 0 ? '+' : ''}${regDelta.mrr})` : ' (base)'}`.padEnd(
              28,
            )
          : 'regMRR skipped'.padEnd(28),
        regRes ? `regZero13 ${targetsZero(regRes.targetMrr).length}`.padEnd(12) : ''.padEnd(12),
        regDelta && variant.mode !== 'off'
          ? `drift moved=${regDelta.drift.moved} worse=${regDelta.drift.worse} better=${regDelta.drift.better} bigWorse=${regDelta.drift.bigWorse}`
          : 'drift (base)',
      ].join(' | '),
    );

    if (variant.mode === 'off') {
      baselineFixture = fixtureRes;
      baselineReg = regRes;
    }
  }

  console.log('=== STEM MODE SCAN ===');
  for (const r of rows) console.log(r);

  if (baselineReg) {
    const zero = targetsZero(baselineReg.targetMrr);
    console.log(`\nbaseline regZero13 (${zero.length}): ${zero.join(', ')}`);
  }
}

await main();

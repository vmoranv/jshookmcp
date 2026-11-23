/**
 * Search tuning report generator.
 * Reads trials.jsonl and outputs a markdown report with top configs and parameter importance.
 *
 * Usage:
 *   tsx scripts/search-tune/report.ts [--in artifacts/search-tuning/trials.jsonl] [--out artifacts/search-tuning/report.md]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve as pathResolve } from 'node:path';
import { VECTOR_TUNABLE_PARAM_KEYS } from './search-space';
import type { TrialParams } from './search-space';

/** Mirrors the overfit gate in optimize.ts (evolve/holdout gap > 0.15 → reject). */
const RRSI_HOLDOUT_GAP_TOLERANCE = 0.15;

/**
 * Reader-owned trial record shape, mirroring what optimize.ts actually
 * serializes to trials.jsonl. The old `import type { TrialResult } from
 * './worker'` pointed at a module that was inlined into optimize.ts (the
 * type-only import was silently erased at runtime, so the stale reference
 * never surfaced). `failedCases` stays optional: the tune writer does not
 * serialize it.
 */
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
  holdoutMetrics?: Record<string, number> | null;
  holdoutCaseCount?: number | null;
  elapsedMs?: number;
  failedCases?: Array<{
    query: string;
    expectedTop: string[];
    actualTop5: string[];
    firstRelevantRank: number | null;
  }>;
}

// ── CLI ──

function parseCliArgs(): { inPath: string; outPath: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : fallback;
  };
  return {
    inPath: get('--in', 'artifacts/search-tuning/trials.jsonl'),
    outPath: get('--out', 'artifacts/search-tuning/report.md'),
  };
}

// ── data loading ──

async function loadTrials(jsonlPath: string): Promise<TrialResult[]> {
  const content = await readFile(jsonlPath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TrialResult);
}

// ── parameter importance (Spearman) ──

interface ParameterImportance {
  readonly key: string;
  readonly method: 'spearman';
  readonly score: number;
}

export function computeSpearmanImportance(trials: TrialResult[]): ParameterImportance[] {
  if (trials.length < 5) return [];

  const paramKeys = new Set<string>();
  for (const t of trials) {
    for (const k of Object.keys(t.params)) {
      paramKeys.add(k);
    }
  }

  const objectives = trials.map((t) => t.metrics.objectiveScore);
  const rankings = rankArray(objectives);

  const results: ParameterImportance[] = [];
  for (const key of paramKeys) {
    const values = trials.map((t) => t.params[key as keyof TrialParams] ?? 0);
    const rho = spearmanCorrelation(values, rankings);
    results.push({ key, method: 'spearman', score: Math.abs(rho) });
  }

  return results.toSorted((a, b) => b.score - a.score);
}

function rankArray(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = Array.from({ length: values.length }, () => 0);
  for (let rank = 0; rank < indexed.length; rank++) {
    ranks[indexed[rank]!.i] = rank + 1;
  }
  return ranks;
}

function spearmanCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    denX = 0,
    denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

// ── RRSI holdout verification ──

/**
 * The RRSI-verified winner: among holdout-scored trials that PASS the
 * overfit gap gate (evolve − holdout ≤ RRSI_HOLDOUT_GAP_TOLERANCE, mirroring
 * optimize.ts), the one with the best holdout objective. A rejected trial is
 * excluded even when its holdout score is the highest — same rule the tuner
 * applies when picking what to write to .env.
 */
export function pickVerifiedWinner(trials: readonly TrialResult[]): TrialResult | undefined {
  let winner: TrialResult | undefined;
  for (const trial of trials) {
    const holdout = trial.holdoutMetrics?.objectiveScore;
    if (typeof holdout !== 'number') continue;
    const gap = trial.metrics.objectiveScore - holdout;
    if (gap > RRSI_HOLDOUT_GAP_TOLERANCE) continue;
    if (winner === undefined || holdout > (winner.holdoutMetrics?.objectiveScore ?? -Infinity)) {
      winner = trial;
    }
  }
  return winner;
}

// ── report rendering ──

export function renderMarkdown(trials: TrialResult[], importance: ParameterImportance[]): string {
  const now = new Date().toISOString();

  const lexical = trials.filter((t) => t.dataset === 'search-quality');
  const profile = trials.filter((t) => t.dataset === 'profile-tier');

  const bestLexical = lexical.toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  )[0];
  const bestProfile = profile.toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  )[0];
  const verifiedWinner = pickVerifiedWinner(trials);
  const holdoutRows = trials
    .filter((t) => typeof t.holdoutMetrics?.objectiveScore === 'number')
    .toSorted(
      (a, b) => (b.holdoutMetrics!.objectiveScore ?? 0) - (a.holdoutMetrics!.objectiveScore ?? 0),
    );

  const top10Lexical = lexical
    .toSorted((a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore)
    .slice(0, 10);

  const allSorted = [...lexical, ...profile].toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  );
  const bestOverall = allSorted[0];

  const lines: string[] = [
    '# Search Tuning Report',
    '',
    `Generated: ${now}`,
    `Total trials: ${trials.length}`,
    '',
    '## Best Overall',
    '',
    `| Trial | Score | MRR@10 | NDCG@10 | P@1 | P@3 |`,
    `|-------|-------|--------|---------|-----|-----|`,
  ];

  if (bestOverall) {
    lines.push(
      `| ${bestOverall.trialId} | ${bestOverall.metrics.objectiveScore.toFixed(4)} | ${bestOverall.metrics.mrrAt10.toFixed(3)} | ${bestOverall.metrics.ndcgAt10.toFixed(3)} | ${bestOverall.metrics.pAt1.toFixed(3)} | ${bestOverall.metrics.pAt3.toFixed(3)} |`,
    );
  }

  lines.push('', '## Best Lexical (search-quality)', '');
  if (bestLexical) {
    lines.push('```json');
    lines.push(JSON.stringify(bestLexical.params, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`Score: ${bestLexical.metrics.objectiveScore.toFixed(4)}`);
    lines.push(
      `MRR@10: ${bestLexical.metrics.mrrAt10.toFixed(3)} | NDCG@10: ${bestLexical.metrics.ndcgAt10.toFixed(3)}`,
    );
    lines.push(
      `P@1: ${bestLexical.metrics.pAt1.toFixed(3)} | P@3: ${bestLexical.metrics.pAt3.toFixed(3)} | P@5: ${bestLexical.metrics.pAt5.toFixed(3)}`,
    );
  }

  lines.push('', '## Best Profile (profile-tier)', '');
  if (bestProfile) {
    lines.push('```json');
    lines.push(JSON.stringify(bestProfile.params, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`Score: ${bestProfile.metrics.objectiveScore.toFixed(4)}`);
  }

  lines.push('', '## Top 10 Lexical Configurations', '');
  lines.push('| # | Trial | Score | MRR@10 | NDCG@10 | P@1 | P@3 | Failed |');
  lines.push('|---|-------|-------|--------|---------|-----|-----|--------|');
  for (let i = 0; i < top10Lexical.length; i++) {
    const t = top10Lexical[i]!;
    lines.push(
      `| ${i + 1} | ${t.trialId} | ${t.metrics.objectiveScore.toFixed(4)} | ${t.metrics.mrrAt10.toFixed(3)} | ${t.metrics.ndcgAt10.toFixed(3)} | ${t.metrics.pAt1.toFixed(3)} | ${t.metrics.pAt3.toFixed(3)} | ${t.failedCases?.length ?? 0} |`,
    );
  }

  // RRSI holdout verification: the raw best lexical config is only trusted
  // after it survives the disjoint holdout slice. This table is the evidence.
  if (holdoutRows.length > 0) {
    lines.push('', '## RRSI Holdout Verification', '');
    lines.push('| Trial | Evolve | Holdout | Gap | Verdict |');
    lines.push('|-------|--------|---------|-----|---------|');
    for (const t of holdoutRows) {
      const evolve = t.metrics.objectiveScore;
      const holdout = t.holdoutMetrics!.objectiveScore!;
      const gap = evolve - holdout;
      const verdict = gap > RRSI_HOLDOUT_GAP_TOLERANCE ? 'REJECT (overfit)' : 'ACCEPT';
      lines.push(
        `| ${t.trialId} | ${evolve.toFixed(4)} | ${holdout.toFixed(4)} | ${gap >= 0 ? '+' : ''}${gap.toFixed(3)} | ${verdict} |`,
      );
    }
  }

  if (importance.length > 0) {
    lines.push('', '## Parameter Importance (|Spearman ρ|)', '');
    lines.push('| # | Parameter | Importance |');
    lines.push('|---|-----------|------------|');
    for (let i = 0; i < importance.length; i++) {
      const p = importance[i]!;
      lines.push(`| ${i + 1} | \`${p.key}\` | ${p.score.toFixed(4)} |`);
    }
  }

  // Recommended defaults: prefer the RRSI-verified winner over the raw best —
  // an evolve winner that was never holdout-scored (or got λ-regularized out
  // of the verification shortlist) is exactly the overfit risk the gate
  // exists to catch. Historical vector-signal keys are stripped: the dense
  // path is gone, so recommending them would write dead env vars.
  const recommendationSource = verifiedWinner ?? bestLexical;
  if (recommendationSource) {
    const vectorKeys: readonly string[] = VECTOR_TUNABLE_PARAM_KEYS;
    const recommended = Object.entries(recommendationSource.params).filter(
      ([key, value]) => value !== undefined && !vectorKeys.includes(key),
    );
    const excluded = Object.keys(recommendationSource.params).filter((key) =>
      vectorKeys.includes(key),
    );
    lines.push('', '## Recommended Defaults', '');
    lines.push(
      `Source: ${recommendationSource.trialId}${verifiedWinner ? ' (RRSI holdout-verified)' : ' (raw best — no holdout-verified candidate present)'}`,
    );
    if (excluded.length > 0) {
      lines.push(
        '',
        `> Excluded ${excluded.length} historical vector-signal key(s) (${excluded.join(', ')}): removed with the dense path; no recommendation is emitted.`,
      );
    }
    lines.push('', '```bash');
    for (const [key, value] of recommended) {
      lines.push(`export ${key}=${value}`);
    }
    lines.push('```');
  }

  // Failed cases from best lexical
  const failedCases = bestLexical?.failedCases ?? [];
  if (failedCases.length > 0) {
    lines.push('', '## Failed Cases (Best Lexical)', '');
    lines.push('| Query | Expected | Actual Top-5 | Rank |');
    lines.push('|-------|----------|---------------|------|');
    for (const fc of failedCases) {
      lines.push(
        `| "${fc.query}" | ${fc.expectedTop.join(', ')} | ${fc.actualTop5.slice(0, 3).join(', ')} | ${fc.firstRelevantRank ?? 'N/A'} |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── main ──

/** True when this module is the process entry point (tsx / node), so the
 *  vitest import path runs no CLI side effects. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryPath = isAbsolute(entry) ? entry : pathResolve(process.cwd(), entry);
  return entryPath === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const { inPath, outPath } = parseCliArgs();

  console.log(`Loading trials from ${inPath}...`);
  const trials = await loadTrials(inPath);
  console.log(`Loaded ${trials.length} trials`);

  // Importance over the RANDOMIZED phase-1 slice. Phase 2 rows are ±1-step
  // refinements clustered around the phase-1 winners: both param values and
  // objectives concentrate, and rank correlation on that structured slice
  // degenerates into near-uniform spurious ρ (the "every param ≈0.83" reports
  // from before this fix). Phase 1's wide, unbiased coverage is the sound
  // basis for importance.
  const importance = computeSpearmanImportance(
    trials.filter((t) => t.dataset === 'search-quality' && t.phase === 1),
  );
  console.log(`Computed importance for ${importance.length} parameters`);

  const markdown = renderMarkdown(trials, importance);
  await writeFile(outPath, markdown, 'utf-8');
  console.log(`Report written to ${outPath}`);
}

if (isDirectRun()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

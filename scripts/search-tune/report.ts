/**
 * Search tuning report generator.
 * Reads trials.jsonl and outputs a markdown report with top configs and parameter importance.
 *
 * Usage:
 *   tsx scripts/search-tune/report.ts [--in artifacts/search-tuning/trials.jsonl] [--out artifacts/search-tuning/report.md]
 */
import { readFile, writeFile } from 'fs/promises';
import type { TrialParams } from './search-space';
import type { TrialResult } from './worker';

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

function computeSpearmanImportance(trials: TrialResult[]): ParameterImportance[] {
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
  const ranks = Array.from({ length: values.length });
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

// ── report rendering ──

function renderMarkdown(trials: TrialResult[], importance: ParameterImportance[]): string {
  const now = new Date().toISOString();

  const lexical = trials.filter((t) => t.dataset === 'search-quality');
  const profile = trials.filter((t) => t.dataset === 'profile-tier');

  const bestLexical = lexical.toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  )[0];
  const bestProfile = profile.toSorted(
    (a, b) => b.metrics.objectiveScore - a.metrics.objectiveScore,
  )[0];

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
      `| ${i + 1} | ${t.trialId} | ${t.metrics.objectiveScore.toFixed(4)} | ${t.metrics.mrrAt10.toFixed(3)} | ${t.metrics.ndcgAt10.toFixed(3)} | ${t.metrics.pAt1.toFixed(3)} | ${t.metrics.pAt3.toFixed(3)} | ${t.failedCases.length} |`,
    );
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

  // Recommended defaults
  if (bestLexical) {
    lines.push('', '## Recommended Defaults', '');
    lines.push('```bash');
    for (const [key, value] of Object.entries(bestLexical.params)) {
      if (value !== undefined) {
        lines.push(`export ${key}=${value}`);
      }
    }
    lines.push('```');
  }

  // Failed cases from best lexical
  if (bestLexical && bestLexical.failedCases.length > 0) {
    lines.push('', '## Failed Cases (Best Lexical)', '');
    lines.push('| Query | Expected | Actual Top-5 | Rank |');
    lines.push('|-------|----------|---------------|------|');
    for (const fc of bestLexical.failedCases) {
      lines.push(
        `| "${fc.query}" | ${fc.expectedTop.join(', ')} | ${fc.actualTop5.slice(0, 3).join(', ')} | ${fc.firstRelevantRank ?? 'N/A'} |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── main ──

async function main(): Promise<void> {
  const { inPath, outPath } = parseCliArgs();

  console.log(`Loading trials from ${inPath}...`);
  const trials = await loadTrials(inPath);
  console.log(`Loaded ${trials.length} trials`);

  const importance = computeSpearmanImportance(trials.filter((t) => t.phase === 1));
  console.log(`Computed importance for ${importance.length} parameters`);

  const markdown = renderMarkdown(trials, importance);
  await writeFile(outPath, markdown, 'utf-8');
  console.log(`Report written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

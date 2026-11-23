/**
 * Produce a durable baseline artifact by running the single evaluation seam
 * under a parameter set. Env overrides are applied before the engine module is
 * imported, because constants are read at module load.
 *
 * Usage:
 *   tsx scripts/search-tune/run-baseline.ts --corpus fixture \
 *     --params scripts/search-tune/baselines/params-2026-11-23-h03.json \
 *     --out scripts/search-tune/baselines/fixture.defaults.json \
 *     --winner h03 --optimizer-score 0.8554 --tuning-ms 520000
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildSearchQualityFixture } from '../../tests/server/search/fixtures/search-quality.fixture';
import type { SearchEvalCase } from '../../tests/server/search/fixtures/search-quality.fixture';
import type { BaselineProvenance, CorpusKind } from './evaluation';
import { splitEvolveHoldout } from './holdout';

export interface BaselineRunOptions {
  readonly corpus: CorpusKind;
  readonly outPath: string;
  readonly paramsPath?: string;
  readonly latencyRepeats?: number;
  readonly seed?: number;
  readonly evolveRatio?: number;
  readonly budgetTruncated?: boolean;
  readonly tuningBudgetMs?: number;
  readonly winnerTrialId?: string;
  readonly optimizerScore?: number;
  readonly note?: string;
}

export async function buildBaseline(options: BaselineRunOptions): Promise<void> {
  let paramOverrides: Record<string, number> = {};
  if (options.paramsPath) {
    const raw = await readFile(options.paramsPath, 'utf8');
    paramOverrides = JSON.parse(raw) as Record<string, number>;
    for (const [key, value] of Object.entries(paramOverrides)) process.env[key] = String(value);
  }
  const { runSearchEvaluation, toBaselineArtifact } = await import('./evaluation');
  const fixture = buildSearchQualityFixture();
  const seed = options.seed ?? 42;
  const evolveRatio = options.evolveRatio ?? 0.7;
  const split = splitEvolveHoldout(fixture.cases, { evolveRatio, seed });
  const provenance: BaselineProvenance = {
    gitSha: readGitSha(),
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    seed,
    evolveRatio,
    split: {
      evolve: split.evolve.length,
      holdout: split.holdout.length,
      singleTagCases: split.singleTagCases.length,
    },
    datasetHash: hashCases(fixture.cases),
    budgetTruncated: options.budgetTruncated ?? false,
    tuningBudgetMs: options.tuningBudgetMs ?? 0,
    winnerTrialId: options.winnerTrialId,
    optimizerScore: options.optimizerScore,
    note: options.note,
  };
  const report = await runSearchEvaluation({
    corpus: options.corpus,
    cases: fixture.cases,
    paramOverrides,
    latencyRepeats: options.latencyRepeats ?? 3,
    include: { perCase: true, ledger: true, significance: false },
  });
  if (report.status === 'blocked') {
    throw new Error(`baseline blocked: ${report.blockers.join(', ')}`);
  }
  const artifact = toBaselineArtifact(report, fixture.cases, provenance);
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        status: report.status,
        corpus: report.corpus,
        aggregate: report.aggregate,
        latency: report.latency,
        paramsHash: report.config.paramsHash,
        rankedHash: report.determinism.rankedHash,
        provenance,
        out: options.outPath,
      },
      null,
      2,
    ),
  );
}

function readGitSha(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    // A baseline from a dirty tree is not reproducible from the named commit;
    // surface that in the artifact instead of claiming an exact revision.
    const dirty =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

function hashCases(cases: readonly SearchEvalCase[]): string {
  const text = cases
    .map(
      (testCase) =>
        `${testCase.id}\u001f${testCase.query}\u001f${testCase.topK}\u001f${testCase.expectations
          .map((expectation) => `${expectation.tool}:${expectation.gain}`)
          .join(',')}`,
    )
    .join('\u001e');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  await buildBaseline({
    corpus: get('corpus', 'fixture') as CorpusKind,
    outPath: get('out', 'artifacts/search-tuning/baseline.json'),
    paramsPath: get('params', '') || undefined,
    latencyRepeats: Number(get('repeats', '3')),
    seed: Number(get('seed', '42')),
    evolveRatio: Number(get('evolve-ratio', '0.7')),
    budgetTruncated: get('truncated', 'false') === 'true',
    tuningBudgetMs: Number(get('tuning-ms', '0')),
    winnerTrialId: get('winner', '') || undefined,
    optimizerScore: get('optimizer-score', '') ? Number(get('optimizer-score', '0')) : undefined,
    note: get('note', '') || undefined,
  });
}

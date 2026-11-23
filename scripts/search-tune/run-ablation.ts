/**
 * D2 mechanism ablation runner.
 *
 * One clean child process per mechanism x corpus. Env-based neutralisation is
 * applied at process start so the constants module loads the ablated values;
 * SearchConfig-based neutralisation goes through the single evaluation seam.
 *
 * `patch` and `not-possible` mechanisms are recorded as not-run, never as zero
 * contribution.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SEARCH_MECHANISMS, getMechanism } from './ablation';
import type { MechanismDescriptor } from './ablation';
import { buildSearchQualityFixture } from '../../tests/server/search/fixtures/search-quality.fixture';
import type { BaselineArtifact, CorpusKind, EvaluationReport } from './evaluation';

const SELF = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const OUT_ROOT = join(ROOT, 'docs/research/tool-search-2025-26/ablation');
const BASELINE_DIR = join(ROOT, 'scripts/search-tune/baselines');
const CORPORA: readonly CorpusKind[] = ['fixture', 'registry'];

interface AblationRecord {
  readonly mechanism: string;
  readonly group: string;
  readonly corpus: CorpusKind;
  readonly status: 'measured' | 'not-run' | 'not-applicable' | 'failed';
  readonly neutralization: string;
  readonly reason?: string;
  readonly baselineObjective?: number;
  readonly ablatedObjective?: number;
  readonly contribution?: number;
  readonly contributionLower?: number;
  readonly contributionUpper?: number;
  readonly verdict?: string;
  readonly wins?: number;
  readonly losses?: number;
  readonly ties?: number;
  readonly pValue?: number;
  readonly blockers?: readonly string[];
}

function baselinePath(corpus: CorpusKind): string {
  return join(BASELINE_DIR, `2026-11-23-${corpus}-vector-off.defaults.json`);
}

function skipReason(mechanism: MechanismDescriptor): string | null {
  if (mechanism.neutralization !== 'config-zero')
    return `neutralization=${mechanism.neutralization}`;
  if (mechanism.id === 'dense') return 'baseline is already vector-off';
  if (mechanism.id === 'feedback-learning')
    return 'harness already forces vectorDynamicWeight=false';
  if (!mechanism.env && !mechanism.searchConfig && !mechanism.vectorMode) return 'no neutraliser';
  return null;
}

async function runChild(mechanismId: string, corpus: CorpusKind, outPath: string): Promise<void> {
  const mechanism = getMechanism(mechanismId);
  if (!mechanism) throw new Error(`unknown mechanism: ${mechanismId}`);
  const baselineRaw = await readFile(baselinePath(corpus), 'utf8');
  const baseline = JSON.parse(baselineRaw) as BaselineArtifact;
  const { runSearchEvaluation } = await import('./evaluation');
  const fixture = buildSearchQualityFixture();
  const report = await runSearchEvaluation({
    corpus,
    vectorMode: mechanism.vectorMode ?? 'off',
    cases: fixture.cases,
    compareTo: baseline,
    searchConfigOverrides: mechanism.searchConfig,
    mechanismOverrides: [mechanism.id],
    latencyRepeats: 1,
    include: { perCase: false, significance: true, ledger: false },
  });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const delta = report.delta;
  console.log(
    JSON.stringify({
      mechanism: mechanism.id,
      corpus,
      status: report.status,
      baselineObjective: baseline.aggregate.objectiveScore,
      ablatedObjective: report.aggregate.objectiveScore,
      deltaPoint: delta?.point,
      deltaLower: delta?.interval.lower,
      deltaUpper: delta?.interval.upper,
      wins: delta?.winLossTie.wins,
      losses: delta?.winLossTie.losses,
      ties: delta?.winLossTie.ties,
      pValue: delta?.signTest.pValue,
      verdict: delta?.verdict,
      blockers: report.blockers,
    }),
  );
}

async function runOne(mechanism: MechanismDescriptor, corpus: CorpusKind): Promise<AblationRecord> {
  const skip = skipReason(mechanism);
  const dir = join(OUT_ROOT, corpus);
  await mkdir(dir, { recursive: true });
  const outPath = join(dir, `${mechanism.id}.json`);
  if (skip) {
    const status = skip.startsWith('neutralization=') ? 'not-run' : 'not-applicable';
    return {
      mechanism: mechanism.id,
      group: mechanism.group,
      corpus,
      status,
      neutralization: mechanism.neutralization,
      reason: skip,
    };
  }
  const env = { ...process.env, ...mechanism.env };
  const code = await new Promise<number>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        SELF,
        '--child',
        '--mechanism',
        mechanism.id,
        '--corpus',
        corpus,
        '--out',
        outPath,
      ],
      { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (exitCode) => {
      if (exitCode !== 0)
        console.error(`child ${mechanism.id}/${corpus} failed: ${stderr.slice(-500)}`);
      resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) {
    return {
      mechanism: mechanism.id,
      group: mechanism.group,
      corpus,
      status: 'failed',
      neutralization: mechanism.neutralization,
      reason: 'child process failed',
    };
  }
  const report = JSON.parse(await readFile(outPath, 'utf8')) as EvaluationReport;
  const delta = report.delta;
  if (!delta) {
    return {
      mechanism: mechanism.id,
      group: mechanism.group,
      corpus,
      status: 'failed',
      neutralization: mechanism.neutralization,
      reason: 'no delta in report',
      blockers: report.blockers,
    };
  }
  return {
    mechanism: mechanism.id,
    group: mechanism.group,
    corpus,
    status: 'measured',
    neutralization: mechanism.neutralization,
    baselineObjective: report.aggregate.objectiveScore - delta.point,
    ablatedObjective: report.aggregate.objectiveScore,
    contribution: -delta.point,
    contributionLower: -delta.interval.upper,
    contributionUpper: -delta.interval.lower,
    verdict: delta.verdict,
    wins: delta.winLossTie.wins,
    losses: delta.winLossTie.losses,
    ties: delta.winLossTie.ties,
    pValue: delta.signTest.pValue,
    blockers: report.blockers,
  };
}

async function runAll(): Promise<void> {
  const records: AblationRecord[] = [];
  for (const mechanism of SEARCH_MECHANISMS) {
    for (const corpus of CORPORA) {
      process.stdout.write(`ablate ${mechanism.id} / ${corpus} ... `);
      const record = await runOne(mechanism, corpus);
      console.log(record.status);
      records.push(record);
      await writeFile(
        join(OUT_ROOT, 'records.json'),
        `${JSON.stringify(records, null, 2)}\n`,
        'utf8',
      );
    }
  }
  await writeSummary(records);
}

async function writeSummary(records: readonly AblationRecord[]): Promise<void> {
  const byMechanism = new Map<string, AblationRecord[]>();
  for (const record of records) {
    const list = byMechanism.get(record.mechanism) ?? [];
    list.push(record);
    byMechanism.set(record.mechanism, list);
  }
  const lines: string[] = [];
  lines.push('# D2 mechanism ablation');
  lines.push('');
  lines.push(
    'Contribution = baseline objective - ablated objective. Positive means the mechanism earns its keep; <= 0 means removing it does not hurt (deletion candidate).',
  );
  lines.push('');
  lines.push('| Mechanism | Group | Fixture contribution | Registry contribution | Status |');
  lines.push('|---|---|---:|---:|---|');
  const rows: { id: string; group: string; fixture?: number; registry?: number; status: string }[] =
    [];
  for (const [id, list] of byMechanism) {
    const fixture = list.find((record) => record.corpus === 'fixture');
    const registry = list.find((record) => record.corpus === 'registry');
    const status =
      fixture?.status === 'measured' && registry?.status === 'measured'
        ? (fixture.contribution ?? 0) <= 0 && (registry.contribution ?? 0) <= 0
          ? 'delete-candidate'
          : (fixture.contribution ?? 0) > 0.01 || (registry.contribution ?? 0) > 0.01
            ? 'keep'
            : 'inconclusive'
        : [fixture?.status, registry?.status].filter(Boolean).join('/');
    rows.push({
      id,
      group: list[0]?.group ?? '',
      fixture: fixture?.contribution,
      registry: registry?.contribution,
      status,
    });
  }
  const sortedRows = rows.toSorted((a, b) => (a.fixture ?? 99) - (b.fixture ?? 99));
  for (const row of sortedRows) {
    const f = row.fixture === undefined ? '—' : row.fixture.toFixed(4);
    const r = row.registry === undefined ? '—' : row.registry.toFixed(4);
    lines.push(`| ${row.id} | ${row.group} | ${f} | ${r} | ${row.status} |`);
  }
  lines.push('');
  const deleteCandidates = rows
    .filter((row) => row.status === 'delete-candidate')
    .map((row) => row.id);
  lines.push(
    `Delete candidates: ${deleteCandidates.length > 0 ? deleteCandidates.join(', ') : 'none'}.`,
  );
  lines.push('');
  lines.push(
    '`patch` / `not-possible` mechanisms are not-run and must be reported as unknown, never as zero.',
  );
  await writeFile(join(OUT_ROOT, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
  await writeFile(join(OUT_ROOT, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--child')) {
    const get = (name: string): string => {
      const index = args.indexOf(`--${name}`);
      return index >= 0 ? (args[index + 1] ?? '') : '';
    };
    const mechanismId = get('mechanism');
    const corpus = get('corpus') as CorpusKind;
    const outPath = get('out');
    if (!mechanismId || !corpus || !outPath)
      throw new Error('child requires --mechanism --corpus --out');
    await runChild(mechanismId, corpus, outPath);
  } else {
    await runAll();
  }
}

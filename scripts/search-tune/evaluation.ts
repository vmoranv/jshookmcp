/**
 * The single evaluation seam for Search.
 *
 * `runSearchEvaluation` owns corpus resolution, engine construction, isolation,
 * per-case ranking capture, metrics, latency sampling, baseline pairing,
 * significance, and the complexity ledger. Ablation, registry evaluation,
 * candidate experiments, and reporting are requests to this function only.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import type { Tool } from '@modelcontextprotocol/server';

import { DEFAULT_SEARCH_CONFIG } from '../../src/config/search-defaults';
import type { SearchConfig } from '../../src/types/config';
import type { SearchEvalCase } from '../../tests/server/search/fixtures/search-quality.fixture';
import { buildSearchQualityFixture } from '../../tests/server/search/fixtures/search-quality.fixture';
import { computeComplexityLedger } from './complexity-ledger';
import type { ComplexityCounts, LedgerSource } from './complexity-ledger';
import { aggregateSearchMetrics, evaluateCase } from './metrics';
import type { AggregateMetrics, CaseMetrics, RankedResult } from './metrics';
import { adoptionVerdict, pairedBootstrap, signTest, winLossTie } from './significance';
import type {
  AdoptionVerdict,
  BootstrapInterval,
  SignTestResult,
  WinLossTie,
} from './significance';

export type CorpusKind = 'fixture' | 'registry';
export type VectorMode = 'off' | 'on';
export type EvaluationStatus = 'ok' | 'blocked' | 'partial';

/** Structural engine interface; the real engine satisfies it, tests stub it. */
export interface SearchEngineLike {
  search(
    query: string,
    topK?: number,
  ): Promise<
    ReadonlyArray<{
      readonly name: string;
      readonly score: number;
      readonly domain?: string | null;
    }>
  >;
  extensionEtag?: string;
}

export interface EvaluationCaseResult {
  readonly id: string;
  readonly query: string;
  readonly ranked: readonly RankedResult[];
  readonly latencyMs: readonly number[];
}

export interface LatencySummary {
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly samples: number;
}

export interface BaselineCaseMetrics {
  readonly id: string;
  readonly reciprocalRankAt10: number;
  readonly ndcgAt10: number;
  readonly hitAt1: 0 | 1;
  readonly hitAt3: 0 | 1;
  readonly hitAt5: 0 | 1;
}

export interface BaselineProvenance {
  readonly gitSha: string | null;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly cpu: string;
  readonly seed: number;
  readonly evolveRatio: number;
  readonly split: {
    readonly evolve: number;
    readonly holdout: number;
    readonly singleTagCases: number;
  };
  readonly datasetHash: string;
  readonly budgetTruncated: boolean;
  readonly tuningBudgetMs: number;
  readonly winnerTrialId?: string;
  readonly optimizerScore?: number;
  readonly note?: string;
}
export interface BaselineArtifact {
  readonly version: 1;
  readonly createdAt: string;
  readonly corpus: {
    readonly kind: CorpusKind;
    readonly toolCount: number;
    readonly caseCount: number;
  };
  readonly config: {
    readonly vectorMode: VectorMode;
    readonly paramsHash: string;
    readonly paramOverrides: Readonly<Record<string, number>>;
  };
  readonly aggregate: AggregateMetrics;
  readonly latency: LatencySummary;
  readonly perCase: readonly BaselineCaseMetrics[];
  readonly ledger?: ComplexityCounts;
  readonly provenance?: BaselineProvenance;
}

export interface DeltaReport {
  readonly baseline: { readonly createdAt: string; readonly paramsHash: string };
  readonly point: number;
  readonly interval: BootstrapInterval;
  readonly signTest: SignTestResult;
  readonly winLossTie: WinLossTie;
  readonly verdict: AdoptionVerdict;
  readonly perCase: readonly {
    readonly id: string;
    readonly current: number;
    readonly baseline: number;
    readonly delta: number;
  }[];
}

export interface EvaluationRequest {
  readonly corpus: CorpusKind;
  readonly vectorMode: VectorMode;
  readonly cases?: readonly SearchEvalCase[];
  readonly engine?: SearchEngineLike;
  readonly toolCountHint?: number;
  readonly paramOverrides?: Readonly<Record<string, number>>;
  readonly searchConfigOverrides?: Partial<SearchConfig>;
  readonly mechanismOverrides?: readonly string[];
  readonly latencyRepeats?: number;
  readonly topK?: number;
  readonly compareTo?: BaselineArtifact;
  readonly include?: {
    readonly perCase?: boolean;
    readonly significance?: boolean;
    readonly ledger?: boolean;
  };
  readonly ledgerSource?: LedgerSource;
  readonly isolation?: { readonly stateDir?: string };
  readonly now?: () => Date;
}

export interface EvaluationReport {
  readonly status: EvaluationStatus;
  readonly blockers: readonly string[];
  readonly corpus: {
    readonly kind: CorpusKind;
    readonly toolCount: number;
    readonly caseCount: number;
  };
  readonly config: {
    readonly vectorMode: VectorMode;
    readonly paramsHash: string;
    readonly paramOverrides: Readonly<Record<string, number>>;
    readonly mechanisms: readonly string[];
  };
  readonly aggregate: AggregateMetrics;
  readonly latency: LatencySummary;
  readonly perCase?: readonly EvaluationCaseResult[];
  readonly delta?: DeltaReport;
  readonly ledger?: ComplexityCounts;
  readonly determinism: {
    readonly rankedHash: string;
    readonly repeatHash?: string;
    readonly identical?: boolean;
  };
  readonly createdAt: string;
}

interface LoadedCorpus {
  readonly kind: CorpusKind;
  readonly tools: readonly Tool[];
  readonly domainByToolName: ReadonlyMap<string, string>;
  readonly sceneKeywords?: ReadonlyMap<string, readonly string[]>;
  readonly cases: readonly SearchEvalCase[];
}

export async function runSearchEvaluation(request: EvaluationRequest): Promise<EvaluationReport> {
  const blockers: string[] = [];
  const createdAt = (request.now ?? (() => new Date()))().toISOString();
  const topK = clampInt(request.topK ?? 10, 1, 50);
  const repeats = clampInt(request.latencyRepeats ?? 3, 1, 5);

  const corpus = await resolveCorpus(request);
  if (corpus.cases.length === 0) {
    return emptyReport(request, blockers.concat('insufficient-cases'), createdAt);
  }

  let tempDir: string | undefined;
  if (!request.isolation?.stateDir && !request.engine) {
    tempDir = await mkdtemp(join(tmpdir(), 'jshook-search-eval-'));
  }
  const stateDir = request.isolation?.stateDir ?? tempDir;

  const run = async (): Promise<EvaluationReport> => {
    const engine = request.engine ?? (await buildEngine(corpus, request));

    const baseEtag = typeof engine.extensionEtag === 'string' ? engine.extensionEtag : '';
    // Warmup is discarded: it absorbs JIT and lazy-index cost so measured
    // latency reflects steady-state search, matching the evaluation contract.
    bustCache(engine, baseEtag, -1);
    const warmupCases = corpus.cases.slice(0, Math.min(15, corpus.cases.length));
    for (const warmupCase of warmupCases) {
      try {
        await engine.search(warmupCase.query, topK);
      } catch {
        // Warmup failures are surfaced by the measured pass.
      }
    }
    const rankedByCase = new Map<string, RankedResult[]>();
    const latencyByCase = new Map<string, number[]>();
    const hashes: string[] = [];

    for (let repeat = 0; repeat < repeats; repeat += 1) {
      bustCache(engine, baseEtag, repeat);
      const names: string[] = [];
      for (const testCase of corpus.cases) {
        const started = performance.now();
        try {
          const results = await engine.search(testCase.query, topK);
          const elapsed = performance.now() - started;
          const ranked = results.map((result): RankedResult => ({
            name: result.name,
            score: result.score,
            domain: result.domain ?? null,
          }));
          names.push(ranked[0]?.name ?? '');
          if (repeat === 0) rankedByCase.set(testCase.id, ranked);
          const samples = latencyByCase.get(testCase.id) ?? [];
          samples.push(elapsed);
          latencyByCase.set(testCase.id, samples);
        } catch (error) {
          blockers.push(`case-error:${testCase.id}:${errorMessage(error)}`);
          if (repeat === 0) rankedByCase.set(testCase.id, []);
        }
      }
      hashes.push(hashText(names.join('\n')));
    }
    restoreEtag(engine, baseEtag);

    const caseMetrics = corpus.cases.map((testCase) =>
      evaluateCase(rankedByCase.get(testCase.id) ?? [], testCase),
    );
    const aggregate = aggregateSearchMetrics(caseMetrics);
    const latency = summarizeLatency([...latencyByCase.values()].flat());
    const rankedHash = hashes[0] ?? '';
    const repeatHash = hashes[1];
    const identical = repeatHash === undefined ? undefined : rankedHash === repeatHash;
    if (identical === false) blockers.push('nondeterministic-repeat');

    const perCase = request.include?.perCase
      ? corpus.cases.map((testCase) => ({
          id: testCase.id,
          query: testCase.query,
          ranked: rankedByCase.get(testCase.id) ?? [],
          latencyMs: latencyByCase.get(testCase.id) ?? [],
        }))
      : undefined;

    const delta =
      request.compareTo && request.include?.significance !== false
        ? buildDelta(corpus.cases, caseMetrics, request.compareTo, blockers)
        : undefined;

    let ledger: ComplexityCounts | undefined;
    if (request.include?.ledger) {
      try {
        ledger = await computeComplexityLedger(request.ledgerSource);
      } catch (error) {
        blockers.push(`ledger-unavailable:${errorMessage(error)}`);
      }
    }

    const failedCases = blockers.filter((blocker) => blocker.startsWith('case-error:')).length;
    const status: EvaluationStatus =
      failedCases >= corpus.cases.length ? 'blocked' : blockers.length > 0 ? 'partial' : 'ok';

    return {
      status,
      blockers,
      corpus: {
        kind: corpus.kind,
        toolCount: request.engine ? (request.toolCountHint ?? 0) : corpus.tools.length,
        caseCount: corpus.cases.length,
      },
      config: {
        vectorMode: request.vectorMode,
        paramsHash: paramsHash(request),
        paramOverrides: request.paramOverrides ?? {},
        mechanisms: request.mechanismOverrides ?? [],
      },
      aggregate,
      latency,
      perCase,
      delta,
      ledger,
      determinism: { rankedHash, repeatHash, identical },
      createdAt,
    };
  };

  try {
    return await withStateDir(stateDir, run);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function resolveCorpus(request: EvaluationRequest): Promise<LoadedCorpus> {
  const fixture = buildSearchQualityFixture();
  const cases = request.cases ?? fixture.cases;
  if (request.engine) {
    return {
      kind: request.corpus,
      tools: [],
      domainByToolName: new Map(),
      cases,
    };
  }
  if (request.corpus === 'fixture') {
    return {
      kind: 'fixture',
      tools: fixture.tools,
      domainByToolName: fixture.domainByToolName,
      cases,
    };
  }
  const { initRegistry, getAllManifests } = await import('../../src/server/registry/index');
  const { loadSearchCatalog } = await import('../../src/server/registry/SearchCatalog');
  await initRegistry();
  const catalog = await loadSearchCatalog();
  const tools: Tool[] = [];
  const domainByToolName = new Map<string, string>();
  for (const manifest of getAllManifests()) {
    for (const registration of manifest.registrations) {
      tools.push(registration.tool);
      domainByToolName.set(registration.tool.name, manifest.domain);
    }
  }
  return {
    kind: 'registry',
    tools,
    domainByToolName,
    sceneKeywords: catalog.sceneKeywordsByToolName,
    cases,
  };
}

async function buildEngine(
  corpus: LoadedCorpus,
  request: EvaluationRequest,
): Promise<SearchEngineLike> {
  if (corpus.kind === 'fixture') {
    const { initRegistry } = await import('../../src/server/registry/index');
    await initRegistry();
  }
  const { ToolSearchEngine } = await import('../../src/server/search/ToolSearchEngineImpl');
  const config: SearchConfig = {
    ...DEFAULT_SEARCH_CONFIG,
    ...request.searchConfigOverrides,
  };
  return new ToolSearchEngine(
    [...corpus.tools],
    corpus.domainByToolName,
    undefined,
    undefined,
    config,
    corpus.sceneKeywords,
  );
}

function buildDelta(
  cases: readonly SearchEvalCase[],
  caseMetrics: readonly CaseMetrics[],
  baseline: BaselineArtifact,
  blockers: string[],
): DeltaReport | undefined {
  const baselineById = new Map(baseline.perCase.map((record) => [record.id, record]));
  const perCase: { id: string; current: number; baseline: number; delta: number }[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const testCase = cases[index]!;
    const base = baselineById.get(testCase.id);
    if (!base) {
      blockers.push(`baseline-case-missing:${testCase.id}`);
      return undefined;
    }
    const current = caseObjective(caseMetrics[index]!);
    const baselineValue = caseObjective(base);
    perCase.push({
      id: testCase.id,
      current,
      baseline: baselineValue,
      delta: current - baselineValue,
    });
  }
  const deltas = perCase.map((record) => record.delta);
  const interval = pairedBootstrap(deltas, { resamples: 10_000, confidence: 0.95, seed: 42 });
  return {
    baseline: { createdAt: baseline.createdAt, paramsHash: baseline.config.paramsHash },
    point: interval.point,
    interval,
    signTest: signTest(deltas),
    winLossTie: winLossTie(deltas),
    verdict: adoptionVerdict(interval.point, interval, 0.02),
    perCase,
  };
}

function caseObjective(
  metrics: Pick<CaseMetrics, 'reciprocalRankAt10' | 'ndcgAt10' | 'hitAt1' | 'hitAt3'>,
): number {
  return (
    0.45 * metrics.reciprocalRankAt10 +
    0.25 * metrics.ndcgAt10 +
    0.15 * metrics.hitAt1 +
    0.15 * metrics.hitAt3
  );
}

function summarizeLatency(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0, max: 0, samples: 0 };
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (quantile: number): number => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(quantile * (sorted.length - 1))),
    );
    return Number(sorted[index]!.toFixed(3));
  };
  return {
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: Number(sorted[sorted.length - 1]!.toFixed(3)),
    samples: sorted.length,
  };
}

function paramsHash(request: EvaluationRequest): string {
  return hashText(
    stableStringify({
      vectorMode: request.vectorMode,
      paramOverrides: request.paramOverrides ?? {},
      searchConfigOverrides: request.searchConfigOverrides ?? {},
      mechanismOverrides: request.mechanismOverrides ?? [],
    }),
  );
}

function bustCache(engine: SearchEngineLike, baseEtag: string, repeat: number): void {
  try {
    engine.extensionEtag = `${baseEtag}#eval-${repeat}`;
  } catch {
    // A frozen stub has no cache; nothing to bust.
  }
}

function restoreEtag(engine: SearchEngineLike, baseEtag: string): void {
  try {
    engine.extensionEtag = baseEtag;
  } catch {
    // Frozen stub.
  }
}

async function withStateDir<T>(dir: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.JSHOOK_STATE_DIR;
  if (dir) process.env.JSHOOK_STATE_DIR = dir;
  try {
    return await run();
  } finally {
    if (dir) {
      if (previous === undefined) delete process.env.JSHOOK_STATE_DIR;
      else process.env.JSHOOK_STATE_DIR = previous;
    }
  }
}

function emptyReport(
  request: EvaluationRequest,
  blockers: readonly string[],
  createdAt: string,
): EvaluationReport {
  const emptyAggregate = aggregateSearchMetrics([]);
  return {
    status: 'blocked',
    blockers,
    corpus: { kind: request.corpus, toolCount: request.toolCountHint ?? 0, caseCount: 0 },
    config: {
      vectorMode: request.vectorMode,
      paramsHash: paramsHash(request),
      paramOverrides: request.paramOverrides ?? {},
      mechanisms: request.mechanismOverrides ?? [],
    },
    aggregate: emptyAggregate,
    latency: { p50: 0, p90: 0, p95: 0, p99: 0, max: 0, samples: 0 },
    determinism: { rankedHash: '' },
    createdAt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Convert a measured report into a durable baseline artifact. Requires
 * per-case data so later candidates can be paired against the same cases.
 */
export function toBaselineArtifact(
  report: EvaluationReport,
  cases: readonly SearchEvalCase[],
  provenance?: BaselineProvenance,
): BaselineArtifact {
  if (!report.perCase) throw new Error('perCase is required to build a baseline artifact');
  const byId = new Map(report.perCase.map((record) => [record.id, record]));
  const perCase = cases.map((testCase) => {
    const record = byId.get(testCase.id);
    if (!record) throw new Error(`missing per-case result: ${testCase.id}`);
    const metrics = evaluateCase(record.ranked, testCase);
    return {
      id: testCase.id,
      reciprocalRankAt10: metrics.reciprocalRankAt10,
      ndcgAt10: metrics.ndcgAt10,
      hitAt1: metrics.hitAt1,
      hitAt3: metrics.hitAt3,
      hitAt5: metrics.hitAt5,
    };
  });
  return {
    version: 1,
    createdAt: report.createdAt,
    corpus: report.corpus,
    config: {
      vectorMode: report.config.vectorMode,
      paramsHash: report.config.paramsHash,
      paramOverrides: report.config.paramOverrides,
    },
    aggregate: report.aggregate,
    latency: report.latency,
    perCase,
    ledger: report.ledger,
    provenance,
  };
}
// ── CLI ──

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const report = await runSearchEvaluation({
    corpus: get('corpus', 'fixture') as CorpusKind,
    vectorMode: get('vector', 'off') as VectorMode,
    latencyRepeats: Number(get('repeats', '3')),
    include: { ledger: true, perCase: false, significance: false },
  });
  const json = JSON.stringify(report, null, 2);
  const out = get('out', '');
  if (out.length > 0) await writeFile(out, json, 'utf8');
  else console.log(json);
}

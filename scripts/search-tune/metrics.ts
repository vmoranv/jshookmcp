/**
 * Search tuning metrics: per-case evaluation, aggregation, and objective scoring.
 */

import type {
  SearchEvalCase,
  SearchExpectation,
} from '../../../tests/server/search/fixtures/search-quality.fixture';

// ── public types ──

export interface RankedResult {
  readonly name: string;
  readonly score: number;
  readonly domain: string | null;
}

export interface CaseMetrics {
  readonly reciprocalRankAt10: number;
  readonly ndcgAt10: number;
  readonly hitAt1: 0 | 1;
  readonly hitAt3: 0 | 1;
  readonly hitAt5: 0 | 1;
  readonly firstRelevantRank: number | null;
}

export interface ProfileMetrics {
  readonly inTierPrecisionAt3: number;
  readonly offTierRecallAt5: number;
  readonly crossTierEscapeSuccess: number;
}

export interface AggregateMetrics {
  readonly mrrAt10: number;
  readonly ndcgAt10: number;
  readonly pAt1: number;
  readonly pAt3: number;
  readonly pAt5: number;
  readonly successAt3: number;
  readonly successAt5: number;
  readonly profile?: ProfileMetrics;
  readonly objectiveScore: number;
}

export interface FailedCaseSummary {
  readonly id: string;
  readonly query: string;
  readonly actualTop5: readonly string[];
  readonly expectedTop: readonly string[];
  readonly firstRelevantRank: number | null;
}

// ── per-case evaluation ──

export function evaluateCase(
  results: readonly RankedResult[],
  testCase: SearchEvalCase,
): CaseMetrics {
  const topK = results.slice(0, 10);
  const relevantSet = new Set(testCase.expectations.filter((e) => e.gain >= 2).map((e) => e.tool));

  // MRR: first relevant rank
  let firstRelevantRank: number | null = null;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i]!.name)) {
      firstRelevantRank = i;
      break;
    }
  }
  const reciprocalRankAt10 = firstRelevantRank !== null ? 1 / (firstRelevantRank + 1) : 0;

  // NDCG@10
  const ndcgAt10 = computeNdcg(topK, testCase.expectations);

  // Hit@K
  const top1Names = topK.slice(0, 1).map((r) => r.name);
  const top3Names = topK.slice(0, 3).map((r) => r.name);
  const top5Names = topK.slice(0, 5).map((r) => r.name);
  const hitAt1 = top1Names.some((n) => relevantSet.has(n)) ? 1 : 0;
  const hitAt3 = top3Names.some((n) => relevantSet.has(n)) ? 1 : 0;
  const hitAt5 = top5Names.some((n) => relevantSet.has(n)) ? 1 : 0;

  return { reciprocalRankAt10, ndcgAt10, hitAt1, hitAt3, hitAt5, firstRelevantRank };
}

// ── aggregation ──

export function aggregateSearchMetrics(caseMetrics: readonly CaseMetrics[]): AggregateMetrics {
  const n = caseMetrics.length || 1;
  const mrrAt10 = caseMetrics.reduce((s, m) => s + m.reciprocalRankAt10, 0) / n;
  const ndcgAt10 = caseMetrics.reduce((s, m) => s + m.ndcgAt10, 0) / n;
  const pAt1 = caseMetrics.reduce((s, m) => s + m.hitAt1, 0) / n;
  const pAt3 = caseMetrics.reduce((s, m) => s + m.hitAt3, 0) / n;
  const pAt5 = caseMetrics.reduce((s, m) => s + m.hitAt5, 0) / n;
  const successAt3 = pAt3;
  const successAt5 = pAt5;

  // objective: 0.45*MRR + 0.25*NDCG + 0.15*P@1 + 0.15*Success@3
  const objectiveScore = 0.45 * mrrAt10 + 0.25 * ndcgAt10 + 0.15 * pAt1 + 0.15 * successAt3;

  return {
    mrrAt10,
    ndcgAt10,
    pAt1,
    pAt3,
    pAt5,
    successAt3,
    successAt5,
    objectiveScore,
  };
}

// ── failure summary ──

export function summarizeFailedCases(
  rankedResultsByCase: ReadonlyMap<string, readonly RankedResult[]>,
  cases: readonly SearchEvalCase[],
  topKThreshold = 3,
): readonly FailedCaseSummary[] {
  const failures: FailedCaseSummary[] = [];
  for (const testCase of cases) {
    const results = rankedResultsByCase.get(testCase.id);
    if (!results) continue;
    const relevantSet = new Set(
      testCase.expectations.filter((e) => e.gain >= 2).map((e) => e.tool),
    );
    const topSlice = results.slice(0, topKThreshold);
    const found = topSlice.some((r) => relevantSet.has(r.name));
    if (!found) {
      let firstRelevantRank: number | null = null;
      for (let i = 0; i < results.length; i++) {
        if (relevantSet.has(results[i]!.name)) {
          firstRelevantRank = i;
          break;
        }
      }
      failures.push({
        id: testCase.id,
        query: testCase.query,
        actualTop5: results.slice(0, 5).map((r) => r.name),
        expectedTop: [...relevantSet],
        firstRelevantRank,
      });
    }
  }
  return failures;
}

// ── NDCG computation ──

function computeNdcg(
  results: readonly RankedResult[],
  expectations: readonly SearchExpectation[],
): number {
  const gainMap = new Map<string, number>();
  for (const e of expectations) {
    gainMap.set(e.tool, e.gain);
  }

  // DCG@10
  let dcg = 0;
  for (let i = 0; i < results.length && i < 10; i++) {
    const gain = gainMap.get(results[i]!.name) ?? 0;
    dcg += gain / Math.log2(i + 2); // i+2 because log2(1) = 0
  }

  // IDCG@10
  const sortedGains = [...gainMap.values()].toSorted((a, b) => b - a);
  let idcg = 0;
  for (let i = 0; i < sortedGains.length && i < 10; i++) {
    idcg += sortedGains[i]! / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

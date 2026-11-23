import { describe, expect, it } from 'vitest';

import { runSearchEvaluation } from '../../../scripts/search-tune/evaluation';
import type { BaselineArtifact, SearchEngineLike } from '../../../scripts/search-tune/evaluation';
import { aggregateSearchMetrics } from '../../../scripts/search-tune/metrics';
import type { SearchEvalCase } from '../../server/search/fixtures/search-quality.fixture';

const CASES: readonly SearchEvalCase[] = [
  {
    id: 'alpha',
    title: 'alpha',
    query: 'alpha',
    topK: 10,
    expectations: [{ tool: 'tool_a', gain: 3 }],
    tags: [],
  },
  {
    id: 'beta',
    title: 'beta',
    query: 'beta',
    topK: 10,
    expectations: [{ tool: 'tool_b', gain: 2 }],
    tags: [],
  },
];

function stubEngine(rankings: Readonly<Record<string, readonly string[]>>): SearchEngineLike {
  return {
    extensionEtag: '',
    async search(query: string) {
      const names = rankings[query] ?? [];
      return names.map((name, index) => ({ name, score: 1 / (index + 1), domain: null }));
    },
  };
}

function perfectEngine(): SearchEngineLike {
  return stubEngine({ alpha: ['tool_a', 'tool_b'], beta: ['tool_b', 'tool_a'] });
}

function zeroBaseline(cases: readonly SearchEvalCase[]): BaselineArtifact {
  const perCase = cases.map((testCase) => ({
    id: testCase.id,
    reciprocalRankAt10: 0,
    ndcgAt10: 0,
    hitAt1: 0 as const,
    hitAt3: 0 as const,
    hitAt5: 0 as const,
  }));
  const aggregate = aggregateSearchMetrics(
    cases.map(() => ({
      reciprocalRankAt10: 0,
      ndcgAt10: 0,
      hitAt1: 0 as const,
      hitAt3: 0 as const,
      hitAt5: 0 as const,
      firstRelevantRank: null,
    })),
  );
  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    corpus: { kind: 'fixture', toolCount: 2, caseCount: cases.length },
    config: { vectorMode: 'off', paramsHash: 'baseline', paramOverrides: {} },
    aggregate,
    latency: { p50: 0, p90: 0, p95: 0, p99: 0, max: 0, samples: 0 },
    perCase,
  };
}

describe('runSearchEvaluation', () => {
  it('returns an ok report with stable rankings across latency repeats', async () => {
    const report = await runSearchEvaluation({
      corpus: 'fixture',
      vectorMode: 'off',
      engine: perfectEngine(),
      toolCountHint: 2,
      cases: CASES,
      latencyRepeats: 2,
      include: { perCase: true },
    });
    expect(report.status).toBe('ok');
    expect(report.aggregate.pAt1).toBe(1);
    expect(report.corpus.toolCount).toBe(2);
    expect(report.perCase).toHaveLength(2);
    expect(report.determinism.identical).toBe(true);
    expect(report.determinism.rankedHash).toHaveLength(16);
  });

  it('computes paired deltas against a baseline and returns a verdict', async () => {
    const report = await runSearchEvaluation({
      corpus: 'fixture',
      vectorMode: 'off',
      engine: perfectEngine(),
      toolCountHint: 2,
      cases: CASES,
      latencyRepeats: 1,
      compareTo: zeroBaseline(CASES),
      include: { significance: true },
    });
    expect(report.delta?.point).toBeCloseTo(1, 5);
    expect(report.delta?.winLossTie).toEqual({ wins: 2, losses: 0, ties: 0 });
    expect(report.delta?.verdict).toBe('adopt');
  });

  it('reports the ledger from the injected source', async () => {
    const counts = { scoreStages: 20, tunableParams: 35, runtimeDeps: 22, searchLoc: 5_000 };
    const report = await runSearchEvaluation({
      corpus: 'fixture',
      vectorMode: 'off',
      engine: perfectEngine(),
      toolCountHint: 2,
      cases: CASES,
      latencyRepeats: 1,
      include: { ledger: true },
      ledgerSource: { read: async () => counts },
    });
    expect(report.ledger).toEqual(counts);
  });

  it('blocks when every case throws', async () => {
    const failing: SearchEngineLike = {
      extensionEtag: '',
      async search() {
        throw new Error('boom');
      },
    };
    const report = await runSearchEvaluation({
      corpus: 'fixture',
      vectorMode: 'off',
      engine: failing,
      toolCountHint: 2,
      cases: CASES,
      latencyRepeats: 1,
    });
    expect(report.status).toBe('blocked');
    expect(report.blockers.filter((blocker) => blocker.startsWith('case-error:'))).toHaveLength(2);
  });

  it('blocks an empty corpus', async () => {
    const report = await runSearchEvaluation({
      corpus: 'fixture',
      vectorMode: 'off',
      engine: stubEngine({}),
      cases: [],
      latencyRepeats: 1,
    });
    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('insufficient-cases');
  });
});

/**
 * Report rendering tests (scripts/search-tune/report.ts).
 *
 * Locks down the two consumption fixes:
 *  - Recommended Defaults come from the RRSI holdout-verified winner (best
 *    holdout score), not the raw best evolve score, with vector keys stripped.
 *  - The importance slice fed to Spearman uses phase-1 random trials; the old
 *    phase>=2 refinement slice degenerated into near-uniform spurious ρ.
 */
import { describe, expect, it } from 'vitest';

import {
  computeSpearmanImportance,
  pickVerifiedWinner,
  renderMarkdown,
} from '../../../scripts/search-tune/report';

interface Metrics extends Record<string, number> {
  mrrAt10: number;
  ndcgAt10: number;
  pAt1: number;
  pAt3: number;
  pAt5: number;
  objectiveScore: number;
}

function makeMetrics(objectiveScore: number): Metrics {
  return {
    mrrAt10: objectiveScore * 0.95,
    ndcgAt10: objectiveScore,
    pAt1: 0.7,
    pAt3: 0.85,
    pAt5: 0.9,
    objectiveScore,
  };
}

function makeTrial(options: {
  trialId: string;
  phase?: number;
  dataset?: string;
  params?: Record<string, number>;
  objectiveScore: number;
  holdoutScore?: number;
}) {
  return {
    trialId: options.trialId,
    phase: options.phase ?? 2,
    dataset: options.dataset ?? 'search-quality',
    params: options.params ?? { SEARCH_BM25_K1: 1, SEARCH_RRF_K: 18 },
    metrics: makeMetrics(options.objectiveScore),
    ...(options.holdoutScore !== undefined
      ? { holdoutMetrics: makeMetrics(options.holdoutScore), holdoutCaseCount: 9 }
      : {}),
  };
}

describe('search-tune/report', () => {
  describe('pickVerifiedWinner', () => {
    it('picks the trial with the best holdout score', () => {
      const trials = [
        makeTrial({ trialId: 'h00', objectiveScore: 0.78, holdoutScore: 0.74 }),
        makeTrial({ trialId: 'h01', objectiveScore: 0.75, holdoutScore: 0.77 }),
        makeTrial({ trialId: 'p2-0001', objectiveScore: 0.8 }), // raw best, unverified
      ];
      expect(pickVerifiedWinner(trials)?.trialId).toBe('h01');
    });

    it('excludes gap-rejected trials even when their holdout score is the highest', () => {
      // evolve 0.95 / holdout 0.80 → gap 0.15 boundary is fine at exactly 0.15;
      // push to 0.95/0.79 (gap 0.16 → REJECT) while keeping the highest holdout.
      const trials = [
        makeTrial({ trialId: 'h-bad', objectiveScore: 0.95, holdoutScore: 0.79 }),
        makeTrial({ trialId: 'h-good', objectiveScore: 0.78, holdoutScore: 0.75 }),
      ];
      expect(pickVerifiedWinner(trials)?.trialId).toBe('h-good');
    });

    it('accepts a trial just inside the gap tolerance', () => {
      // 0.89 − 0.75 = 0.14, safely under the 0.15 gate (an exact-0.15 pair
      // floats to 0.15000…02 and rejects — same semantics as optimize.ts).
      const trials = [makeTrial({ trialId: 'h-edge', objectiveScore: 0.89, holdoutScore: 0.75 })];
      expect(pickVerifiedWinner(trials)?.trialId).toBe('h-edge');
    });

    it('returns undefined when no trial carries holdout metrics', () => {
      const trials = [makeTrial({ trialId: 'p1-0001', phase: 1, objectiveScore: 0.7 })];
      expect(pickVerifiedWinner(trials)).toBeUndefined();
    });
  });

  describe('renderMarkdown', () => {
    it('sources Recommended Defaults from the verified winner, not the raw best', () => {
      const markdown = renderMarkdown(
        [
          makeTrial({
            trialId: 'p2-0392',
            objectiveScore: 0.7961,
            params: { SEARCH_BM25_K1: 1.5 },
          }),
          makeTrial({
            trialId: 'h00',
            objectiveScore: 0.7842,
            holdoutScore: 0.7518,
            params: { SEARCH_BM25_K1: 0.8 },
          }),
        ],
        [],
      );
      expect(markdown).toContain('Source: h00 (RRSI holdout-verified)');
      expect(markdown).toContain('export SEARCH_BM25_K1=0.8');
      expect(markdown).not.toContain('export SEARCH_BM25_K1=1.5');
    });

    it('strips vector keys from recommendations and explains the exclusion', () => {
      const markdown = renderMarkdown(
        [
          makeTrial({
            trialId: 'h00',
            objectiveScore: 0.78,
            holdoutScore: 0.75,
            params: {
              SEARCH_BM25_K1: 0.8,
              SEARCH_VECTOR_BM25_SKIP_THRESHOLD: 25,
              SEARCH_VECTOR_COSINE_WEIGHT: 0.37,
              SEARCH_VECTOR_LEARN_UP: 0.09,
            },
          }),
        ],
        [],
      );
      expect(markdown).toContain('export SEARCH_BM25_K1=0.8');
      expect(markdown).not.toContain('export SEARCH_VECTOR_');
      expect(markdown).toContain('Excluded 3 historical vector-signal key(s)');
      expect(markdown).not.toContain('optimize.ts --vector');
    });

    it('renders the RRSI holdout table with gap-based verdicts', () => {
      const markdown = renderMarkdown(
        [
          makeTrial({ trialId: 'h00', objectiveScore: 0.9, holdoutScore: 0.7 }), // gap 0.20 → REJECT
          makeTrial({ trialId: 'h01', objectiveScore: 0.78, holdoutScore: 0.75 }), // gap 0.03 → ACCEPT
        ],
        [],
      );
      expect(markdown).toContain('## RRSI Holdout Verification');
      expect(markdown).toContain('| h00 | 0.9000 | 0.7000 | +0.200 | REJECT (overfit) |');
      expect(markdown).toContain('| h01 | 0.7800 | 0.7500 | +0.030 | ACCEPT |');
      // Winner selection mirrors the tuner: best holdout among ACCEPTed trials.
      expect(markdown).toContain('Source: h01 (RRSI holdout-verified)');
    });

    it('falls back to the raw best with an explicit note when nothing is verified', () => {
      const markdown = renderMarkdown(
        [makeTrial({ trialId: 'p2-0001', objectiveScore: 0.77 })],
        [],
      );
      expect(markdown).toContain(
        'Source: p2-0001 (raw best — no holdout-verified candidate present)',
      );
    });
  });

  describe('computeSpearmanImportance slice sanity', () => {
    it('differentiates a driving param from noise on a wide-coverage slice', () => {
      // Phase-1-like data: BM25_K1 drives the objective, RRF_K is noise.
      const trials = Array.from({ length: 60 }, (_, i) =>
        makeTrial({
          trialId: `p1-${i}`,
          phase: 1,
          objectiveScore: 0.5 + (i % 6) * 0.05,
          params: { SEARCH_BM25_K1: 0.5 + (i % 6) * 0.5, SEARCH_RRF_K: 10 + ((i * 7) % 12) * 8 },
        }),
      );
      const importance = computeSpearmanImportance(trials);
      const byKey = new Map(importance.map((p) => [p.key, p.score]));
      expect(byKey.get('SEARCH_BM25_K1')!).toBeGreaterThan(0.9);
      expect(byKey.get('SEARCH_BM25_K1')!).toBeGreaterThan(byKey.get('SEARCH_RRF_K')!);
    });
  });
});

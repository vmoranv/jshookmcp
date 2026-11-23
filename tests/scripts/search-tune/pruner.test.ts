/**
 * Pruner + objective regularization tests (scripts/search-tune/pruner.ts).
 *
 * The pruner freezes low-sensitivity parameters after a tuning phase so
 * subsequent sampling stops exploring dimensions that provably do not move
 * the objective. Regularization discounts candidates that drift far from the
 * shipped defaults, complementing the binary RRSI holdout gate with a
 * continuous overfitting penalty.
 */
import { describe, expect, it, vi } from 'vitest';

// Constants evaluate process.env at module load — scrub any SEARCH_*/RERANK_*
// leakage from the surrounding shell before the static imports bind, or the
// drift guard would compare against shell-polluted values.
vi.hoisted(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(SEARCH_|RERANK_)/.test(key)) delete process.env[key];
  }
});

import {
  deriveFrozenParams,
  regularizedScore,
  computeDefaultPenalty,
  type TrialSummary,
} from '../../../scripts/search-tune/pruner';
import {
  SEARCH_TUNE_DEFAULTS,
  type TunableParamKey,
} from '../../../scripts/search-tune/search-space';
import * as searchConstants from '../../../src/constants/search';

describe('search-tune/pruner', () => {
  describe('deriveFrozenParams', () => {
    it('freezes a low-sensitivity parameter back to its shipped default', () => {
      // SEARCH_RRF_K sweeps its whole range with < 0.002 objective spread
      // (objective is driven by BM25_K1, which is ORTHOGONAL to K so every K
      // bucket sees the same K1 distribution → equal bucket means).
      const trials: TrialSummary[] = [];
      for (const k of [10, 20, 30, 42, 50, 60, 70, 80, 90, 100, 110, 120]) {
        for (let k1Level = 0; k1Level < 3; k1Level++) {
          trials.push({
            params: { SEARCH_RRF_K: k, SEARCH_BM25_K1: 1 + k1Level * 0.5 },
            objectiveScore: 0.7 + k1Level * 0.1,
          });
        }
      }

      const { frozen } = deriveFrozenParams(trials);
      // Frozen to the SHIPPED DEFAULT (18), not to a sampled value: a
      // parameter that provably does not move the objective has no evidence
      // justifying drift from the default.
      expect(frozen.SEARCH_RRF_K).toBe(18);
      expect(frozen.SEARCH_BM25_K1).toBeUndefined();
    });

    it('does not freeze a high-sensitivity parameter', () => {
      const trials: TrialSummary[] = [];
      for (let i = 0; i < 36; i++) {
        const k1 = 1 + (i % 3) * 0.5;
        trials.push({
          params: { SEARCH_BM25_K1: k1, SEARCH_RRF_K: 10 + (i % 6) * 20 },
          objectiveScore: 0.5 + (k1 - 1) * 0.3, // strong dependence on K1
        });
      }

      const { frozen } = deriveFrozenParams(trials);
      expect(frozen.SEARCH_BM25_K1).toBeUndefined();
    });

    it('returns nothing when history is too small', () => {
      const trials: TrialSummary[] = [
        { params: { SEARCH_RRF_K: 18 }, objectiveScore: 0.6 },
        { params: { SEARCH_RRF_K: 20 }, objectiveScore: 0.61 },
      ];

      const { frozen } = deriveFrozenParams(trials);
      expect(Object.keys(frozen).length).toBe(0);
    });

    it('reports rationale for every frozen key', () => {
      const trials: TrialSummary[] = [];
      for (let i = 0; i < 30; i++) {
        trials.push({
          params: { SEARCH_RRF_K: 10 + (i % 6) * 2, SEARCH_BM25_K1: 1 + (i % 3) * 0.5 },
          objectiveScore: 0.8,
        });
      }

      const { frozen, rationale } = deriveFrozenParams(trials);
      for (const entry of rationale) {
        expect(frozen[entry.key as TunableParamKey]).toBeDefined();
        expect(entry.spread).toBeLessThan(0.002);
      }
    });
  });

  describe('regularization', () => {
    it('computeDefaultPenalty returns 0 when params equal the defaults', () => {
      const penalty = computeDefaultPenalty({ SEARCH_RRF_K: 18, SEARCH_BM25_K1: 1 });
      expect(penalty).toBe(0);
    });

    it('computeDefaultPenalty measures normalized drift from the default', () => {
      // SEARCH_RRF_K range [10, 120] (span 110), default 18 → value 30 drifts
      // by 12/110. SEARCH_BM25_K1 range [0.5, 3.0] (span 2.5), default 1 →
      // value 2.0 drifts by 1/2.5.
      const penalty = computeDefaultPenalty({ SEARCH_RRF_K: 30, SEARCH_BM25_K1: 2 });
      expect(penalty).toBeCloseTo(12 / 110 + 1 / 2.5, 10);
    });

    it('regularizedScore subtracts lambda times the penalty', () => {
      const trial: TrialSummary = {
        params: { SEARCH_RRF_K: 30, SEARCH_BM25_K1: 2 },
        objectiveScore: 0.9,
      };
      const expected = 0.9 - 0.01 * (12 / 110 + 1 / 2.5);
      expect(regularizedScore(trial, 0.01)).toBeCloseTo(expected, 10);
    });

    it('regularizedScore with lambda 0 is the raw objective', () => {
      const trial: TrialSummary = {
        params: { SEARCH_RRF_K: 30, SEARCH_BM25_K1: 2 },
        objectiveScore: 0.9,
      };
      expect(regularizedScore(trial, 0)).toBe(0.9);
    });
  });

  describe('SEARCH_TUNE_DEFAULTS drift guard', () => {
    it('matches every default in src/constants/search.ts (clean env)', () => {
      // Constants read process.env at module load. The search-tune worker
      // injects SEARCH_* env per trial, so this table must mirror the SHIPPED
      // defaults — this test fails the moment someone changes a default in
      // constants without updating the tuner (or vice versa).
      for (const [key, value] of Object.entries(SEARCH_TUNE_DEFAULTS)) {
        const actual = (searchConstants as Record<string, unknown>)[key];
        expect(actual, `default drift for ${key}`).toBe(value);
      }
    });

    it('covers every tunable param key', () => {
      const keys = Object.keys(SEARCH_TUNE_DEFAULTS);
      // 20 phase-1 lexical keys + 4 profile + 9 rerank (vector keys removed). The three
      // SEARCH_VECTOR_LEARN_* keys left the space: no offline eval observes
      // feedback-learning dynamics (see search-space.ts).
      expect(keys.length).toBeGreaterThanOrEqual(33);
      for (const key of keys) {
        expect(typeof SEARCH_TUNE_DEFAULTS[key as TunableParamKey]).toBe('number');
      }
    });
  });
});

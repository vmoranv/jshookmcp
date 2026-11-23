/**
 * Search-space gating tests (scripts/search-tune/search-space.ts).
 *
 * Locks down the vector dead-dimension fix: LEARN_* keys left the tuning
 * space entirely (offline evals never record tool-call feedback, so those
 * dimensions are unobservable), and the two vector-scoring keys only join
 * phase-1 sampling when the run passes --vector.
 */
import { describe, expect, it } from 'vitest';

import {
  PARAM_DEFS,
  SEARCH_TUNE_DEFAULTS,
  SEARCH_TUNE_PARAM_KEYS,
  VECTOR_SCORING_PARAM_KEYS,
  VECTOR_TUNABLE_PARAM_KEYS,
  getPhaseParams,
  sampleRandomParams,
} from '../../../scripts/search-tune/search-space';

const LEARN_KEYS = [
  'SEARCH_VECTOR_LEARN_UP',
  'SEARCH_VECTOR_LEARN_DOWN',
  'SEARCH_VECTOR_LEARN_TOP_N',
] as const;

describe('search-tune/search-space vector gating', () => {
  it('drops vector-scoring keys from phase 1 in a lexical run', () => {
    const lexical = getPhaseParams(PARAM_DEFS, 1, { vectorEnabled: false });
    const keys = lexical.map((d) => d.key);
    for (const key of VECTOR_SCORING_PARAM_KEYS) {
      expect(keys, `lexical phase 1 must not sample ${key}`).not.toContain(key);
    }
    // The lexical-only keys survive — the filter is surgical, not a blanket cut.
    expect(keys).toContain('SEARCH_BM25_K1');
    expect(keys).toContain('SEARCH_RRF_BM25_BLEND');
  });

  it('never includes vector-scoring keys after the dense-path removal', () => {
    for (const keys of [
      getPhaseParams(PARAM_DEFS, 1, { vectorEnabled: true }).map((d) => d.key),
      getPhaseParams(PARAM_DEFS, 1, { vectorEnabled: false }).map((d) => d.key),
      getPhaseParams(PARAM_DEFS, 1).map((d) => d.key),
    ]) {
      for (const key of VECTOR_SCORING_PARAM_KEYS) {
        expect(keys).not.toContain(key);
      }
    }
  });

  it('never includes vector-scoring keys in phases 2-4', () => {
    for (const phase of [2, 3, 4] as const) {
      const keys = getPhaseParams(PARAM_DEFS, phase).map((d) => d.key);
      for (const key of VECTOR_SCORING_PARAM_KEYS) {
        expect(keys).not.toContain(key);
      }
    }
  });
  it('sampling the lexical phase never yields a vector key', () => {
    const lexicalDefs = getPhaseParams(PARAM_DEFS, 1, { vectorEnabled: false });
    for (let seed = 1; seed <= 20; seed++) {
      const params = sampleRandomParams(lexicalDefs, seed);
      for (const key of VECTOR_TUNABLE_PARAM_KEYS) {
        expect(params, `seed=${seed} must not sample ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it('removed the offline-unobservable LEARN keys from the whole tuning space', () => {
    for (const key of LEARN_KEYS) {
      expect(SEARCH_TUNE_PARAM_KEYS).not.toContain(key);
      expect(PARAM_DEFS.map((d) => d.key)).not.toContain(key);
      expect(SEARCH_TUNE_DEFAULTS).not.toHaveProperty(key);
    }
  });

  it('VECTOR_TUNABLE_PARAM_KEYS covers scoring + LEARN keys for historical filtering', () => {
    expect([...VECTOR_TUNABLE_PARAM_KEYS]).toEqual([
      'SEARCH_VECTOR_BM25_SKIP_THRESHOLD',
      'SEARCH_VECTOR_COSINE_WEIGHT',
      ...LEARN_KEYS,
    ]);
  });
});

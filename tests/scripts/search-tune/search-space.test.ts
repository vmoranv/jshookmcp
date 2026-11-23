/**
 * Search-space tests (scripts/search-tune/search-space.ts).
 *
 * Search is lexical-only (ADR-0005): no SEARCH_VECTOR_* dimension is sampled.
 * VECTOR_TUNABLE_PARAM_KEYS survives only as a historical denylist for old
 * trials.jsonl files.
 */
import { describe, expect, it } from 'vitest';

import {
  PARAM_DEFS,
  SEARCH_TUNE_DEFAULTS,
  SEARCH_TUNE_PARAM_KEYS,
  VECTOR_TUNABLE_PARAM_KEYS,
  getPhaseParams,
  sampleRandomParams,
} from '../../../scripts/search-tune/search-space';

const LEGACY_VECTOR_KEYS = [
  'SEARCH_VECTOR_BM25_SKIP_THRESHOLD',
  'SEARCH_VECTOR_COSINE_WEIGHT',
  'SEARCH_VECTOR_LEARN_UP',
  'SEARCH_VECTOR_LEARN_DOWN',
  'SEARCH_VECTOR_LEARN_TOP_N',
] as const;

describe('search-tune/search-space lexical space', () => {
  it('never samples a vector key', () => {
    const keys = PARAM_DEFS.map((d) => d.key);
    for (const key of LEGACY_VECTOR_KEYS) {
      expect(keys, `tuning space must not sample ${key}`).not.toContain(key);
    }
    expect(keys).toContain('SEARCH_BM25_K1');
    expect(keys).toContain('SEARCH_RRF_BM25_BLEND');
  });

  it('keeps every phase free of vector keys', () => {
    for (const phase of [1, 2, 3, 4] as const) {
      const keys = getPhaseParams(PARAM_DEFS, phase).map((d) => d.key);
      for (const key of LEGACY_VECTOR_KEYS) {
        expect(keys, `phase ${phase} must not sample ${key}`).not.toContain(key);
      }
    }
  });

  it('samples only keys that exist in the tuning whitelist', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const params = sampleRandomParams(getPhaseParams(PARAM_DEFS, 1), seed);
      for (const key of Object.keys(params)) {
        expect(SEARCH_TUNE_PARAM_KEYS, `seed=${seed} sampled non-whitelisted ${key}`).toContain(
          key,
        );
      }
      for (const key of LEGACY_VECTOR_KEYS) {
        expect(params, `seed=${seed} must not sample ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it('removed the offline-unobservable LEARN keys from the whole tuning space', () => {
    for (const key of LEGACY_VECTOR_KEYS.filter((k) => k.includes('_LEARN_'))) {
      expect(SEARCH_TUNE_PARAM_KEYS).not.toContain(key);
      expect(PARAM_DEFS.map((d) => d.key)).not.toContain(key);
      expect(SEARCH_TUNE_DEFAULTS).not.toHaveProperty(key);
    }
  });

  it('exports the historical vector denylist for report filtering', () => {
    expect([...VECTOR_TUNABLE_PARAM_KEYS]).toEqual([...LEGACY_VECTOR_KEYS]);
  });
});

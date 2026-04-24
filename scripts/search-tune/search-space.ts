/**
 * Search tuning parameter space: whitelist, ranges, sampling, and env mapping.
 */
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

// ── parameter whitelist ──

export const SEARCH_TUNE_PARAM_KEYS = [
  // Phase 1: lexical + vector scoring (all signals)
  'SEARCH_TRIGRAM_WEIGHT',
  'SEARCH_TRIGRAM_THRESHOLD',
  'SEARCH_RRF_BM25_BLEND',
  'SEARCH_RRF_K',
  'SEARCH_RRF_RESCALE_FACTOR',
  'SEARCH_PREFIX_MATCH_MULTIPLIER',
  'SEARCH_COVERAGE_PRECISION_FACTOR',
  'SEARCH_DOMAIN_HUB_THRESHOLD',
  'SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER',
  'SEARCH_BM25_K1',
  'SEARCH_BM25_B',
  'SEARCH_EXACT_NAME_MATCH_MULTIPLIER',
  'SEARCH_AFFINITY_BOOST_FACTOR',
  'SEARCH_AFFINITY_BASE_WEIGHT',
  'SEARCH_AFFINITY_TOP_N',
  'SEARCH_PARAM_TOKEN_WEIGHT',
  'SEARCH_SYNONYM_EXPANSION_LIMIT',
  'SEARCH_VECTOR_BM25_SKIP_THRESHOLD',
  'SEARCH_VECTOR_COSINE_WEIGHT',
  'SEARCH_VECTOR_LEARN_UP',
  'SEARCH_VECTOR_LEARN_DOWN',
  'SEARCH_VECTOR_LEARN_TOP_N',
  'SEARCH_RECENCY_MAX_BOOST',
  'SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER',
  // Phase 3: profile penalty
  'SEARCH_TIER_PENALTY',
  'SEARCH_TIER_PENALTY_SEARCH',
  'SEARCH_TIER_PENALTY_WORKFLOW',
  'SEARCH_TIER_PENALTY_FULL',
] as const;

export type TunableParamKey = (typeof SEARCH_TUNE_PARAM_KEYS)[number];

export interface TunableParamDef {
  readonly key: TunableParamKey;
  readonly type: 'int' | 'float';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly phase: 1 | 2 | 3;
}

export type TrialParams = Readonly<Partial<Record<TunableParamKey, number>>>;

// ── parameter definitions ──

const PARAM_DEFS: readonly TunableParamDef[] = [
  // Phase 1: lexical + vector + boost signals (all 24 scoring params)
  { key: 'SEARCH_TRIGRAM_WEIGHT', type: 'float', min: 0.01, max: 0.3, step: 0.01, phase: 1 },
  { key: 'SEARCH_TRIGRAM_THRESHOLD', type: 'float', min: 0.15, max: 0.55, step: 0.01, phase: 1 },
  { key: 'SEARCH_RRF_BM25_BLEND', type: 'float', min: 0.1, max: 0.8, step: 0.01, phase: 1 },
  { key: 'SEARCH_RRF_K', type: 'int', min: 10, max: 120, step: 2, phase: 1 },
  { key: 'SEARCH_RRF_RESCALE_FACTOR', type: 'float', min: 100, max: 5000, step: 100, phase: 1 },
  {
    key: 'SEARCH_PREFIX_MATCH_MULTIPLIER',
    type: 'float',
    min: 0.1,
    max: 0.9,
    step: 0.02,
    phase: 1,
  },
  {
    key: 'SEARCH_COVERAGE_PRECISION_FACTOR',
    type: 'float',
    min: 0.1,
    max: 1.2,
    step: 0.02,
    phase: 1,
  },
  { key: 'SEARCH_DOMAIN_HUB_THRESHOLD', type: 'int', min: 2, max: 8, step: 1, phase: 1 },
  {
    key: 'SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER',
    type: 'float',
    min: 0.95,
    max: 1.3,
    step: 0.01,
    phase: 1,
  },
  { key: 'SEARCH_BM25_K1', type: 'float', min: 0.5, max: 3.0, step: 0.1, phase: 1 },
  { key: 'SEARCH_BM25_B', type: 'float', min: 0.2, max: 1.0, step: 0.05, phase: 1 },
  {
    key: 'SEARCH_EXACT_NAME_MATCH_MULTIPLIER',
    type: 'float',
    min: 1.0,
    max: 8.0,
    step: 0.1,
    phase: 1,
  },
  { key: 'SEARCH_AFFINITY_BOOST_FACTOR', type: 'float', min: 0.02, max: 0.5, step: 0.01, phase: 1 },
  { key: 'SEARCH_AFFINITY_BASE_WEIGHT', type: 'float', min: 0.05, max: 0.6, step: 0.05, phase: 1 },
  { key: 'SEARCH_AFFINITY_TOP_N', type: 'int', min: 2, max: 12, step: 1, phase: 1 },
  { key: 'SEARCH_PARAM_TOKEN_WEIGHT', type: 'float', min: 0.3, max: 3.5, step: 0.1, phase: 1 },
  { key: 'SEARCH_SYNONYM_EXPANSION_LIMIT', type: 'int', min: 0, max: 10, step: 1, phase: 1 },
  { key: 'SEARCH_VECTOR_BM25_SKIP_THRESHOLD', type: 'float', min: 0, max: 30, step: 1, phase: 1 },
  { key: 'SEARCH_VECTOR_COSINE_WEIGHT', type: 'float', min: 0.05, max: 0.8, step: 0.01, phase: 1 },
  { key: 'SEARCH_VECTOR_LEARN_UP', type: 'float', min: 0.01, max: 0.15, step: 0.01, phase: 1 },
  { key: 'SEARCH_VECTOR_LEARN_DOWN', type: 'float', min: 0.01, max: 0.1, step: 0.01, phase: 1 },
  { key: 'SEARCH_VECTOR_LEARN_TOP_N', type: 'int', min: 2, max: 10, step: 1, phase: 1 },
  { key: 'SEARCH_RECENCY_MAX_BOOST', type: 'float', min: 0.0, max: 1.0, step: 0.05, phase: 1 },
  {
    key: 'SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER',
    type: 'float',
    min: 1.0,
    max: 3.0,
    step: 0.1,
    phase: 1,
  },
  // Phase 3: profile penalty (all tiers)
  { key: 'SEARCH_TIER_PENALTY', type: 'float', min: 0.2, max: 1.0, step: 0.05, phase: 3 },
  { key: 'SEARCH_TIER_PENALTY_SEARCH', type: 'float', min: 0.1, max: 0.9, step: 0.02, phase: 3 },
  { key: 'SEARCH_TIER_PENALTY_WORKFLOW', type: 'float', min: 0.2, max: 0.95, step: 0.02, phase: 3 },
  { key: 'SEARCH_TIER_PENALTY_FULL', type: 'float', min: 0.6, max: 1.0, step: 0.02, phase: 3 },
] as const;

// ── public API ──

export async function loadSearchSpace(): Promise<readonly TunableParamDef[]> {
  return PARAM_DEFS;
}

export function getPhaseParams(
  defs: readonly TunableParamDef[],
  phase: number,
): readonly TunableParamDef[] {
  return defs.filter((d) => d.phase === phase);
}

/**
 * Sample random parameters within bounds using a seeded PRNG (xorshift32).
 */
export function sampleRandomParams(defs: readonly TunableParamDef[], seed: number): TrialParams {
  const params: Record<string, number> = {};
  let s = seed >>> 0;
  for (const def of defs) {
    s = xorshift32(s);
    const t = (s >>> 0) / 4294967296; // [0, 1)
    const range = def.max - def.min;
    const raw = def.min + t * range;
    params[def.key] = snapToStep(raw, def);
  }
  return normalizeParams(params as TrialParams);
}

/**
 * Build local refinement grid: vary one parameter at a time by ±step.
 */
export function buildLocalRefinementGrid(
  base: TrialParams,
  defs: readonly TunableParamDef[],
): readonly TrialParams[] {
  const grid: TrialParams[] = [];
  for (const def of defs) {
    const baseVal = base[def.key];
    if (baseVal === undefined) continue;
    for (const delta of [-def.step, def.step]) {
      const newVal = snapToStep(baseVal + delta, def);
      if (newVal < def.min || newVal > def.max) continue;
      grid.push(normalizeParams({ ...base, [def.key]: newVal }));
    }
  }
  return grid;
}

export function paramsToEnv(params: TrialParams): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      env[key] = String(value);
    }
  }
  return env;
}

export function normalizeParams(params: TrialParams): TrialParams {
  const result: Record<string, number> = {};
  const defMap = new Map(PARAM_DEFS.map((d) => [d.key, d]));
  for (const [key, value] of Object.entries(params)) {
    const def = defMap.get(key as TunableParamKey);
    if (!def || value === undefined) continue;
    const snapped = snapToStep(value, def);
    result[key] = Math.max(def.min, Math.min(def.max, snapped));
  }
  return result as TrialParams;
}

// ── internal helpers ──

function snapToStep(value: number, def: TunableParamDef): number {
  const stepped = Math.round(value / def.step) * def.step;
  if (def.type === 'int') return Math.round(stepped);
  return Math.round(stepped * 1000) / 1000;
}

function xorshift32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return x >>> 0;
}

/**
 * Search tuning parameter space: whitelist, ranges, sampling, and env mapping.
 */
/* eslint-disable no-underscore-dangle */

// ── parameter whitelist ──

export const SEARCH_TUNE_PARAM_KEYS = [
  // Phase 1: lexical + boost signals. Vector-scoring keys
  // (SEARCH_VECTOR_BM25_SKIP_THRESHOLD / SEARCH_VECTOR_COSINE_WEIGHT) are only
  // sampled when the run passes --vector (see VECTOR_SCORING_PARAM_KEYS); in a
  // lexical run the tuning worker's engine constructs with vectorEnabled=false,
  // making those dimensions dead — sampling them burns trial budget and emits
  // noise "recommendations".
  //
  // SEARCH_VECTOR_LEARN_* are deliberately absent: they steer the FeedbackTracker
  // learning loop, which only advances on real tool-call feedback
  // (recordToolCallFeedback). The eval loop never records feedback, so no
  // offline trial can observe them — see VECTOR_TUNABLE_PARAM_KEYS for the
  // historical-filter set used when consuming old trials.jsonl files.
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
  'SEARCH_RECENCY_MAX_BOOST',
  'SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER',
  'SEARCH_SCENE_KEYWORD_WEIGHT',
  // Phase 3: profile penalty
  'SEARCH_TIER_PENALTY',
  'SEARCH_TIER_PENALTY_SEARCH',
  'SEARCH_TIER_PENALTY_WORKFLOW',
  'SEARCH_TIER_PENALTY_FULL',
  // Phase 4: rerank context multipliers
  'RERANK_MAINTENANCE_PENALTY',
  'RERANK_STATELESS_INTERACTIVE_PENALTY',
  'RERANK_STATELESS_CORE_PENALTY',
  'RERANK_STATELESS_COMPUTE_BOOST',
  'RERANK_STATELESS_SPECIFIC_TOOL_BOOST',
  'RERANK_BROWSER_LAUNCH_BOOST',
  'RERANK_BROWSER_ATTACH_BOOST',
  'RERANK_NETWORK_MONITOR_BOOST',
  'RERANK_NETWORK_GET_REQUESTS_BOOST',
] as const;

export type TunableParamKey = (typeof SEARCH_TUNE_PARAM_KEYS)[number];

/**
 * Vector-signal scoring keys. Only sampled when the tuning run passes
 * `--vector` (optimize.ts then sets SEARCH_VECTOR_ENABLED=true in every worker
 * env). In the default lexical run the worker engine has vectorEnabled=false,
 * so these two keys are dead dimensions — getPhaseParams drops them.
 */
export const VECTOR_SCORING_PARAM_KEYS = [
  'SEARCH_VECTOR_BM25_SKIP_THRESHOLD',
  'SEARCH_VECTOR_COSINE_WEIGHT',
] as const;

/**
 * Every vector-related key that can appear in a HISTORICAL trials.jsonl (runs
 * predating the gating above sampled all five). Consumers that turn trial
 * params into recommendations (report.ts, .env application) exclude this set:
 * LEARN_* values are offline-unobservable feedback-dynamics knobs, and
 * SKIP/COSINE values from a lexical-only run carry no evidence.
 */
export const VECTOR_TUNABLE_PARAM_KEYS = [
  ...VECTOR_SCORING_PARAM_KEYS,
  'SEARCH_VECTOR_LEARN_UP',
  'SEARCH_VECTOR_LEARN_DOWN',
  'SEARCH_VECTOR_LEARN_TOP_N',
] as const;

/**
 * Shipped defaults for every tunable key, mirroring src/constants/search.ts.
 * The pruner's regularization measures drift from these values, so the table
 * must stay in sync — tests/scripts/search-tune/pruner.test.ts fails on any
 * drift between this table and the constants module.
 *
 * Note: constants are env-overridable; this table records the DEFAULTS (the
 * second argument of each float()/int() call), not current env values.
 */
export const SEARCH_TUNE_DEFAULTS: Readonly<Record<TunableParamKey, number>> = {
  SEARCH_TRIGRAM_WEIGHT: 0.02,
  SEARCH_TRIGRAM_THRESHOLD: 0.47,
  SEARCH_RRF_BM25_BLEND: 0.39,
  SEARCH_RRF_K: 18,
  SEARCH_RRF_RESCALE_FACTOR: 2100,
  SEARCH_PREFIX_MATCH_MULTIPLIER: 0.84,
  SEARCH_COVERAGE_PRECISION_FACTOR: 0.94,
  SEARCH_DOMAIN_HUB_THRESHOLD: 5,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.04,
  SEARCH_BM25_K1: 1,
  SEARCH_BM25_B: 0.75,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER: 3.2,
  SEARCH_AFFINITY_BOOST_FACTOR: 0.38,
  SEARCH_AFFINITY_BASE_WEIGHT: 0.5,
  SEARCH_AFFINITY_TOP_N: 9,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.1,
  SEARCH_SYNONYM_EXPANSION_LIMIT: 2,
  SEARCH_RECENCY_MAX_BOOST: 0.1,
  SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER: 2.4,
  SEARCH_SCENE_KEYWORD_WEIGHT: 0.8,
  SEARCH_TIER_PENALTY: 0.35,
  SEARCH_TIER_PENALTY_SEARCH: 0.4,
  SEARCH_TIER_PENALTY_WORKFLOW: 0.6,
  SEARCH_TIER_PENALTY_FULL: 0.6,
  RERANK_MAINTENANCE_PENALTY: 0.43,
  RERANK_STATELESS_INTERACTIVE_PENALTY: 0.65,
  RERANK_STATELESS_CORE_PENALTY: 0.15,
  RERANK_STATELESS_COMPUTE_BOOST: 2.2,
  RERANK_STATELESS_SPECIFIC_TOOL_BOOST: 2.25,
  RERANK_BROWSER_LAUNCH_BOOST: 1.35,
  RERANK_BROWSER_ATTACH_BOOST: 1.55,
  RERANK_NETWORK_MONITOR_BOOST: 1.6,
  RERANK_NETWORK_GET_REQUESTS_BOOST: 1.55,
};

export interface TunableParamDef {
  readonly key: TunableParamKey;
  readonly type: 'int' | 'float';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly phase: 1 | 2 | 3 | 4;
}

export type TrialParams = Readonly<Partial<Record<TunableParamKey, number>>>;

// ── parameter definitions ──

export const PARAM_DEFS: readonly TunableParamDef[] = [
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
  { key: 'SEARCH_RECENCY_MAX_BOOST', type: 'float', min: 0.0, max: 1.0, step: 0.05, phase: 1 },
  { key: 'SEARCH_SCENE_KEYWORD_WEIGHT', type: 'float', min: 0.5, max: 5.0, step: 0.1, phase: 1 },
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
  // Phase 4: rerank context multipliers
  { key: 'RERANK_MAINTENANCE_PENALTY', type: 'float', min: 0.01, max: 0.5, step: 0.01, phase: 4 },
  {
    key: 'RERANK_STATELESS_INTERACTIVE_PENALTY',
    type: 'float',
    min: 0.1,
    max: 0.8,
    step: 0.05,
    phase: 4,
  },
  {
    key: 'RERANK_STATELESS_CORE_PENALTY',
    type: 'float',
    min: 0.05,
    max: 0.5,
    step: 0.05,
    phase: 4,
  },
  { key: 'RERANK_STATELESS_COMPUTE_BOOST', type: 'float', min: 1.0, max: 3.0, step: 0.1, phase: 4 },
  {
    key: 'RERANK_STATELESS_SPECIFIC_TOOL_BOOST',
    type: 'float',
    min: 1.0,
    max: 2.5,
    step: 0.05,
    phase: 4,
  },
  { key: 'RERANK_BROWSER_LAUNCH_BOOST', type: 'float', min: 1.0, max: 2.5, step: 0.05, phase: 4 },
  { key: 'RERANK_BROWSER_ATTACH_BOOST', type: 'float', min: 1.0, max: 2.0, step: 0.05, phase: 4 },
  { key: 'RERANK_NETWORK_MONITOR_BOOST', type: 'float', min: 1.0, max: 2.5, step: 0.05, phase: 4 },
  {
    key: 'RERANK_NETWORK_GET_REQUESTS_BOOST',
    type: 'float',
    min: 1.0,
    max: 2.5,
    step: 0.05,
    phase: 4,
  },
] as const;

// ── public API ──

export async function loadSearchSpace(): Promise<readonly TunableParamDef[]> {
  return PARAM_DEFS;
}

export function getPhaseParams(
  defs: readonly TunableParamDef[],
  phase: number,
  options?: { vectorEnabled?: boolean },
): readonly TunableParamDef[] {
  const phaseDefs = defs.filter((d) => d.phase === phase);
  if (options?.vectorEnabled === false) {
    // Lexical run: the worker engine constructs with vectorEnabled=false, so
    // vector-scoring dimensions are dead — exclude them from sampling.
    const vectorKeys: readonly string[] = VECTOR_SCORING_PARAM_KEYS;
    return phaseDefs.filter((d) => !vectorKeys.includes(d.key));
  }
  return phaseDefs;
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
 * Keys in `skipKeys` (pruner-frozen params) keep their base value — no
 * ±step variants are generated for retired dimensions.
 */
export function buildLocalRefinementGrid(
  base: TrialParams,
  defs: readonly TunableParamDef[],
  skipKeys?: ReadonlySet<string>,
): readonly TrialParams[] {
  const grid: TrialParams[] = [];
  for (const def of defs) {
    if (skipKeys?.has(def.key)) continue;
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

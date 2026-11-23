/**
 * The 20 scoring mechanisms of the Search engine, grouped into 11 slots.
 *
 * Each descriptor says how the mechanism can be neutralised for ablation.
 * `not-possible` means "contribution unknown", never "zero contribution".
 * Env-based neutralisation must be applied before the constants module loads,
 * so runners spawn a child process rather than mutating process.env in place.
 */

import type { SearchConfig } from '../../src/types/config';

export const MECHANISM_GROUPS = [
  'index',
  'lexical',
  'query',
  'fusion',
  'rerank',
  'intent',
  'graph',
  'state',
  'calibration',
] as const;

export type MechanismGroup = (typeof MECHANISM_GROUPS)[number];

export type Neutralization = 'config-zero' | 'patch' | 'not-possible';

export interface MechanismDescriptor {
  readonly id: string;
  readonly group: MechanismGroup;
  readonly label: string;
  readonly neutralization: Neutralization;
  /** Constants-module env overrides; require a child process to take effect. */
  readonly env?: Readonly<Record<string, string>>;
  /** SearchConfig overrides applied at engine construction. */
  readonly searchConfig?: Partial<SearchConfig>;
  /** Dense requires a vector mode rather than a knob. */
  readonly vectorMode?: 'off' | 'on';
  readonly note?: string;
}

export const SEARCH_MECHANISMS: readonly MechanismDescriptor[] = [
  {
    id: 'field-weights',
    group: 'index',
    label: 'field weighting (name/domain/description/params/scene)',
    neutralization: 'patch',
    note: 'No single neutral value; the five weights interact.',
  },
  {
    id: 'bm25-core',
    group: 'lexical',
    label: 'BM25 lexical scorer',
    neutralization: 'not-possible',
    note: 'No knob removes the core scorer; k1/b only reshape it.',
  },
  {
    id: 'exact-prefix',
    group: 'lexical',
    label: 'exact-name and prefix multipliers',
    neutralization: 'config-zero',
    env: {
      SEARCH_EXACT_NAME_MATCH_MULTIPLIER: '1',
      SEARCH_PREFIX_MATCH_MULTIPLIER: '1',
    },
  },
  {
    id: 'coverage',
    group: 'lexical',
    label: 'coverage precision factor',
    neutralization: 'config-zero',
    env: { SEARCH_COVERAGE_PRECISION_FACTOR: '0' },
  },
  {
    id: 'trigram',
    group: 'lexical',
    label: 'trigram fuzzy index',
    neutralization: 'config-zero',
    env: { SEARCH_TRIGRAM_WEIGHT: '0', SEARCH_TRIGRAM_THRESHOLD: '1' },
  },
  {
    id: 'synonym-expansion',
    group: 'query',
    label: 'synonym expansion',
    neutralization: 'config-zero',
    env: { SEARCH_SYNONYM_EXPANSION_LIMIT: '0' },
  },
  {
    id: 'cjk-aliases',
    group: 'query',
    label: 'CJK query aliases',
    neutralization: 'config-zero',
    searchConfig: { cjkQueryAliases: [] },
  },
  {
    id: 'explicit-mention',
    group: 'query',
    label: 'explicit tool-name promotion',
    neutralization: 'not-possible',
    note: 'promoteExplicitMention has no runtime knob.',
  },
  {
    id: 'out-of-domain-gate',
    group: 'query',
    label: 'out-of-domain vocabulary rejection',
    neutralization: 'not-possible',
    note: 'Private strategy flag; not reachable from configuration.',
  },
  {
    id: 'rrf-fusion',
    group: 'fusion',
    label: 'RRF score fusion',
    neutralization: 'not-possible',
    note: 'Blend range tops at 0.8; no disable knob.',
  },
  {
    id: 'rule-rerank',
    group: 'rerank',
    label: 'rule-based lexical re-rank multipliers',
    neutralization: 'config-zero',
    env: {
      RERANK_MAINTENANCE_PENALTY: '1',
      RERANK_STATELESS_INTERACTIVE_PENALTY: '1',
      RERANK_STATELESS_CORE_PENALTY: '1',
      RERANK_STATELESS_COMPUTE_BOOST: '1',
      RERANK_STATELESS_SPECIFIC_TOOL_BOOST: '1',
      RERANK_BROWSER_LAUNCH_BOOST: '1',
      RERANK_BROWSER_ATTACH_BOOST: '1',
      RERANK_NETWORK_MONITOR_BOOST: '1',
      RERANK_NETWORK_GET_REQUESTS_BOOST: '1',
    },
    note: 'Neutralises multipliers; MMR ordering may still move results.',
  },
  {
    id: 'intent-bands',
    group: 'intent',
    label: 'intent bonus bands',
    neutralization: 'config-zero',
    searchConfig: { intentToolBoostRules: [] },
  },
  {
    id: 'category-profiles',
    group: 'intent',
    label: 'query-category domain boosts',
    neutralization: 'config-zero',
    searchConfig: { queryCategoryProfiles: [] },
  },
  {
    id: 'affinity-hub',
    group: 'graph',
    label: 'affinity graph and domain-hub expansion',
    neutralization: 'config-zero',
    env: {
      SEARCH_AFFINITY_BOOST_FACTOR: '0',
      SEARCH_AFFINITY_BASE_WEIGHT: '0',
      SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: '1',
      SEARCH_DOMAIN_HUB_THRESHOLD: '8',
    },
  },
  {
    id: 'workflow-transition',
    group: 'graph',
    label: 'workflow transition boosts',
    neutralization: 'not-possible',
    note: 'Curated table; SEARCH_WORKFLOW_BOOST_TIERS is declared but unread.',
  },
  {
    id: 'tier-penalty',
    group: 'state',
    label: 'profile tier penalty',
    neutralization: 'config-zero',
    env: {
      SEARCH_TIER_PENALTY: '1',
      SEARCH_TIER_PENALTY_SEARCH: '1',
      SEARCH_TIER_PENALTY_WORKFLOW: '1',
      SEARCH_TIER_PENALTY_FULL: '1',
    },
  },
  {
    id: 'recency',
    group: 'state',
    label: 'recency boost',
    neutralization: 'config-zero',
    env: { SEARCH_RECENCY_MAX_BOOST: '0' },
  },
  {
    id: 'confidence-floor',
    group: 'calibration',
    label: 'calibrated confidence floor',
    neutralization: 'not-possible',
    note: 'Threshold is a module constant, not configuration.',
  },
];

export function getMechanism(id: string): MechanismDescriptor | undefined {
  return SEARCH_MECHANISMS.find((mechanism) => mechanism.id === id);
}

export function mechanismsByGroup(group: MechanismGroup): readonly MechanismDescriptor[] {
  return SEARCH_MECHANISMS.filter((mechanism) => mechanism.group === group);
}

/** Structural invariants; returns human-readable errors (empty = valid). */
export function validateMechanisms(
  mechanisms: readonly MechanismDescriptor[] = SEARCH_MECHANISMS,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const groups = new Set<string>(MECHANISM_GROUPS);
  for (const mechanism of mechanisms) {
    if (seen.has(mechanism.id)) errors.push(`duplicate id: ${mechanism.id}`);
    seen.add(mechanism.id);
    if (!groups.has(mechanism.group))
      errors.push(`unknown group: ${mechanism.id} -> ${mechanism.group}`);
    if (
      mechanism.neutralization === 'config-zero' &&
      !mechanism.env &&
      !mechanism.searchConfig &&
      !mechanism.vectorMode
    ) {
      errors.push(`config-zero without a neutraliser: ${mechanism.id}`);
    }
  }
  return errors;
}

/**
 * Search engine tuning: BM25, RRF, trigram, embeddings, affinity, predictive boosting, and reranking.
 * Prefixes: SEARCH_*, PREDICTIVE_*, RERANK_*
 */

import { int, float, bool, str, csv, autoInt, cpuCount } from './helpers.js';

/* ================================================================== */
/*  Search ranking — workflow domain                                   */
/* ================================================================== */

/**
 * Search ranking controls for workflow-domain tools.
 * `SEARCH_WORKFLOW_BOOST_TIERS` accepts comma-separated tiers, default: workflow,full
 * `SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER` default: 1.5
 */
export const SEARCH_WORKFLOW_BOOST_TIERS = new Set(
  csv('SEARCH_WORKFLOW_BOOST_TIERS', ['workflow', 'full']),
);
export const SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER = float(
  'SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER',
  2.4,
);

/**
 * When enabled, search_tools automatically activates domains of top
 * inactive results (with TTL). Default: true.
 */
export const SEARCH_AUTO_ACTIVATE_DOMAINS = bool('SEARCH_AUTO_ACTIVATE_DOMAINS', true);

/* ================================================================== */
/*  GraphBoost-inspired search enhancements                            */
/* ================================================================== */

/**
 * GraphBoost-inspired search enhancements (see GraphBoost paper §4).
 *
 * SEARCH_AFFINITY_BOOST_FACTOR: bonus applied to prefix-group neighbors of
 * top search results. Mirrors §4.1.4 dependency hull expansion.
 *
 * SEARCH_AFFINITY_TOP_N: how many top results contribute affinity boosts.
 *
 * SEARCH_DOMAIN_HUB_THRESHOLD: if ≥ this many top-10 results share a domain,
 * other tools in that domain receive a coherence boost.
 *
 * SEARCH_QUERY_CACHE_CAPACITY: LRU cache size for search results.
 * Mirrors §4.3 CSAPC cross-session caching. Raised to 500 to match the
 * 431+ tool catalog size and reduce warm-cache miss rate.
 */
export const SEARCH_AFFINITY_BOOST_FACTOR = float('SEARCH_AFFINITY_BOOST_FACTOR', 0.38);
export const SEARCH_AFFINITY_TOP_N = int('SEARCH_AFFINITY_TOP_N', 9);
export const SEARCH_DOMAIN_HUB_THRESHOLD = int('SEARCH_DOMAIN_HUB_THRESHOLD', 5);
export const SEARCH_QUERY_CACHE_CAPACITY = int('SEARCH_QUERY_CACHE_CAPACITY', 500);

/**
 * Cache invalidation tolerance: cached entries are reusable while the
 * live vector weight stays within this delta of the weight recorded
 * when the entry was stored. Avoids flushing the full cache on every
 * feedback tick (the previous epoch bump behavior).
 */
export const SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE = float(
  'SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE',
  0.05,
);

/* ================================================================== */
/*  Semantic search: synonym, trigram, RRF                             */
/* ================================================================== */

/**
 * Semantic search enhancements (synonym expansion, trigram fuzzy, RRF fusion).
 *
 * SEARCH_TRIGRAM_WEIGHT: weight of trigram Jaccard similarity as an RRF signal.
 * SEARCH_TRIGRAM_THRESHOLD: minimum Jaccard score to enter the trigram ranking.
 * SEARCH_RRF_K: smoothing constant for Reciprocal Rank Fusion (standard: 60).
 * SEARCH_RRF_RESCALE_FACTOR: multiplier that maps RRF scores into the BM25
 *   magnitude range so downstream boosts (affinity, domain hub) stay comparable.
 * SEARCH_RRF_BM25_BLEND: blend weight between the preserved BM25 score and
 *   the rescaled RRF score when they coexist for the same doc.
 * SEARCH_SYNONYM_EXPANSION_LIMIT: max synonym tokens added per original query term.
 * SEARCH_PARAM_TOKEN_WEIGHT: weight for tool parameter name tokens in the index.
 */
export const SEARCH_TRIGRAM_WEIGHT = float('SEARCH_TRIGRAM_WEIGHT', 0.02);
export const SEARCH_TRIGRAM_THRESHOLD = float('SEARCH_TRIGRAM_THRESHOLD', 0.47);
export const SEARCH_RRF_K = int('SEARCH_RRF_K', 18);
export const SEARCH_RRF_RESCALE_FACTOR = float('SEARCH_RRF_RESCALE_FACTOR', 2100);
export const SEARCH_RRF_BM25_BLEND = float('SEARCH_RRF_BM25_BLEND', 0.39);
export const SEARCH_SYNONYM_EXPANSION_LIMIT = int('SEARCH_SYNONYM_EXPANSION_LIMIT', 2);
export const SEARCH_PARAM_TOKEN_WEIGHT = float('SEARCH_PARAM_TOKEN_WEIGHT', 1.1);

/**
 * Generic technology scene keywords — indexed per-tool with this weight
 * in the BM25 inverted index. Keywords describe abstract technical
 * capabilities ("parameter extraction", "bytecode tracing") without
 * vendor or brand references, so the search engine can surface tools
 * for domain-specific workflows it hasn't seen before.
 */
export const SEARCH_SCENE_KEYWORD_WEIGHT = float('SEARCH_SCENE_KEYWORD_WEIGHT', 0.8);

/* ================================================================== */
/*  BM25 scoring parameters                                            */
/* ================================================================== */

/**
 * BM25 scoring parameters.
 *
 * SEARCH_BM25_K1: term frequency saturation (1.2-2.0 typical; higher = more tf weight).
 * SEARCH_BM25_B: length normalization factor (0..1; 0.75 is the textbook default).
 *   The previous hardcoded value of 0.3 under-penalized long descriptions,
 *   allowing verbose tools to crowd the top results.
 */
export const SEARCH_BM25_K1 = float('SEARCH_BM25_K1', 1);
export const SEARCH_BM25_B = float('SEARCH_BM25_B', 0.75);

/* ================================================================== */
/*  Dense vector search (embeddings)                                   */
/* ================================================================== */

/**
 * Dense vector search (Phase 8 — Hybrid Semantic Routing).
 *
 * SEARCH_VECTOR_ENABLED: master switch for embedding-based search signal.
 * SEARCH_VECTOR_MODEL_ID: HuggingFace model used for embedding inference.
 * SEARCH_VECTOR_COSINE_WEIGHT: initial weight of the vector cosine signal in RRF fusion.
 * SEARCH_VECTOR_DYNAMIC_WEIGHT: when true, vector weight self-tunes based on tool-call feedback.
 * SEARCH_VECTOR_LEARN_UP / DOWN: step sizes applied when the selected tool was
 *   inside / outside the vector top-N. The defaults trade convergence speed
 *   for stability.
 * SEARCH_VECTOR_LEARN_TOP_N: rank threshold that separates "hit" from "miss".
 */
export const SEARCH_VECTOR_ENABLED = bool('SEARCH_VECTOR_ENABLED', true);
export const SEARCH_VECTOR_MODEL_ID = str('SEARCH_VECTOR_MODEL_ID', 'Xenova/bge-micro-v2');
export const SEARCH_VECTOR_COSINE_WEIGHT = float('SEARCH_VECTOR_COSINE_WEIGHT', 0.53);
export const SEARCH_VECTOR_DYNAMIC_WEIGHT = bool('SEARCH_VECTOR_DYNAMIC_WEIGHT', true);
export const SEARCH_VECTOR_LEARN_UP = float('SEARCH_VECTOR_LEARN_UP', 0.13);
export const SEARCH_VECTOR_LEARN_DOWN = float('SEARCH_VECTOR_LEARN_DOWN', 0.02);
export const SEARCH_VECTOR_LEARN_TOP_N = int('SEARCH_VECTOR_LEARN_TOP_N', 3);
/**
 * SEARCH_VECTOR_BM25_SKIP_THRESHOLD: when the top BM25 score meets or exceeds
 * this value, dense vector scoring is skipped — the text signal is already
 * strong enough that embeddings rarely change the ranking.
 * Set to 0 to always run vector scoring (original behavior).
 */
export const SEARCH_VECTOR_BM25_SKIP_THRESHOLD = float('SEARCH_VECTOR_BM25_SKIP_THRESHOLD', 8);

export const SEARCH_VECTOR_PREWARM = bool('SEARCH_VECTOR_PREWARM', false);
export const SEARCH_VECTOR_WORKER_IDLE_MS = int('SEARCH_VECTOR_WORKER_IDLE_MS', 15_000);
export const SEARCH_VECTOR_CACHE_ENABLED = bool('SEARCH_VECTOR_CACHE_ENABLED', true);

/* ================================================================== */
/*  Profile tier-aware ranking                                         */
/* ================================================================== */

/**
 * Profile tier-aware ranking: tools whose domain is not visible under the
 * caller's active tier (search ⊂ workflow ⊂ full) are not filtered out but
 * downweighted by this multiplier (0..1). Setting to 1 disables the penalty.
 */
export const SEARCH_TIER_PENALTY = float('SEARCH_TIER_PENALTY', 0.35);

/** Per-profile tier penalty overrides. When set, these take precedence over SEARCH_TIER_PENALTY. */
export const SEARCH_TIER_PENALTY_SEARCH = float('SEARCH_TIER_PENALTY_SEARCH', 0.4);
export const SEARCH_TIER_PENALTY_WORKFLOW = float('SEARCH_TIER_PENALTY_WORKFLOW', 0.6);
export const SEARCH_TIER_PENALTY_FULL = float('SEARCH_TIER_PENALTY_FULL', 0.6);

/* ================================================================== */
/*  Recency & frequency boost                                          */
/* ================================================================== */

/**
 * Recency / frequency boost: tools invoked within SEARCH_RECENCY_WINDOW_MS
 * receive a log-scaled boost up to SEARCH_RECENCY_MAX_BOOST. Helps user-
 * preferred tools naturally surface.
 *
 * SEARCH_RECENCY_TRACKER_MAX caps the tracker map size to bound memory in
 * long sessions; evicted entries are the oldest insertions (LRU).
 */
export const SEARCH_RECENCY_WINDOW_MS = int('SEARCH_RECENCY_WINDOW_MS', 30 * 60_000);
export const SEARCH_RECENCY_MAX_BOOST = float('SEARCH_RECENCY_MAX_BOOST', 0.1);
export const SEARCH_RECENCY_TRACKER_MAX = int('SEARCH_RECENCY_TRACKER_MAX', 200);

/* ================================================================== */
/*  Fine-grained scoring knobs                                         */
/* ================================================================== */

/**
 * Additional fine-grained scoring knobs. These used to be hardcoded; moving
 * them to env lets downstream deployments tune ranking behaviour without
 * rebuilding.
 *
 *   SEARCH_EXACT_NAME_MATCH_MULTIPLIER — score multiplier when the query
 *       normalises to an exact tool name.
 *   SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER — score multiplier applied to tools
 *       whose domain shows up ≥ SEARCH_DOMAIN_HUB_THRESHOLD times in the
 *       top-10.
 *   SEARCH_AFFINITY_BASE_WEIGHT — baseline edge weight used when building
 *       the prefix-group affinity graph (decayed by √|group|).
 *   SEARCH_COVERAGE_PRECISION_FACTOR — amplitude of the coverage × precision
 *       bonus applied when query tokens overlap a tool's name tokens.
 *   SEARCH_PREFIX_MATCH_MULTIPLIER — multiplier applied to BM25 postings
 *       reached via prefix expansion (non-exact tokens).
 */
export const SEARCH_EXACT_NAME_MATCH_MULTIPLIER = float('SEARCH_EXACT_NAME_MATCH_MULTIPLIER', 3.2);
export const SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER = float('SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER', 1.04);
export const SEARCH_AFFINITY_BASE_WEIGHT = float('SEARCH_AFFINITY_BASE_WEIGHT', 0.5);
export const SEARCH_COVERAGE_PRECISION_FACTOR = float('SEARCH_COVERAGE_PRECISION_FACTOR', 0.94);
export const SEARCH_PREFIX_MATCH_MULTIPLIER = float('SEARCH_PREFIX_MATCH_MULTIPLIER', 0.84);

/* ================================================================== */
/*  Self-RAG quick path                                                */
/* ================================================================== */

/**
 * Self-RAG quick path: when the query is a simple form (exact tool name or
 * single token), skip expensive signals (embedding, synonym expansion, RRF
 * fusion) and use only BM25 + trigram. Reduces latency from ~200ms to ~5ms.
 *
 *   SEARCH_SELF_RAG_ENABLED — master toggle for the quick path.
 */
export const SEARCH_SELF_RAG_ENABLED = bool('SEARCH_SELF_RAG_ENABLED', true);

/* ================================================================== */
/*  PredictiveBooster parameters                                       */
/* ================================================================== */

/**
 * PredictiveBooster parameters.
 *   - PREDICTIVE_MAX_HISTORY: sliding-window size for recorded tool calls.
 *     Raised from 50 to match the median length of a multi-domain session.
 *   - PREDICTIVE_CONFIDENCE_THRESHOLD: minimum transition probability to
 *     emit a prediction. Slightly lowered to surface emerging patterns
 *     sooner, while higher-order weighting filters noise.
 *   - PREDICTIVE_DECAY_FACTOR: exponential decay applied to stored
 *     transition weights on each record; makes recent usage dominate.
 *   - PREDICTIVE_MAX_SECOND_ORDER_KEYS — upper bound on the second-order
 *     Markov table to keep memory usage predictable.
 */
export const PREDICTIVE_MAX_HISTORY = int('PREDICTIVE_MAX_HISTORY', 100);
export const PREDICTIVE_CONFIDENCE_THRESHOLD = float('PREDICTIVE_CONFIDENCE_THRESHOLD', 0.25);
export const PREDICTIVE_DECAY_FACTOR = float('PREDICTIVE_DECAY_FACTOR', 0.95);
export const PREDICTIVE_MAX_SECOND_ORDER_KEYS = int('PREDICTIVE_MAX_SECOND_ORDER_KEYS', 1000);

/* ================================================================== */
/*  ToolRouter reranking (context-aware)                               */
/* ================================================================== */

/**
 * ToolRouter reranking multipliers (§4.1.6 context-aware rerank).
 * Applied after search engine scoring to contextualize results based on task
 * classification (browser/network vs maintenance vs stateless compute) and
 * runtime state (page active, network enabled, captured requests).
 *
 * All are env-overridable so the tune script can optimize them.
 */
export const RERANK_MAINTENANCE_PENALTY = float('RERANK_MAINTENANCE_PENALTY', 0.43);
export const RERANK_STATELESS_INTERACTIVE_PENALTY = float(
  'RERANK_STATELESS_INTERACTIVE_PENALTY',
  0.65,
);
export const RERANK_STATELESS_CORE_PENALTY = float('RERANK_STATELESS_CORE_PENALTY', 0.15);
export const RERANK_STATELESS_COMPUTE_BOOST = float('RERANK_STATELESS_COMPUTE_BOOST', 2.2);
export const RERANK_STATELESS_SPECIFIC_TOOL_BOOST = float(
  'RERANK_STATELESS_SPECIFIC_TOOL_BOOST',
  2.25,
);
export const RERANK_BROWSER_LAUNCH_BOOST = float('RERANK_BROWSER_LAUNCH_BOOST', 1.35);
export const RERANK_BROWSER_ATTACH_BOOST = float('RERANK_BROWSER_ATTACH_BOOST', 1.55);
export const RERANK_NETWORK_MONITOR_BOOST = float('RERANK_NETWORK_MONITOR_BOOST', 1.6);
export const RERANK_NETWORK_GET_REQUESTS_BOOST = float('RERANK_NETWORK_GET_REQUESTS_BOOST', 1.55);

/* ================================================================== */
/*  Worker pool (auto-sized)                                           */
/* ================================================================== */

/**
 * Worker pool ceiling. Accepts "auto" (case-insensitive) to derive a
 * machine-tuned value: half of the available logical CPUs, bounded by
 * [WORKER_POOL_MIN_WORKERS, 8]. Defaults to 4 when auto derivation fails.
 */
export const WORKER_POOL_MAX_WORKERS = autoInt('WORKER_POOL_MAX_WORKERS', 4, () => {
  const halved = Math.floor(cpuCount() / 2);
  const minimum = int('WORKER_POOL_MIN_WORKERS', 2);
  return Math.max(minimum, Math.min(8, halved));
});

/**
 * Centralized runtime-tunable constants.
 *
 * Every value can be overridden via the corresponding env var (loaded from
 * `.env` by `dotenv` at startup).  Modules import from here instead of
 * hard-coding magic numbers.
 */

import { cpus } from 'node:os';

// ── helpers ──

const int = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const float = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const normalized = v.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
};

const str = (key: string, fallback: string): string => process.env[key] || fallback;

const list = (key: string, fallback: number[]): number[] => {
  const v = process.env[key];
  if (!v) return fallback;
  return v.split(',').map(Number).filter(Number.isFinite);
};

const csv = (key: string, fallback: string[]): string[] => {
  const v = process.env[key];
  if (!v) return fallback;
  const parsed = v
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

/**
 * Auto-sized int: accepts "auto" (case-insensitive) to derive the value from
 * a supplier, otherwise behaves like `int(key, fallback)`.
 */
const autoInt = (key: string, fallback: number, autoSupplier: () => number): number => {
  const v = process.env[key];
  if (v !== undefined && v.trim().toLowerCase() === 'auto') {
    const derived = autoSupplier();
    return Number.isFinite(derived) && derived > 0 ? Math.floor(derived) : fallback;
  }
  return int(key, fallback);
};

const cpuCount = (): number => {
  try {
    return cpus().length;
  } catch {
    return 4;
  }
};

/* ================================================================== */
/*  HIGH — server lifecycle                                            */
/* ================================================================== */

/** Maximum time allowed for graceful shutdown before force-exiting. */
export const SHUTDOWN_TIMEOUT_MS = int('SHUTDOWN_TIMEOUT_MS', 20_000);

/** Sliding window (ms) for counting runtime errors before entering degraded mode. */
export const RUNTIME_ERROR_WINDOW_MS = int('RUNTIME_ERROR_WINDOW_MS', 60_000);

/** Max recoverable errors within the window before enabling degraded mode. */
export const RUNTIME_ERROR_THRESHOLD = int('RUNTIME_ERROR_THRESHOLD', 8);

/* ================================================================== */
/*  HIGH — debug ports & endpoints                                     */
/* ================================================================== */

/** Ports scanned when looking for a CDP / Node debug listener. */
export const DEBUG_PORT_CANDIDATES = list('DEBUG_PORT_CANDIDATES', [9222, 9229, 9333, 2039]);

/** Default port used when launching a process with `--remote-debugging-port`. */
export const DEFAULT_DEBUG_PORT = int('DEFAULT_DEBUG_PORT', 9222);

/** Ghidra bridge REST endpoint. */
export const GHIDRA_BRIDGE_ENDPOINT = str('GHIDRA_BRIDGE_URL', 'http://127.0.0.1:18080');

/** IDA bridge REST endpoint. */
export const IDA_BRIDGE_ENDPOINT = str('IDA_BRIDGE_URL', 'http://127.0.0.1:18081');

/** Base URL for the configured external CAPTCHA solver service. */
export const CAPTCHA_SOLVER_BASE_URL =
  process.env.CAPTCHA_SOLVER_BASE_URL?.trim() ||
  process.env.CAPTCHA_2CAPTCHA_BASE_URL?.trim() ||
  '';

/** Extension registry base URL. Must be supplied via .env or environment. */
export const EXTENSION_REGISTRY_BASE_URL = process.env.EXTENSION_REGISTRY_BASE_URL?.trim() || '';

// ── MEDIUM — timeouts ──

export const MCP_HTTP_REQUEST_TIMEOUT_MS = int('MCP_HTTP_REQUEST_TIMEOUT_MS', 30_000);
export const MCP_HTTP_HEADERS_TIMEOUT_MS = int('MCP_HTTP_HEADERS_TIMEOUT_MS', 10_000);
export const MCP_HTTP_KEEPALIVE_TIMEOUT_MS = int('MCP_HTTP_KEEPALIVE_TIMEOUT_MS', 60_000);
export const MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS = int('MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS', 5_000);

export const EXTERNAL_TOOL_TIMEOUT_MS = int('EXTERNAL_TOOL_TIMEOUT_MS', 30_000);
export const EXTERNAL_TOOL_PROBE_TIMEOUT_MS = int('EXTERNAL_TOOL_PROBE_TIMEOUT_MS', 5_000);
export const EXTERNAL_TOOL_PROBE_CACHE_TTL_MS = int('EXTERNAL_TOOL_PROBE_CACHE_TTL_MS', 60_000);
export const EXTERNAL_TOOL_FORCE_KILL_GRACE_MS = int('EXTERNAL_TOOL_FORCE_KILL_GRACE_MS', 2_000);

export const SANDBOX_EXEC_TIMEOUT_MS = int('SANDBOX_EXEC_TIMEOUT_MS', 5_000);
export const SANDBOX_MEMORY_LIMIT_MB = int('SANDBOX_MEMORY_LIMIT_MB', 128);
export const SANDBOX_STACK_SIZE_MB = int('SANDBOX_STACK_SIZE_MB', 4);
export const SANDBOX_TERMINATE_GRACE_MS = int('SANDBOX_TERMINATE_GRACE_MS', 2_000);

export const SYMBOLIC_EXEC_MAX_PATHS = int('SYMBOLIC_EXEC_MAX_PATHS', 100);
export const SYMBOLIC_EXEC_MAX_DEPTH = int('SYMBOLIC_EXEC_MAX_DEPTH', 50);
export const SYMBOLIC_EXEC_TIMEOUT_MS = int('SYMBOLIC_EXEC_TIMEOUT_MS', 30_000);

export const JSVMP_DEOBFUSCATE_TIMEOUT_MS = int('JSVMP_DEOBFUSCATE_TIMEOUT_MS', 30_000);
export const JSVMP_MAX_ITERATIONS = int('JSVMP_MAX_ITERATIONS', 100);
export const JSVMP_SYMBOLIC_MAX_STEPS = int('JSVMP_SYMBOLIC_MAX_STEPS', 1_000);
export const JSVMP_SYMBOLIC_TIMEOUT_MS = int('JSVMP_SYMBOLIC_TIMEOUT_MS', 30_000);

export const DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS = int(
  'DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS',
  30_000,
);
export const WATCH_EVAL_TIMEOUT_MS = int('WATCH_EVAL_TIMEOUT_MS', 5_000);

export const TRANSFORM_WORKER_TIMEOUT_MS = int('TRANSFORM_WORKER_TIMEOUT_MS', 15_000);
export const TRANSFORM_VM_SCRIPT_TIMEOUT_MS = int('TRANSFORM_VM_SCRIPT_TIMEOUT_MS', 5_000);
export const TRANSFORM_CRYPTO_POOL_MAX_WORKERS = int('TRANSFORM_CRYPTO_POOL_MAX_WORKERS', 4);
export const TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS = int(
  'TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS',
  30_000,
);
export const TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB = int(
  'TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB',
  128,
);
export const TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB = int(
  'TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB',
  32,
);

export const EMULATOR_FETCH_GOTO_TIMEOUT_MS = int('EMULATOR_FETCH_GOTO_TIMEOUT_MS', 30_000);

export const WASM_TOOL_TIMEOUT_MS = int('WASM_TOOL_TIMEOUT_MS', 60_000);
export const WASM_OFFLINE_RUN_TIMEOUT_MS = int('WASM_OFFLINE_RUN_TIMEOUT_MS', 10_000);
export const WASM_OPTIMIZE_TIMEOUT_MS = int('WASM_OPTIMIZE_TIMEOUT_MS', 120_000);

export const MINIAPP_UNPACK_TIMEOUT_MS = int('MINIAPP_UNPACK_TIMEOUT_MS', 180_000);

export const CAPTCHA_SUBMIT_TIMEOUT_MS = int('CAPTCHA_SUBMIT_TIMEOUT_MS', 15_000);

// ── HTTP Fetch ──
export const FETCH_ABORT_TIMEOUT_MS = int('FETCH_ABORT_TIMEOUT_MS', 10_000);
export const CAPTCHA_POLL_INTERVAL_MS = int('CAPTCHA_POLL_INTERVAL_MS', 5_000);
export const CAPTCHA_RESULT_TIMEOUT_MS = int('CAPTCHA_RESULT_TIMEOUT_MS', 10_000);
export const CAPTCHA_DEFAULT_TIMEOUT_MS = int('CAPTCHA_DEFAULT_TIMEOUT_MS', 180_000);
export const CAPTCHA_MIN_TIMEOUT_MS = int('CAPTCHA_MIN_TIMEOUT_MS', 5_000);
export const CAPTCHA_MAX_TIMEOUT_MS = int('CAPTCHA_MAX_TIMEOUT_MS', 600_000);
export const CAPTCHA_MAX_RETRIES = int('CAPTCHA_MAX_RETRIES', 5);
export const CAPTCHA_DEFAULT_RETRIES = int('CAPTCHA_DEFAULT_RETRIES', 2);

export const NETWORK_REPLAY_TIMEOUT_MS = int('NETWORK_REPLAY_TIMEOUT_MS', 30_000);
export const NETWORK_REPLAY_MAX_BODY_BYTES = int('NETWORK_REPLAY_MAX_BODY_BYTES', 512_000);
export const NETWORK_REPLAY_MAX_REDIRECTS = int('NETWORK_REPLAY_MAX_REDIRECTS', 5);
export const NETWORK_HAR_BODY_CONCURRENCY = int('NETWORK_HAR_BODY_CONCURRENCY', 4);

// ── CDP Protocol ──
export const CDP_JSON_LIST_PATH = '/json/list';
export const CDP_JSON_VERSION_PATH = '/json/version';
export const CDP_LOOPBACK_HOST = '127.0.0.1';

// ── Output Paths ──
export const MCP_ARTIFACTS_HAR_DIR = 'artifacts/har';
export const MCP_ARTIFACTS_REPORTS_DIR = 'artifacts/reports';
export const CAPTCHA_SCREENSHOT_FALLBACK_DIR = 'screenshots/captcha';

export const WORKFLOW_BATCH_MAX_ACCOUNTS = int('WORKFLOW_BATCH_MAX_ACCOUNTS', 50);
export const WORKFLOW_BATCH_MAX_CONCURRENCY = int('WORKFLOW_BATCH_MAX_CONCURRENCY', 1);
export const WORKFLOW_REGISTER_ACCOUNT_TIMEOUT_MS = int(
  'WORKFLOW_REGISTER_ACCOUNT_TIMEOUT_MS',
  60_000,
);
export const WORKFLOW_ACTION_DELAY_MS = int('WORKFLOW_ACTION_DELAY_MS', 1_000);
export const WORKFLOW_SETTLE_DELAY_MS = int('WORKFLOW_SETTLE_DELAY_MS', 2_000);
export const WORKFLOW_INPUT_DELAY_MS = int('WORKFLOW_INPUT_DELAY_MS', 1_500);

export const WORKFLOW_BATCH_MAX_RETRIES = int('WORKFLOW_BATCH_MAX_RETRIES', 3);
export const WORKFLOW_BATCH_MAX_BACKOFF_MS = int('WORKFLOW_BATCH_MAX_BACKOFF_MS', 30_000);
export const WORKFLOW_BATCH_MAX_TIMEOUT_MS = int('WORKFLOW_BATCH_MAX_TIMEOUT_MS', 300_000);
export const WORKFLOW_BATCH_RETRY_BACKOFF_MS = int('WORKFLOW_BATCH_RETRY_BACKOFF_MS', 2_000);
export const WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS = int(
  'WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS',
  90_000,
);
export const WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES = int(
  'WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES',
  20 * 1024 * 1024,
);
export const WORKFLOW_JS_BUNDLE_MAX_REDIRECTS = int('WORKFLOW_JS_BUNDLE_MAX_REDIRECTS', 5);
export const WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS = int(
  'WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS',
  30_000,
);
export const WORKFLOW_BUNDLE_CACHE_TTL_MS = int('WORKFLOW_BUNDLE_CACHE_TTL_MS', 5 * 60 * 1000);
export const WORKFLOW_BUNDLE_CACHE_MAX_BYTES = int(
  'WORKFLOW_BUNDLE_CACHE_MAX_BYTES',
  100 * 1024 * 1024,
);

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
  1.5,
);

/**
 * Default TTL (minutes) for domain activations via activate_domain and
 * search auto-activation. 0 = no auto-expiry.
 * Default: 30 minutes.
 */
export const ACTIVATION_TTL_MINUTES = int('ACTIVATION_TTL_MINUTES', 30);

/**
 * When enabled, search_tools automatically activates domains of top
 * inactive results (with TTL). Default: true.
 */
export const SEARCH_AUTO_ACTIVATE_DOMAINS = bool('SEARCH_AUTO_ACTIVATE_DOMAINS', true);

/**
 * AutoPruner inactivity thresholds. Previously hardcoded as 5 / 15 / 60s which
 * conflicted with ACTIVATION_TTL_MINUTES (30 min) — auto-activated domains
 * were being pruned long before their declared TTL. Defaults now align with
 * the TTL semantics:
 *   - AUTO_INACTIVITY_MS   = 15 min (auto-activated, soft-evict before TTL cap)
 *   - MANUAL_INACTIVITY_MS = 30 min (manual activations live for the full TTL)
 *   - CHECK_INTERVAL_MS    = 60 s   (frequency of the prune sweep)
 */
export const AUTOPRUNE_AUTO_INACTIVITY_MS = int('AUTOPRUNE_AUTO_INACTIVITY_MS', 15 * 60_000);
export const AUTOPRUNE_MANUAL_INACTIVITY_MS = int('AUTOPRUNE_MANUAL_INACTIVITY_MS', 30 * 60_000);
export const AUTOPRUNE_CHECK_INTERVAL_MS = int('AUTOPRUNE_CHECK_INTERVAL_MS', 60_000);

/**
 * PredictiveBooster parameters.
 *   - PREDICTIVE_MAX_HISTORY: sliding-window size for recorded tool calls.
 *     Raised from 50 to match the median length of a multi-domain session.
 *   - PREDICTIVE_CONFIDENCE_THRESHOLD: minimum transition probability to
 *     emit a prediction. Slightly lowered to surface emerging patterns
 *     sooner, while higher-order weighting filters noise.
 *   - PREDICTIVE_DECAY_FACTOR: exponential decay applied to stored
 *     transition weights on each record; makes recent usage dominate.
 */
export const PREDICTIVE_MAX_HISTORY = int('PREDICTIVE_MAX_HISTORY', 100);
export const PREDICTIVE_CONFIDENCE_THRESHOLD = float('PREDICTIVE_CONFIDENCE_THRESHOLD', 0.25);
export const PREDICTIVE_DECAY_FACTOR = float('PREDICTIVE_DECAY_FACTOR', 0.95);

/**
 * ActivationController tuning.
 *   - ACTIVATION_COOLDOWN_MS: minimum interval between two boost attempts for
 *     the same domain; prevents feedback loops when several events match in a
 *     short window.
 *   - ACTIVATION_COMPOUND_EVAL_EVERY: number of tool calls between compound
 *     condition evaluations (was hardcoded to 5).
 *   - ACTIVATION_EVENT_HISTORY_MAX: sliding-window size for event pattern
 *     matching.
 */
export const ACTIVATION_COOLDOWN_MS = int('ACTIVATION_COOLDOWN_MS', 30_000);
export const ACTIVATION_COMPOUND_EVAL_EVERY = int('ACTIVATION_COMPOUND_EVAL_EVERY', 5);
export const ACTIVATION_EVENT_HISTORY_MAX = int('ACTIVATION_EVENT_HISTORY_MAX', 200);

/**
 * Sliding-window durations used when evaluating boost rules and compound
 * conditions. Previously hardcoded at 60_000 / 120_000 / 300_000 across
 * ActivationController / CompoundConditionEngine; centralised here so
 * deployments can widen the windows for long-running debug sessions.
 */
export const ACTIVATION_BOOST_WINDOW_MS = int('ACTIVATION_BOOST_WINDOW_MS', 60_000);
export const COMPOUND_EVENT_WINDOW_MS = int('COMPOUND_EVENT_WINDOW_MS', 120_000);
export const COMPOUND_LONG_WINDOW_MS = int('COMPOUND_LONG_WINDOW_MS', 300_000);

/**
 * GraphBoost-inspired search enhancements (see GraphBoost paper §4).
 *
 * SEARCH_TFIDF_COSINE_WEIGHT: weight of TF-IDF cosine similarity in hybrid
 * scoring (0 = BM25 only, 1 = cosine only). Mirrors §4.1.3 hybrid retrieval.
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
export const SEARCH_TFIDF_COSINE_WEIGHT = float('SEARCH_TFIDF_COSINE_WEIGHT', 0.3);
export const SEARCH_AFFINITY_BOOST_FACTOR = float('SEARCH_AFFINITY_BOOST_FACTOR', 0.15);
export const SEARCH_AFFINITY_TOP_N = int('SEARCH_AFFINITY_TOP_N', 5);
export const SEARCH_DOMAIN_HUB_THRESHOLD = int('SEARCH_DOMAIN_HUB_THRESHOLD', 3);
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
export const SEARCH_TRIGRAM_WEIGHT = float('SEARCH_TRIGRAM_WEIGHT', 0.12);
export const SEARCH_TRIGRAM_THRESHOLD = float('SEARCH_TRIGRAM_THRESHOLD', 0.35);
export const SEARCH_RRF_K = int('SEARCH_RRF_K', 60);
export const SEARCH_RRF_RESCALE_FACTOR = float('SEARCH_RRF_RESCALE_FACTOR', 1000);
export const SEARCH_RRF_BM25_BLEND = float('SEARCH_RRF_BM25_BLEND', 0.5);
export const SEARCH_SYNONYM_EXPANSION_LIMIT = int('SEARCH_SYNONYM_EXPANSION_LIMIT', 3);
export const SEARCH_PARAM_TOKEN_WEIGHT = float('SEARCH_PARAM_TOKEN_WEIGHT', 1.5);

/**
 * BM25 scoring parameters.
 *
 * SEARCH_BM25_K1: term frequency saturation (1.2-2.0 typical; higher = more tf weight).
 * SEARCH_BM25_B: length normalization factor (0..1; 0.75 is the textbook default).
 *   The previous hardcoded value of 0.3 under-penalized long descriptions,
 *   allowing verbose tools to crowd the top results.
 */
export const SEARCH_BM25_K1 = float('SEARCH_BM25_K1', 1.5);
export const SEARCH_BM25_B = float('SEARCH_BM25_B', 0.75);

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
export const SEARCH_VECTOR_COSINE_WEIGHT = float('SEARCH_VECTOR_COSINE_WEIGHT', 0.4);
export const SEARCH_VECTOR_DYNAMIC_WEIGHT = bool('SEARCH_VECTOR_DYNAMIC_WEIGHT', true);
export const SEARCH_VECTOR_LEARN_UP = float('SEARCH_VECTOR_LEARN_UP', 0.05);
export const SEARCH_VECTOR_LEARN_DOWN = float('SEARCH_VECTOR_LEARN_DOWN', 0.03);
export const SEARCH_VECTOR_LEARN_TOP_N = int('SEARCH_VECTOR_LEARN_TOP_N', 5);

/**
 * Profile tier-aware ranking: tools whose domain is not visible under the
 * caller's active tier (search ⊂ workflow ⊂ full) are not filtered out but
 * downweighted by this multiplier (0..1). Setting to 1 disables the penalty.
 */
export const SEARCH_TIER_PENALTY = float('SEARCH_TIER_PENALTY', 0.7);

/** Per-profile tier penalty overrides. When set, these take precedence over SEARCH_TIER_PENALTY. */
export const SEARCH_TIER_PENALTY_SEARCH = float('SEARCH_TIER_PENALTY_SEARCH', 0.4);
export const SEARCH_TIER_PENALTY_WORKFLOW = float('SEARCH_TIER_PENALTY_WORKFLOW', 0.7);
export const SEARCH_TIER_PENALTY_FULL = float('SEARCH_TIER_PENALTY_FULL', 1.0);

/**
 * Recency / frequency boost: tools invoked within SEARCH_RECENCY_WINDOW_MS
 * receive a log-scaled boost up to SEARCH_RECENCY_MAX_BOOST. Helps user-
 * preferred tools naturally surface.
 *
 * SEARCH_RECENCY_TRACKER_MAX caps the tracker map size to bound memory in
 * long sessions; evicted entries are the oldest insertions (LRU).
 */
export const SEARCH_RECENCY_WINDOW_MS = int('SEARCH_RECENCY_WINDOW_MS', 30 * 60_000);
export const SEARCH_RECENCY_MAX_BOOST = float('SEARCH_RECENCY_MAX_BOOST', 0.4);
export const SEARCH_RECENCY_TRACKER_MAX = int('SEARCH_RECENCY_TRACKER_MAX', 200);

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
 *   PREDICTIVE_MAX_SECOND_ORDER_KEYS — upper bound on the second-order
 *       Markov table to keep memory usage predictable.
 */
export const SEARCH_EXACT_NAME_MATCH_MULTIPLIER = float('SEARCH_EXACT_NAME_MATCH_MULTIPLIER', 2.5);
export const SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER = float('SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER', 1.08);
export const SEARCH_AFFINITY_BASE_WEIGHT = float('SEARCH_AFFINITY_BASE_WEIGHT', 0.3);
export const SEARCH_COVERAGE_PRECISION_FACTOR = float('SEARCH_COVERAGE_PRECISION_FACTOR', 0.5);
export const SEARCH_PREFIX_MATCH_MULTIPLIER = float('SEARCH_PREFIX_MATCH_MULTIPLIER', 0.5);
export const PREDICTIVE_MAX_SECOND_ORDER_KEYS = int('PREDICTIVE_MAX_SECOND_ORDER_KEYS', 1000);

export const EXTENSION_GIT_CLONE_TIMEOUT_MS = int('EXTENSION_GIT_CLONE_TIMEOUT_MS', 60_000);
export const EXTENSION_GIT_CHECKOUT_TIMEOUT_MS = int('EXTENSION_GIT_CHECKOUT_TIMEOUT_MS', 30_000);

// ── MEDIUM — buffer sizes ──

export const PROCESS_LIST_MAX_BUFFER_BYTES = int('PROCESS_LIST_MAX_BUFFER_BYTES', 1024 * 1024 * 10);
export const EXTERNAL_TOOL_MAX_STDOUT_BYTES = int(
  'EXTERNAL_TOOL_MAX_STDOUT_BYTES',
  10 * 1024 * 1024,
);
export const EXTERNAL_TOOL_MAX_STDERR_BYTES = int(
  'EXTERNAL_TOOL_MAX_STDERR_BYTES',
  1 * 1024 * 1024,
);

// ── GraphQL ──
export const GRAPHQL_MAX_PREVIEW_CHARS = int('GRAPHQL_MAX_PREVIEW_CHARS', 4_000);
export const GRAPHQL_MAX_SCHEMA_CHARS = int('GRAPHQL_MAX_SCHEMA_CHARS', 120_000);
export const GRAPHQL_MAX_QUERY_CHARS = int('GRAPHQL_MAX_QUERY_CHARS', 12_000);
export const GRAPHQL_MAX_GRAPH_NODES = int('GRAPHQL_MAX_GRAPH_NODES', 2_000);
export const GRAPHQL_MAX_GRAPH_EDGES = int('GRAPHQL_MAX_GRAPH_EDGES', 5_000);

// ── Analysis ──
export const ANALYSIS_MAX_SUMMARY_FILES = int('ANALYSIS_MAX_SUMMARY_FILES', 40);
export const ANALYSIS_MAX_SAFE_COLLECTED_BYTES = int(
  'ANALYSIS_MAX_SAFE_COLLECTED_BYTES',
  256 * 1024,
);
export const ANALYSIS_MAX_SAFE_RESPONSE_BYTES = int('ANALYSIS_MAX_SAFE_RESPONSE_BYTES', 220 * 1024);

// ── Streaming / WebSocket ──
export const WS_PAYLOAD_PREVIEW_LIMIT = int('WS_PAYLOAD_PREVIEW_LIMIT', 200);
export const WS_PAYLOAD_SAMPLE_LIMIT = int('WS_PAYLOAD_SAMPLE_LIMIT', 2_000);

// ── Browser scripts ──
export const SCRIPTS_MAX_CAP = int('SCRIPTS_MAX_CAP', 500);

// ── MEDIUM — concurrency & resource limits ──

export const WORKER_POOL_MIN_WORKERS = int('WORKER_POOL_MIN_WORKERS', 2);
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
export const WORKER_POOL_IDLE_TIMEOUT_MS = int('WORKER_POOL_IDLE_TIMEOUT_MS', 30_000);
export const WORKER_POOL_JOB_TIMEOUT_MS = int('WORKER_POOL_JOB_TIMEOUT_MS', 15_000);

export const PARALLEL_DEFAULT_CONCURRENCY = int('PARALLEL_DEFAULT_CONCURRENCY', 3);
export const PARALLEL_DEFAULT_TIMEOUT_MS = int('PARALLEL_DEFAULT_TIMEOUT_MS', 60_000);
export const PARALLEL_DEFAULT_MAX_RETRIES = int('PARALLEL_DEFAULT_MAX_RETRIES', 2);
export const PARALLEL_RETRY_BACKOFF_BASE_MS = int('PARALLEL_RETRY_BACKOFF_BASE_MS', 1_000);

// ── MEDIUM — cache & budget limits ──

export const CACHE_GLOBAL_MAX_SIZE_BYTES = int('CACHE_GLOBAL_MAX_SIZE_BYTES', 500 * 1024 * 1024);
export const CACHE_LOW_HIT_RATE_THRESHOLD = float('CACHE_LOW_HIT_RATE_THRESHOLD', 0.3);
export const TOKEN_BUDGET_MAX_TOKENS = int('TOKEN_BUDGET_MAX_TOKENS', 200_000);
export const DETAILED_DATA_DEFAULT_TTL_MS = int('DETAILED_DATA_DEFAULT_TTL_MS', 30 * 60 * 1000);
export const DETAILED_DATA_MAX_TTL_MS = int('DETAILED_DATA_MAX_TTL_MS', 60 * 60 * 1000);
export const DETAILED_DATA_SMART_THRESHOLD_BYTES = int(
  'DETAILED_DATA_SMART_THRESHOLD_BYTES',
  50 * 1024,
);

// ── MEDIUM — LLM parameters ──

export const ADV_DEOBF_LLM_MAX_TOKENS = int('ADV_DEOBF_LLM_MAX_TOKENS', 3_000);
export const VM_DEOBF_LLM_MAX_TOKENS = int('VM_DEOBF_LLM_MAX_TOKENS', 4_000);
export const DEOBF_LLM_MAX_TOKENS = int('DEOBF_LLM_MAX_TOKENS', 2_000);
export const CRYPTO_DETECT_LLM_MAX_TOKENS = int('CRYPTO_DETECT_LLM_MAX_TOKENS', 2_000);

// ── MEDIUM — memory operations ──

export const MEMORY_READ_TIMEOUT_MS = int('MEMORY_READ_TIMEOUT_MS', 10_000);
export const MEMORY_MAX_READ_BYTES = int('MEMORY_MAX_READ_BYTES', 16 * 1024 * 1024);
export const MEMORY_WRITE_TIMEOUT_MS = int('MEMORY_WRITE_TIMEOUT_MS', 10_000);
export const MEMORY_MAX_WRITE_BYTES = int('MEMORY_MAX_WRITE_BYTES', 16 * 1024);
export const MEMORY_DUMP_TIMEOUT_MS = int('MEMORY_DUMP_TIMEOUT_MS', 60_000);
export const MEMORY_SCAN_TIMEOUT_MS = int('MEMORY_SCAN_TIMEOUT_MS', 120_000);
export const MEMORY_SCAN_MAX_BUFFER_BYTES = int('MEMORY_SCAN_MAX_BUFFER_BYTES', 1024 * 1024 * 50);
export const MEMORY_SCAN_MAX_RESULTS = int('MEMORY_SCAN_MAX_RESULTS', 10_000);
export const MEMORY_SCAN_MAX_REGIONS = int('MEMORY_SCAN_MAX_REGIONS', 50_000);
export const MEMORY_SCAN_REGION_MAX_BYTES = int('MEMORY_SCAN_REGION_MAX_BYTES', 16_777_216);
export const MEMORY_INJECT_TIMEOUT_MS = int('MEMORY_INJECT_TIMEOUT_MS', 30_000);
export const ENABLE_INJECTION_TOOLS = bool('ENABLE_INJECTION_TOOLS', true);
export const MEMORY_MONITOR_INTERVAL_MS = int('MEMORY_MONITOR_INTERVAL_MS', 1_000);

export const MEMORY_VMMAP_TIMEOUT_MS = int('MEMORY_VMMAP_TIMEOUT_MS', 15_000);
export const MEMORY_PROTECTION_QUERY_TIMEOUT_MS = int('MEMORY_PROTECTION_QUERY_TIMEOUT_MS', 15_000);
export const MEMORY_PROTECTION_PWSH_TIMEOUT_MS = int('MEMORY_PROTECTION_PWSH_TIMEOUT_MS', 30_000);

export const NATIVE_ADMIN_CHECK_TIMEOUT_MS = int('NATIVE_ADMIN_CHECK_TIMEOUT_MS', 5_000);
export const NATIVE_SCAN_MAX_RESULTS = int('NATIVE_SCAN_MAX_RESULTS', 10_000);

/** Launch wait after spawning a debug process (Linux/Mac). */
export const PROCESS_LAUNCH_WAIT_MS = int('PROCESS_LAUNCH_WAIT_MS', 2_000);

/** Poll attempts when waiting for a debug port (Windows). */
export const WIN_DEBUG_PORT_POLL_ATTEMPTS = int('WIN_DEBUG_PORT_POLL_ATTEMPTS', 20);
export const WIN_DEBUG_PORT_POLL_INTERVAL_MS = int('WIN_DEBUG_PORT_POLL_INTERVAL_MS', 500);

export const PACKER_SANDBOX_TIMEOUT_MS = int('PACKER_SANDBOX_TIMEOUT_MS', 3_000);

// ── Native scanning & analysis ──

/** Minimum size to consider a run of 0x00/0xCC as a code cave. */
export const CODE_CAVE_MIN_SIZE = int('CODE_CAVE_MIN_SIZE', 16);

/** Timeout waiting for a hardware breakpoint hit (ms). */
export const BREAKPOINT_HIT_TIMEOUT_MS = int('BREAKPOINT_HIT_TIMEOUT_MS', 10_000);
/** Max hits collected during a breakpoint trace. */
export const BREAKPOINT_TRACE_MAX_HITS = int('BREAKPOINT_TRACE_MAX_HITS', 100);

/** Max heap blocks enumerated per heap via Toolhelp32. */
export const HEAP_ENUMERATE_MAX_BLOCKS = int('HEAP_ENUMERATE_MAX_BLOCKS', 10_000);
/** Block count threshold that signals a heap spray pattern. */
export const HEAP_SPRAY_THRESHOLD = int('HEAP_SPRAY_THRESHOLD', 50);
/** Size rounding tolerance (bytes) when grouping blocks for spray detection. */
export const HEAP_SPRAY_SIZE_TOLERANCE = int('HEAP_SPRAY_SIZE_TOLERANCE', 64);
/** Block sizes above this (bytes) are flagged as suspicious. */
export const HEAP_SUSPICIOUS_BLOCK_SIZE = int('HEAP_SUSPICIOUS_BLOCK_SIZE', 10_485_760);

/** Default interval (ms) for memory freeze writes. */
export const FREEZE_DEFAULT_INTERVAL_MS = int('FREEZE_DEFAULT_INTERVAL_MS', 100);
/** Max entries kept in the write-value undo history. */
export const WRITE_HISTORY_MAX = int('WRITE_HISTORY_MAX', 200);

/** Max address matches stored per first-scan / group-scan. */
export const SCAN_MAX_RESULTS_PER_SCAN = int('SCAN_MAX_RESULTS_PER_SCAN', 100_000);
/** Max addresses returned in a tool response (display limit). */
export const SCAN_DISPLAY_RESULTS_LIMIT = int('SCAN_DISPLAY_RESULTS_LIMIT', 200);
/** Max addresses captured during an unknown-initial-value scan. */
export const SCAN_UNKNOWN_INITIAL_MAX_ADDRESSES = int(
  'SCAN_UNKNOWN_INITIAL_MAX_ADDRESSES',
  500_000,
);
/** Max pointers returned by a pointer scan. */
export const SCAN_POINTER_MAX_RESULTS = int('SCAN_POINTER_MAX_RESULTS', 5_000);
/** Max composite pattern size (bytes) for a group scan. */
export const SCAN_GROUP_MAX_PATTERN_SIZE = int('SCAN_GROUP_MAX_PATTERN_SIZE', 256);

/** Max concurrent scan sessions. */
export const SCAN_SESSION_MAX_COUNT = int('SCAN_SESSION_MAX_COUNT', 20);
/** Scan session inactivity TTL (ms). Default: 30 min. */
export const SCAN_SESSION_TTL_MS = int('SCAN_SESSION_TTL_MS', 1_800_000);

/** Max BFS depth for multi-level pointer chain scanning. */
export const POINTER_CHAIN_MAX_DEPTH = int('POINTER_CHAIN_MAX_DEPTH', 6);
/** Max offset (bytes) between pointer value and target to consider a match. */
export const POINTER_CHAIN_MAX_OFFSET = int('POINTER_CHAIN_MAX_OFFSET', 4096);
/** Max chains returned by a pointer chain scan. */
export const POINTER_CHAIN_MAX_RESULTS = int('POINTER_CHAIN_MAX_RESULTS', 500);
/** Chunk size (bytes) for reading memory during pointer chain scans. */
export const POINTER_CHAIN_SCAN_CHUNK_SIZE = int('POINTER_CHAIN_SCAN_CHUNK_SIZE', 16_777_216);

/** Default byte range analyzed by the structure analyzer. */
export const STRUCT_ANALYZE_DEFAULT_SIZE = int('STRUCT_ANALYZE_DEFAULT_SIZE', 256);
/** Max virtual functions enumerated per vtable. */
export const STRUCT_VTABLE_MAX_FUNCTIONS = int('STRUCT_VTABLE_MAX_FUNCTIONS', 64);
/** Max RTTI/mangled name string length to read. */
export const STRUCT_RTTI_MAX_STRING_LEN = int('STRUCT_RTTI_MAX_STRING_LEN', 256);
/** Max C-string length to read from process memory. */
export const STRUCT_CSTRING_MAX_LEN = int('STRUCT_CSTRING_MAX_LEN', 256);

/* ================================================================== */
/*  Binary instrumentation timeouts                                    */
/* ================================================================== */

/** Timeout for a single Frida CLI invocation (spawn/attach/detach helpers). */
export const FRIDA_TIMEOUT_MS = int('FRIDA_TIMEOUT_MS', 15_000);

/** Timeout for a Ghidra headless analyzer run (analyzeHeadless subprocess). */
export const GHIDRA_TIMEOUT_MS = int('GHIDRA_TIMEOUT_MS', 120_000);

/**
 * Timeout for a Unidbg subprocess invocation (spawn / call / trace).
 * The handler layer used to duplicate this with a tighter 30s ceiling which
 * caused premature failure when a module worked 31-59s. Unified here.
 */
export const UNIDBG_TIMEOUT_MS = int('UNIDBG_TIMEOUT_MS', 60_000);

/* ================================================================== */
/*  ADB bridge timeouts                                                */
/* ================================================================== */

/** Default timeout for a generic `adb` CLI call. */
export const ADB_DEFAULT_TIMEOUT_MS = int('ADB_DEFAULT_TIMEOUT_MS', 30_000);

/** Timeout for `adb shell` commands (may run longer than generic adb calls). */
export const ADB_SHELL_TIMEOUT_MS = int('ADB_SHELL_TIMEOUT_MS', 60_000);

/** Timeout for an HTTP GET against an on-device WebView debugger endpoint. */
export const ADB_WEBVIEW_HTTP_TIMEOUT_MS = int('ADB_WEBVIEW_HTTP_TIMEOUT_MS', 5_000);

/** Timeout for establishing a WebSocket to an on-device WebView. */
export const ADB_WEBVIEW_WS_TIMEOUT_MS = int('ADB_WEBVIEW_WS_TIMEOUT_MS', 10_000);

/* ================================================================== */
/*  Mojo IPC                                                           */
/* ================================================================== */

/** Timeout for a Mojo-monitor helper subprocess. */
export const MOJO_MONITOR_TIMEOUT_MS = int('MOJO_MONITOR_TIMEOUT_MS', 10_000);

/* ================================================================== */
/*  Process memory availability probe                                  */
/* ================================================================== */

/** TTL of the "native memory scan available" cache (platform probe). */
export const MEMORY_AVAILABILITY_CACHE_TTL_MS = int('MEMORY_AVAILABILITY_CACHE_TTL_MS', 45_000);

/* ================================================================== */
/*  HTTP transport                                                     */
/* ================================================================== */

/** Upper bound on the per-IP rate-limit map before GC kicks in. */
export const HTTP_RATE_LIMIT_MAX_IPS = int('HTTP_RATE_LIMIT_MAX_IPS', 10_000);

/** Frequency of the HTTP transport's rate-limit + session cleanup sweep. */
export const HTTP_CLEANUP_INTERVAL_MS = int('HTTP_CLEANUP_INTERVAL_MS', 5 * 60_000);

/** Default SSE heartbeat interval (comment frames to keep the stream open). */
export const SSE_HEARTBEAT_MS = int('SSE_HEARTBEAT_MS', 30_000);

/* ================================================================== */
/*  Compact tool schema (token optimization)                           */
/* ================================================================== */

/**
 * When true, strip parameter descriptions from registered tool schemas
 * to reduce the tools/list payload. Full schemas remain available via
 * the describe_tool meta-tool. Default: true for full profile.
 */
export const MCP_COMPACT_SCHEMA = bool('MCP_COMPACT_SCHEMA', true);

/* ================================================================== */
/*  Sandbox / native bridge / sourcemap / v8                           */
/* ================================================================== */

/** Hard ceiling applied to user-supplied sandbox exec timeouts. */
export const SANDBOX_MAX_TIMEOUT_MS = int('SANDBOX_MAX_TIMEOUT_MS', 30_000);

/** Timeout for REST calls to the native bridge (IDA/Ghidra). */
export const NATIVE_BRIDGE_TIMEOUT_MS = int('NATIVE_BRIDGE_TIMEOUT_MS', 15_000);

/** Timeout for the sourcemap-extension fetch helper. */
export const SOURCEMAP_EXT_TIMEOUT_MS = int('SOURCEMAP_EXT_TIMEOUT_MS', 15_000);

/** Timeout for the V8 bytecode extraction subprocess helper. */
export const V8_BYTECODE_SUBPROC_TIMEOUT_MS = int('V8_BYTECODE_SUBPROC_TIMEOUT_MS', 60_000);

/* ================================================================== */
/*  Webhook / cross-domain orchestrator / macros                       */
/* ================================================================== */

/** Default per-command processing timeout inside the webhook command queue. */
export const WEBHOOK_PROCESS_TIMEOUT_MS = int('WEBHOOK_PROCESS_TIMEOUT_MS', 10_000);

/** Default per-step timeout for the cross-domain orchestrator. */
export const ORCHESTRATOR_STEP_TIMEOUT_MS = int('ORCHESTRATOR_STEP_TIMEOUT_MS', 10_000);

/** Default overall macro timeout (MacroRunner). */
export const MACRO_DEFAULT_TIMEOUT_MS = int('MACRO_DEFAULT_TIMEOUT_MS', 120_000);

/** Default per-invocation timeout for built-in macro definitions. */
export const MACRO_BUILTIN_TIMEOUT_MS = int('MACRO_BUILTIN_TIMEOUT_MS', 60_000);

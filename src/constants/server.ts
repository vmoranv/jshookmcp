/**
 * Server lifecycle, MCP transport, debug ports, timeouts, and token budgets.
 * Prefixes: SHUTDOWN_*, RUNTIME_*, DEBUG_*, MCP_*, TOKEN_*, ACTIVATION_*
 */

import { int, float, bool, list, str } from './helpers.js';

/* ================================================================== */
/*  Server lifecycle                                                   */
/* ================================================================== */

/** Maximum time allowed for graceful shutdown before force-exiting. */
export const SHUTDOWN_TIMEOUT_MS = int('SHUTDOWN_TIMEOUT_MS', 20_000);

/* ================================================================== */
/*  Multi-instance guard (stdio MCP process pile-up)                   */
/* ================================================================== */

/**
 * JSHOOK_INSTANCE_WARN_AT: log a warning when this many live jshook processes
 * (including the current one) are registered. Default 2 — a single host is
 * normal; concurrent Claude/Codex/Grok/Hermes sessions commonly pile up.
 */
export const JSHOOK_INSTANCE_WARN_AT = int('JSHOOK_INSTANCE_WARN_AT', 2);

/**
 * JSHOOK_MAX_INSTANCES: hard cap on concurrent jshook server processes.
 * 0 = unlimited (default). When exceeded, startup exits with a clear error
 * so hosts do not silently spawn more multi-GB processes.
 */
export const JSHOOK_MAX_INSTANCES = int('JSHOOK_MAX_INSTANCES', 0);

/** Sliding window (ms) for counting runtime errors before entering degraded mode. */
export const RUNTIME_ERROR_WINDOW_MS = int('RUNTIME_ERROR_WINDOW_MS', 60_000);

/** Max recoverable errors within the window before enabling degraded mode. */
export const RUNTIME_ERROR_THRESHOLD = int('RUNTIME_ERROR_THRESHOLD', 8);

/* ================================================================== */
/*  Debug ports & endpoints                                            */
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

/* ================================================================== */
/*  MCP transport timeouts                                             */
/* ================================================================== */

export const MCP_HTTP_REQUEST_TIMEOUT_MS = int('MCP_HTTP_REQUEST_TIMEOUT_MS', 30_000);
export const MCP_HTTP_HEADERS_TIMEOUT_MS = int('MCP_HTTP_HEADERS_TIMEOUT_MS', 10_000);
export const MCP_HTTP_KEEPALIVE_TIMEOUT_MS = int('MCP_HTTP_KEEPALIVE_TIMEOUT_MS', 86_400_000); // 24h for SSE long-lived connections
export const MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS = int('MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS', 5_000);

/* ================================================================== */
/*  Token budgets                                                      */
/* ================================================================== */

export const TOKEN_BUDGET_MAX_TOKENS = int('TOKEN_BUDGET_MAX_TOKENS', 200_000);

/* ================================================================== */
/*  Activation system                                                  */
/* ================================================================== */

/**
 * Default TTL (minutes) for domain activations via activate_domain and
 * search auto-activation. 0 = no auto-expiry.
 * Default: 30 minutes.
 */
export const ACTIVATION_TTL_MINUTES = int('ACTIVATION_TTL_MINUTES', 30);

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

/* ================================================================== */
/*  Extension system                                                   */
/* ================================================================== */

export const EXTENSION_GIT_CLONE_TIMEOUT_MS = int('EXTENSION_GIT_CLONE_TIMEOUT_MS', 60_000);
export const EXTENSION_GIT_CHECKOUT_TIMEOUT_MS = int('EXTENSION_GIT_CHECKOUT_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  CDP Protocol                                                       */
/* ================================================================== */

export const CDP_JSON_LIST_PATH = '/json/list';
export const CDP_JSON_VERSION_PATH = '/json/version';
export const CDP_LOOPBACK_HOST = '127.0.0.1';

/* ================================================================== */
/*  Output Paths                                                       */
/* ================================================================== */

export const MCP_ARTIFACTS_HAR_DIR = 'artifacts/har';
export const MCP_ARTIFACTS_REPORTS_DIR = 'artifacts/reports';

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
/*  HTTP transport                                                     */
/* ================================================================== */

/** Upper bound on the per-IP rate-limit map before GC kicks in. */
export const HTTP_RATE_LIMIT_MAX_IPS = int('HTTP_RATE_LIMIT_MAX_IPS', 10_000);

/** Frequency of the HTTP transport's rate-limit + session cleanup sweep. */
export const HTTP_CLEANUP_INTERVAL_MS = int('HTTP_CLEANUP_INTERVAL_MS', 5 * 60_000);

/** Default SSE heartbeat interval (comment frames to keep the stream open). */
export const SSE_HEARTBEAT_MS = int('SSE_HEARTBEAT_MS', 30_000);

/* ================================================================== */
/*  MCP structured logging                                             */
/* ================================================================== */

/** Whether to enable MCP `notifications/message` structured log transport. */
export const MCP_LOG_ENABLED = bool('MCP_LOG_ENABLED', false);

/** Minimum log level for the MCP structured log transport. */
export const MCP_LOG_LEVEL = str('MCP_LOG_LEVEL', 'info');

/** Directory for file-based MCP log persistence. Empty = disabled. */
export const MCP_LOG_FILE_DIR = str('MCP_LOG_FILE_DIR', '');

/* ================================================================== */
/*  Concurrency & resource limits                                      */
/* ================================================================== */

export const WORKER_POOL_MIN_WORKERS = int('WORKER_POOL_MIN_WORKERS', 2);
export const WORKER_POOL_IDLE_TIMEOUT_MS = int('WORKER_POOL_IDLE_TIMEOUT_MS', 30_000);
export const WORKER_POOL_JOB_TIMEOUT_MS = int('WORKER_POOL_JOB_TIMEOUT_MS', 15_000);

export const PARALLEL_DEFAULT_CONCURRENCY = int('PARALLEL_DEFAULT_CONCURRENCY', 3);
export const PARALLEL_DEFAULT_TIMEOUT_MS = int('PARALLEL_DEFAULT_TIMEOUT_MS', 60_000);
export const PARALLEL_DEFAULT_MAX_RETRIES = int('PARALLEL_DEFAULT_MAX_RETRIES', 2);
export const PARALLEL_RETRY_BACKOFF_BASE_MS = int('PARALLEL_RETRY_BACKOFF_BASE_MS', 1_000);

/* ================================================================== */
/*  Cache & budget limits                                              */
/* ================================================================== */

export const CACHE_GLOBAL_MAX_SIZE_BYTES = int('CACHE_GLOBAL_MAX_SIZE_BYTES', 500 * 1024 * 1024);
export const CACHE_LOW_HIT_RATE_THRESHOLD = float('CACHE_LOW_HIT_RATE_THRESHOLD', 0.3);
export const DETAILED_DATA_DEFAULT_TTL_MS = int('DETAILED_DATA_DEFAULT_TTL_MS', 30 * 60 * 1000);
export const DETAILED_DATA_MAX_TTL_MS = int('DETAILED_DATA_MAX_TTL_MS', 60 * 60 * 1000);
export const DETAILED_DATA_SMART_THRESHOLD_BYTES = int(
  'DETAILED_DATA_SMART_THRESHOLD_BYTES',
  50 * 1024,
);
// Per-field cache sanitization: strings larger than this (bytes) are offloaded to disk
// and replaced with a compact placeholder before entering DetailedDataManager. data: URIs
// are always offloaded regardless of size (base64 is meaningless to an LLM). See issue #62.
export const OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES = int(
  'OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES',
  64 * 1024,
);

/* ================================================================== */
/*  Buffer sizes                                                       */
/* ================================================================== */

export const PROCESS_LIST_MAX_BUFFER_BYTES = int('PROCESS_LIST_MAX_BUFFER_BYTES', 1024 * 1024 * 10);

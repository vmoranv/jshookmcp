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

/** Sliding window (ms) for counting runtime errors before entering degraded mode. */
export const RUNTIME_ERROR_WINDOW_MS = int('RUNTIME_ERROR_WINDOW_MS', 60_000);

/** Max recoverable errors within the window before enabling degraded mode. */
export const RUNTIME_ERROR_THRESHOLD = int('RUNTIME_ERROR_THRESHOLD', 8);

/** Warn when this many live jshook server processes share the same user state directory. */
export const JSHOOK_INSTANCE_WARN_AT = int('JSHOOK_INSTANCE_WARN_AT', 2);

/** Optional hard cap for live jshook server processes. 0 disables the cap. */
export const JSHOOK_MAX_INSTANCES = int('JSHOOK_MAX_INSTANCES', 0);

/* ================================================================== */
/*  Debug ports & endpoints                                            */
/* ================================================================== */

/** Ports scanned when looking for a CDP / Node debug listener. */
export const DEBUG_PORT_CANDIDATES = list('DEBUG_PORT_CANDIDATES', [9222, 9229, 9333, 2039]);

/** Default port used when launching a process with `--remote-debugging-port`. */
export const DEFAULT_DEBUG_PORT = int('DEFAULT_DEBUG_PORT', 9222);

/** HTTP transport listen port for the MCP server (`MCP_PORT`). */
export const MCP_HTTP_PORT = int('MCP_PORT', 3000);

/** HTTP transport listen host for the MCP server (`MCP_HOST`). */
export const MCP_HTTP_HOST = str('MCP_HOST', '127.0.0.1');

/** Gate detailed health-check output behind MCP_HEALTH_VERBOSE. */
export const MCP_HEALTH_VERBOSE = bool('MCP_HEALTH_VERBOSE', false);

/** Permit non-localhost HTTP bindings without MCP_AUTH_TOKEN. */
export const MCP_ALLOW_INSECURE = bool('MCP_ALLOW_INSECURE', false);

/** Ghidra bridge REST endpoint. */
export const GHIDRA_BRIDGE_ENDPOINT = str('GHIDRA_BRIDGE_URL', 'http://127.0.0.1:18080');

/** IDA bridge REST endpoint. */
export const IDA_BRIDGE_ENDPOINT = str('IDA_BRIDGE_URL', 'http://127.0.0.1:18081');

/** Base URL for the configured external CAPTCHA solver service. */
export const CAPTCHA_SOLVER_BASE_URL =
  str('CAPTCHA_SOLVER_BASE_URL', '').trim() || str('CAPTCHA_2CAPTCHA_BASE_URL', '').trim();

/** Extension registry base URL. Must be supplied via .env or environment. */
export const EXTENSION_REGISTRY_BASE_URL = str('EXTENSION_REGISTRY_BASE_URL', '').trim();

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
 * Token budget for dynamically activated tools in search-tier sessions
 * (activate_tools / activate_domain). The summed estimate of activated tool
 * definitions may not exceed this limit; further activations are rejected.
 * Only the activatedToolNames increment counts — base profile tools are free.
 * Default: 30000.
 */
export const MCP_TOOL_ACTIVATION_BUDGET_TOKENS = int('MCP_TOOL_ACTIVATION_BUDGET_TOKENS', 30_000);

/**
 * Max number of dynamically activated tools in search-tier sessions.
 * Default: 50.
 */
export const MCP_TOOL_MAX_ACTIVE_TOOLS = int('MCP_TOOL_MAX_ACTIVE_TOOLS', 50);

/**
 * AutoPruner inactivity thresholds. Previously hardcoded as 5 / 15 / 60s which
 * conflicted with ACTIVATION_TTL_MINUTES (30 min) — auto-activated domains
 * were being pruned long before their declared TTL. Defaults now align with
 * the TTL semantics:
 *   - AUTO_INACTIVITY_MS   = 15 min (auto-activated, soft-evict before TTL cap)
 *   - MANUAL_INACTIVITY_MS = 30 min (inactivity leash for a manual activation)
 *   - CHECK_INTERVAL_MS    = 60 s   (frequency of the prune sweep)
 *
 * MANUAL_INACTIVITY_MS is an INACTIVITY ceiling, not a TTL: an
 * `activate_domain({ ttlMinutes })` past 30 min is still retired after 30 min
 * without tool activity. Only `ttlMinutes: 0` (no expiry) and the base profile
 * tier are exempt. Raise it above ACTIVATION_TTL_MINUTES if you want a
 * caller-supplied TTL to be authoritative.
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
/** Lower bound for the install/build phase after a clone (never below the clone timeout). */
export const EXTENSION_INSTALL_TIMEOUT_MS = int('EXTENSION_INSTALL_TIMEOUT_MS', 120_000);

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
/*  Stdio transport                                                    */
/* ================================================================== */

/** Max time to wait for a single stdout write before treating it as broken. */
export const STDIO_SEND_TIMEOUT_MS = int('STDIO_SEND_TIMEOUT_MS', 500);

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

/** Retry-After (ms) returned by the HTTP transport when at session capacity. */
export const HTTP_CAPACITY_RETRY_AFTER_MS = int('HTTP_CAPACITY_RETRY_AFTER_MS', 1_000);

/**
 * Opt-in MCP Streamable HTTP "JSON response" mode: reply with an
 * `application/json` body instead of the default `text/event-stream` stream.
 *
 * Latency win (mean -15%~-33%, p90 ~3.08ms → 1.71ms per the SSE-reuse survey)
 * at two documented costs:
 *
 *   1. The SDK (1.29.0) silently DROPS server-initiated requests sent with a
 *      `relatedRequestId` in JSON mode — `send()` neither writes them to the
 *      (now-absent) response SSE stream nor buffers them into the JSON body
 *      (webStandardStreamableHttp.js). ElicitationBridge (`elicitation/create`)
 *      and LLMSamplingBridge (`sampling/createMessage`) attach
 *      `relatedRequestId` when invoked from INSIDE a tool call, so those
 *      mid-call requests are lost. The same requests sent WITHOUT a
 *      `relatedRequestId` (e.g. from a background task) route to the
 *      standalone GET SSE stream and are unaffected. Resolution: this flag
 *      defaults OFF; enabling it disables in-tool-call elicitation/sampling
 *      delegation (the common CAPTCHA-pause / LLM-delegate path).
 *
 *   2. No streaming first byte: the SDK buffers until every response for the
 *      POST is ready before resolving the JSON body, so long-running tools get
 *      no progressive output (no progress notifications over the response, no
 *      early partial results).
 *
 * @env MCP_HTTP_JSON_RESPONSE
 * @default false
 */
export const MCP_HTTP_JSON_RESPONSE = bool('MCP_HTTP_JSON_RESPONSE', false);

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
/*  Skills over MCP (SEP-2640, experimental SDK extension)             */
/* ================================================================== */

/**
 * Directory served through the MCP Skills extension. Empty (default) points at
 * `<projectRoot>/skills` — the bundled operation guides. Set to `off` to disable
 * the extension entirely, or to an absolute/custom path to serve your own skills
 * folder (each subfolder must contain a `SKILL.md` with name/description).
 */
export const MCP_SKILLS_DIR = str('MCP_SKILLS_DIR', '');

/* ================================================================== */
/*  V8 heap snapshot retention                                         */
/* ================================================================== */

/**
 * Retention caps for v8_inspector heap snapshots.
 *
 * `MCP_V8_HEAP_SNAPSHOT_MAX_COUNT` bounds both the on-disk and in-memory
 * snapshot store. It defaults to 3 so a long-lived process never retains every
 * captured snapshot's chunks in memory (each capture is GB-scale); set it to 0
 * to opt out of eviction, or raise it via env. `MCP_V8_HEAP_SNAPSHOT_MAX_TOTAL_MB`
 * additionally bounds the on-disk bytes and defaults to 0 (disabled).
 */
export const MCP_V8_HEAP_SNAPSHOT_MAX_COUNT = int('MCP_V8_HEAP_SNAPSHOT_MAX_COUNT', 3);
export const MCP_V8_HEAP_SNAPSHOT_MAX_TOTAL_MB = int('MCP_V8_HEAP_SNAPSHOT_MAX_TOTAL_MB', 0);

/* ================================================================== */
/*  Concurrency & resource limits                                      */
/* ================================================================== */

export const WORKER_POOL_MIN_WORKERS = int('WORKER_POOL_MIN_WORKERS', 2);
export const WORKER_POOL_IDLE_TIMEOUT_MS = int('WORKER_POOL_IDLE_TIMEOUT_MS', 30_000);
export const WORKER_POOL_JOB_TIMEOUT_MS = int('WORKER_POOL_JOB_TIMEOUT_MS', 15_000);

/** Browser fleet: max local sessions the HTTP transport admits by default. */
export const MCP_BROWSER_FLEET_MAX_LOCAL_LEASES = int('MCP_BROWSER_FLEET_MAX_LOCAL_LEASES', 4096);

/** Browser fleet: HTTP session idle TTL before eviction (ms). */
export const MCP_BROWSER_FLEET_LEASE_TTL_MS = int('MCP_BROWSER_FLEET_LEASE_TTL_MS', 600_000);

/** Browser fleet: consistent-hash ring size for local session routing. */
export const MCP_BROWSER_FLEET_VIRTUAL_NODES = int('MCP_BROWSER_FLEET_VIRTUAL_NODES', 128);

/** MCP transport mode: 'stdio' (default) or 'http'. */
export const MCP_TRANSPORT = str('MCP_TRANSPORT', 'stdio');

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

/** LargeDataOffloader: strings larger than this (bytes) go to DetailedDataManager. */
export const OFFLOADER_DETAIL_THRESHOLD_BYTES = int('OFFLOADER_DETAIL_THRESHOLD', 512 * 1024);

/** LargeDataOffloader: strings larger than this (bytes) go directly to a file. */
export const OFFLOADER_FILE_THRESHOLD_BYTES = int('OFFLOADER_FILE_THRESHOLD', 4 * 1024 * 1024);

/**
 * handleGetOffloadedData read-back guard: refuse to read an offloaded file
 * larger than this (bytes) back into memory in a single read. A multi-MB blob
 * read synchronously would freeze the event loop and balloon ~33% larger as a
 * base64 string. Offloaded files live in artifacts/offloaded/; raise this env
 * var deliberately only when a caller must read back a larger blob (a2-05/a4-05).
 */
export const MAX_OFFLOADED_READ_BYTES = int('MAX_OFFLOADED_READ_BYTES', 64 * 1024 * 1024);

/* ================================================================== */
/*  Buffer sizes                                                       */
/* ================================================================== */

export const PROCESS_LIST_MAX_BUFFER_BYTES = int('PROCESS_LIST_MAX_BUFFER_BYTES', 1024 * 1024 * 10);

/** Single-process PowerShell exec: max captured stdout (getProcessByPid, windows, command-line, ports, kill). */
export const PROCESS_EXEC_MAX_BUFFER_BYTES = int('PROCESS_EXEC_MAX_BUFFER_BYTES', 1024 * 1024);

/* ================================================================== */
/*  Tool execution pipeline                                            */
/* ================================================================== */

/** Watchdog: warn when a tool execution exceeds this duration (ms). */
export const TOOL_EXEC_HANG_WATCHDOG_MS = int('TOOL_EXEC_HANG_WATCHDOG_MS', 30_000);

/** Circuit-breaker retry-after (seconds) fallback when no breaker state exists. */
export const DEFAULT_RETRY_AFTER_SEC = int('RETRY_AFTER_SEC', 30);

/**
 * Browser session cost-hint table (EWMA cold-start estimates, ms).
 * Estimated durations for tool classes without an explicit duration arg:
 *   - COST_HINT_SEARCH     navigation / wait-heavy tools
 *   - COST_HINT_FEEDBACK   human-mouse motion
 *   - COST_HINT_SECURITY   human scroll
 *   - COST_HINT_DEFAULT    quick read-only tools (get/list/status/...)
 *   - COST_HINT_WORKFLOW   everything else
 *   - COST_HINT_MULTIPLIER timeout args are upper bounds; scale them down
 */
export const COST_HINT_SEARCH = int('COST_HINT_SEARCH', 7_500);
export const COST_HINT_FEEDBACK = int('COST_HINT_FEEDBACK', 600);
export const COST_HINT_SECURITY = int('COST_HINT_SECURITY', 1_500);
export const COST_HINT_DEFAULT = int('COST_HINT_DEFAULT', 50);
export const COST_HINT_WORKFLOW = int('COST_HINT_WORKFLOW', 250);
export const COST_HINT_MULTIPLIER = float('COST_HINT_MULTIPLIER', 0.25);

/** Preview length (chars) for the args payload in hung-tool watchdog logs. */
export const ARGS_PREVIEW_MAX_CHARS = int('ARGS_PREVIEW_MAX_CHARS', 500);

/**
 * Doom-loop circuit breaker: block a tool call once the SAME tool has been
 * invoked this many consecutive times with identical arguments within one MCP
 * session (a call with different arguments resets the counter). Once the
 * threshold is reached every further identical call returns an error response,
 * but the long advisory text is only repeated every `threshold` calls to avoid
 * flooding the client. 0 disables the breaker.
 *
 * @env MCP_DOOM_LOOP_THRESHOLD
 * @default 5
 */
export const MCP_DOOM_LOOP_THRESHOLD = int('MCP_DOOM_LOOP_THRESHOLD', 5);

/** Upper bound on how many rule summaries are listed in a deny error response. */
export const TOOL_GATE_MAX_LISTED_RULES = 10;

/* ================================================================== */
/*  Time units                                                         */
/* ================================================================== */

/** Milliseconds in one minute (pure unit constant, not env-configurable). */
export const MS_PER_MINUTE = 60_000;

/* ================================================================== */
/*  Browser session coordinator                                        */
/* ================================================================== */

/** Max tracked browser sessions; new session ids are rejected once exceeded. */
export const BROWSER_SESSION_MAX_SESSIONS = int('BROWSER_SESSION_MAX_SESSIONS', 512);

/** Idle threshold before a tracked browser session is swept (ms). */
export const BROWSER_SESSION_IDLE_TTL_MS = int('BROWSER_SESSION_IDLE_TTL_MS', 30 * 60_000);

/** Idle sweep interval for the browser session coordinator (ms). */
export const BROWSER_SESSION_SWEEP_MS = int('BROWSER_SESSION_SWEEP_MS', 60_000);

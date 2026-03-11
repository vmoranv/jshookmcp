/**
 * Centralized runtime-tunable constants.
 *
 * Every value can be overridden via the corresponding env var (loaded from
 * `.env` by `dotenv` at startup).  Modules import from here instead of
 * hard-coding magic numbers.
 */

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

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

const str = (key: string, fallback: string): string =>
  process.env[key] || fallback;

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

const json = <T>(key: string, fallback: T): T => {
  const v = process.env[key];
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

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

/* ================================================================== */
/*  MEDIUM — timeouts                                                  */
/* ================================================================== */

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

export const DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS = int('DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS', 30_000);
export const WATCH_EVAL_TIMEOUT_MS = int('WATCH_EVAL_TIMEOUT_MS', 5_000);

export const TRANSFORM_WORKER_TIMEOUT_MS = int('TRANSFORM_WORKER_TIMEOUT_MS', 15_000);
export const TRANSFORM_VM_SCRIPT_TIMEOUT_MS = int('TRANSFORM_VM_SCRIPT_TIMEOUT_MS', 5_000);
export const TRANSFORM_CRYPTO_POOL_MAX_WORKERS = int('TRANSFORM_CRYPTO_POOL_MAX_WORKERS', 4);
export const TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS = int('TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS', 30_000);
export const TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB = int('TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB', 128);
export const TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB = int('TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB', 32);

export const EMULATOR_FETCH_GOTO_TIMEOUT_MS = int('EMULATOR_FETCH_GOTO_TIMEOUT_MS', 30_000);

export const WASM_TOOL_TIMEOUT_MS = int('WASM_TOOL_TIMEOUT_MS', 60_000);
export const WASM_OFFLINE_RUN_TIMEOUT_MS = int('WASM_OFFLINE_RUN_TIMEOUT_MS', 10_000);
export const WASM_OPTIMIZE_TIMEOUT_MS = int('WASM_OPTIMIZE_TIMEOUT_MS', 120_000);

export const MINIAPP_UNPACK_TIMEOUT_MS = int('MINIAPP_UNPACK_TIMEOUT_MS', 180_000);

export const CAPTCHA_SUBMIT_TIMEOUT_MS = int('CAPTCHA_SUBMIT_TIMEOUT_MS', 15_000);
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
export const NETWORK_HAR_BODY_CONCURRENCY = int('NETWORK_HAR_BODY_CONCURRENCY', 8);

export const WORKFLOW_BATCH_MAX_RETRIES = int('WORKFLOW_BATCH_MAX_RETRIES', 3);
export const WORKFLOW_BATCH_MAX_BACKOFF_MS = int('WORKFLOW_BATCH_MAX_BACKOFF_MS', 30_000);
export const WORKFLOW_BATCH_MAX_TIMEOUT_MS = int('WORKFLOW_BATCH_MAX_TIMEOUT_MS', 300_000);
export const WORKFLOW_BATCH_RETRY_BACKOFF_MS = int('WORKFLOW_BATCH_RETRY_BACKOFF_MS', 2_000);
export const WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS = int('WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS', 90_000);
export const WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES = int('WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES', 20 * 1024 * 1024);
export const WORKFLOW_JS_BUNDLE_MAX_REDIRECTS = int('WORKFLOW_JS_BUNDLE_MAX_REDIRECTS', 5);
export const WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS = int('WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS', 30_000);
export const WORKFLOW_BUNDLE_CACHE_TTL_MS = int('WORKFLOW_BUNDLE_CACHE_TTL_MS', 5 * 60 * 1000);
export const WORKFLOW_BUNDLE_CACHE_MAX_BYTES = int('WORKFLOW_BUNDLE_CACHE_MAX_BYTES', 100 * 1024 * 1024);

/**
 * Search ranking controls for workflow-domain tools.
 * `SEARCH_WORKFLOW_BOOST_TIERS` accepts comma-separated tiers, default: workflow,full
 * `SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER` default: 1.5
 */
export const SEARCH_WORKFLOW_BOOST_TIERS = new Set(
  csv('SEARCH_WORKFLOW_BOOST_TIERS', ['workflow', 'full'])
);
export const SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER = float('SEARCH_WORKFLOW_DOMAIN_BOOST_MULTIPLIER', 1.5);

/**
 * Optional JSON override for explicit intent->tool ranking boosts in ToolSearch.
 * Shape:
 * [
 *   {
 *     "pattern": "regex",
 *     "flags": "i",
 *     "boosts": [{"tool":"web_api_capture_session","bonus":26}]
 *   }
 * ]
 */
export type SearchIntentToolBoostRuleConfig = {
  pattern: string;
  flags?: string;
  boosts: Array<{ tool: string; bonus: number }>;
};
export const SEARCH_INTENT_TOOL_BOOST_RULES_OVERRIDE =
  json<SearchIntentToolBoostRuleConfig[] | null>('SEARCH_INTENT_TOOL_BOOST_RULES_JSON', null);

export const EXTENSION_GIT_CLONE_TIMEOUT_MS = int('EXTENSION_GIT_CLONE_TIMEOUT_MS', 60_000);
export const EXTENSION_GIT_CHECKOUT_TIMEOUT_MS = int('EXTENSION_GIT_CHECKOUT_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  MEDIUM — buffer sizes                                              */
/* ================================================================== */

export const PROCESS_LIST_MAX_BUFFER_BYTES = int('PROCESS_LIST_MAX_BUFFER_BYTES', 1024 * 1024 * 10);
export const EXTERNAL_TOOL_MAX_STDOUT_BYTES = int('EXTERNAL_TOOL_MAX_STDOUT_BYTES', 10 * 1024 * 1024);
export const EXTERNAL_TOOL_MAX_STDERR_BYTES = int('EXTERNAL_TOOL_MAX_STDERR_BYTES', 1 * 1024 * 1024);

/* ================================================================== */
/*  MEDIUM — concurrency & resource limits                             */
/* ================================================================== */

export const WORKER_POOL_MIN_WORKERS = int('WORKER_POOL_MIN_WORKERS', 2);
export const WORKER_POOL_MAX_WORKERS = int('WORKER_POOL_MAX_WORKERS', 4);
export const WORKER_POOL_IDLE_TIMEOUT_MS = int('WORKER_POOL_IDLE_TIMEOUT_MS', 30_000);
export const WORKER_POOL_JOB_TIMEOUT_MS = int('WORKER_POOL_JOB_TIMEOUT_MS', 15_000);

export const PARALLEL_DEFAULT_CONCURRENCY = int('PARALLEL_DEFAULT_CONCURRENCY', 3);
export const PARALLEL_DEFAULT_TIMEOUT_MS = int('PARALLEL_DEFAULT_TIMEOUT_MS', 60_000);
export const PARALLEL_DEFAULT_MAX_RETRIES = int('PARALLEL_DEFAULT_MAX_RETRIES', 2);
export const PARALLEL_RETRY_BACKOFF_BASE_MS = int('PARALLEL_RETRY_BACKOFF_BASE_MS', 1_000);

/* ================================================================== */
/*  MEDIUM — cache & budget limits                                     */
/* ================================================================== */

export const CACHE_GLOBAL_MAX_SIZE_BYTES = int('CACHE_GLOBAL_MAX_SIZE_BYTES', 500 * 1024 * 1024);
export const CACHE_LOW_HIT_RATE_THRESHOLD = parseFloat(process.env.CACHE_LOW_HIT_RATE_THRESHOLD || '0.3');
export const TOKEN_BUDGET_MAX_TOKENS = int('TOKEN_BUDGET_MAX_TOKENS', 200_000);
export const DETAILED_DATA_DEFAULT_TTL_MS = int('DETAILED_DATA_DEFAULT_TTL_MS', 30 * 60 * 1000);
export const DETAILED_DATA_MAX_TTL_MS = int('DETAILED_DATA_MAX_TTL_MS', 60 * 60 * 1000);
export const DETAILED_DATA_SMART_THRESHOLD_BYTES = int('DETAILED_DATA_SMART_THRESHOLD_BYTES', 50 * 1024);

/* ================================================================== */
/*  MEDIUM — LLM parameters                                            */
/* ================================================================== */

export const ADV_DEOBF_LLM_MAX_TOKENS = int('ADV_DEOBF_LLM_MAX_TOKENS', 3_000);
export const VM_DEOBF_LLM_MAX_TOKENS = int('VM_DEOBF_LLM_MAX_TOKENS', 4_000);
export const DEOBF_LLM_MAX_TOKENS = int('DEOBF_LLM_MAX_TOKENS', 2_000);
export const CRYPTO_DETECT_LLM_MAX_TOKENS = int('CRYPTO_DETECT_LLM_MAX_TOKENS', 2_000);

/* ================================================================== */
/*  MEDIUM — memory operations                                         */
/* ================================================================== */

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
export const ENABLE_INJECTION_TOOLS = bool('ENABLE_INJECTION_TOOLS', false);
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

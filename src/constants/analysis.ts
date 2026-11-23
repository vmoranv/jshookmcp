/**
 * Code analysis: GraphQL, WASM, sourcemap, miniapp, debugger, process.
 * Prefixes: GRAPHQL_*, WASM_*, ANALYSIS_*, MINIAPP_*, DEBUGGER_*, WATCH_*, PROCESS_*, WIN_*, SOURCEMAP_*
 */

import { float, int } from './helpers.js';

/* ================================================================== */
/*  GraphQL                                                            */
/* ================================================================== */

export const GRAPHQL_MAX_PREVIEW_CHARS = int('GRAPHQL_MAX_PREVIEW_CHARS', 4_000);
export const GRAPHQL_MAX_SCHEMA_CHARS = int('GRAPHQL_MAX_SCHEMA_CHARS', 120_000);
export const GRAPHQL_MAX_QUERY_CHARS = int('GRAPHQL_MAX_QUERY_CHARS', 12_000);
export const GRAPHQL_MAX_GRAPH_NODES = int('GRAPHQL_MAX_GRAPH_NODES', 2_000);
export const GRAPHQL_MAX_GRAPH_EDGES = int('GRAPHQL_MAX_GRAPH_EDGES', 5_000);

/** Abort timeout for a graphql_replay POST (Node-side fetch or in-page fetch). */
export const GRAPHQL_REPLAY_FETCH_TIMEOUT_MS = int('GRAPHQL_REPLAY_FETCH_TIMEOUT_MS', 10_000);

/* ================================================================== */
/*  WASM                                                               */
/* ================================================================== */

export const WASM_TOOL_TIMEOUT_MS = int('WASM_TOOL_TIMEOUT_MS', 60_000);
export const WASM_OFFLINE_RUN_TIMEOUT_MS = int('WASM_OFFLINE_RUN_TIMEOUT_MS', 10_000);
export const WASM_OPTIMIZE_TIMEOUT_MS = int('WASM_OPTIMIZE_TIMEOUT_MS', 120_000);

/** WASM obfuscation detection thresholds */
export const WASM_DEAD_CODE_MIN_MATCHES = int('WASM_DEAD_CODE_MIN_MATCHES', 10);
export const WASM_BITWISE_OPS_THRESHOLD = int('WASM_BITWISE_OPS_THRESHOLD', 20);
export const WASM_VM_DISPATCH_MIN_LOOPS = int('WASM_VM_DISPATCH_MIN_LOOPS', 3);

/* ================================================================== */
/*  Analysis                                                           */
/* ================================================================== */

export const ANALYSIS_MAX_SUMMARY_FILES = int('ANALYSIS_MAX_SUMMARY_FILES', 40);
export const ANALYSIS_MAX_SAFE_COLLECTED_BYTES = int(
  'ANALYSIS_MAX_SAFE_COLLECTED_BYTES',
  256 * 1024,
);
export const ANALYSIS_MAX_SAFE_RESPONSE_BYTES = int('ANALYSIS_MAX_SAFE_RESPONSE_BYTES', 220 * 1024);

/**
 * Hard cap (UTF-8 bytes) for `code` inputs to CPU-heavy analysis tools.
 * Oversized payloads are rejected before any engine is invoked (b4-02).
 */
export const MAX_ANALYSIS_CODE_BYTES = int('MAX_ANALYSIS_CODE_BYTES', 5 * 1024 * 1024, {
  min: 1,
});

/* ================================================================== */
/*  Symbolic execution server-side budget clamps (b4-03)              */
/* ================================================================== */

/** Server cap for user-supplied maxPaths on js_symbolic_execute. */
export const SYMBOLIC_CLAMP_MAX_PATHS = int('SYMBOLIC_CLAMP_MAX_PATHS', 200, { min: 1 });

/** Server cap for user-supplied maxDepth on js_symbolic_execute. */
export const SYMBOLIC_CLAMP_MAX_DEPTH = int('SYMBOLIC_CLAMP_MAX_DEPTH', 32, { min: 1 });

/** Server cap for user-supplied timeout (ms) on symbolic execution tools. */
export const SYMBOLIC_CLAMP_TIMEOUT_MS = int('SYMBOLIC_CLAMP_TIMEOUT_MS', 60_000, { min: 1 });

/** Server cap for user-supplied maxSteps on js_symbolic_execute_jsvmp. */
export const SYMBOLIC_CLAMP_MAX_STEPS = int('SYMBOLIC_CLAMP_MAX_STEPS', 5_000, { min: 1 });

/* ================================================================== */
/*  LLM-assisted analysis (ai_suggest_exploits)                        */
/* ================================================================== */

/** Max tokens for exploit-suggestion LLM sampling (exploit JSON output). */
export const ANALYSIS_EXPLOIT_LLM_MAX_TOKENS = int('ANALYSIS_EXPLOIT_LLM_MAX_TOKENS', 3_072);

/* ================================================================== */
/*  Quality scoring (modules/analyzer/QualityAnalyzer)                 */
/* ================================================================== */

/** Weighted-quality formula: share of the final 0-100 score per component. */
export const QUALITY_WEIGHT_SECURITY = float('QUALITY_WEIGHT_SECURITY', 0.4);
export const QUALITY_WEIGHT_COMPLEXITY = float('QUALITY_WEIGHT_COMPLEXITY', 0.25);
export const QUALITY_WEIGHT_MAINTAINABILITY = float('QUALITY_WEIGHT_MAINTAINABILITY', 0.2);
export const QUALITY_WEIGHT_CODE_SMELL = float('QUALITY_WEIGHT_CODE_SMELL', 0.15);

/** Per-severity deduction from the security sub-score (min 0). */
export const QUALITY_SECURITY_PENALTY_CRITICAL = int('QUALITY_SECURITY_PENALTY_CRITICAL', 20);
export const QUALITY_SECURITY_PENALTY_HIGH = int('QUALITY_SECURITY_PENALTY_HIGH', 10);
export const QUALITY_SECURITY_PENALTY_MEDIUM = int('QUALITY_SECURITY_PENALTY_MEDIUM', 5);
export const QUALITY_SECURITY_PENALTY_LOW = int('QUALITY_SECURITY_PENALTY_LOW', 2);

/** Per-severity deduction from the code-smell sub-score (min 0). */
export const QUALITY_SMELL_PENALTY_HIGH = int('QUALITY_SMELL_PENALTY_HIGH', 10);
export const QUALITY_SMELL_PENALTY_MEDIUM = int('QUALITY_SMELL_PENALTY_MEDIUM', 5);
export const QUALITY_SMELL_PENALTY_LOW = int('QUALITY_SMELL_PENALTY_LOW', 2);

/** Cyclomatic-complexity bands (strictly-above threshold) and their deductions. */
export const QUALITY_COMPLEXITY_BAND_HIGH = int('QUALITY_COMPLEXITY_BAND_HIGH', 20);
export const QUALITY_COMPLEXITY_PENALTY_HIGH = int('QUALITY_COMPLEXITY_PENALTY_HIGH', 30);
export const QUALITY_COMPLEXITY_BAND_MEDIUM = int('QUALITY_COMPLEXITY_BAND_MEDIUM', 10);
export const QUALITY_COMPLEXITY_PENALTY_MEDIUM = int('QUALITY_COMPLEXITY_PENALTY_MEDIUM', 15);
export const QUALITY_COMPLEXITY_BAND_LOW = int('QUALITY_COMPLEXITY_BAND_LOW', 5);
export const QUALITY_COMPLEXITY_PENALTY_LOW = int('QUALITY_COMPLEXITY_PENALTY_LOW', 5);

/** Cognitive-complexity bands and their deductions. */
export const QUALITY_COGNITIVE_BAND_HIGH = int('QUALITY_COGNITIVE_BAND_HIGH', 15);
export const QUALITY_COGNITIVE_PENALTY_HIGH = int('QUALITY_COGNITIVE_PENALTY_HIGH', 20);
export const QUALITY_COGNITIVE_BAND_LOW = int('QUALITY_COGNITIVE_BAND_LOW', 10);
export const QUALITY_COGNITIVE_PENALTY_LOW = int('QUALITY_COGNITIVE_PENALTY_LOW', 10);

/** Average-complexity fallback bands (used when metrics are not provided). */
export const QUALITY_AVG_COMPLEXITY_BAND_HIGH = int('QUALITY_AVG_COMPLEXITY_BAND_HIGH', 10);
export const QUALITY_AVG_COMPLEXITY_PENALTY_HIGH = int('QUALITY_AVG_COMPLEXITY_PENALTY_HIGH', 20);
export const QUALITY_AVG_COMPLEXITY_BAND_LOW = int('QUALITY_AVG_COMPLEXITY_BAND_LOW', 5);
export const QUALITY_AVG_COMPLEXITY_PENALTY_LOW = int('QUALITY_AVG_COMPLEXITY_PENALTY_LOW', 10);

/** Defaults when a component has no measurement. */
export const QUALITY_DEFAULT_MAINTAINABILITY = int('QUALITY_DEFAULT_MAINTAINABILITY', 70);
export const QUALITY_DEFAULT_AI_SCORE = int('QUALITY_DEFAULT_AI_SCORE', 70);

/* ================================================================== */
/*  Pattern detection (modules/analyzer/PatternDetector*)              */
/* ================================================================== */

/** Encryption-pattern confidence reported per evidence location. */
export const PATTERN_CONFIDENCE_ENCRYPTION_URL = float('PATTERN_CONFIDENCE_ENCRYPTION_URL', 0.7);
export const PATTERN_CONFIDENCE_ENCRYPTION_POST = float('PATTERN_CONFIDENCE_ENCRYPTION_POST', 0.8);
export const PATTERN_CONFIDENCE_ENCRYPTION_LOG = float('PATTERN_CONFIDENCE_ENCRYPTION_LOG', 0.9);

/** Critical-request priority scoring weights (ranking, higher first). */
export const PATTERN_PRIORITY_METHOD_WEIGHT = int('PATTERN_PRIORITY_METHOD_WEIGHT', 10);
export const PATTERN_PRIORITY_KEYWORD_WEIGHT = int('PATTERN_PRIORITY_KEYWORD_WEIGHT', 5);
export const PATTERN_PRIORITY_POSTDATA_WEIGHT = int('PATTERN_PRIORITY_POSTDATA_WEIGHT', 5);
export const PATTERN_PRIORITY_URL_LENGTH_DIVISOR = int('PATTERN_PRIORITY_URL_LENGTH_DIVISOR', 100, {
  min: 1,
});

/** Critical-log priority scoring weights (ranking, higher first). */
export const PATTERN_LOG_PRIORITY_ERROR = int('PATTERN_LOG_PRIORITY_ERROR', 20);
export const PATTERN_LOG_PRIORITY_WARN = int('PATTERN_LOG_PRIORITY_WARN', 10);

/** Signature-detection confidence reported per location/format. */
export const PATTERN_SIGNATURE_CONFIDENCE_URL_PARAM = float(
  'PATTERN_SIGNATURE_CONFIDENCE_URL_PARAM',
  0.82,
);
export const PATTERN_SIGNATURE_CONFIDENCE_HEADER_HMAC = float(
  'PATTERN_SIGNATURE_CONFIDENCE_HEADER_HMAC',
  0.88,
);
export const PATTERN_SIGNATURE_CONFIDENCE_HEADER_JWT = float(
  'PATTERN_SIGNATURE_CONFIDENCE_HEADER_JWT',
  0.92,
);
export const PATTERN_SIGNATURE_CONFIDENCE_HEADER_CUSTOM = float(
  'PATTERN_SIGNATURE_CONFIDENCE_HEADER_CUSTOM',
  0.75,
);
export const PATTERN_SIGNATURE_CONFIDENCE_BODY_HMAC = float(
  'PATTERN_SIGNATURE_CONFIDENCE_BODY_HMAC',
  0.85,
);
export const PATTERN_SIGNATURE_CONFIDENCE_BODY_JWT = float(
  'PATTERN_SIGNATURE_CONFIDENCE_BODY_JWT',
  0.9,
);
export const PATTERN_SIGNATURE_CONFIDENCE_BODY_CUSTOM = float(
  'PATTERN_SIGNATURE_CONFIDENCE_BODY_CUSTOM',
  0.7,
);
export const PATTERN_SIGNATURE_CONFIDENCE_BODY_FORM = float(
  'PATTERN_SIGNATURE_CONFIDENCE_BODY_FORM',
  0.65,
);

/** Token-detection confidence reported per location/format. */
export const PATTERN_TOKEN_CONFIDENCE_HEADER_JWT = float(
  'PATTERN_TOKEN_CONFIDENCE_HEADER_JWT',
  0.95,
);
export const PATTERN_TOKEN_CONFIDENCE_HEADER_BEARER = float(
  'PATTERN_TOKEN_CONFIDENCE_HEADER_BEARER',
  0.9,
);
export const PATTERN_TOKEN_CONFIDENCE_HEADER_CUSTOM = float(
  'PATTERN_TOKEN_CONFIDENCE_HEADER_CUSTOM',
  0.75,
);
export const PATTERN_TOKEN_CONFIDENCE_PARAM_JWT = float('PATTERN_TOKEN_CONFIDENCE_PARAM_JWT', 0.92);
export const PATTERN_TOKEN_CONFIDENCE_PARAM_OAUTH = float(
  'PATTERN_TOKEN_CONFIDENCE_PARAM_OAUTH',
  0.88,
);
export const PATTERN_TOKEN_CONFIDENCE_PARAM_CUSTOM = float(
  'PATTERN_TOKEN_CONFIDENCE_PARAM_CUSTOM',
  0.7,
);
export const PATTERN_TOKEN_CONFIDENCE_BODY_JWT = float('PATTERN_TOKEN_CONFIDENCE_BODY_JWT', 0.93);
export const PATTERN_TOKEN_CONFIDENCE_BODY_CUSTOM = float(
  'PATTERN_TOKEN_CONFIDENCE_BODY_CUSTOM',
  0.72,
);
export const PATTERN_TOKEN_CONFIDENCE_BODY_FORM = float('PATTERN_TOKEN_CONFIDENCE_BODY_FORM', 0.68);

/** Minimum candidate length before a value is treated as a token. */
export const PATTERN_TOKEN_MIN_LENGTH = int('PATTERN_TOKEN_MIN_LENGTH', 20);

/* ================================================================== */
/*  Miniapp unpacking                                                  */
/* ================================================================== */

export const MINIAPP_UNPACK_TIMEOUT_MS = int('MINIAPP_UNPACK_TIMEOUT_MS', 180_000);

/* ================================================================== */
/*  Debugger                                                           */
/* ================================================================== */

export const DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS = int(
  'DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS',
  30_000,
);
export const WATCH_EVAL_TIMEOUT_MS = int('WATCH_EVAL_TIMEOUT_MS', 5_000);
export const WATCH_MAX_HISTORY = int('WATCH_MAX_HISTORY', 100);
export const SCRIPT_SEARCH_RESULT_LIMIT = int('SCRIPT_SEARCH_RESULT_LIMIT', 500);
export const SCRIPT_CONTEXT_TRUNCATE_LINES_LARGE = int('SCRIPT_CONTEXT_TRUNCATE_LINES_LARGE', 2000);
export const SCRIPT_CONTEXT_SNIPPET_HALF_LINES_LARGE = int(
  'SCRIPT_CONTEXT_SNIPPET_HALF_LINES_LARGE',
  100,
);
export const SCRIPT_CONTEXT_TRUNCATE_LINES_SMALL = int('SCRIPT_CONTEXT_TRUNCATE_LINES_SMALL', 1000);
export const SCRIPT_CONTEXT_SNIPPET_HALF_LINES_SMALL = int(
  'SCRIPT_CONTEXT_SNIPPET_HALF_LINES_SMALL',
  50,
);
export const SCRIPT_CONTEXT_HALF_LINES_SMALL = int('SCRIPT_CONTEXT_HALF_LINES_SMALL', 3);

/* ================================================================== */
/*  Dataflow & Taint Analysis                                          */
/* ================================================================== */

export const DATAFLOW_MAX_FIXPOINT_ITERATIONS = int('DATAFLOW_MAX_FIXPOINT_ITERATIONS', 100);

/* ================================================================== */
/*  Process operations                                                 */
/* ================================================================== */

/** Launch wait after spawning a debug process (Linux/Mac). */
export const PROCESS_LAUNCH_WAIT_MS = int('PROCESS_LAUNCH_WAIT_MS', 2_000);

/** Poll attempts when waiting for a debug port (Windows). */
export const WIN_DEBUG_PORT_POLL_ATTEMPTS = int('WIN_DEBUG_PORT_POLL_ATTEMPTS', 20);
export const WIN_DEBUG_PORT_POLL_INTERVAL_MS = int('WIN_DEBUG_PORT_POLL_INTERVAL_MS', 500);

/* ================================================================== */
/*  Sourcemap                                                          */
/* ================================================================== */

/** Timeout for the sourcemap-extension fetch helper. */
export const SOURCEMAP_EXT_TIMEOUT_MS = int('SOURCEMAP_EXT_TIMEOUT_MS', 15_000);

/** Sourcemap v4 parsing */
export const SOURCEMAP_V4_RAW_FIELD_MAX_LEN = int('SOURCEMAP_V4_RAW_FIELD_MAX_LEN', 200);
export const SOURCEMAP_V4_RETRY_DELAY_MS = int('SOURCEMAP_V4_RETRY_DELAY_MS', 250);

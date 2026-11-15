/**
 * Browser automation: page operations, browser pool, DOM inspection, collector, frame handling.
 * Prefixes: BROWSER_*, PAGE_*, DOM_*, SCRIPTS_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  Browser pool                                                       */
/* ================================================================== */

/** Browser pool idle timeout before auto-disconnect. Default: 5 minutes. */
export const BROWSER_POOL_IDLE_TIMEOUT_MS = int('BROWSER_POOL_IDLE_TIMEOUT_MS', 300_000);

/**
 * Per-CDP-call protocol timeout handed to Puppeteer at launch and when
 * attaching to an existing browser.
 *
 * Puppeteer/Playwright reject a stuck CDP command after this window; without
 * it a hung debugger session blocks the caller indefinitely. Configurable
 * because the right value depends on the environment: a local headless
 * browser needs ~60s only for pathological pages, while remote/debug-attached
 * targets behind a slow link need more (and a laptop that sleeps mid-call
 * needs the caller-side timeouts, not this one, to intervene).
 */
export const BROWSER_PROTOCOL_TIMEOUT_MS = int('BROWSER_PROTOCOL_TIMEOUT_MS', 60_000);

/** Idle timeout for the production CodeCollector browser lifecycle. 0 disables reclamation. */
export const BROWSER_IDLE_TIMEOUT_MS = int('BROWSER_IDLE_TIMEOUT_MS', 300_000);

/** Max tabs per pooled browser instance. */
export const BROWSER_POOL_MAX_TABS = int('BROWSER_POOL_MAX_TABS', 10);

/* ================================================================== */
/*  Page operations                                                    */
/* ================================================================== */

/** Timeout for waiting on an iframe selector during frame resolution. */
export const PAGE_FRAME_SELECTOR_TIMEOUT_MS = int('PAGE_FRAME_SELECTOR_TIMEOUT_MS', 10_000);

/** Timeout for waitForNetworkIdle in PageController. */
export const PAGE_NETWORK_IDLE_TIMEOUT_MS = int('PAGE_NETWORK_IDLE_TIMEOUT_MS', 30_000);

/**
 * Default timeout for page navigation/reload/selector-wait operations in
 * PageController when no per-call timeout is supplied. Also the dialog-wait
 * timeout in handleDialog.
 */
export const PAGE_OPERATION_TIMEOUT_MS = int('PAGE_OPERATION_TIMEOUT_MS', 30_000);

/**
 * Hard backstop timeout for page.evaluate()/evaluateOnNewDocument()/coverage
 * calls wrapped in PageController's timeout helpers.
 */
export const PAGE_EVALUATE_TIMEOUT_MS = int('PAGE_EVALUATE_TIMEOUT_MS', 30_000);

/**
 * Result-size threshold (bytes) beyond which evaluate results are summarized
 * by the DetailedDataManager (50 KiB default — large enough for most
 * structured payloads, small enough to keep responses bounded).
 */
export const PAGE_EVAL_MAX_SIZE_BYTES = int('PAGE_EVAL_MAX_SIZE_BYTES', 51200);

/* ================================================================== */
/*  CDP session                                                        */
/* ================================================================== */

/**
 * Watchdog for CDP session operations (createCDPSession / liveness ping) so a
 * hanging session cannot block monitor setup. After debugger pause/resume a
 * session can sit in a zombie state where send() hangs indefinitely without
 * firing 'disconnected' (used by PerformanceMonitor + ConsoleMonitor).
 */
export const CDP_SESSION_TIMEOUT_MS = int('CDP_SESSION_TIMEOUT_MS', 500);

/* ================================================================== */
/*  DOM inspection                                                     */
/* ================================================================== */

/** Default limit for querySelectorAll results in DOMInspector. */
export const DOM_QUERY_DEFAULT_LIMIT = int('DOM_QUERY_DEFAULT_LIMIT', 50);

/** Timeout for waitForElement (waitForSelector) in DOMInspector. */
export const DOM_WAIT_ELEMENT_TIMEOUT_MS = int('DOM_WAIT_ELEMENT_TIMEOUT_MS', 30_000);

/** Cap on caller-supplied selectors / filter text fed into string-built evaluations. */
export const DOM_QUERY_INPUT_MAX_CHARS = int('DOM_QUERY_INPUT_MAX_CHARS', 4096);

/** Default wait interval for the page to reach readyState 'complete' (ms). */
export const DOM_READY_STATE_POLL_INTERVAL_MS = int('DOM_READY_STATE_POLL_INTERVAL_MS', 100);

/** Retry delay before re-running an empty query after readyState 'complete' (ms). */
export const DOM_EMPTY_RESULT_RETRY_DELAY_MS = int('DOM_EMPTY_RESULT_RETRY_DELAY_MS', 500);

/** Default readyState wait budget when the caller does not supply one (ms). */
export const DOM_DEFAULT_READY_STATE_TIMEOUT_MS = int('DOM_DEFAULT_READY_STATE_TIMEOUT_MS', 3000);

/* ================================================================== */
/*  Collector & Code Compression                                       */
/* ================================================================== */

/** Fallback navigation/collection timeout when neither options nor config supply one. */
export const COLLECTOR_DEFAULT_TIMEOUT_MS = int('COLLECTOR_DEFAULT_TIMEOUT_MS', 30_000);

/** How long to wait after navigation for late-loading dynamic scripts. */
export const COLLECTOR_DYNAMIC_SCRIPT_WAIT_MS = int('COLLECTOR_DYNAMIC_SCRIPT_WAIT_MS', 3_000);

/** Compression batch retries per file in collector. */
export const COLLECTOR_COMPRESS_MAX_RETRIES = int('COLLECTOR_COMPRESS_MAX_RETRIES', 3);

/** Compression concurrency across files in collector. */
export const COLLECTOR_COMPRESS_CONCURRENCY = int('COLLECTOR_COMPRESS_CONCURRENCY', 5);

/** Log compression progress every N percent in collector. */
export const COLLECTOR_COMPRESS_PROGRESS_LOG_INTERVAL = int(
  'COLLECTOR_COMPRESS_PROGRESS_LOG_INTERVAL',
  25,
);

/** Base (ms) for the linear retry backoff in CodeCompressor: `base * attempt`. */
export const CODE_COMPRESSOR_RETRY_BACKOFF_MS = int('CODE_COMPRESSOR_RETRY_BACKOFF_MS', 100);

/** Default `shouldCompress` threshold (bytes) — content below this is kept raw. */
export const CODE_COMPRESSOR_MIN_THRESHOLD_BYTES = int('CODE_COMPRESSOR_MIN_THRESHOLD_BYTES', 1024);

/** Max nesting depth for chunked payloads in CodeCompressor. */
export const CODE_COMPRESSOR_MAX_RECURSION_DEPTH = int('CODE_COMPRESSOR_MAX_RECURSION_DEPTH', 16);

/** Fail-fast window for the pre-evaluate CDP health probe in PageController. */
export const PAGE_CDP_HEALTH_CHECK_TIMEOUT_MS = int('PAGE_CDP_HEALTH_CHECK_TIMEOUT_MS', 500);

/** Cap on extracted function names per file in SmartCodeCollector. */
export const SMART_COLLECTOR_MAX_EXTRACTED_FUNCTIONS = int(
  'SMART_COLLECTOR_MAX_EXTRACTED_FUNCTIONS',
  20,
);

/* ================================================================== */
/*  Browser scripts                                                    */
/* ================================================================== */

/** Max scripts tracked by the script collector. */
export const SCRIPTS_MAX_CAP = int('SCRIPTS_MAX_CAP', 500);

/* ================================================================== */
/*  Worker / Service Worker inspection                                 */
/* ================================================================== */

/** Max scripts returned per browser_worker_scripts dump. */
export const WORKER_SCRIPT_MAX = int('WORKER_SCRIPT_MAX', 200);

/** Max source bytes fetched per worker script (guards LLM context). Default 256 KiB. */
export const WORKER_SCRIPT_SOURCE_MAX_BYTES = int('WORKER_SCRIPT_SOURCE_MAX_BYTES', 262_144);

/** How long to wait for Debugger.scriptParsed replay after Debugger.enable. */
export const WORKER_SCRIPT_COLLECT_WAIT_MS = int('WORKER_SCRIPT_COLLECT_WAIT_MS', 750);

/** CDP target types that represent Web/Service/Shared workers. */
export const WORKER_TARGET_TYPES = ['service_worker', 'shared_worker', 'worker'] as const;

/* ================================================================== */
/*  Font fingerprinting                                                 */
/* ================================================================== */

/**
 * Minimal fallback probe set used only when the Local Font Access API
 * (`queryLocalFonts`) is unavailable (e.g. non-Chromium browsers, permission
 * denied). These ~8 fonts are present/absent in OS-discriminating patterns, so
 * the fingerprint retains entropy even without full enumeration. The primary
 * enumeration path is `queryLocalFonts`, which needs no hard-coded list at all.
 */
export const FONT_FALLBACK_PROBE_LIST: readonly string[] = [
  'Arial',
  'Courier New',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
];

/** Max local fonts to enumerate via queryLocalFonts before switching to hashes-only. */
export const FONT_LOCAL_ENUMERATE_MAX = int('FONT_LOCAL_ENUMERATE_MAX', 2000);

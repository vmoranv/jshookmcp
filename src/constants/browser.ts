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

/** Max tabs per pooled browser instance. */
export const BROWSER_POOL_MAX_TABS = int('BROWSER_POOL_MAX_TABS', 10);

/* ================================================================== */
/*  Page operations                                                    */
/* ================================================================== */

/** Timeout for waiting on an iframe selector during frame resolution. */
export const PAGE_FRAME_SELECTOR_TIMEOUT_MS = int('PAGE_FRAME_SELECTOR_TIMEOUT_MS', 10_000);

/** Timeout for waitForNetworkIdle in PageController. */
export const PAGE_NETWORK_IDLE_TIMEOUT_MS = int('PAGE_NETWORK_IDLE_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  DOM inspection                                                     */
/* ================================================================== */

/** Default limit for querySelectorAll results in DOMInspector. */
export const DOM_QUERY_DEFAULT_LIMIT = int('DOM_QUERY_DEFAULT_LIMIT', 50);

/** Timeout for waitForElement (waitForSelector) in DOMInspector. */
export const DOM_WAIT_ELEMENT_TIMEOUT_MS = int('DOM_WAIT_ELEMENT_TIMEOUT_MS', 30_000);

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

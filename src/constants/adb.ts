/**
 * ADB bridge: device management, shell commands, WebView debugging, APK operations, logcat.
 * Prefixes: ADB_*, APK_*
 */

import { int, csv } from './helpers.js';

/* ================================================================== */
/*  ADB bridge timeouts                                                */
/* ================================================================== */

/** Default timeout for a generic `adb` CLI call. */
export const ADB_DEFAULT_TIMEOUT_MS = int('ADB_DEFAULT_TIMEOUT_MS', 30_000);

/** Timeout for `adb shell` commands (may run longer than generic adb calls). */
export const ADB_SHELL_TIMEOUT_MS = int('ADB_SHELL_TIMEOUT_MS', 60_000);

/** Max stdout/stderr captured from a generic adb command. */
export const ADB_MAX_BUFFER_BYTES = int('ADB_MAX_BUFFER_BYTES', 16 * 1024 * 1024);

/** Max stdout/stderr captured from dumpsys/logcat style adb commands. */
export const ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES = int(
  'ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES',
  32 * 1024 * 1024,
);

/** Timeout for adb pull/push of APKs or native libraries. */
export const ADB_FILE_TRANSFER_TIMEOUT_MS = int('ADB_FILE_TRANSFER_TIMEOUT_MS', 180_000);

/** Maximum component names emitted per package summary section. */
export const ADB_PACKAGE_COMPONENT_LIMIT = int('ADB_PACKAGE_COMPONENT_LIMIT', 500);

/** Maximum parsed properties returned by adb_getprop (full getprop dump ~500-1500). */
export const ADB_GETPROP_MAX_PROPERTIES = int('ADB_GETPROP_MAX_PROPERTIES', 5_000);

/** ZIP/APK header magic values accepted by adb_apk_pull validation, encoded as hex. */
export const APK_ZIP_MAGIC_HEX_HEADERS = csv('APK_ZIP_MAGIC_HEX_HEADERS', [
  '504b0304',
  '504b0506',
  '504b0708',
]);

/* ================================================================== */
/*  ADB logcat                                                         */
/* ================================================================== */

/** Default and maximum logcat records read by adb_logcat_query. */
export const ADB_LOGCAT_TAIL_DEFAULT = int('ADB_LOGCAT_TAIL_DEFAULT', 500);
export const ADB_LOGCAT_TAIL_MAX = int('ADB_LOGCAT_TAIL_MAX', 20_000);

/** Default and maximum matching logcat lines returned to the caller. */
export const ADB_LOGCAT_MAX_LINES_DEFAULT = int('ADB_LOGCAT_MAX_LINES_DEFAULT', 100);
export const ADB_LOGCAT_MAX_LINES_MAX = int('ADB_LOGCAT_MAX_LINES_MAX', 5_000);

/* ================================================================== */
/*  ADB cold start tracing                                             */
/* ================================================================== */

/** Default and maximum wait after am start -W before reading startup logs. */
export const ADB_COLD_START_WAIT_MS_DEFAULT = int('ADB_COLD_START_WAIT_MS_DEFAULT', 5_000);
export const ADB_COLD_START_WAIT_MS_MAX = int('ADB_COLD_START_WAIT_MS_MAX', 30_000);

/** Default and maximum logcat records inspected by adb_app_cold_start_trace. */
export const ADB_COLD_START_LOGCAT_TAIL_DEFAULT = int('ADB_COLD_START_LOGCAT_TAIL_DEFAULT', 800);
export const ADB_COLD_START_LOGCAT_TAIL_MIN = int('ADB_COLD_START_LOGCAT_TAIL_MIN', 100);
export const ADB_COLD_START_LOGCAT_TAIL_MAX = int('ADB_COLD_START_LOGCAT_TAIL_MAX', 20_000);

/** Maximum startup timeline entries returned by adb_app_cold_start_trace. */
export const ADB_COLD_START_TIMELINE_LIMIT = int('ADB_COLD_START_TIMELINE_LIMIT', 300);

/* ================================================================== */
/*  ADB WebView debugging                                              */
/* ================================================================== */

/** Timeout for an HTTP GET against an on-device WebView debugger endpoint. */
export const ADB_WEBVIEW_HTTP_TIMEOUT_MS = int('ADB_WEBVIEW_HTTP_TIMEOUT_MS', 5_000);

/** Timeout for establishing a WebSocket to an on-device WebView. */
export const ADB_WEBVIEW_WS_TIMEOUT_MS = int('ADB_WEBVIEW_WS_TIMEOUT_MS', 10_000);

/** Default host port for ADB WebView CDP forwarding. */
export const ADB_WEBVIEW_HOST_PORT_DEFAULT = int('ADB_WEBVIEW_HOST_PORT_DEFAULT', 9222);

/* ================================================================== */
/*  ADB connector                                                      */
/* ================================================================== */

/** Timeout for `adb version` availability check. */
export const ADB_VERSION_CHECK_TIMEOUT_MS = int('ADB_VERSION_CHECK_TIMEOUT_MS', 5_000);

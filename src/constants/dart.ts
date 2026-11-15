/**
 * Dart Inspector (libapp.so string extraction, snapshot header parsing, object pool dumping).
 * Prefixes: DART_*
 */

import { int, str } from './helpers.js';

/* ================================================================== */
/*  Dart Inspector (libapp.so string extraction)                       */
/* ================================================================== */

/**
 * Minimum length for a string to be considered. Below the floor the extractor
 * emits nothing useful (entropy noise), above the ceiling almost no real Dart
 * symbol exists. Both are user-tunable.
 */
export const DART_MIN_LENGTH = int('DART_MIN_LENGTH', 4);
export const DART_MIN_LENGTH_FLOOR = int('DART_MIN_LENGTH_FLOOR', 2);
export const DART_MIN_LENGTH_CEILING = int('DART_MIN_LENGTH_CEILING', 64);

/**
 * Streaming chunk parameters. Overlap MUST cover the largest expected single
 * string so that strings straddling a chunk boundary are still detected.
 */
export const DART_MAX_CHUNK_BYTES = int('DART_MAX_CHUNK_BYTES', 16 * 1024 * 1024);
export const DART_CHUNK_OVERLAP_BYTES = int('DART_CHUNK_OVERLAP_BYTES', 128);

/** Printable ASCII range used when scanning ASCII strings. */
export const DART_PRINTABLE_ASCII_MIN = int('DART_PRINTABLE_ASCII_MIN', 0x20);
export const DART_PRINTABLE_ASCII_MAX = int('DART_PRINTABLE_ASCII_MAX', 0x7e);

/** Default encoding for dart_strings_extract: 'ascii' | 'utf16le' | 'both'. */
export const DART_DEFAULT_ENCODING = str('DART_DEFAULT_ENCODING', 'both');

/** Max offsets recorded per unique string. Excess offsets are truncated and marked. */
export const DART_MAX_OFFSETS_PER_STRING = int('DART_MAX_OFFSETS_PER_STRING', 1000);

/**
 * customRules safety knobs. MAX_REGEX_PATTERN_LENGTH caps the pattern source,
 * REGEX_TIMEOUT_MS bounds a single match attempt at runtime, ALLOWED_REGEX_FLAGS
 * restricts which flags users may supply (g is added internally; m/y/s rejected).
 */
export const DART_MAX_REGEX_PATTERN_LENGTH = int('DART_MAX_REGEX_PATTERN_LENGTH', 256);
export const DART_REGEX_TIMEOUT_MS = int('DART_REGEX_TIMEOUT_MS', 50);
export const DART_ALLOWED_REGEX_FLAGS = str('DART_ALLOWED_REGEX_FLAGS', 'iu');

/** Overall budget for a single dart_strings_extract call (ms / payload bytes). */
export const DART_MAX_EXTRACT_DURATION_MS = int('DART_MAX_EXTRACT_DURATION_MS', 30_000);
export const DART_MAX_RESULT_BYTES = int('DART_MAX_RESULT_BYTES', 16 * 1024 * 1024);

/**
 * dart_smi_scan default upper bound on decoded Smi values. Tunes the
 * signal-to-noise ratio of the scanner (large random words divide out to
 * huge "integers" that are almost never meaningful literals).
 */
export const DART_MAX_SMI_VALUE = int('DART_MAX_SMI_VALUE', 1_000_000);

/** Obfuscation map search recursion depth limit. */
export const DART_OBFUSCATION_MAP_MAX_DIR_DEPTH = int('DART_OBFUSCATION_MAP_MAX_DIR_DEPTH', 5);
/** Obfuscation map search maximum candidates limit. */
export const DART_OBFUSCATION_MAP_MAX_CANDIDATES = int('DART_OBFUSCATION_MAP_MAX_CANDIDATES', 20);

/**
 * dart_symbolize ceiling on the obfuscation-map JSON the loader will
 * accept. Real Flutter obfuscation maps are typically a few hundred KB;
 * 16 MiB keeps memory bounded against pathological inputs.
 */
export const DART_MAX_MAP_BYTES = int('DART_MAX_MAP_BYTES', 16 * 1024 * 1024);

/**
 * flutter_packages_detect aggregation caps. Real-world Flutter apps reference
 * 50–300 packages and each package usually surfaces a few dozen files; the
 * defaults keep the response bounded against pathological binaries that
 * splice tens of thousands of synthetic `package:` strings.
 */
export const DART_MAX_PACKAGES_PER_RESULT = int('DART_MAX_PACKAGES_PER_RESULT', 1000);
export const DART_MAX_FILES_PER_PACKAGE = int('DART_MAX_FILES_PER_PACKAGE', 50);

/**
 * Wall-clock budget for a single flutter_packages_detect aggregation (ms).
 * Bounds the aggregation loop over extracted `package:` refs so a pathologically
 * large ref list cannot monopolize the detector. Env-tunable via
 * DART_PACKAGES_MAX_DETECT_DURATION_MS.
 */
export const DART_PACKAGES_MAX_DETECT_DURATION_MS = int(
  'DART_PACKAGES_MAX_DETECT_DURATION_MS',
  30_000,
);

/**
 * dart_snapshot_header_parse / dart_version_fingerprint safety knobs.
 * MAX_FILE_BYTES caps total input size (default 1 GiB) so the parser refuses
 * pathological inputs early with a PERMISSION error. HEADER_SCAN_MAX_BYTES is
 * the upper bound on the byte-scan fallback used when the named ELF symbol is
 * stripped (default 32 MiB — Dart isolate snapshot data normally sits within
 * the first dozen MiB of libapp.so).
 */
export const DART_SNAPSHOT_MAX_FILE_BYTES = int('DART_SNAPSHOT_MAX_FILE_BYTES', 1024 * 1024 * 1024);
export const DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES = int(
  'DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES',
  32 * 1024 * 1024,
);

/**
 * Optional path to a JSON file extending the built-in snapshot version table
 * (snapshotHash → flutterVersion/engineCommit/dartSdkRev). User entries take
 * precedence on hash collisions. Default empty = built-in table only.
 */
export const DART_SNAPSHOT_TABLE_PATH = str('DART_SNAPSHOT_TABLE_PATH', '');

/**
 * dart_object_pool_dump safety knobs. The dumper iterates the Dart isolate
 * snapshot's ObjectPool slot-by-slot; these constants bound the work per
 * call. MAX_SLOTS caps how many slots may be emitted (default 4096).
 * PREVIEW_BYTES truncates string slot previews (default 64 bytes).
 * MAX_DUMP_DURATION_MS is a wall-clock budget enforced inside the dumper
 * (default 10 s) so a malformed grammar can not loop forever.
 */
export const DART_PP_MAX_SLOTS = int('DART_PP_MAX_SLOTS', 4096);
export const DART_PP_PREVIEW_BYTES = int('DART_PP_PREVIEW_BYTES', 64);
export const DART_PP_MAX_DUMP_DURATION_MS = int('DART_PP_MAX_DUMP_DURATION_MS', 10_000);

/**
 * dart_call_function / dart_trace_execution emulator step budgets. These cap
 * how many ARM64 instructions the Dart AOT executor may run before returning,
 * so a pathological loop cannot hang the call. Shared by the tool schemas
 * (default/maximum) and the handler fallbacks.
 */
export const DART_EXEC_MAX_STEPS = int('DART_EXEC_MAX_STEPS', 100_000);
export const DART_TRACE_MAX_STEPS = int('DART_TRACE_MAX_STEPS', 1_000);

/* ================================================================== */
/*  Dart snapshot session cache                                         */
/* ================================================================== */

/**
 * Dart snapshot session cache (mirrors the NEMU_SESSION_* knobs of the
 * native-emulator SessionManager). A multi-step reversing session otherwise
 * re-parses the same `libapp.so` (10–40 MB, hundreds of clusters) on every
 * dynamic tool call; the cache keys the already-parsed `LoadedSnapshot` by a
 * `sessionId` so `dart_list_functions` / `dart_call_graph` / `dart_inspect_object_pool`
 * / `dart_call_function` / `dart_trace_execution` can reuse it.
 *
 * Snapshots are pure data (no mapped memory / JNI tables), so the cache only
 * stores the parsed structure — no dispose() per entry is needed (unlike
 * NativeEmulator sessions).
 */
export const DART_SESSION_IDLE_TTL_MS = int('DART_SESSION_IDLE_TTL_MS', 300_000);
export const DART_SESSION_SWEEP_MS = int('DART_SESSION_SWEEP_MS', 60_000);
export const DART_MAX_SESSIONS = int('DART_MAX_SESSIONS', 32);

/**
 * dart_call_graph cap on emitted edges. Pool-slot scanning can produce one
 * candidate edge per slot; the cap keeps the response bounded against
 * pathological snapshots with tens of thousands of slots (excess sets
 * `truncated=true`).
 */
export const DART_CALL_GRAPH_MAX_EDGES = int('DART_CALL_GRAPH_MAX_EDGES', 5000);

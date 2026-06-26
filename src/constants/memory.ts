/**
 * Native memory operations: scanning, pointer chains, structure analysis, heap, hardware breakpoints.
 * Prefixes: MEMORY_*, SCAN_*, POINTER_*, STRUCT_*, HEAP_*, BREAKPOINT_*, CODE_CAVE_*, FREEZE_*, WRITE_*, USERSPACE_*, NATIVE_*
 */

import { bool, int } from './helpers.js';

/* ================================================================== */
/*  Windows API call path                                               */
/* ================================================================== */

/** Enable direct ntdll system-call path for OpenProcess.
 *  Setting to '1' routes process-handle opens through ntdll exports
 *  (bypassing the normal userspace API layer).  Default: off. */
export const MEMORY_SYSCALL_EVASION = bool('JSHOOK_MEMORY_SYSCALL_EVASION', false);

/* ================================================================== */
/*  Memory operations                                                  */
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
export const MEMORY_ENUM_REGIONS_RETURN_LIMIT = int('MEMORY_ENUM_REGIONS_RETURN_LIMIT', 10_000);
export const MEMORY_ENUM_REGIONS_MAX_BUFFER_BYTES = int(
  'MEMORY_ENUM_REGIONS_MAX_BUFFER_BYTES',
  10 * 1024 * 1024,
);
export const MEMORY_VMMAP_MAX_BUFFER_BYTES = int('MEMORY_VMMAP_MAX_BUFFER_BYTES', 5 * 1024 * 1024);
export const MEMORY_INJECT_TIMEOUT_MS = int('MEMORY_INJECT_TIMEOUT_MS', 30_000);
export const MEMORY_MONITOR_INTERVAL_MS = int('MEMORY_MONITOR_INTERVAL_MS', 1_000);

export const MEMORY_VMMAP_TIMEOUT_MS = int('MEMORY_VMMAP_TIMEOUT_MS', 15_000);
export const MEMORY_PROTECTION_QUERY_TIMEOUT_MS = int('MEMORY_PROTECTION_QUERY_TIMEOUT_MS', 15_000);
export const MEMORY_PROTECTION_PWSH_TIMEOUT_MS = int('MEMORY_PROTECTION_PWSH_TIMEOUT_MS', 30_000);

export const NATIVE_ADMIN_CHECK_TIMEOUT_MS = int('NATIVE_ADMIN_CHECK_TIMEOUT_MS', 5_000);
export const NATIVE_SCAN_MAX_RESULTS = int('NATIVE_SCAN_MAX_RESULTS', 10_000);

/* ================================================================== */
/*  Memory availability probe                                          */
/* ================================================================== */

/** TTL of the "native memory scan available" cache (platform probe). */
export const MEMORY_AVAILABILITY_CACHE_TTL_MS = int('MEMORY_AVAILABILITY_CACHE_TTL_MS', 45_000);

/* ================================================================== */
/*  Memory audit / region / process signal                             */
/* ================================================================== */

/** Capacity of the ring-buffer audit trail for memory operations. */
export const MEMORY_AUDIT_TRAIL_CAPACITY = int('MEMORY_AUDIT_TRAIL_CAPACITY', 5_000);

/** Timeout for process stop/continue signals during memory scan. */
export const MEMORY_PROCESS_SIGNAL_TIMEOUT_MS = int('MEMORY_PROCESS_SIGNAL_TIMEOUT_MS', 2_000);

/** Timeout for shell probes during memory availability detection. */
export const MEMORY_PROBE_CMD_TIMEOUT_MS = int('MEMORY_PROBE_CMD_TIMEOUT_MS', 5_000);

/** Timeout for vmmap and similar region enumeration subprocesses. */
export const MEMORY_VMMAP_ENUM_TIMEOUT_MS = int('MEMORY_VMMAP_ENUM_TIMEOUT_MS', 15_000);

/** Timeout for PowerShell-based module listing subprocesses. */
export const MEMORY_MODULES_TIMEOUT_MS = int('MEMORY_MODULES_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  Userspace address ceiling                                          */
/* ================================================================== */

/**
 * Upper bound of the Windows x64 user-mode virtual address space (0x7FFF_FFFF_0000).
 * Region-walking scans stop here so they never probe kernel space. It is an
 * architectural ceiling, not a tunable, so it is a fixed bigint.
 */
export const USERSPACE_MAX_ADDRESS = 0x7fff_ffff_0000n;

/* ================================================================== */
/*  Scanning session limits                                            */
/* ================================================================== */

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

/* ================================================================== */
/*  Pointer chain scanning                                             */
/* ================================================================== */

/** Max BFS depth for multi-level pointer chain scanning. */
export const POINTER_CHAIN_MAX_DEPTH = int('POINTER_CHAIN_MAX_DEPTH', 6);
/** Max offset (bytes) between pointer value and target to consider a match. */
export const POINTER_CHAIN_MAX_OFFSET = int('POINTER_CHAIN_MAX_OFFSET', 4096);
/** Max chains returned by a pointer chain scan. */
export const POINTER_CHAIN_MAX_RESULTS = int('POINTER_CHAIN_MAX_RESULTS', 500);
/** Chunk size (bytes) for reading memory during pointer chain scans. */
export const POINTER_CHAIN_SCAN_CHUNK_SIZE = int('POINTER_CHAIN_SCAN_CHUNK_SIZE', 16_777_216);

/* ================================================================== */
/*  Structure analysis                                                 */
/* ================================================================== */

/** Default byte range analyzed by the structure analyzer. */
export const STRUCT_ANALYZE_DEFAULT_SIZE = int('STRUCT_ANALYZE_DEFAULT_SIZE', 256);
/** Max virtual functions enumerated per vtable. */
export const STRUCT_VTABLE_MAX_FUNCTIONS = int('STRUCT_VTABLE_MAX_FUNCTIONS', 64);
/** Max RTTI/mangled name string length to read. */
export const STRUCT_RTTI_MAX_STRING_LEN = int('STRUCT_RTTI_MAX_STRING_LEN', 256);
/** Max C-string length to read from process memory. */
export const STRUCT_CSTRING_MAX_LEN = int('STRUCT_CSTRING_MAX_LEN', 256);

/* ================================================================== */
/*  Heap analysis                                                      */
/* ================================================================== */

/** Max heap blocks enumerated per heap via Toolhelp32. */
export const HEAP_ENUMERATE_MAX_BLOCKS = int('HEAP_ENUMERATE_MAX_BLOCKS', 10_000);
/** Block count threshold that signals a heap spray pattern. */
export const HEAP_SPRAY_THRESHOLD = int('HEAP_SPRAY_THRESHOLD', 50);
/** Size rounding tolerance (bytes) when grouping blocks for spray detection. */
export const HEAP_SPRAY_SIZE_TOLERANCE = int('HEAP_SPRAY_SIZE_TOLERANCE', 64);
/** Block sizes above this (bytes) are flagged as suspicious. */
export const HEAP_SUSPICIOUS_BLOCK_SIZE = int('HEAP_SUSPICIOUS_BLOCK_SIZE', 10_485_760);

/* ================================================================== */
/*  Hardware breakpoints & code caves                                  */
/* ================================================================== */

/** Minimum size to consider a run of 0x00/0xCC as a code cave. */
export const CODE_CAVE_MIN_SIZE = int('CODE_CAVE_MIN_SIZE', 16);

/** Timeout waiting for a hardware breakpoint hit (ms). */
export const BREAKPOINT_HIT_TIMEOUT_MS = int('BREAKPOINT_HIT_TIMEOUT_MS', 10_000);
/** Max hits collected during a breakpoint trace. */
export const BREAKPOINT_TRACE_MAX_HITS = int('BREAKPOINT_TRACE_MAX_HITS', 100);

/* ================================================================== */
/*  Memory freeze & write history                                      */
/* ================================================================== */

/** Default interval (ms) for memory freeze writes. */
export const FREEZE_DEFAULT_INTERVAL_MS = int('FREEZE_DEFAULT_INTERVAL_MS', 100);
/** Max entries kept in the write-value undo history. */
export const WRITE_HISTORY_MAX = int('WRITE_HISTORY_MAX', 200);

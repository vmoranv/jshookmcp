/**
 * AntiCheatDetector type definitions.
 * @module AntiCheatDetector.types
 */

/** Known anti-cheat / anti-debug mechanism types */
export type AntiCheatMechanism =
  | 'anti_debug_api' // IsDebuggerPresent, CheckRemoteDebuggerPresent
  | 'ntquery_debug' // NtQueryInformationProcess(ProcessDebugPort)
  | 'timing_check' // QueryPerformanceCounter deltas, RDTSC
  | 'guard_page' // PAGE_GUARD on critical regions
  | 'code_integrity_check' // CRC/hash of code sections
  | 'import_integrity' // IAT hook detection (checking own imports)
  | 'exception_based' // INT 2D, INT 3 based detection
  | 'thread_hiding' // NtSetInformationThread(ThreadHideFromDebugger)
  | 'heap_flags' // PEB.NtGlobalFlag / HeapFlags check
  | 'hardware_breakpoint'; // DR register checks via GetThreadContext

/** Detected anti-cheat mechanism */
export interface AntiCheatDetection {
  /** Mechanism type */
  mechanism: AntiCheatMechanism;
  /** Confidence of detection */
  confidence: 'low' | 'medium' | 'high';
  /** Location (hex address or 'import:FuncName') */
  location: string;
  /** Module containing the mechanism */
  moduleName: string;
  /** Human-readable description */
  details: string;
  /** Suggested bypass strategy */
  bypassSuggestion: string;
}

/** Guard page region info */
export interface GuardPageInfo {
  /** Region address (hex) */
  address: string;
  /** Region size */
  size: number;
  /** Module covering this region (if any) */
  moduleName: string | null;
  /** Nearby symbol (if resoluble) */
  nearbySymbol: string | null;
}

/** Guard page scan statistics */
export interface GuardPageScanStats {
  /** Total memory regions queried successfully */
  scannedRegions: number;
  /** Number of transient VirtualQueryEx failures */
  queryFailures: number;
  /** Total wall time */
  durationMs: number;
  /** Whether the scan hit its time budget */
  timedOut: boolean;
  /** Whether the scan stopped early due to safety limits */
  truncated: boolean;
  /** Configured region ceiling */
  maxRegions: number;
  /** Configured time budget */
  timeoutMs: number;
}

/** Guard page scan result */
export interface GuardPageScanResult {
  /** Guard page regions found so far */
  guardPages: GuardPageInfo[];
  /** Scan execution statistics */
  stats: GuardPageScanStats;
}

/** Code integrity check result */
export interface IntegrityCheckInfo {
  /** Section name */
  sectionName: string;
  /** Module name */
  moduleName: string;
  /** Hash of disk bytes (SHA-256 hex) */
  diskHash: string;
  /** Hash of memory bytes (SHA-256 hex) */
  memoryHash: string;
  /** Whether the section has been modified */
  isModified: boolean;
}

/** Integrity scan statistics */
export interface IntegrityCheckStats {
  /** Modules considered for scanning */
  scannedModules: number;
  /** Executable sections hashed and compared */
  scannedSections: number;
  /** Bytes hashed across all checked sections */
  hashedBytes: number;
  /** Modules skipped because they could not be read or parsed */
  skippedModules: number;
  /** Sections skipped because they exceeded the per-section byte cap */
  skippedSections: number;
  /** Total wall time */
  durationMs: number;
  /** Whether the scan hit its time budget */
  timedOut: boolean;
  /** Whether the scan stopped early due to safety limits */
  truncated: boolean;
  /** Configured module ceiling */
  maxModules: number;
  /** Configured section ceiling */
  maxSections: number;
  /** Configured total-byte ceiling */
  maxBytes: number;
  /** Configured time budget */
  timeoutMs: number;
}

/** Integrity scan result */
export interface IntegrityScanResult {
  /** Executable sections that were hashed and compared */
  sections: IntegrityCheckInfo[];
  /** Scan execution statistics */
  stats: IntegrityCheckStats;
}

/** Runtime safety limits for native anti-cheat scans */
export interface AntiCheatDetectorOptions {
  guardPageMaxRegions?: number;
  guardPageTimeoutMs?: number;
  integrityMaxModules?: number;
  integrityMaxSections?: number;
  integrityMaxBytes?: number;
  integrityMaxSectionBytes?: number;
  integrityTimeoutMs?: number;
}

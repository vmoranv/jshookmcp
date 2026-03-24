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

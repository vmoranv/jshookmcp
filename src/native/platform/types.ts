/**
 * Platform-agnostic memory operation types.
 *
 * These types abstract Win32 MEMORY_BASIC_INFORMATION and macOS vm_region_basic_info_64
 * into a unified interface used by all cross-platform engines.
 *
 * @module platform/types
 */

// ── Process Handle ──

/** Opaque handle to a target process. Platform providers store their native handle internally. */
export interface ProcessHandle {
  /** Original PID this handle was opened for */
  readonly pid: number;
  /** Whether write access was requested */
  readonly writeAccess: boolean;
}

// ── Memory Protection ──

/** Memory protection flags (platform-independent) */
export enum MemoryProtection {
  NoAccess = 0,
  Read = 1 << 0, // 0x01
  Write = 1 << 1, // 0x02
  Execute = 1 << 2, // 0x04
  ReadWrite = Read | Write, // 0x03
  ReadExecute = Read | Execute, // 0x05
  ReadWriteExecute = Read | Write | Execute, // 0x07
  Guard = 1 << 3, // 0x08 — trap on first access
  WriteCopy = 1 << 4, // 0x10 — copy-on-write
}

// ── Memory Region ──

/** Memory region state */
export type MemoryRegionState = 'committed' | 'reserved' | 'free';

/** Memory region type */
export type MemoryRegionType = 'image' | 'mapped' | 'private' | 'unknown';

/** Platform-agnostic memory region info (replaces Win32 MEMORY_BASIC_INFORMATION) */
export interface MemoryRegionInfo {
  /** Base address of the region */
  readonly baseAddress: bigint;
  /** Size of the region in bytes */
  readonly size: number;
  /** Current protection flags */
  readonly protection: MemoryProtection;
  /** Region state */
  readonly state: MemoryRegionState;
  /** Region type */
  readonly type: MemoryRegionType;
  /** Convenience: is the region readable? */
  readonly isReadable: boolean;
  /** Convenience: is the region writable? */
  readonly isWritable: boolean;
  /** Convenience: is the region executable? */
  readonly isExecutable: boolean;
}

// ── Module Info ──

/** Loaded module information (replaces Win32 MODULEINFO + GetModuleBaseName) */
export interface ModuleInfo {
  /** Module file name */
  readonly name: string;
  /** Base address where the module is loaded */
  readonly baseAddress: bigint;
  /** Size of the module in memory */
  readonly size: number;
}

// ── Operation Results ──

/** Result of a memory read operation */
export interface MemoryReadResult {
  /** The data that was read */
  readonly data: Buffer;
  /** Number of bytes actually read */
  readonly bytesRead: number;
}

/** Result of a memory write operation */
export interface MemoryWriteResult {
  /** Number of bytes written */
  readonly bytesWritten: number;
}

/** Result of a protection change operation */
export interface ProtectionChangeResult {
  /** Previous protection flags */
  readonly oldProtection: MemoryProtection;
}

/** Result of a memory allocation */
export interface AllocationResult {
  /** Address of the allocated memory */
  readonly address: bigint;
}

// ── Platform Availability ──

/** Platform availability check result */
export interface PlatformAvailability {
  readonly available: boolean;
  readonly reason?: string;
  readonly platform: 'win32' | 'darwin' | 'linux';
}

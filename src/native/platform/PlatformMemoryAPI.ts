/**
 * PlatformMemoryAPI — Cross-platform contract for native memory operations.
 *
 * Implemented by:
 * - Win32MemoryProvider (wraps kernel32.dll / psapi.dll via koffi)
 * - DarwinMemoryProvider (wraps libSystem.B.dylib Mach APIs via koffi)
 *
 * Consumed by:
 * - MemoryScanner, PointerChainEngine, StructureAnalyzer
 * - MemoryController, HeapAnalyzer, NativeMemoryManager
 *
 * Design rules:
 * 1. All methods use platform-agnostic types from ./types.ts
 * 2. ProcessHandle is opaque — providers store native handles internally
 * 3. Errors are thrown as Error instances, never swallowed
 * 4. Address values use bigint throughout (no hex string conversion at this layer)
 *
 * @module platform/PlatformMemoryAPI
 */

import type {
  ProcessHandle,
  MemoryRegionInfo,
  MemoryReadResult,
  MemoryWriteResult,
  ProtectionChangeResult,
  AllocationResult,
  ModuleInfo,
  MemoryProtection,
  PlatformAvailability,
} from './types.js';

export interface PlatformMemoryAPI {
  /** Platform identifier */
  readonly platform: 'win32' | 'darwin';

  // ── Lifecycle ──

  /** Check if this provider can operate on the current system */
  checkAvailability(): Promise<PlatformAvailability>;

  /** Open a handle to the target process */
  openProcess(pid: number, writeAccess: boolean): ProcessHandle;

  /** Close a process handle and release resources */
  closeProcess(handle: ProcessHandle): void;

  // ── Memory Operations ──

  /** Read bytes from target process memory */
  readMemory(handle: ProcessHandle, address: bigint, size: number): MemoryReadResult;

  /** Write bytes to target process memory */
  writeMemory(handle: ProcessHandle, address: bigint, data: Buffer): MemoryWriteResult;

  // ── Region Operations ──

  /**
   * Query the memory region containing the given address.
   * Returns null if the address is beyond the valid address space.
   */
  queryRegion(handle: ProcessHandle, address: bigint): MemoryRegionInfo | null;

  /** Change memory protection for a region */
  changeProtection(
    handle: ProcessHandle,
    address: bigint,
    size: number,
    newProtection: MemoryProtection
  ): ProtectionChangeResult;

  // ── Allocation ──

  /** Allocate memory in the target process */
  allocateMemory(
    handle: ProcessHandle,
    size: number,
    protection: MemoryProtection
  ): AllocationResult;

  /** Free previously allocated memory in the target process */
  freeMemory(handle: ProcessHandle, address: bigint, size: number): void;

  // ── Module Enumeration ──

  /** List all loaded modules/libraries in the target process */
  enumerateModules(handle: ProcessHandle): ModuleInfo[];
}

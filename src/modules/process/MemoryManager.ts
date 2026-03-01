/**
 * Cross-platform Memory Manager
 * Provides memory read/write/scan operations for Windows, Linux, and macOS
 *
 * PERFORMANCE: Uses koffi FFI for direct Win32 API calls (10-100x faster than PowerShell)
 * FALLBACK: Automatically falls back to PowerShell when native is unavailable
 *
 * WARNING: These operations require elevated privileges and can crash target processes.
 * Use with caution and only on processes you own or have permission to debug.
 *
 * This file is a facade that delegates to the sub-modules in ./memory/.
 */

import { logger } from '../../utils/logger.js';
import {
  type Platform,
  type PatternType,
  type MemoryReadResult,
  type MemoryWriteResult,
  type MemoryScanResult,
  type MemoryProtectionInfo,
  type MemoryPatch,
  readMemory as _readMemory,
  writeMemory as _writeMemory,
  batchMemoryWrite as _batchMemoryWrite,
  scanMemory as _scanMemory,
  scanMemoryFiltered as _scanMemoryFiltered,
  dumpMemoryRegion as _dumpMemoryRegion,
  enumerateRegions as _enumerateRegions,
  checkMemoryProtection as _checkMemoryProtection,
  enumerateModules as _enumerateModules,
  injectDll as _injectDll,
  injectShellcode as _injectShellcode,
  MemoryMonitorManager,
  checkAvailability as _checkAvailability,
  checkDebugPort as _checkDebugPort,
} from './memory/index.js';

// Re-export types so existing consumers keep working
export type { MemoryReadResult, MemoryWriteResult, MemoryScanResult };

// Platform detection - kept local to avoid circular dependency with index.ts
function detectPlatform(): Platform {
  const platform = process.platform;
  switch (platform) {
    case 'win32': return 'win32';
    case 'linux': return 'linux';
    case 'darwin': return 'darwin';
    default: return 'unknown';
  }
}

/**
 * Memory Manager - Cross-platform memory operations
 *
 * All implementation logic lives in ./memory/*.ts.  This class is a thin
 * facade that holds the platform value and the monitor registry and
 * delegates every public method to the appropriate sub-module function.
 */
export class MemoryManager {
  private platform: Platform;
  private monitorManager = new MemoryMonitorManager();

  constructor() {
    this.platform = detectPlatform();
    logger.info(`MemoryManager initialized for platform: ${this.platform}`);
  }

  // -------------------------------------------------------------------------
  // Read / Write
  // -------------------------------------------------------------------------

  /**
   * Read memory from a process
   * @param pid Target process ID
   * @param address Memory address (hex string like "0x12345678")
   * @param size Number of bytes to read
   */
  async readMemory(pid: number, address: string, size: number): Promise<MemoryReadResult> {
    return _readMemory(this.platform, pid, address, size, (p, a) =>
      _checkMemoryProtection(this.platform, p, a)
    );
  }

  /**
   * Write memory to a process
   * @param pid Target process ID
   * @param address Memory address (hex string)
   * @param data Data to write (hex string)
   * @param encoding 'hex' or 'base64'
   */
  async writeMemory(
    pid: number,
    address: string,
    data: string,
    encoding: 'hex' | 'base64' = 'hex'
  ): Promise<MemoryWriteResult> {
    return _writeMemory(this.platform, pid, address, data, encoding, (p, a) =>
      _checkMemoryProtection(this.platform, p, a)
    );
  }

  /**
   * Batch memory write (NOP sled, patch multiple addresses)
   */
  async batchMemoryWrite(
    pid: number,
    patches: MemoryPatch[]
  ): Promise<{ success: boolean; results: { address: string; success: boolean; error?: string }[]; error?: string }> {
    return _batchMemoryWrite(pid, patches, (p, addr, data, enc) =>
      this.writeMemory(p, addr, data, enc)
    );
  }

  // -------------------------------------------------------------------------
  // Scan
  // -------------------------------------------------------------------------

  /**
   * Scan memory for a pattern
   * @param pid Target process ID
   * @param pattern Pattern to search (hex bytes like "48 8B 05" or value)
   * @param patternType Type of pattern
   */
  async scanMemory(
    pid: number,
    pattern: string,
    patternType: PatternType = 'hex'
  ): Promise<MemoryScanResult> {
    return _scanMemory(this.platform, pid, pattern, patternType);
  }

  /**
   * Scan within specific addresses (filtered scan)
   * For secondary scanning within previous results
   */
  async scanMemoryFiltered(
    pid: number,
    pattern: string,
    addresses: string[],
    patternType: PatternType = 'hex'
  ): Promise<MemoryScanResult> {
    return _scanMemoryFiltered(
      pid,
      pattern,
      addresses,
      patternType,
      (p, addr, size) => this.readMemory(p, addr, size),
      (p, pat, type) => this.scanMemory(p, pat, type)
    );
  }

  // -------------------------------------------------------------------------
  // Regions / Modules / Protection
  // -------------------------------------------------------------------------

  /**
   * Dump memory region to file
   */
  async dumpMemoryRegion(
    pid: number,
    startAddress: string,
    size: number,
    outputPath: string
  ): Promise<{ success: boolean; error?: string }> {
    return _dumpMemoryRegion(this.platform, pid, startAddress, size, outputPath);
  }

  /**
   * Enumerate memory regions
   */
  async enumerateRegions(pid: number): ReturnType<typeof _enumerateRegions> {
    return _enumerateRegions(this.platform, pid);
  }

  /**
   * Check memory protection at specific address
   */
  async checkMemoryProtection(pid: number, address: string): Promise<MemoryProtectionInfo> {
    return _checkMemoryProtection(this.platform, pid, address);
  }

  /**
   * Enumerate loaded modules in target process
   */
  async enumerateModules(
    pid: number
  ): Promise<{ success: boolean; modules?: { name: string; baseAddress: string; size: number }[]; error?: string }> {
    return _enumerateModules(this.platform, pid);
  }

  // -------------------------------------------------------------------------
  // Injection
  // -------------------------------------------------------------------------

  /**
   * Inject DLL into target process (Windows only)
   * Uses CreateRemoteThread + LoadLibraryA
   */
  async injectDll(pid: number, dllPath: string): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return _injectDll(this.platform, pid, dllPath);
  }

  /**
   * Inject shellcode into target process (Windows only)
   * Uses VirtualAllocEx + WriteProcessMemory + CreateRemoteThread
   */
  async injectShellcode(
    pid: number,
    shellcode: string,
    encoding: 'hex' | 'base64' = 'hex'
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return _injectShellcode(this.platform, pid, shellcode, encoding);
  }

  // -------------------------------------------------------------------------
  // Anti-Detection
  // -------------------------------------------------------------------------

  /**
   * Check for debugger attachment in target process (Windows only)
   */
  async checkDebugPort(pid: number): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
    return _checkDebugPort(this.platform, pid);
  }

  // -------------------------------------------------------------------------
  // Monitor
  // -------------------------------------------------------------------------

  /**
   * Monitor memory address for changes (polling-based)
   * Returns a monitoring session ID
   */
  startMemoryMonitor(
    pid: number,
    address: string,
    size: number = 4,
    intervalMs: number = 1000,
    onChange?: (oldValue: string, newValue: string) => void
  ): string {
    return this.monitorManager.start(pid, address, size, intervalMs, (p, addr, sz) =>
      this.readMemory(p, addr, sz), onChange);
  }

  stopMemoryMonitor(monitorId: string): boolean {
    return this.monitorManager.stop(monitorId);
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /**
   * Check if memory operations are available on current platform
   */
  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return _checkAvailability(this.platform);
  }
}

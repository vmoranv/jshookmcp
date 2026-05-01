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

import { logger } from '@utils/logger';
import {
  type Platform,
  type PatternType,
  type MemoryReadResult,
  type MemoryWriteResult,
  type MemoryScanResult,
  type MemoryProtectionInfo,
  type MemoryPatch,
  readMemory as readMemoryImpl,
  writeMemory as writeMemoryImpl,
  batchMemoryWrite as batchMemoryWriteImpl,
  scanMemory as scanMemoryImpl,
  scanMemoryFiltered as scanMemoryFilteredImpl,
  dumpMemoryRegion as dumpMemoryRegionImpl,
  enumerateRegions as enumerateRegionsImpl,
  checkMemoryProtection as checkMemoryProtectionImpl,
  enumerateModules as enumerateModulesImpl,
  injectDll as injectDllImpl,
  injectShellcode as injectShellcodeImpl,
  MemoryMonitorManager,
  checkAvailability as checkAvailabilityImpl,
  checkDebugPort as checkDebugPortImpl,
} from '@modules/process/memory/index';

// Re-export types so existing consumers keep working
export type { MemoryReadResult, MemoryWriteResult, MemoryScanResult };

// Platform detection - kept local to avoid circular dependency with index.ts
function detectPlatform(): Platform {
  const platform = process.platform;
  switch (platform) {
    case 'win32':
      return 'win32';
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    default:
      return 'unknown';
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

  // ── Read / Write ──

  async readMemory(pid: number, address: string, size: number): Promise<MemoryReadResult> {
    return readMemoryImpl(this.platform, pid, address, size, (p, a) =>
      checkMemoryProtectionImpl(this.platform, p, a),
    );
  }

  async writeMemory(
    pid: number,
    address: string,
    data: string,
    encoding: 'hex' | 'base64' = 'hex',
  ): Promise<MemoryWriteResult> {
    return writeMemoryImpl(this.platform, pid, address, data, encoding, (p, a) =>
      checkMemoryProtectionImpl(this.platform, p, a),
    );
  }

  async batchMemoryWrite(
    pid: number,
    patches: MemoryPatch[],
  ): Promise<{
    success: boolean;
    results: { address: string; success: boolean; error?: string }[];
    error?: string;
  }> {
    return batchMemoryWriteImpl(pid, patches, (p, addr, data, enc) =>
      this.writeMemory(p, addr, data, enc),
    );
  }

  // ── Scan ──

  async scanMemory(
    pid: number,
    pattern: string,
    patternType: PatternType = 'hex',
    suspendTarget = false,
  ): Promise<MemoryScanResult> {
    return scanMemoryImpl(this.platform, pid, pattern, patternType, suspendTarget);
  }

  async scanMemoryFiltered(
    pid: number,
    pattern: string,
    addresses: string[],
    patternType: PatternType = 'hex',
  ): Promise<MemoryScanResult> {
    return scanMemoryFilteredImpl(
      pid,
      pattern,
      addresses,
      patternType,
      (p, addr, size) => this.readMemory(p, addr, size),
      (p, pat, type) => this.scanMemory(p, pat, type),
    );
  }

  // ── Regions / Modules / Protection ──

  async dumpMemoryRegion(
    pid: number,
    startAddress: string,
    size: number,
    outputPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    return dumpMemoryRegionImpl(this.platform, pid, startAddress, size, outputPath);
  }

  async enumerateRegions(pid: number): ReturnType<typeof enumerateRegionsImpl> {
    return enumerateRegionsImpl(this.platform, pid);
  }

  async checkMemoryProtection(pid: number, address: string): Promise<MemoryProtectionInfo> {
    return checkMemoryProtectionImpl(this.platform, pid, address);
  }

  async enumerateModules(pid: number): Promise<{
    success: boolean;
    modules?: { name: string; baseAddress: string; size: number }[];
    error?: string;
  }> {
    return enumerateModulesImpl(this.platform, pid);
  }

  // ── Injection ──

  /**
   * Inject DLL into target process (Windows only)
   * Uses CreateRemoteThread + LoadLibraryA
   */
  async injectDll(
    pid: number,
    dllPath: string,
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return injectDllImpl(this.platform, pid, dllPath);
  }

  /**
   * Inject shellcode into target process (Windows only)
   * Uses VirtualAllocEx + WriteProcessMemory + CreateRemoteThread
   */
  async injectShellcode(
    pid: number,
    shellcode: string,
    encoding: 'hex' | 'base64' = 'hex',
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return injectShellcodeImpl(this.platform, pid, shellcode, encoding);
  }

  // ── Anti-Detection ──

  async checkDebugPort(
    pid: number,
  ): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
    return checkDebugPortImpl(this.platform, pid);
  }

  // ── Monitor ──

  startMemoryMonitor(
    pid: number,
    address: string,
    size: number = 4,
    intervalMs: number = 1000,
    onChange?: (oldValue: string, newValue: string) => void,
  ): string {
    return this.monitorManager.start(
      pid,
      address,
      size,
      intervalMs,
      (p, addr, sz) => this.readMemory(p, addr, sz),
      onChange,
    );
  }

  stopMemoryMonitor(monitorId: string): boolean {
    return this.monitorManager.stop(monitorId);
  }

  // ── Availability ──

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return checkAvailabilityImpl(this.platform);
  }
}

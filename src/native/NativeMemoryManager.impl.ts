/**
 * Native Memory Manager — Cross-platform memory operations.
 *
 * Uses PlatformMemoryAPI for read/write/scan/regions/modules.
 * Win32-only injection and debug methods remain guarded by platform checks.
 *
 * Performance improvement: 10-100x faster than PowerShell-based approach
 * - No process spawning overhead
 * - Direct memory access via FFI
 * - Lower latency and higher throughput
 *
 * @module NativeMemoryManager
 */

import { logger } from '@utils/logger';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { cpuLimit } from '../utils/concurrency';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import { MemoryProtection } from './platform/types.js';
import type { MemoryRegionInfo } from './platform/types.js';
import type {
  MemoryRegion,
  ModuleInfo,
  NativeMemoryReadResult,
  NativeMemoryScanResult,
  NativeMemoryWriteResult,
  NativePatternType,
} from '@native/NativeMemoryManager.types';
import { findPatternInBuffer, parsePattern } from '@native/NativeMemoryManager.utils';
import { checkNativeMemoryAvailability } from '@native/NativeMemoryManager.availability';
export type {
  MemoryRegion,
  ModuleInfo,
  NativeMemoryReadResult,
  NativeMemoryScanResult,
  NativeMemoryWriteResult,
} from '@native/NativeMemoryManager.types';

const execAsync = promisify(exec);
const SCAN_CHUNK_SIZE = 16 * 1024 * 1024;

export function scanRegionInChunks(
  region: { baseAddress: bigint; regionSize: number },
  patternBytes: number[],
  mask: number[],
  readChunk: (address: bigint, size: number) => Buffer<ArrayBufferLike>,
  chunkSize = SCAN_CHUNK_SIZE,
): bigint[] {
  if (patternBytes.length === 0 || region.regionSize < patternBytes.length || chunkSize <= 0) {
    return [];
  }

  const overlap = Math.max(patternBytes.length - 1, 0);
  let carryOver: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const matches: bigint[] = [];

  for (let chunkOffset = 0; chunkOffset < region.regionSize; chunkOffset += chunkSize) {
    const readSize = Math.min(chunkSize, region.regionSize - chunkOffset);
    const chunkAddress = region.baseAddress + BigInt(chunkOffset);
    const chunk = readChunk(chunkAddress, readSize);
    const scanBuffer = carryOver.length > 0 ? Buffer.concat([carryOver, chunk]) : chunk;
    const chunkMatches = findPatternInBuffer(scanBuffer, patternBytes, mask);

    for (const matchOffset of chunkMatches) {
      const regionOffset = chunkOffset + matchOffset - carryOver.length;
      matches.push(region.baseAddress + BigInt(regionOffset));
    }

    if (overlap === 0 || chunkOffset + readSize >= region.regionSize) {
      carryOver = Buffer.alloc(0);
      continue;
    }

    const carrySize = Math.min(overlap, scanBuffer.length);
    carryOver = scanBuffer.subarray(scanBuffer.length - carrySize);
  }

  return matches;
}

// ── Native Memory Manager ──

/**
 * High-performance cross-platform memory manager.
 * Uses PlatformMemoryAPI for read/write/scan/regions/modules.
 * Win32-only methods (injection, debug) are guarded by platform checks.
 */
export class NativeMemoryManager {
  private _provider: PlatformMemoryAPI | null = null;

  /** Lazily create the platform memory provider */
  private get provider(): PlatformMemoryAPI {
    if (!this._provider) {
      this._provider = createPlatformProvider();
    }
    return this._provider;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return checkNativeMemoryAvailability(execAsync);
  }

  // ── Memory Read Operations ──

  async readMemory(pid: number, address: string, size: number): Promise<NativeMemoryReadResult> {
    try {
      const addrNum = BigInt(address.startsWith('0x') ? address : `0x${address}`);

      const handle = this.provider.openProcess(pid, false);
      try {
        const { data: buffer } = this.provider.readMemory(handle, addrNum, size);
        return {
          success: true,
          data: buffer.toString('hex').toUpperCase().match(/.{2}/g)?.join(' ') || '',
        };
      } finally {
        this.provider.closeProcess(handle);
      }
    } catch (error) {
      logger.error('Native memory read failed', {
        pid,
        address,
        size,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Memory Write Operations ──

  async writeMemory(
    pid: number,
    address: string,
    data: string,
    encoding: 'hex' | 'base64' = 'hex',
  ): Promise<NativeMemoryWriteResult> {
    try {
      const addrNum = BigInt(address.startsWith('0x') ? address : `0x${address}`);

      let buffer: Buffer;
      if (encoding === 'base64') {
        buffer = Buffer.from(data, 'base64');
      } else {
        buffer = Buffer.from(data.replace(/\s/g, ''), 'hex');
      }

      const handle = this.provider.openProcess(pid, true);
      try {
        const { bytesWritten } = this.provider.writeMemory(handle, addrNum, buffer);
        return {
          success: true,
          bytesWritten,
        };
      } finally {
        this.provider.closeProcess(handle);
      }
    } catch (error) {
      logger.error('Native memory write failed', {
        pid,
        address,
        encoding,
        dataLength: data.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Memory Region Operations ──

  async enumerateRegions(
    pid: number,
  ): Promise<{ success: boolean; regions?: MemoryRegion[]; error?: string }> {
    try {
      const handle = this.provider.openProcess(pid, false);
      const regions: MemoryRegion[] = [];

      try {
        let address = 0n;
        const maxAddress = BigInt('0x7FFFFFFF0000');

        while (address < maxAddress) {
          const regionInfo = this.provider.queryRegion(handle, address);

          if (!regionInfo) {
            break;
          }

          regions.push(regionInfoToMemoryRegion(regionInfo));
          address = regionInfo.baseAddress + BigInt(regionInfo.size);
        }

        return { success: true, regions };
      } finally {
        this.provider.closeProcess(handle);
      }
    } catch (error) {
      logger.error('Native region enumeration failed', {
        pid,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkMemoryProtection(
    pid: number,
    address: string,
  ): Promise<{
    success: boolean;
    protection?: string;
    isWritable?: boolean;
    isReadable?: boolean;
    isExecutable?: boolean;
    regionStart?: string;
    regionSize?: number;
    error?: string;
  }> {
    try {
      const addrNum = BigInt(address.startsWith('0x') ? address : `0x${address}`);
      const handle = this.provider.openProcess(pid, false);

      try {
        const regionInfo = this.provider.queryRegion(handle, addrNum);

        if (!regionInfo) {
          return { success: false, error: 'Failed to query memory region' };
        }

        return {
          success: true,
          protection: protectionToString(regionInfo.protection),
          isWritable: regionInfo.isWritable,
          isReadable: regionInfo.isReadable,
          isExecutable: regionInfo.isExecutable,
          regionStart: `0x${regionInfo.baseAddress.toString(16).toUpperCase()}`,
          regionSize: regionInfo.size,
        };
      } finally {
        this.provider.closeProcess(handle);
      }
    } catch (error) {
      logger.error('Native protection check failed', {
        pid,
        address,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Memory Scan Operations ──

  async scanMemory(
    pid: number,
    pattern: string,
    patternType: 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string' = 'hex',
  ): Promise<NativeMemoryScanResult> {
    try {
      const { patternBytes, mask } = parsePattern(pattern, patternType as NativePatternType);

      if (patternBytes.length === 0) {
        return { success: false, addresses: [], error: 'Invalid pattern' };
      }

      const maxResults = 10000;
      const readableRegions: Array<{ baseAddress: bigint; regionSize: number }> = [];
      const handle = this.provider.openProcess(pid, false);
      let regionMatches: bigint[][] = [];

      try {
        let address = 0n;
        const maxAddress = BigInt('0x7FFFFFFF0000');

        while (address < maxAddress) {
          const regionInfo = this.provider.queryRegion(handle, address);

          if (!regionInfo) {
            break;
          }

          if (
            regionInfo.isReadable &&
            regionInfo.size > 0 &&
            regionInfo.size <= Number.MAX_SAFE_INTEGER
          ) {
            readableRegions.push({
              baseAddress: regionInfo.baseAddress,
              regionSize: regionInfo.size,
            });
          }

          address = regionInfo.baseAddress + BigInt(regionInfo.size);
        }

        const providerRef = this.provider;
        regionMatches = await Promise.all(
          readableRegions.map((region) =>
            cpuLimit(async () => {
              try {
                return scanRegionInChunks(
                  region,
                  patternBytes,
                  mask,
                  (addr, size) => providerRef.readMemory(handle, addr, size).data,
                );
              } catch {
                // Skip unreadable regions
                return [];
              }
            }),
          ),
        );
      } finally {
        this.provider.closeProcess(handle);
      }

      const addresses: string[] = [];
      for (const matches of regionMatches) {
        for (const foundAddr of matches) {
          addresses.push(`0x${foundAddr.toString(16).toUpperCase()}`);
          if (addresses.length >= maxResults) {
            break;
          }
        }

        if (addresses.length >= maxResults) {
          break;
        }
      }

      return {
        success: true,
        addresses,
        stats: {
          patternLength: patternBytes.length,
          resultsFound: addresses.length,
        },
      };
    } catch (error) {
      logger.error('Native memory scan failed', {
        pid,
        patternType,
        patternLength: pattern.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        addresses: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Module Operations ──

  async enumerateModules(
    pid: number,
  ): Promise<{ success: boolean; modules?: ModuleInfo[]; error?: string }> {
    try {
      const handle = this.provider.openProcess(pid, false);

      try {
        const platformModules = this.provider.enumerateModules(handle);

        const modules: ModuleInfo[] = platformModules.map((m) => ({
          name: m.name,
          baseAddress: `0x${m.baseAddress.toString(16).toUpperCase()}`,
          size: m.size,
        }));

        return { success: true, modules };
      } finally {
        this.provider.closeProcess(handle);
      }
    } catch (error) {
      logger.error('Native module enumeration failed', {
        pid,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Injection Operations (Win32-only) ──

  /** Win32 only — uses CreateRemoteThread + LoadLibraryA */
  async injectDll(
    pid: number,
    dllPath: string,
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'DLL injection is only supported on Windows' };
    }

    try {
      // Lazy import Win32-only APIs
      const {
        openProcessForMemory,
        CloseHandle,
        WriteProcessMemory,
        VirtualAllocEx,
        CreateRemoteThread,
        GetModuleHandle,
        GetProcAddress,
        PAGE,
        MEM,
      } = await import('@native/Win32API');

      const handle = openProcessForMemory(pid, true);

      try {
        const kernel32Handle = GetModuleHandle('kernel32.dll');
        const loadLibraryAddr = GetProcAddress(kernel32Handle, 'LoadLibraryA');

        if (!loadLibraryAddr) {
          return { success: false, error: 'Failed to get LoadLibraryA address' };
        }

        const pathBuffer = Buffer.from(dllPath + '\0', 'ascii');
        const remoteMem = VirtualAllocEx(
          handle,
          0n,
          pathBuffer.length,
          MEM.COMMIT | MEM.RESERVE,
          PAGE.READWRITE,
        );

        if (!remoteMem) {
          return { success: false, error: 'Failed to allocate remote memory' };
        }

        WriteProcessMemory(handle, remoteMem, pathBuffer);

        const { handle: threadHandle, threadId } = CreateRemoteThread(
          handle,
          loadLibraryAddr,
          remoteMem,
        );

        if (!threadHandle) {
          return { success: false, error: 'Failed to create remote thread' };
        }

        CloseHandle(threadHandle);
        return { success: true, remoteThreadId: threadId };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native DLL injection failed', {
        pid,
        dllPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Win32 only — uses VirtualAllocEx + CreateRemoteThread */
  async injectShellcode(
    pid: number,
    shellcode: string,
    encoding: 'hex' | 'base64' = 'hex',
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Shellcode injection is only supported on Windows' };
    }

    try {
      let buffer: Buffer;
      if (encoding === 'base64') {
        buffer = Buffer.from(shellcode, 'base64');
      } else {
        buffer = Buffer.from(shellcode.replace(/\s/g, ''), 'hex');
      }

      // Lazy import Win32-only APIs
      const {
        openProcessForMemory,
        CloseHandle,
        WriteProcessMemory,
        VirtualAllocEx,
        VirtualProtectEx,
        CreateRemoteThread,
        PAGE,
        MEM,
      } = await import('@native/Win32API');

      const handle = openProcessForMemory(pid, true);

      try {
        const remoteMem = VirtualAllocEx(
          handle,
          0n,
          buffer.length,
          MEM.COMMIT | MEM.RESERVE,
          PAGE.READWRITE,
        );

        if (!remoteMem) {
          return { success: false, error: 'Failed to allocate remote memory' };
        }

        WriteProcessMemory(handle, remoteMem, buffer);

        const { success: protectSuccess } = VirtualProtectEx(
          handle,
          remoteMem,
          buffer.length,
          PAGE.EXECUTE_READWRITE,
        );

        if (!protectSuccess) {
          return { success: false, error: 'Failed to change memory protection' };
        }

        const { handle: threadHandle, threadId } = CreateRemoteThread(handle, remoteMem, 0n);

        if (!threadHandle) {
          return { success: false, error: 'Failed to create remote thread' };
        }

        CloseHandle(threadHandle);
        return { success: true, remoteThreadId: threadId };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native shellcode injection failed', {
        pid,
        encoding,
        shellcodeLength: shellcode.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Anti-Debug Operations (Win32-only) ──

  /** Win32 only — uses NtQueryInformationProcess */
  async checkDebugPort(
    pid: number,
  ): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Debug port check is only supported on Windows' };
    }

    try {
      const { openProcessForMemory, CloseHandle, NtQueryInformationProcess } =
        await import('@native/Win32API');

      const handle = openProcessForMemory(pid, false);

      try {
        const { status, debugPort } = NtQueryInformationProcess(handle, 7);

        if (status !== 0) {
          return {
            success: false,
            error: `NtQueryInformationProcess failed with status 0x${status.toString(16)}`,
          };
        }

        return {
          success: true,
          isDebugged: debugPort !== 0,
        };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native debug port check failed', {
        pid,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ── Helpers ──

/** Convert platform-agnostic MemoryRegionInfo to legacy MemoryRegion format */
function regionInfoToMemoryRegion(info: MemoryRegionInfo): MemoryRegion {
  return {
    baseAddress: `0x${info.baseAddress.toString(16).toUpperCase()}`,
    size: info.size,
    state: info.state.toUpperCase(),
    protection: protectionToString(info.protection),
    isReadable: info.isReadable,
    isWritable: info.isWritable,
    isExecutable: info.isExecutable,
    type: info.type.toUpperCase(),
  };
}

/** Convert MemoryProtection flags to human-readable string */
function protectionToString(prot: MemoryProtection): string {
  if (prot === MemoryProtection.NoAccess) return 'NOACCESS';

  const parts: string[] = [];
  const hasRead = (prot & MemoryProtection.Read) !== 0;
  const hasWrite = (prot & MemoryProtection.Write) !== 0;
  const hasExec = (prot & MemoryProtection.Execute) !== 0;
  const hasGuard = (prot & MemoryProtection.Guard) !== 0;

  if (hasRead && hasWrite && hasExec) parts.push('RWX');
  else if (hasRead && hasExec) parts.push('RX');
  else if (hasRead && hasWrite) parts.push('RW');
  else if (hasRead) parts.push('R');
  else if (hasExec) parts.push('X');

  if (hasGuard) parts.push('GUARD');

  return parts.join(' ') || 'UNKNOWN';
}

// Export singleton instance
export const nativeMemoryManager = new NativeMemoryManager();

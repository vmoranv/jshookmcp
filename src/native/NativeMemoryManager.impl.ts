/**
 * Native Memory Manager using koffi FFI
 * High-performance memory operations using direct Win32 API calls
 *
 * Performance improvement: 10-100x faster than PowerShell-based approach
 * - No process spawning overhead
 * - Direct memory access via FFI
 * - Lower latency and higher throughput
 *
 * @module NativeMemoryManager
 */

import { logger } from '../utils/logger.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  PAGE,
  MEM,
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualQueryEx,
  VirtualProtectEx,
  VirtualAllocEx,
  CreateRemoteThread,
  GetModuleHandle,
  GetProcAddress,
  NtQueryInformationProcess,
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleInformation,
} from './Win32API.js';
import type {
  MemoryRegion,
  ModuleInfo,
  NativeMemoryReadResult,
  NativeMemoryScanResult,
  NativeMemoryWriteResult,
  NativePatternType,
} from './NativeMemoryManager.types.js';
import {
  findPatternInBuffer,
  getProtectionString,
  getStateString,
  getTypeString,
  isExecutable,
  isReadable,
  isWritable,
  parsePattern,
} from './NativeMemoryManager.utils.js';
import { checkNativeMemoryAvailability } from './NativeMemoryManager.availability.js';
export type {
  MemoryRegion,
  ModuleInfo,
  NativeMemoryReadResult,
  NativeMemoryScanResult,
  NativeMemoryWriteResult,
} from './NativeMemoryManager.types.js';

const execAsync = promisify(exec);

// ==================== Native Memory Manager ====================

/**
 * High-performance memory manager using direct Win32 API calls
 */
export class NativeMemoryManager {
  /**
   * Check if native memory operations are available
   */
  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return checkNativeMemoryAvailability(execAsync);
  }

  // ==================== Memory Read Operations ====================

  /**
   * Read memory from a process
   */
  async readMemory(pid: number, address: string, size: number): Promise<NativeMemoryReadResult> {
    try {
      const addrNum = BigInt(address.startsWith('0x') ? address : `0x${address}`);

      const handle = openProcessForMemory(pid, false);
      try {
        const buffer = ReadProcessMemory(handle, addrNum, size);
        return {
          success: true,
          data: buffer.toString('hex').toUpperCase().match(/.{2}/g)?.join(' ') || '',
        };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native memory read failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Memory Write Operations ====================

  /**
   * Write memory to a process
   */
  async writeMemory(
    pid: number,
    address: string,
    data: string,
    encoding: 'hex' | 'base64' = 'hex'
  ): Promise<NativeMemoryWriteResult> {
    try {
      const addrNum = BigInt(address.startsWith('0x') ? address : `0x${address}`);

      let buffer: Buffer;
      if (encoding === 'base64') {
        buffer = Buffer.from(data, 'base64');
      } else {
        buffer = Buffer.from(data.replace(/\s/g, ''), 'hex');
      }

      const handle = openProcessForMemory(pid, true);
      try {
        const bytesWritten = WriteProcessMemory(handle, addrNum, buffer);
        return {
          success: true,
          bytesWritten,
        };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native memory write failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Memory Region Operations ====================

  /**
   * Enumerate all memory regions in a process
   */
  async enumerateRegions(pid: number): Promise<{ success: boolean; regions?: MemoryRegion[]; error?: string }> {
    try {
      const handle = openProcessForMemory(pid, false);
      const regions: MemoryRegion[] = [];

      try {
        let address = 0n;
        const maxAddress = BigInt('0x7FFFFFFF0000');

        while (address < maxAddress) {
          const { success, info } = VirtualQueryEx(handle, address);

          if (!success || info.RegionSize === 0n) {
            break;
          }

          const region: MemoryRegion = {
            baseAddress: `0x${info.BaseAddress.toString(16).toUpperCase()}`,
            size: Number(info.RegionSize),
            state: getStateString(info.State),
            protection: getProtectionString(info.Protect),
            isReadable: isReadable(info),
            isWritable: isWritable(info.Protect),
            isExecutable: isExecutable(info.Protect),
            type: getTypeString(info.Type),
          };

          regions.push(region);
          address = info.BaseAddress + info.RegionSize;
        }

        return { success: true, regions };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native region enumeration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check memory protection at a specific address
   */
  async checkMemoryProtection(
    pid: number,
    address: string
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
      const handle = openProcessForMemory(pid, false);

      try {
        const { success, info } = VirtualQueryEx(handle, addrNum);

        if (!success) {
          return { success: false, error: 'Failed to query memory region' };
        }

        return {
          success: true,
          protection: getProtectionString(info.Protect),
          isWritable: isWritable(info.Protect),
          isReadable: isReadable(info),
          isExecutable: isExecutable(info.Protect),
          regionStart: `0x${info.BaseAddress.toString(16).toUpperCase()}`,
          regionSize: Number(info.RegionSize),
        };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native protection check failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Memory Scan Operations ====================

  /**
   * Scan memory for a pattern
   */
  async scanMemory(
    pid: number,
    pattern: string,
    patternType: 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string' = 'hex'
  ): Promise<NativeMemoryScanResult> {
    try {
      const { patternBytes, mask } = parsePattern(pattern, patternType as NativePatternType);

      if (patternBytes.length === 0) {
        return { success: false, addresses: [], error: 'Invalid pattern' };
      }

      const handle = openProcessForMemory(pid, false);
      const addresses: string[] = [];
      const maxResults = 10000;

      try {
        let address = 0n;
        const maxAddress = BigInt('0x7FFFFFFF0000');

        while (address < maxAddress && addresses.length < maxResults) {
          const { success, info } = VirtualQueryEx(handle, address);

          if (!success || info.RegionSize === 0n) {
            break;
          }

          if (isReadable(info) && Number(info.RegionSize) > 0 && Number(info.RegionSize) < 1024 * 1024 * 1024) {
            try {
              const regionBuffer = ReadProcessMemory(handle, info.BaseAddress, Number(info.RegionSize));
              const matches = findPatternInBuffer(regionBuffer, patternBytes, mask);

              for (const offset of matches) {
                const foundAddr = info.BaseAddress + BigInt(offset);
                addresses.push(`0x${foundAddr.toString(16).toUpperCase()}`);
                if (addresses.length >= maxResults) break;
              }
            } catch {
              // Skip unreadable regions
            }
          }

          address = info.BaseAddress + info.RegionSize;
        }

        return {
          success: true,
          addresses,
          stats: {
            patternLength: patternBytes.length,
            resultsFound: addresses.length,
          },
        };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native memory scan failed:', error);
      return {
        success: false,
        addresses: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Module Operations ====================

  /**
   * Enumerate loaded modules in a process
   */
  async enumerateModules(pid: number): Promise<{ success: boolean; modules?: ModuleInfo[]; error?: string }> {
    try {
      const handle = openProcessForMemory(pid, false);

      try {
        const { success, modules: handles, count } = EnumProcessModules(handle);

        if (!success) {
          return { success: false, error: 'EnumProcessModules failed' };
        }

        const modules: ModuleInfo[] = [];

        for (let i = 0; i < count; i++) {
          const hModule = handles[i];
          if (!hModule) continue;

          const name = GetModuleBaseName(handle, hModule);
          const { success: infoSuccess, info } = GetModuleInformation(handle, hModule);

          if (infoSuccess && info) {
            modules.push({
              name,
              baseAddress: `0x${info.lpBaseOfDll.toString(16).toUpperCase()}`,
              size: info.SizeOfImage,
            });
          }
        }

        return { success: true, modules };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native module enumeration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Injection Operations ====================

  /**
   * Inject DLL into target process
   */
  async injectDll(
    pid: number,
    dllPath: string
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    try {
      const handle = openProcessForMemory(pid, true);

      try {
        const kernel32Handle = GetModuleHandle('kernel32.dll');
        const loadLibraryAddr = GetProcAddress(kernel32Handle, 'LoadLibraryA');

        if (!loadLibraryAddr) {
          return { success: false, error: 'Failed to get LoadLibraryA address' };
        }

        const pathBuffer = Buffer.from(dllPath + '\0', 'ascii');
        const remoteMem = VirtualAllocEx(handle, 0n, pathBuffer.length, MEM.COMMIT | MEM.RESERVE, PAGE.READWRITE);

        if (!remoteMem) {
          return { success: false, error: 'Failed to allocate remote memory' };
        }

        WriteProcessMemory(handle, remoteMem, pathBuffer);

        const { handle: threadHandle, threadId } = CreateRemoteThread(handle, loadLibraryAddr, remoteMem);

        if (!threadHandle) {
          return { success: false, error: 'Failed to create remote thread' };
        }

        CloseHandle(threadHandle);
        return { success: true, remoteThreadId: threadId };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native DLL injection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Inject shellcode into target process
   */
  async injectShellcode(
    pid: number,
    shellcode: string,
    encoding: 'hex' | 'base64' = 'hex'
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    try {
      let buffer: Buffer;
      if (encoding === 'base64') {
        buffer = Buffer.from(shellcode, 'base64');
      } else {
        buffer = Buffer.from(shellcode.replace(/\s/g, ''), 'hex');
      }

      const handle = openProcessForMemory(pid, true);

      try {
        const remoteMem = VirtualAllocEx(handle, 0n, buffer.length, MEM.COMMIT | MEM.RESERVE, PAGE.READWRITE);

        if (!remoteMem) {
          return { success: false, error: 'Failed to allocate remote memory' };
        }

        WriteProcessMemory(handle, remoteMem, buffer);

        const { success: protectSuccess } = VirtualProtectEx(handle, remoteMem, buffer.length, PAGE.EXECUTE_READWRITE);

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
      logger.error('Native shellcode injection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Anti-Debug Operations ====================

  /**
   * Check if process is being debugged
   */
  async checkDebugPort(pid: number): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
    try {
      const handle = openProcessForMemory(pid, false);

      try {
        const { status, debugPort } = NtQueryInformationProcess(handle, 7);

        if (status !== 0) {
          return { success: false, error: `NtQueryInformationProcess failed with status 0x${status.toString(16)}` };
        }

        return {
          success: true,
          isDebugged: debugPort !== 0,
        };
      } finally {
        CloseHandle(handle);
      }
    } catch (error) {
      logger.error('Native debug port check failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

}

// Export singleton instance
export const nativeMemoryManager = new NativeMemoryManager();

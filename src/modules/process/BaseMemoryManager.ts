/**
 * Base Memory Manager - Abstract Base Class
 * Defines the interface for platform-specific implementations
 */

import type {
  MemoryReadResult,
  MemoryWriteResult,
  MemoryScanResult,
  MemoryProtectionInfo,
  ModuleInfo,
  PatternType,
} from '@modules/process/types';

export abstract class BaseMemoryManager {
  abstract readonly platform: string;

  abstract readMemory(pid: number, address: number, size: number): Promise<MemoryReadResult>;

  abstract writeMemory(pid: number, address: number, data: Buffer): Promise<MemoryWriteResult>;

  abstract scanMemory(
    pid: number,
    pattern: string,
    patternType: PatternType,
  ): Promise<MemoryScanResult>;

  abstract checkMemoryProtection(pid: number, address: number): Promise<MemoryProtectionInfo>;

  abstract enumerateRegions(
    pid: number,
  ): Promise<{ success: boolean; regions?: ModuleInfo[]; error?: string }>;

  abstract enumerateModules(
    pid: number,
  ): Promise<{ success: boolean; modules?: ModuleInfo[]; error?: string }>;

  abstract dumpMemoryRegion(
    pid: number,
    address: number,
    size: number,
    outputPath: string,
  ): Promise<{ success: boolean; error?: string }>;

  abstract injectDll(
    pid: number,
    dllPath: string,
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }>;

  abstract injectShellcode(
    pid: number,
    shellcode: Buffer,
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }>;

  abstract checkDebugPort(
    pid: number,
  ): Promise<{ success: boolean; isDebugged?: boolean; error?: string }>;

  abstract checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  protected convertPatternToBytes(
    pattern: string,
    patternType: PatternType,
  ): { bytes: number[]; mask: number[] } {
    const bytes: number[] = [];
    const mask: number[] = [];

    switch (patternType) {
      case 'hex': {
        const hexParts = pattern.trim().split(/\s+/);
        for (const part of hexParts) {
          if (part === '??' || part === '**' || part === '?') {
            bytes.push(0);
            mask.push(0);
          } else {
            const byte = parseInt(part, 16);
            if (!isNaN(byte)) {
              bytes.push(byte);
              mask.push(1);
            }
          }
        }
        break;
      }
      case 'int32': {
        const int32Val = parseInt(pattern);
        if (!isNaN(int32Val)) {
          const buf = Buffer.allocUnsafe(4);
          buf.writeInt32LE(int32Val, 0);
          bytes.push(...Array.from(buf));
          mask.push(1, 1, 1, 1);
        }
        break;
      }
      case 'int64': {
        const int64Val = BigInt.asIntN(64, BigInt(pattern));
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigInt64LE(int64Val, 0);
        bytes.push(...Array.from(buf));
        mask.push(1, 1, 1, 1, 1, 1, 1, 1);
        break;
      }
      case 'float': {
        const floatVal = parseFloat(pattern);
        if (!isNaN(floatVal)) {
          const buf = Buffer.allocUnsafe(4);
          buf.writeFloatLE(floatVal, 0);
          bytes.push(...Array.from(buf));
          mask.push(1, 1, 1, 1);
        }
        break;
      }
      case 'double': {
        const doubleVal = parseFloat(pattern);
        if (!isNaN(doubleVal)) {
          const buf = Buffer.allocUnsafe(8);
          buf.writeDoubleLE(doubleVal, 0);
          bytes.push(...Array.from(buf));
          mask.push(1, 1, 1, 1, 1, 1, 1, 1);
        }
        break;
      }
      case 'string': {
        const stringBuf = Buffer.from(pattern, 'utf8');
        bytes.push(...Array.from(stringBuf));
        mask.push(...stringBuf.map(() => 1));
        break;
      }
    }

    return { bytes, mask };
  }
}

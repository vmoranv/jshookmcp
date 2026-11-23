/**
 * Structure Analyzer Utilities — shared helper functions.
 *
 * @module StructureAnalyzer.Utils
 */

import type { FieldType } from './StructureAnalyzer.types';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { nativeMemoryManager } from './NativeMemoryManager.impl';

export class StructAnalyzerUtils {
  private provider: PlatformMemoryAPI;
  constructor(provider: PlatformMemoryAPI) {
    this.provider = provider;
  }

  async readCString(
    handle: ProcessHandle,
    address: bigint,
    maxLen: number,
  ): Promise<string | null> {
    try {
      const buf = (await this.provider.readMemory(handle, address, maxLen)).data;
      const nullIdx = buf.indexOf(0);
      if (nullIdx < 0) return null;
      // latin1 is a 1:1 byte mapping; 'ascii' masks the high bit (0xC1 → 'A')
      // and would make non-ASCII garbage look printable.
      const str = buf.subarray(0, nullIdx).toString('latin1');
      // Validate it's printable ASCII
      if (/^[\x20-\x7E]+$/.test(str) && str.length >= 1) {
        return str;
      }
      return null;
    } catch {
      return null;
    }
  }

  fieldTypeToCType(type: FieldType, size: number): string {
    switch (type) {
      case 'int8':
        return 'int8_t';
      case 'uint8':
        return 'uint8_t';
      case 'int16':
        return 'int16_t';
      case 'uint16':
        return 'uint16_t';
      case 'int32':
        return 'int32_t';
      case 'uint32':
        return 'uint32_t';
      case 'int64':
        return 'int64_t';
      case 'uint64':
        return 'uint64_t';
      case 'float':
        return 'float';
      case 'double':
        return 'double';
      case 'pointer':
        return 'void*';
      case 'vtable_ptr':
        return 'void**';
      case 'string_ptr':
        return 'char*';
      case 'bool':
        return 'bool';
      case 'padding':
        return `uint8_t[${size}]`;
      case 'unknown':
        return `uint8_t[${size}]`;
      default:
        return `uint8_t[${size}]`;
    }
  }

  async getModuleEntries(
    pid: number,
  ): Promise<Map<string, { name: string; base: bigint; size: number }>> {
    const modules = new Map<string, { name: string; base: bigint; size: number }>();
    try {
      const result = await nativeMemoryManager.enumerateModules(pid);
      if (result.success && result.modules) {
        for (const mod of result.modules) {
          const base = BigInt(
            mod.baseAddress.startsWith('0x') ? mod.baseAddress : `0x${mod.baseAddress}`,
          );
          modules.set(mod.name.toLowerCase(), { name: mod.name, base, size: mod.size });
        }
      }
    } catch {
      // Best-effort
    }
    return modules;
  }

  resolveToModule(
    address: bigint,
    moduleMap: Map<string, { name: string; base: bigint; size: number }>,
  ): { module: string; offset: number } | null {
    for (const entry of moduleMap.values()) {
      if (address >= entry.base && address < entry.base + BigInt(entry.size)) {
        return { module: entry.name, offset: Number(address - entry.base) };
      }
    }
    return null;
  }

  isValidReadablePointer(handle: ProcessHandle, address: bigint): boolean {
    try {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) return false;
      return regionInfo.isReadable;
    } catch {
      return false;
    }
  }

  isValidExecutablePointer(handle: ProcessHandle, address: bigint): boolean {
    try {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) return false;
      return regionInfo.isReadable && regionInfo.isExecutable;
    } catch {
      return false;
    }
  }
}

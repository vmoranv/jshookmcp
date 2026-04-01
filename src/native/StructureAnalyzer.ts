/**
 * Structure Analyzer — heuristic memory structure inference.
 *
 * Analyzes memory at a given address to infer field types, detect vtables,
 * parse RTTI, and export C-style struct definitions.
 *
 * Uses PlatformMemoryAPI for cross-platform memory operations.
 *
 * @module StructureAnalyzer
 */

import {
  STRUCT_ANALYZE_DEFAULT_SIZE,
  STRUCT_VTABLE_MAX_FUNCTIONS,
  STRUCT_RTTI_MAX_STRING_LEN,
} from '@src/constants';
import type {
  InferredField,
  InferredStruct,
  VtableInfo,
  FieldType,
  StructureAnalysisOptions,
  CStructExport,
} from './StructureAnalyzer.types';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { nativeMemoryManager } from './NativeMemoryManager.impl';

export class StructureAnalyzer {
  private _provider: PlatformMemoryAPI | null = null;

  private get provider(): PlatformMemoryAPI {
    if (!this._provider) {
      this._provider = createPlatformProvider();
    }
    return this._provider;
  }

  /**
   * Infer the structure layout at a given address.
   */
  async analyzeStructure(
    pid: number,
    address: string,
    options?: StructureAnalysisOptions,
  ): Promise<InferredStruct> {
    const size = options?.size ?? STRUCT_ANALYZE_DEFAULT_SIZE;
    const baseAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);

    const handle = this.provider.openProcess(pid, false);
    try {
      const buf = this.provider.readMemory(handle, baseAddr, size).data;
      const fields: InferredField[] = [];
      let offset = 0;

      while (offset < size) {
        const remaining = size - offset;
        if (remaining < 1) break;

        const classification = this.classifyValue(buf, handle, baseAddr, offset, remaining);
        fields.push({
          offset,
          size: classification.size,
          type: classification.type,
          name: `field_0x${offset.toString(16).padStart(2, '0').toUpperCase()}`,
          value: classification.value,
          confidence: classification.confidence,
          notes: classification.notes,
        });

        offset += classification.size;
      }

      // Check first field for vtable
      let vtableAddress: string | undefined;
      let className: string | undefined;
      let baseClasses: string[] | undefined;

      if (fields.length > 0 && fields[0]!.type === 'vtable_ptr') {
        vtableAddress = fields[0]!.value;

        // Try RTTI parsing
        if (options?.parseRtti !== false && vtableAddress) {
          try {
            const rtti = await this.parseRtti(pid, vtableAddress, handle);
            if (rtti) {
              className = rtti.className;
              baseClasses = rtti.baseClasses;
            }
          } catch {
            // RTTI parsing is best-effort
          }
        }
      }

      return {
        baseAddress: `0x${baseAddr.toString(16).toUpperCase()}`,
        totalSize: size,
        fields,
        vtableAddress,
        className,
        baseClasses,
        timestamp: Date.now(),
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Parse vtable at given address.
   * A vtable is an array of function pointers in executable memory.
   */
  async parseVtable(pid: number, vtableAddress: string): Promise<VtableInfo> {
    const vtableAddr = BigInt(
      vtableAddress.startsWith('0x') ? vtableAddress : `0x${vtableAddress}`,
    );
    const handle = this.provider.openProcess(pid, false);

    try {
      const functions: VtableInfo['functions'] = [];
      const modules = await this.getModuleEntries(pid);

      for (let i = 0; i < STRUCT_VTABLE_MAX_FUNCTIONS; i++) {
        const ptrAddr = vtableAddr + BigInt(i * 8);
        let funcPtr: bigint;
        try {
          const buf = this.provider.readMemory(handle, ptrAddr, 8).data;
          funcPtr = buf.readBigUInt64LE(0);
        } catch {
          break;
        }

        // Each entry must point to executable memory
        if (!this.isValidExecutablePointer(handle, funcPtr)) break;

        const modInfo = this.resolveToModule(funcPtr, modules);
        functions.push({
          index: i,
          address: `0x${funcPtr.toString(16).toUpperCase()}`,
          module: modInfo?.module,
          moduleOffset: modInfo?.offset,
        });
      }

      // Try RTTI: vtable[-1] (8 bytes before vtable) on MSVC x64
      let rttiName: string | undefined;
      let baseClassList: string[] | undefined;
      try {
        const rtti = await this.parseRtti(pid, vtableAddress, handle);
        if (rtti) {
          rttiName = rtti.className;
          baseClassList = rtti.baseClasses;
        }
      } catch {
        // Best-effort
      }

      return {
        address: `0x${vtableAddr.toString(16).toUpperCase()}`,
        functionCount: functions.length,
        functions,
        rttiName,
        baseClasses: baseClassList,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Parse RTTI Complete Object Locator (MSVC x64 layout).
   *
   * vtable[-1] → RTTI COL:
   *   +0x00: signature (1 for x64)
   *   +0x04: offset
   *   +0x08: cdOffset
   *   +0x0C: typeDescriptorRVA
   *   +0x10: classDescriptorRVA
   *   +0x14: objectLocatorRVA
   *
   * TypeDescriptor (at moduleBase + typeDescriptorRVA):
   *   +0x00: pVFTable (pointer)
   *   +0x08: spare (pointer)
   *   +0x10: name (null-terminated mangled string)
   */
  async parseRtti(
    pid: number,
    vtableAddress: string,
    existingHandle?: ProcessHandle,
  ): Promise<{ className: string; baseClasses: string[] } | null> {
    const vtableAddr = BigInt(
      vtableAddress.startsWith('0x') ? vtableAddress : `0x${vtableAddress}`,
    );
    const ownHandle = !existingHandle;
    const handle = existingHandle ?? this.provider.openProcess(pid, false);

    try {
      // Read vtable[-1]: pointer to COL
      const colPtrBuf = this.provider.readMemory(handle, vtableAddr - 8n, 8).data;
      const colAddr = colPtrBuf.readBigUInt64LE(0);

      // Validate COL pointer
      if (!this.isValidReadablePointer(handle, colAddr)) return null;

      // Read COL
      const colBuf = this.provider.readMemory(handle, colAddr, 0x18).data;
      const signature = colBuf.readUInt32LE(0);

      // Signature must be 1 for x64
      if (signature !== 1) return null;

      const typeDescRVA = colBuf.readUInt32LE(0x0c);
      const classDescRVA = colBuf.readUInt32LE(0x10);
      const objectLocRVA = colBuf.readUInt32LE(0x14);

      // Calculate module base from objectLocatorRVA:
      // moduleBase = colAddr - objectLocatorRVA
      const moduleBase = colAddr - BigInt(objectLocRVA);

      // Read TypeDescriptor
      const typeDescAddr = moduleBase + BigInt(typeDescRVA);
      const className = this.readCString(handle, typeDescAddr + 0x10n, STRUCT_RTTI_MAX_STRING_LEN);
      if (!className) return null;

      // Demangle basic MSVC names: ".?AVClassName@@" → "ClassName"
      const demangled = this.demangleMsvcName(className);

      // Try to read class hierarchy
      const baseClasses: string[] = [];
      try {
        const classDescAddr = moduleBase + BigInt(classDescRVA);
        const classDescBuf = this.provider.readMemory(handle, classDescAddr, 0x10).data;
        const numBaseClasses = classDescBuf.readUInt32LE(0x08);
        const baseClassArrayRVA = classDescBuf.readUInt32LE(0x0c);

        if (numBaseClasses > 0 && numBaseClasses < 20) {
          const baseArrayAddr = moduleBase + BigInt(baseClassArrayRVA);
          const baseArrayBuf = this.provider.readMemory(
            handle,
            baseArrayAddr,
            numBaseClasses * 4,
          ).data;

          for (let i = 1; i < numBaseClasses; i++) {
            // Skip index 0 (self)
            const baseDescRVA = baseArrayBuf.readUInt32LE(i * 4);
            const baseDescAddr = moduleBase + BigInt(baseDescRVA);

            try {
              const baseDescBuf = this.provider.readMemory(handle, baseDescAddr, 0x08).data;
              const baseTypeDescRVA = baseDescBuf.readUInt32LE(0);
              const baseTypeDescAddr = moduleBase + BigInt(baseTypeDescRVA);
              const baseName = this.readCString(
                handle,
                baseTypeDescAddr + 0x10n,
                STRUCT_RTTI_MAX_STRING_LEN,
              );
              if (baseName) {
                baseClasses.push(this.demangleMsvcName(baseName));
              }
            } catch {
              break;
            }
          }
        }
      } catch {
        // Best-effort
      }

      return { className: demangled, baseClasses };
    } catch {
      return null;
    } finally {
      if (ownHandle) this.provider.closeProcess(handle);
    }
  }

  /**
   * Export an inferred struct as C-style definition.
   */
  exportToCStruct(structure: InferredStruct, name?: string): CStructExport {
    const structName = name ?? structure.className ?? 'UnknownStruct';
    const lines: string[] = [];

    lines.push(
      `struct ${structName} { // size: 0x${structure.totalSize.toString(16).toUpperCase()} (${structure.totalSize} bytes)`,
    );

    for (const field of structure.fields) {
      const cType = this.fieldTypeToCType(field.type, field.size);
      const offsetStr = `0x${field.offset.toString(16).padStart(2, '0').toUpperCase()}`;
      const comment = field.notes
        ? `// +${offsetStr} ${field.notes}`
        : `// +${offsetStr} = ${field.value}`;

      if (field.type === 'padding') {
        lines.push(`    uint8_t _pad_${field.offset.toString(16)}[${field.size}]; ${comment}`);
      } else {
        lines.push(`    ${cType} ${field.name}; ${comment}`);
      }
    }

    lines.push('};');

    const definition = lines.join('\n');
    return {
      name: structName,
      definition,
      size: structure.totalSize,
      fieldCount: structure.fields.filter((f) => f.type !== 'padding').length,
    };
  }

  /**
   * Compare two structure instances to find differing vs constant fields.
   */
  async compareInstances(
    pid: number,
    address1: string,
    address2: string,
    size?: number,
  ): Promise<{
    matching: InferredField[];
    differing: Array<{ offset: number; value1: string; value2: string; type: FieldType }>;
  }> {
    const analysisSize = size ?? STRUCT_ANALYZE_DEFAULT_SIZE;
    const [struct1, struct2] = await Promise.all([
      this.analyzeStructure(pid, address1, { size: analysisSize, parseRtti: false }),
      this.analyzeStructure(pid, address2, { size: analysisSize, parseRtti: false }),
    ]);

    const matching: InferredField[] = [];
    const differing: Array<{ offset: number; value1: string; value2: string; type: FieldType }> =
      [];

    // Align fields by offset
    const fieldMap2 = new Map(struct2.fields.map((f) => [f.offset, f]));

    for (const f1 of struct1.fields) {
      const f2 = fieldMap2.get(f1.offset);
      if (!f2) continue;

      if (f1.value === f2.value && f1.type === f2.type) {
        matching.push(f1);
      } else {
        differing.push({
          offset: f1.offset,
          value1: f1.value,
          value2: f2.value,
          type: f1.type,
        });
      }
    }

    return { matching, differing };
  }

  // ── Private Helpers ──

  /**
   * Classify the value at a given offset in the buffer.
   */
  private classifyValue(
    buf: Buffer,
    handle: ProcessHandle,
    _baseAddr: bigint,
    offset: number,
    remaining: number,
  ): { type: FieldType; size: number; value: string; confidence: number; notes?: string } {
    // Try 8-byte pointer first (most common in x64)
    if (remaining >= 8) {
      const val64 = buf.readBigUInt64LE(offset);

      // Check for vtable pointer (first field only)
      if (offset === 0 && val64 !== 0n) {
        if (this.isValidExecutablePointer(handle, val64)) {
          // Verify it's a vtable: check if the pointed-to location is also full of executable pointers
          try {
            const vtableCheck = this.provider.readMemory(handle, val64, 16).data;
            const firstFunc = vtableCheck.readBigUInt64LE(0);
            if (this.isValidExecutablePointer(handle, firstFunc)) {
              return {
                type: 'vtable_ptr',
                size: 8,
                value: `0x${val64.toString(16).toUpperCase()}`,
                confidence: 0.9,
                notes: 'likely vtable pointer (points to array of executable pointers)',
              };
            }
          } catch {
            // Not a vtable
          }
        }
      }

      // Check for valid pointer
      if (val64 !== 0n && val64 > 0x10000n && val64 < 0x7fffffffffffn) {
        if (this.isValidReadablePointer(handle, val64)) {
          // Check if it points to a string
          const str = this.readCString(handle, val64, 64);
          if (str && str.length >= 2) {
            return {
              type: 'string_ptr',
              size: 8,
              value: `0x${val64.toString(16).toUpperCase()} → "${str.slice(0, 32)}${str.length > 32 ? '...' : ''}"`,
              confidence: 0.75,
              notes: `string pointer: "${str.slice(0, 64)}"`,
            };
          }

          return {
            type: 'pointer',
            size: 8,
            value: `0x${val64.toString(16).toUpperCase()}`,
            confidence: 0.7,
            notes: 'valid pointer to readable memory',
          };
        }
      }
    }

    // Try 4-byte values
    if (remaining >= 4) {
      const val32u = buf.readUInt32LE(offset);
      const val32s = buf.readInt32LE(offset);
      const valFloat = buf.readFloatLE(offset);

      // All zeros → padding
      if (val32u === 0 && remaining >= 8 && buf.readUInt32LE(offset + 4) === 0) {
        // Count consecutive zero bytes
        let zeroLen = 0;
        for (let i = offset; i < buf.length && buf[i] === 0; i++) zeroLen++;
        const padSize = Math.min(zeroLen, remaining);
        // Align to 8 (since we only enter if remaining >= 8 and zeroLen >= 8)
        const alignedPad = padSize & ~7;
        return {
          type: 'padding',
          size: alignedPad,
          value: `0x${'00'.repeat(Math.min(alignedPad, 8))}`,
          confidence: 0.6,
        };
      }

      // Single zero → might be int32 with value 0 or bool
      if (val32u === 0) {
        return {
          type: 'int32',
          size: 4,
          value: '0',
          confidence: 0.4,
          notes: 'zero value — could be int, bool, or padding',
        };
      }

      // Boolean check (0 or 1)
      if (val32u === 1) {
        return {
          type: 'bool',
          size: 4,
          value: 'true',
          confidence: 0.5,
          notes: 'value is 1 — could be boolean',
        };
      }

      // Float check: is it a reasonable float?
      if (
        isFinite(valFloat) &&
        !isNaN(valFloat) &&
        Math.abs(valFloat) > 1e-10 &&
        Math.abs(valFloat) < 1e8
      ) {
        // Check if it looks more like a float than an integer
        const intLooksReasonable = val32u > 0 && val32u < 100_000;
        const floatHasDecimals = Math.abs(valFloat - Math.round(valFloat)) > 0.001;

        if (floatHasDecimals || (!intLooksReasonable && Math.abs(valFloat) < 10000)) {
          return {
            type: 'float',
            size: 4,
            value: valFloat.toFixed(6),
            confidence: floatHasDecimals ? 0.8 : 0.5,
            notes: floatHasDecimals
              ? 'IEEE 754 float with fractional part'
              : 'could be float or int',
          };
        }
      }

      // Reasonable integer range
      if (val32u < 0x80000000) {
        return {
          type: 'int32',
          size: 4,
          value: val32s.toString(),
          confidence: 0.6,
        };
      }

      return {
        type: 'uint32',
        size: 4,
        value: val32u.toString(),
        confidence: 0.5,
      };
    }

    // 2-byte value
    if (remaining >= 2) {
      const val16 = buf.readUInt16LE(offset);
      return {
        type: 'uint16',
        size: 2,
        value: val16.toString(),
        confidence: 0.4,
      };
    }

    // 1-byte value
    const val8 = buf.readUInt8(offset);
    return {
      type: 'uint8',
      size: 1,
      value: val8.toString(),
      confidence: 0.3,
    };
  }

  private isValidReadablePointer(handle: ProcessHandle, address: bigint): boolean {
    try {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) return false;
      return regionInfo.isReadable;
    } catch {
      return false;
    }
  }

  private isValidExecutablePointer(handle: ProcessHandle, address: bigint): boolean {
    try {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) return false;
      return regionInfo.isReadable && regionInfo.isExecutable;
    } catch {
      return false;
    }
  }

  private readCString(handle: ProcessHandle, address: bigint, maxLen: number): string | null {
    try {
      const buf = this.provider.readMemory(handle, address, maxLen).data;
      const nullIdx = buf.indexOf(0);
      if (nullIdx < 0) return null;
      const str = buf.subarray(0, nullIdx).toString('ascii');
      // Validate it's printable ASCII
      if (/^[\x20-\x7E]+$/.test(str) && str.length >= 1) {
        return str;
      }
      return null;
    } catch {
      return null;
    }
  }

  private demangleMsvcName(name: string): string {
    // ".?AVClassName@@" → "ClassName"
    // ".?AUStructName@@" → "StructName"
    const match = name.match(/\.?\?A[VU](.+?)@@/);
    if (match) return match[1]!;

    // ".?AW4EnumName@@" → "EnumName" (enums)
    const enumMatch = name.match(/\.?\?AW4(.+?)@@/);
    if (enumMatch) return enumMatch[1]!;

    // Remove leading "." and trailing "@@"
    return name.replace(/^\./, '').replace(/@@$/, '');
  }

  private fieldTypeToCType(type: FieldType, size: number): string {
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

  private async getModuleEntries(
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

  private resolveToModule(
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
}

export const structureAnalyzer = new StructureAnalyzer();

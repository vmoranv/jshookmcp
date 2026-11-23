/**
 * Field Classifier — heuristic value classification for memory structure analysis.
 *
 * Analyzes raw memory bytes to infer field types (vtable pointer, pointer, string, int, float, padding).
 *
 * @module StructureAnalyzer.FieldClassifier
 */

import type { FieldType } from './StructureAnalyzer.types';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';

interface FieldClassification {
  type: FieldType;
  size: number;
  value: string;
  confidence: number;
  notes?: string;
}

export class FieldClassifier {
  private provider: PlatformMemoryAPI;
  private readCString: (
    handle: ProcessHandle,
    address: bigint,
    maxLen: number,
  ) => Promise<string | null>;
  private isValidReadablePointer: (handle: ProcessHandle, address: bigint) => boolean;
  private isValidExecutablePointer: (handle: ProcessHandle, address: bigint) => boolean;
  constructor(
    provider: PlatformMemoryAPI,
    readCString: (handle: ProcessHandle, address: bigint, maxLen: number) => Promise<string | null>,
    isValidReadablePointer: (handle: ProcessHandle, address: bigint) => boolean,
    isValidExecutablePointer: (handle: ProcessHandle, address: bigint) => boolean,
  ) {
    this.provider = provider;
    this.readCString = readCString;
    this.isValidReadablePointer = isValidReadablePointer;
    this.isValidExecutablePointer = isValidExecutablePointer;
  }

  /**
   * Classify the value at a given offset in the buffer.
   */
  async classifyValue(
    buf: Buffer,
    handle: ProcessHandle,
    offset: number,
    remaining: number,
  ): Promise<FieldClassification> {
    // Try 8-byte pointer first (most common in x64)
    if (remaining >= 8) {
      const val64 = buf.readBigUInt64LE(offset);

      // Check for vtable pointer (first field only)
      const vtableCheck = await this.checkVtablePointer(handle, offset, val64);
      if (vtableCheck) return vtableCheck;

      // Check for valid pointer
      const pointerCheck = await this.checkPointer(handle, val64);
      if (pointerCheck) return pointerCheck;
    }

    // Try 4-byte values
    if (remaining >= 4) {
      const val32u = buf.readUInt32LE(offset);
      const val32s = buf.readInt32LE(offset);
      const valFloat = buf.readFloatLE(offset);

      // All zeros → padding
      const paddingCheck = this.checkPadding(buf, offset, remaining, val32u);
      if (paddingCheck) return paddingCheck;

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
      const boolCheck = this.checkBool(val32u);
      if (boolCheck) return boolCheck;

      // Float check
      const floatCheck = this.checkFloat(valFloat, val32u);
      if (floatCheck) return floatCheck;

      // Reasonable integer range
      return this.checkInt32(val32u, val32s);
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

  private async checkVtablePointer(
    handle: ProcessHandle,
    offset: number,
    val64: bigint,
  ): Promise<FieldClassification | null> {
    if (offset !== 0 || val64 === 0n) return null;

    // The vtable itself lives in read-only data (.rdata/.rodata) — only its
    // entries must be executable.
    if (!this.isValidReadablePointer(handle, val64)) return null;

    // Verify it's a vtable: check if the pointed-to location is also full of executable pointers
    try {
      const vtableCheck = (await this.provider.readMemory(handle, val64, 16)).data;
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
    return null;
  }

  private async checkPointer(
    handle: ProcessHandle,
    val64: bigint,
  ): Promise<FieldClassification | null> {
    if (val64 === 0n || val64 <= 0x10000n || val64 >= 0x7fffffffffffn) return null;

    if (!this.isValidReadablePointer(handle, val64)) return null;

    // Check if it points to a string
    const stringCheck = await this.checkStringPointer(handle, val64);
    if (stringCheck) return stringCheck;

    return {
      type: 'pointer',
      size: 8,
      value: `0x${val64.toString(16).toUpperCase()}`,
      confidence: 0.7,
      notes: 'valid pointer to readable memory',
    };
  }

  private async checkStringPointer(
    handle: ProcessHandle,
    val64: bigint,
  ): Promise<FieldClassification | null> {
    const str = await this.readCString(handle, val64, 64);
    if (!str || str.length < 2) return null;

    return {
      type: 'string_ptr',
      size: 8,
      value: `0x${val64.toString(16).toUpperCase()} → "${str.slice(0, 32)}${str.length > 32 ? '...' : ''}"`,
      confidence: 0.75,
      notes: `string pointer: "${str.slice(0, 64)}"`,
    };
  }

  private checkPadding(
    buf: Buffer,
    offset: number,
    remaining: number,
    val32u: number,
  ): FieldClassification | null {
    if (val32u !== 0 || remaining < 8 || buf.readUInt32LE(offset + 4) !== 0) return null;

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

  private checkBool(val32u: number): FieldClassification | null {
    if (val32u !== 1) return null;

    return {
      type: 'bool',
      size: 4,
      value: 'true',
      confidence: 0.5,
      notes: 'value is 1 — could be boolean',
    };
  }

  private checkFloat(valFloat: number, val32u: number): FieldClassification | null {
    if (
      !isFinite(valFloat) ||
      isNaN(valFloat) ||
      Math.abs(valFloat) <= 1e-10 ||
      Math.abs(valFloat) >= 1e8
    ) {
      return null;
    }

    // Check if it looks more like a float than an integer
    const intLooksReasonable = val32u > 0 && val32u < 100_000;
    const floatHasDecimals = Math.abs(valFloat - Math.round(valFloat)) > 0.001;

    if (floatHasDecimals || (!intLooksReasonable && Math.abs(valFloat) < 10000)) {
      return {
        type: 'float',
        size: 4,
        value: valFloat.toFixed(6),
        confidence: floatHasDecimals ? 0.8 : 0.5,
        notes: floatHasDecimals ? 'IEEE 754 float with fractional part' : 'could be float or int',
      };
    }
    return null;
  }

  private checkInt32(val32u: number, val32s: number): FieldClassification {
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
}

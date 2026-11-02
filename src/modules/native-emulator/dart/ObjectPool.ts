/**
 * ObjectPool — Dart constant pool for indirect calls and constant references.
 *
 * Every Dart function has an associated ObjectPool that holds:
 *  - Function pointers (for indirect calls)
 *  - Constant objects (strings, numbers, type objects)
 *  - Native function addresses
 *  - External symbols
 *
 * The Dart compiler emits code like:
 *  ```asm
 *  LDR x8, [PP, #0x18]    // Load entry 3 from ObjectPool (PP is x27)
 *  BLR x8                  // Call the loaded address
 *  ```
 *
 * This module parses ObjectPool structures and provides lookup helpers
 * that the LoadStore decoder can use to resolve PP-relative loads.
 *
 * References:
 *  - Dart SDK: `runtime/vm/object_pool.h`
 *  - Dart SDK: `runtime/vm/object_pool.cc`
 *  - blutter: ObjectPool deserialization
 */

import { ToolError } from '@errors/ToolError';

/** ObjectPool entry types. */
export type ObjectPoolEntryType = 'object' | 'immediate' | 'native' | 'external';

/** A single entry in an ObjectPool. */
export interface ObjectPoolEntry {
  /** Entry type identifier. */
  type: ObjectPoolEntryType;
  /** The value stored in this entry (address, constant, or immediate). */
  value: bigint;
  /** Function/symbol name if available (for debugging/analysis). */
  name?: string;
}

/**
 * ObjectPool — Dart function constant pool.
 *
 * Layout (simplified, real format is version-dependent):
 * ```
 * +0x00: length (4 bytes) — number of entries
 * +0x04: padding (4 bytes)
 * +0x08: entries (8 bytes each)
 * ```
 *
 * Each entry is an 8-byte slot that can hold:
 *  - A tagged object pointer (Smi or heap object)
 *  - An immediate value (raw integer)
 *  - A native function address (PC value)
 *  - An external symbol address
 */
export class ObjectPool {
  private readonly baseAddress: bigint;
  private readonly entries: ObjectPoolEntry[];
  private readonly length: number;

  /**
   * Parse an ObjectPool from raw bytes.
   *
   * @param data - Raw ObjectPool bytes (must include header + all entries)
   * @param baseAddress - Base address where this pool is mapped (for address resolution)
   */
  constructor(data: Uint8Array, baseAddress: bigint = 0n) {
    this.baseAddress = baseAddress;
    if (data.length < 8) {
      throw new ToolError('VALIDATION', 'ObjectPool data too small (need >= 8 bytes for header)', {
        details: { dataSize: data.length },
      });
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // +0x00: length (4 bytes, little-endian)
    this.length = view.getUint32(0, true);

    if (data.length < 8 + this.length * 8) {
      throw new ToolError(
        'VALIDATION',
        `ObjectPool header claims ${this.length} entries but data only has ${data.length} bytes`,
        {
          details: { claimedLength: this.length, dataSize: data.length },
        },
      );
    }

    // Parse entries
    this.entries = [];
    for (let i = 0; i < this.length; i++) {
      const offset = 8 + i * 8;
      const value = view.getBigUint64(offset, true);

      // Type inference heuristic (simplified):
      // - If LSB=1, it's a tagged object
      // - If LSB=0 and value is large, it's likely a code address
      // - Otherwise, it's an immediate value
      const type = this.inferEntryType(value);

      this.entries.push({ type, value });
    }
  }

  /**
   * Look up an entry by byte offset.
   * Dart code emits `LDR x, [PP, #offset]` where offset is 0x00, 0x08, 0x10, etc.
   *
   * @param offset - Byte offset from the pool base (must be 8-byte aligned)
   * @returns The value stored at that offset
   */
  lookup(offset: number): bigint {
    if (offset < 0 || offset % 8 !== 0) {
      throw new ToolError(
        'VALIDATION',
        `Invalid ObjectPool offset: ${offset} (must be >= 0 and 8-byte aligned)`,
      );
    }

    const index = offset / 8;
    if (index >= this.entries.length) {
      throw new ToolError(
        'VALIDATION',
        `ObjectPool index out of bounds: ${index} (pool has ${this.entries.length} entries)`,
      );
    }

    const entry = this.entries[index];
    if (!entry) {
      throw new ToolError('RUNTIME', `ObjectPool entry at index ${index} is undefined`);
    }

    return entry.value;
  }

  /**
   * Get the full entry (type + value + name) at the given offset.
   */
  getEntry(offset: number): ObjectPoolEntry {
    const index = offset / 8;
    if (index < 0 || index >= this.entries.length) {
      throw new ToolError('VALIDATION', `ObjectPool index out of bounds: ${index}`);
    }
    const entry = this.entries[index];
    if (!entry) {
      throw new ToolError('RUNTIME', `ObjectPool entry at index ${index} is undefined`);
    }
    return entry;
  }

  /**
   * Get all entries (for inspection/debugging).
   */
  getAllEntries(): readonly ObjectPoolEntry[] {
    return this.entries;
  }

  /**
   * Get the number of entries in this pool.
   */
  getLength(): number {
    return this.length;
  }

  /**
   * Annotate an entry with a symbolic name (for debugging).
   * Called when the analyzer resolves a function name for a code pointer.
   */
  setEntryName(offset: number, name: string): void {
    const index = offset / 8;
    const entry = this.entries[index];
    if (entry) {
      entry.name = name;
    }
  }

  /**
   * Infer entry type from its value.
   * Heuristic-based (real Dart snapshots encode type metadata separately).
   */
  private inferEntryType(value: bigint): ObjectPoolEntryType {
    // Tagged pointer (LSB=1 or LSB=0 for Smi)
    if ((value & 0x1n) === 0x1n) {
      return 'object'; // Heap object
    }
    if ((value & 0x1n) === 0x0n && value !== 0n && value < 0x100000000n) {
      return 'object'; // Likely a Smi
    }

    // Large value in executable range (likely a code address)
    if (value > 0x10000000n && value < 0xffffffffffffffffn) {
      return 'native';
    }

    // External symbol (address in a known range)
    if (value > 0x1000n && value < 0x10000000n) {
      return 'external';
    }

    // Default to immediate
    return 'immediate';
  }

  /**
   * Check if an offset is valid (within bounds).
   */
  isValidOffset(offset: number): boolean {
    return offset >= 0 && offset % 8 === 0 && offset / 8 < this.entries.length;
  }

  /**
   * Format the pool for debugging (returns a human-readable string).
   */
  toString(): string {
    const lines = [`ObjectPool @ 0x${this.baseAddress.toString(16)} (${this.length} entries):`];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry) continue;
      const offset = i * 8;
      const name = entry.name ? ` // ${entry.name}` : '';
      lines.push(
        `  [0x${offset.toString(16).padStart(4, '0')}] ${entry.type.padEnd(10)} 0x${entry.value.toString(16)}${name}`,
      );
    }
    return lines.join('\n');
  }
}

/**
 * ObjectPoolRegistry — manages multiple ObjectPools for different Dart functions.
 *
 * Each Dart function has its own ObjectPool. When the CPU executes a function,
 * the PP register (x27) points to that function's pool. This registry tracks
 * all pools and provides lookups by address.
 */
export class ObjectPoolRegistry {
  private readonly pools = new Map<bigint, ObjectPool>();

  /**
   * Register an ObjectPool at a specific address.
   *
   * @param address - Base address where the pool is mapped in memory
   * @param data - Raw ObjectPool bytes
   */
  register(address: bigint, data: Uint8Array): ObjectPool {
    const pool = new ObjectPool(data, address);
    this.pools.set(address, pool);
    return pool;
  }

  /**
   * Get an ObjectPool by its base address.
   * Returns undefined if not registered.
   */
  get(address: bigint): ObjectPool | undefined {
    return this.pools.get(address);
  }

  /**
   * Check if a pool is registered at the given address.
   */
  has(address: bigint): boolean {
    return this.pools.has(address);
  }

  /**
   * Get all registered pools.
   */
  getAllPools(): Map<bigint, ObjectPool> {
    return new Map(this.pools);
  }

  /**
   * Clear all registered pools.
   */
  clear(): void {
    this.pools.clear();
  }

  /**
   * Get the number of registered pools.
   */
  size(): number {
    return this.pools.size;
  }
}

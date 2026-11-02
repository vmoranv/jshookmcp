/**
 * DartRuntime — Dart VM calling convention and runtime state management.
 *
 * Implements the Dart-specific register assignments, tagged pointer model,
 * and runtime object layout required to execute Dart AOT code on the ARM64
 * emulator.
 *
 * Dart VM register conventions (ARM64 ABI):
 *  - x15 (THR)  : Thread pointer — points to the current isolate's Thread object
 *  - x27 (PP)   : ObjectPool pointer — constant pool for the current function
 *  - x26 (NULL) : Null object — always holds the canonical Dart `null` object
 *  - x28 (HEAP) : Heap base — base address for compressed pointers
 *
 * Tagged pointer model:
 *  - Smi (Small Integer): LSB=0, value = ptr >> 1
 *  - Heap object: LSB=1, address = ptr & ~0x1
 *
 * References:
 *  - Dart SDK: `runtime/vm/constants_arm64.h` (register assignments)
 *  - Dart SDK: `runtime/vm/raw_object.h` (tagged pointer layout)
 *  - Dart SDK: `runtime/vm/thread.h` (Thread structure)
 */

import type { CpuEngine } from '../CpuEngine';

/** Dart-specific register indices (ARM64). */
export const DART_THR = 15; // x15 = Thread pointer
export const DART_PP = 27; // x27 = ObjectPool pointer
export const DART_NULL = 26; // x26 = NULL object
export const DART_HEAP_BASE = 28; // x28 = Heap base

/** Dart runtime register state. */
export interface DartRegisters {
  /** Thread pointer (THR, x15) — points to isolate Thread object. */
  thread: bigint;
  /** ObjectPool pointer (PP, x27) — function's constant pool. */
  objectPool: bigint;
  /** Null object (NULL, x26) — canonical Dart `null`. */
  nullObject: bigint;
  /** Heap base (HEAP_BASE, x28) — used for compressed pointers. */
  heapBase: bigint;
}

/**
 * Remove the heap object tag from a pointer.
 * Dart heap pointers have LSB=1; this clears it to get the real address.
 */
export function detagPointer(ptr: bigint): bigint {
  return ptr & ~0x1n;
}

/**
 * Check if a pointer is a Smi (Small Integer).
 * Smi values have LSB=0 (no tag bit set).
 */
export function isSmi(ptr: bigint): boolean {
  return (ptr & 0x1n) === 0n;
}

/**
 * Extract the integer value from a Smi.
 * Dart stores Smis as (value << 1), so we right-shift to restore the value.
 */
export function smiValue(smi: bigint): bigint {
  return smi >> 1n;
}

/**
 * Convert an integer value to a Smi representation.
 * Left-shift by 1 and ensure LSB=0 (Smi tag).
 */
export function pointerToSmi(value: bigint): bigint {
  return value << 1n;
}

/**
 * Check if a pointer is a heap object (LSB=1).
 */
export function isHeapObject(ptr: bigint): boolean {
  return (ptr & 0x1n) === 0x1n;
}

/**
 * Tag a raw pointer as a heap object (set LSB=1).
 */
export function tagAsHeapObject(addr: bigint): bigint {
  return addr | 0x1n;
}

/**
 * Dart runtime context — extends CpuEngine with Dart-specific state.
 *
 * This class acts as a facade that:
 *  1. Stores Dart runtime register values (THR, PP, NULL, HEAP_BASE)
 *  2. Provides helpers for tagged pointer manipulation
 *  3. Intercepts register reads/writes to maintain Dart invariants
 *
 * Usage:
 *  ```ts
 *  const runtime = new DartRuntime(cpuEngine);
 *  runtime.initializeRuntime(thread, pool, nullObj, heapBase);
 *  // Now execute Dart code via cpuEngine.callSymbol(...)
 *  ```
 */
export class DartRuntime {
  private readonly cpu: CpuEngine;
  private dartThread: bigint = 0n;
  private dartObjectPool: bigint = 0n;
  private dartNullObject: bigint = 0n;
  private dartHeapBase: bigint = 0n;

  constructor(cpu: CpuEngine) {
    this.cpu = cpu;
  }

  /**
   * Initialize Dart runtime state.
   * Must be called before executing any Dart code.
   *
   * @param thread - Address of the Dart Thread object (x15)
   * @param pool - Address of the ObjectPool (x27)
   * @param nullObj - Address of the canonical null object (x26)
   * @param heapBase - Heap base address (x28)
   */
  initializeRuntime(thread: bigint, pool: bigint, nullObj: bigint, heapBase: bigint): void {
    this.dartThread = thread;
    this.dartObjectPool = pool;
    this.dartNullObject = nullObj;
    this.dartHeapBase = heapBase;

    // Set Dart-specific registers in the CPU
    this.cpu.writeGpr(DART_THR, thread);
    this.cpu.writeGpr(DART_PP, pool);
    this.cpu.writeGpr(DART_NULL, nullObj);
    this.cpu.writeGpr(DART_HEAP_BASE, heapBase);
  }

  /**
   * Get current Dart runtime register state.
   */
  getRegisters(): DartRegisters {
    return {
      thread: this.dartThread,
      objectPool: this.dartObjectPool,
      nullObject: this.dartNullObject,
      heapBase: this.dartHeapBase,
    };
  }

  /**
   * Update the ObjectPool pointer (PP, x27).
   * Called when entering a new Dart function with a different pool.
   */
  setObjectPool(pool: bigint): void {
    this.dartObjectPool = pool;
    this.cpu.writeGpr(DART_PP, pool);
  }

  /**
   * Read a Dart-specific register.
   * Returns the live CPU register value for THR/PP/NULL/HEAP_BASE. The
   * JS-side mirrors (this.dartThread & co.) are initialisation state only —
   * once guest code executes, the CPU register file is the source of truth
   * and the mirrors would go stale.
   */
  readDartRegister(reg: number): bigint | undefined {
    if (!this.isDartRegister(reg)) return undefined;
    return this.cpu.readGpr(reg);
  }

  /**
   * Check if a register is a Dart-specific register.
   */
  isDartRegister(reg: number): boolean {
    return reg === DART_THR || reg === DART_PP || reg === DART_NULL || reg === DART_HEAP_BASE;
  }

  /**
   * Helper: decode a Dart value (Smi or heap object).
   * Returns { type: 'smi', value } or { type: 'object', address }.
   */
  decodeValue(ptr: bigint): { type: 'smi'; value: bigint } | { type: 'object'; address: bigint } {
    if (isSmi(ptr)) {
      return { type: 'smi', value: smiValue(ptr) };
    }
    return { type: 'object', address: detagPointer(ptr) };
  }

  /**
   * Helper: read a Dart object field at the given offset.
   * Assumes the object pointer is already detagged.
   */
  readObjectField(objectAddr: bigint, offset: number): bigint {
    const addr = Number(objectAddr) + offset;
    const bytes = this.cpu.readMemory(addr, 8);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return view.getBigUint64(0, true);
  }

  /**
   * Helper: check if a value is the Dart null object.
   */
  isNull(ptr: bigint): boolean {
    return ptr === this.dartNullObject;
  }

  /**
   * Reset runtime state (for testing or reinitialization).
   */
  reset(): void {
    this.dartThread = 0n;
    this.dartObjectPool = 0n;
    this.dartNullObject = 0n;
    this.dartHeapBase = 0n;
  }
}

/**
 * Standalone helper: format a Dart value for debugging.
 * Returns a human-readable string representation.
 */
export function formatDartValue(ptr: bigint): string {
  if (ptr === 0n) return 'nullptr';
  if (isSmi(ptr)) {
    const value = smiValue(ptr);
    return `Smi(${value})`;
  }
  const addr = detagPointer(ptr);
  return `HeapObject(0x${addr.toString(16)})`;
}

/**
 * Standalone helper: validate Dart pointer alignment.
 * Heap objects must be 8-byte aligned (after detagging).
 */
export function isValidHeapPointer(ptr: bigint): boolean {
  if (!isHeapObject(ptr)) return false;
  const addr = detagPointer(ptr);
  return (addr & 0x7n) === 0n; // 8-byte aligned
}

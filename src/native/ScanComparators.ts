/**
 * Scan Comparators — typed value reading and comparison for iterative memory scanning.
 *
 * Implements all 10 comparison modes used by the scan engine:
 * exact, unknown_initial, changed, unchanged, increased, decreased,
 * greater_than, less_than, between, not_equal.
 *
 * Monomorphic specialization: instead of a single polymorphic compareScanValues
 * that switches on valueType every call, we pre-build a typed comparator for
 * each valueType so V8 TurboFan sees monomorphic (single-shape) hot paths.
 *
 * @module ScanComparators
 */

import type { ScanCompareMode, ScanValueType } from './NativeMemoryManager.types';

const FLOAT_EPSILON = 1e-6;
const DOUBLE_EPSILON = 1e-12;

/**
 * Return the byte width for a given scan value type.
 */
export function getValueSize(type: ScanValueType): number {
  switch (type) {
    case 'byte':
    case 'int8':
      return 1;
    case 'int16':
    case 'uint16':
      return 2;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'int64':
    case 'uint64':
    case 'double':
    case 'pointer':
      return 8;
    case 'hex':
    case 'string':
      return 0; // variable length
    default:
      return 4;
  }
}

/**
 * Return the natural alignment for a given value type.
 */
export function getDefaultAlignment(type: ScanValueType): number {
  switch (type) {
    case 'byte':
    case 'int8':
      return 1;
    case 'int16':
    case 'uint16':
      return 2;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'int64':
    case 'uint64':
    case 'double':
    case 'pointer':
      return 8;
    default:
      return 1;
  }
}

// ── Monomorphic typed readers ──────────────────────────────────────────

type NumberReader = (buf: Buffer) => number;
type BigIntReader = (buf: Buffer) => bigint;
type TypedReader = NumberReader | BigIntReader;

function makeReader(type: ScanValueType): TypedReader {
  switch (type) {
    case 'byte':
      return (buf: Buffer) => buf.readUInt8(0);
    case 'int8':
      return (buf: Buffer) => buf.readInt8(0);
    case 'int16':
      return (buf: Buffer) => buf.readInt16LE(0);
    case 'uint16':
      return (buf: Buffer) => buf.readUInt16LE(0);
    case 'int32':
      return (buf: Buffer) => buf.readInt32LE(0);
    case 'uint32':
      return (buf: Buffer) => buf.readUInt32LE(0);
    case 'int64':
      return (buf: Buffer) => buf.readBigInt64LE(0);
    case 'uint64':
    case 'pointer':
      return (buf: Buffer) => buf.readBigUInt64LE(0);
    case 'float':
      return (buf: Buffer) => buf.readFloatLE(0);
    case 'double':
      return (buf: Buffer) => buf.readDoubleLE(0);
    default:
      return (buf: Buffer) => buf.readInt32LE(0);
  }
}

// ── Monomorphic approximate equality ───────────────────────────────────

function makeApproxEqual(type: ScanValueType): (a: number | bigint, b: number | bigint) => boolean {
  if (type === 'float') {
    return (a: number | bigint, b: number | bigint) =>
      Math.abs(Number(a) - Number(b)) < FLOAT_EPSILON;
  }
  if (type === 'double') {
    return (a: number | bigint, b: number | bigint) =>
      Math.abs(Number(a) - Number(b)) < DOUBLE_EPSILON;
  }
  // Integer types — bigint comparison when both are bigint, else numeric
  const isBigIntType = type === 'int64' || type === 'uint64' || type === 'pointer';
  if (isBigIntType) {
    return (a: number | bigint, b: number | bigint) => a === b;
  }
  return (a: number | bigint, b: number | bigint) => Number(a) === Number(b);
}

// ── Monomorphic comparator factory ─────────────────────────────────────

type ScanComparator = (
  current: Buffer,
  previous: Buffer | null,
  target: Buffer | null,
  target2: Buffer | null,
) => boolean;

function makeComparator(mode: ScanCompareMode, type: ScanValueType): ScanComparator {
  const read = makeReader(type);
  const approxEq = makeApproxEqual(type);
  const isBigIntType = type === 'int64' || type === 'uint64' || type === 'pointer';

  const compare = isBigIntType
    ? (a: number | bigint, b: number | bigint): number => {
        const ba = BigInt(a as bigint);
        const bb = BigInt(b as bigint);
        return ba < bb ? -1 : ba > bb ? 1 : 0;
      }
    : (a: number | bigint, b: number | bigint): number => Number(a) - Number(b);

  switch (mode) {
    case 'exact':
      return (cur, _prev, tgt, _tgt2) => {
        if (!tgt) return false;
        return approxEq(read(cur), read(tgt));
      };
    case 'unknown_initial':
      return () => true;
    case 'changed':
      return (cur, prev, _tgt, _tgt2) => {
        if (!prev) return false;
        return !approxEq(read(cur), read(prev));
      };
    case 'unchanged':
      return (cur, prev, _tgt, _tgt2) => {
        if (!prev) return true;
        return approxEq(read(cur), read(prev));
      };
    case 'increased':
      return (cur, prev, _tgt, _tgt2) => {
        if (!prev) return false;
        return compare(read(cur), read(prev)) > 0;
      };
    case 'decreased':
      return (cur, prev, _tgt, _tgt2) => {
        if (!prev) return false;
        return compare(read(cur), read(prev)) < 0;
      };
    case 'greater_than':
      return (cur, _prev, tgt, _tgt2) => {
        if (!tgt) return false;
        return compare(read(cur), read(tgt)) > 0;
      };
    case 'less_than':
      return (cur, _prev, tgt, _tgt2) => {
        if (!tgt) return false;
        return compare(read(cur), read(tgt)) < 0;
      };
    case 'between':
      return (cur, _prev, tgt, tgt2) => {
        if (!tgt || !tgt2) return false;
        return compare(read(cur), read(tgt)) >= 0 && compare(read(cur), read(tgt2)) <= 0;
      };
    case 'not_equal':
      return (cur, _prev, tgt, _tgt2) => {
        if (!tgt) return false;
        return !approxEq(read(cur), read(tgt));
      };
    default:
      return () => false;
  }
}

// ── Comparator cache ───────────────────────────────────────────────────

const comparatorCache = new Map<string, ScanComparator>();

function getComparator(mode: ScanCompareMode, valueType: ScanValueType): ScanComparator {
  const key = `${mode}:${valueType}`;
  let comp = comparatorCache.get(key);
  if (!comp) {
    comp = makeComparator(mode, valueType);
    comparatorCache.set(key, comp);
  }
  return comp;
}

// ── Public API (backward compatible) ───────────────────────────────────

/**
 * Read a typed numeric value from a buffer at offset 0.
 */
export function readTypedValue(buf: Buffer, type: ScanValueType): number | bigint {
  return makeReader(type)(buf);
}

/**
 * Compare scan values according to the specified mode.
 *
 * Dispatches to a monomorphic specialist comparator that is cached per
 * (mode, valueType) pair. This avoids per-call switch dispatch on valueType
 * in the hot scan loop, allowing V8 TurboFan to inline and optimize the
 * typed read + compare path.
 */
export function compareScanValues(
  current: Buffer,
  previous: Buffer | null,
  target: Buffer | null,
  target2: Buffer | null,
  mode: ScanCompareMode,
  valueType: ScanValueType,
): boolean {
  return getComparator(mode, valueType)(current, previous, target, target2);
}

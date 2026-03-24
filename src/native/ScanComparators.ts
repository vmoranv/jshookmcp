/**
 * Scan Comparators — typed value reading and comparison for iterative memory scanning.
 *
 * Implements all 10 comparison modes used by the scan engine:
 * exact, unknown_initial, changed, unchanged, increased, decreased,
 * greater_than, less_than, between, not_equal.
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

/**
 * Read a typed numeric value from a buffer at offset 0.
 */
export function readTypedValue(buf: Buffer, type: ScanValueType): number | bigint {
  switch (type) {
    case 'byte':
      return buf.readUInt8(0);
    case 'int8':
      return buf.readInt8(0);
    case 'int16':
      return buf.readInt16LE(0);
    case 'uint16':
      return buf.readUInt16LE(0);
    case 'int32':
      return buf.readInt32LE(0);
    case 'uint32':
      return buf.readUInt32LE(0);
    case 'int64':
      return buf.readBigInt64LE(0);
    case 'uint64':
    case 'pointer':
      return buf.readBigUInt64LE(0);
    case 'float':
      return buf.readFloatLE(0);
    case 'double':
      return buf.readDoubleLE(0);
    default:
      return buf.readInt32LE(0);
  }
}

/**
 * Check if two numeric values are approximately equal, using epsilon for floats.
 */
function approxEqual(a: number | bigint, b: number | bigint, type: ScanValueType): boolean {
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a === b;
  }
  const na = Number(a);
  const nb = Number(b);
  if (type === 'float') {
    return Math.abs(na - nb) < FLOAT_EPSILON;
  }
  if (type === 'double') {
    return Math.abs(na - nb) < DOUBLE_EPSILON;
  }
  return na === nb;
}

/**
 * Compare a numeric value against another for ordering.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareValues(a: number | bigint, b: number | bigint): number {
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  return Number(a) - Number(b);
}

/**
 * Compare scan values according to the specified mode.
 *
 * @param current  - Current value buffer read from memory
 * @param previous - Previous value buffer from last scan (null on first scan)
 * @param target   - Target value buffer for exact/greater/less/not_equal comparisons
 * @param target2  - Second target value buffer for 'between' mode (upper bound)
 * @param mode     - Comparison mode
 * @param valueType - Value type for proper reading
 */
export function compareScanValues(
  current: Buffer,
  previous: Buffer | null,
  target: Buffer | null,
  target2: Buffer | null,
  mode: ScanCompareMode,
  valueType: ScanValueType,
): boolean {
  const cur = readTypedValue(current, valueType);

  switch (mode) {
    case 'exact': {
      if (!target) return false;
      const tgt = readTypedValue(target, valueType);
      return approxEqual(cur, tgt, valueType);
    }

    case 'unknown_initial':
      return true; // always matches on first scan

    case 'changed': {
      if (!previous) return false;
      const prev = readTypedValue(previous, valueType);
      return !approxEqual(cur, prev, valueType);
    }

    case 'unchanged': {
      if (!previous) return true;
      const prev = readTypedValue(previous, valueType);
      return approxEqual(cur, prev, valueType);
    }

    case 'increased': {
      if (!previous) return false;
      const prev = readTypedValue(previous, valueType);
      return compareValues(cur, prev) > 0;
    }

    case 'decreased': {
      if (!previous) return false;
      const prev = readTypedValue(previous, valueType);
      return compareValues(cur, prev) < 0;
    }

    case 'greater_than': {
      if (!target) return false;
      const tgt = readTypedValue(target, valueType);
      return compareValues(cur, tgt) > 0;
    }

    case 'less_than': {
      if (!target) return false;
      const tgt = readTypedValue(target, valueType);
      return compareValues(cur, tgt) < 0;
    }

    case 'between': {
      if (!target || !target2) return false;
      const lo = readTypedValue(target, valueType);
      const hi = readTypedValue(target2, valueType);
      return compareValues(cur, lo) >= 0 && compareValues(cur, hi) <= 0;
    }

    case 'not_equal': {
      if (!target) return false;
      const tgt = readTypedValue(target, valueType);
      return !approxEqual(cur, tgt, valueType);
    }

    default:
      return false;
  }
}

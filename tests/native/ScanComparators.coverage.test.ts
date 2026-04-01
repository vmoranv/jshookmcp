/**
 * Coverage tests for ScanComparators — exercise all uncovered branches.
 *
 * Gaps in the main test suite:
 *  - getDefaultAlignment: int8, uint16, uint32, float, uint64, double, default
 *  - readTypedValue: int8, uint32, default
 *  - compareScanValues: exact/gt/lt/not_equal with null target, between with null target2,
 *                       approxEqual double branch, compareValues number (mixed-type) branch
 *  - getValueSize default branch
 */

import { describe, it, expect } from 'vitest';
import {
  readTypedValue,
  compareScanValues,
  getValueSize,
  getDefaultAlignment,
} from '../../src/native/ScanComparators';

// ── Helpers (same as ScanComparators.test.ts) ─────────────────────────────────

function makeBuf(
  value: number,
  type: 'int8' | 'byte' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float' | 'double',
): Buffer {
  switch (type) {
    case 'byte':
    case 'int8': {
      const b = Buffer.allocUnsafe(1);
      if (type === 'int8') b.writeInt8(value, 0);
      else b.writeUInt8(value, 0);
      return b;
    }
    case 'int16': {
      const b = Buffer.allocUnsafe(2);
      b.writeInt16LE(value, 0);
      return b;
    }
    case 'uint16': {
      const b = Buffer.allocUnsafe(2);
      b.writeUInt16LE(value, 0);
      return b;
    }
    case 'int32': {
      const b = Buffer.allocUnsafe(4);
      b.writeInt32LE(value, 0);
      return b;
    }
    case 'uint32': {
      const b = Buffer.allocUnsafe(4);
      b.writeUInt32LE(value >>> 0, 0);
      return b;
    }
    case 'float': {
      const b = Buffer.allocUnsafe(4);
      b.writeFloatLE(value, 0);
      return b;
    }
    case 'double': {
      const b = Buffer.allocUnsafe(8);
      b.writeDoubleLE(value, 0);
      return b;
    }
  }
}

function makeBigBuf(value: bigint, type: 'int64' | 'uint64'): Buffer {
  const b = Buffer.allocUnsafe(8);
  if (type === 'int64') b.writeBigInt64LE(value, 0);
  else b.writeBigUInt64LE(value, 0);
  return b;
}

// ── getValueSize: default branch ──────────────────────────────────────────────

describe('ScanComparators coverage: getValueSize', () => {
  it('default branch returns 4 for unknown type', () => {
    // Cast to the union so TypeScript accepts an invalid literal
    expect(getValueSize('not_a_real_type' as 'byte')).toBe(4);
  });
});

// ── getDefaultAlignment: all uncovered branches ──────────────────────────────

describe('ScanComparators coverage: getDefaultAlignment', () => {
  it('int8 returns 1', () => {
    expect(getDefaultAlignment('int8')).toBe(1);
  });

  it('uint16 returns 2', () => {
    expect(getDefaultAlignment('uint16')).toBe(2);
  });

  it('uint32 returns 4', () => {
    expect(getDefaultAlignment('uint32')).toBe(4);
  });

  it('float returns 4', () => {
    expect(getDefaultAlignment('float')).toBe(4);
  });

  it('uint64 returns 8', () => {
    expect(getDefaultAlignment('uint64')).toBe(8);
  });

  it('double returns 8', () => {
    expect(getDefaultAlignment('double')).toBe(8);
  });

  it('default branch returns 1 for unknown type', () => {
    expect(getDefaultAlignment('not_a_real_type' as 'byte')).toBe(1);
  });
});

// ── readTypedValue: uncovered branches ───────────────────────────────────────

describe('ScanComparators coverage: readTypedValue', () => {
  it('int8 reads signed byte correctly', () => {
    // positive value
    expect(readTypedValue(makeBuf(42, 'int8'), 'int8')).toBe(42);
    // negative value
    expect(readTypedValue(makeBuf(-1, 'int8'), 'int8')).toBe(-1);
    // boundary -128
    expect(readTypedValue(makeBuf(-128, 'int8'), 'int8')).toBe(-128);
    // boundary 127
    expect(readTypedValue(makeBuf(127, 'int8'), 'int8')).toBe(127);
  });

  it('uint32 reads unsigned 32-bit correctly', () => {
    // small value
    expect(readTypedValue(makeBuf(100, 'uint32'), 'uint32')).toBe(100);
    // large value above signed int32 range (0x80000000 = 2147483648)
    expect(readTypedValue(makeBuf(0x80000000, 'uint32'), 'uint32')).toBe(0x80000000);
    // max uint32
    expect(readTypedValue(makeBuf(0xffffffff, 'uint32'), 'uint32')).toBe(0xffffffff);
  });

  it('pointer reads same as uint64', () => {
    // pointer type is treated identically to uint64 in readTypedValue
    const b = makeBigBuf(0x123456789abcdef0n, 'uint64');
    expect(readTypedValue(b, 'pointer')).toBe(0x123456789abcdef0n);
  });

  it('default branch falls back to readInt32LE for unknown type', () => {
    // When type is unknown, it defaults to readInt32LE(0)
    // A zeroed buffer gives 0, so we test that the path is taken
    const b = makeBuf(0, 'int32');
    const result = readTypedValue(b, 'not_a_real_type' as 'int32');
    expect(result).toBe(0);
  });
});

// ── compareScanValues: uncovered branches ────────────────────────────────────

describe('ScanComparators coverage: compareScanValues — null-buffer guards', () => {
  it('exact returns false when target is null', () => {
    expect(compareScanValues(makeBuf(100, 'int32'), null, null, null, 'exact', 'int32')).toBe(
      false,
    );
  });

  it('greater_than returns false when target is null', () => {
    expect(
      compareScanValues(makeBuf(101, 'int32'), null, null, null, 'greater_than', 'int32'),
    ).toBe(false);
  });

  it('less_than returns false when target is null', () => {
    expect(compareScanValues(makeBuf(99, 'int32'), null, null, null, 'less_than', 'int32')).toBe(
      false,
    );
  });

  it('not_equal returns false when target is null', () => {
    expect(compareScanValues(makeBuf(101, 'int32'), null, null, null, 'not_equal', 'int32')).toBe(
      false,
    );
  });

  it('between returns false when target2 is null (target is present)', () => {
    // target is present but target2 is null → should return false
    expect(
      compareScanValues(makeBuf(50, 'int32'), null, makeBuf(10, 'int32'), null, 'between', 'int32'),
    ).toBe(false);
  });

  it('between returns false when both target and target2 are null', () => {
    expect(compareScanValues(makeBuf(50, 'int32'), null, null, null, 'between', 'int32')).toBe(
      false,
    );
  });

  it('changed returns false when previous is null', () => {
    expect(compareScanValues(makeBuf(101, 'int32'), null, null, null, 'changed', 'int32')).toBe(
      false,
    );
  });

  it('increased returns false when previous is null', () => {
    expect(compareScanValues(makeBuf(101, 'int32'), null, null, null, 'increased', 'int32')).toBe(
      false,
    );
  });

  it('decreased returns false when previous is null', () => {
    expect(compareScanValues(makeBuf(99, 'int32'), null, null, null, 'decreased', 'int32')).toBe(
      false,
    );
  });

  it('default branch returns false for unknown mode', () => {
    expect(
      compareScanValues(
        makeBuf(100, 'int32'),
        null,
        null,
        null,
        'not_a_real_mode' as 'exact',
        'int32',
      ),
    ).toBe(false);
  });
});

describe('ScanComparators coverage: compareScanValues — approxEqual double epsilon', () => {
  it('exact match on double uses DOUBLE_EPSILON (1e-12) not FLOAT_EPSILON', () => {
    // Two double values within 1e-12 should match
    const a = Buffer.allocUnsafe(8);
    a.writeDoubleLE(1.0000000000001, 0);
    const b = Buffer.allocUnsafe(8);
    b.writeDoubleLE(1.0, 0);
    expect(compareScanValues(a, null, b, null, 'exact', 'double')).toBe(true);
  });

  it('exact match on double fails when difference exceeds epsilon', () => {
    const a = Buffer.allocUnsafe(8);
    a.writeDoubleLE(1.0000001, 0); // difference > 1e-12
    const b = Buffer.allocUnsafe(8);
    b.writeDoubleLE(1.0, 0);
    expect(compareScanValues(a, null, b, null, 'exact', 'double')).toBe(false);
  });
});

describe('ScanComparators coverage: compareScanValues — compareValues number branch', () => {
  it('compareValues uses Number() subtraction for non-bigint types (same float value)', () => {
    // Both buffers hold the same float value 100.0; unchanged should be true
    // even though we read both as float (triggers the Number(a)-Number(b) branch)
    const cur = makeBuf(100.0, 'float');
    const prev = makeBuf(100.0, 'float');
    expect(compareScanValues(cur, prev, null, null, 'unchanged', 'float')).toBe(true);
  });

  it('compareValues number subtraction gives correct ordering for mixed int/float', () => {
    // current=int32(200), previous=int32(100) → compareValues(200, 100) → 100
    // increased: 100 > 0 → true
    const cur = makeBuf(200, 'int32');
    const prev = makeBuf(100, 'int32');
    expect(compareScanValues(cur, prev, null, null, 'increased', 'int32')).toBe(true);
  });

  it('compareValues bigint equality: a === b returns 0', () => {
    const a = makeBigBuf(100n, 'int64');
    const b = makeBigBuf(100n, 'int64');
    expect(compareScanValues(a, b, null, null, 'unchanged', 'int64')).toBe(true);
  });

  it('compareValues bigint less-than: a < b returns -1', () => {
    const cur = makeBigBuf(99n, 'int64');
    const prev = makeBigBuf(100n, 'int64');
    expect(compareScanValues(cur, prev, null, null, 'decreased', 'int64')).toBe(true);
  });

  it('compareValues bigint greater-than: a > b returns 1', () => {
    const cur = makeBigBuf(101n, 'int64');
    const prev = makeBigBuf(100n, 'int64');
    expect(compareScanValues(cur, prev, null, null, 'increased', 'int64')).toBe(true);
  });
});

describe('ScanComparators coverage: compareScanValues — edge cases', () => {
  it('between with current exactly at lower bound (lo) returns true', () => {
    // compareValues(cur, lo) >= 0 — edge at exactly lo
    expect(
      compareScanValues(
        makeBuf(10, 'int32'),
        null,
        makeBuf(10, 'int32'),
        makeBuf(100, 'int32'),
        'between',
        'int32',
      ),
    ).toBe(true);
  });

  it('between with current exactly at upper bound (hi) returns true', () => {
    // compareValues(cur, hi) <= 0 — edge at exactly hi
    expect(
      compareScanValues(
        makeBuf(100, 'int32'),
        null,
        makeBuf(10, 'int32'),
        makeBuf(100, 'int32'),
        'between',
        'int32',
      ),
    ).toBe(true);
  });

  it('between with current below lower bound returns false', () => {
    expect(
      compareScanValues(
        makeBuf(5, 'int32'),
        null,
        makeBuf(10, 'int32'),
        makeBuf(100, 'int32'),
        'between',
        'int32',
      ),
    ).toBe(false);
  });

  it('between with current above upper bound returns false', () => {
    expect(
      compareScanValues(
        makeBuf(200, 'int32'),
        null,
        makeBuf(10, 'int32'),
        makeBuf(100, 'int32'),
        'between',
        'int32',
      ),
    ).toBe(false);
  });

  it('exact mode: int64 bigint exact equality', () => {
    const a = makeBigBuf(12345678901234n, 'int64');
    const b = makeBigBuf(12345678901234n, 'int64');
    expect(compareScanValues(a, null, b, null, 'exact', 'int64')).toBe(true);
  });

  it('exact mode: uint64 bigint exact inequality (covered by approxEqual)', () => {
    const a = makeBigBuf(0xffffffffffffffffn, 'uint64');
    const b = makeBigBuf(0xfffffffffffffffen, 'uint64');
    expect(compareScanValues(a, null, b, null, 'exact', 'uint64')).toBe(false);
  });

  it('exact mode: pointer type uses uint64 branch in readTypedValue', () => {
    const a = makeBigBuf(0x00400000n, 'uint64');
    const b = makeBigBuf(0x00400000n, 'uint64');
    expect(compareScanValues(a, null, b, null, 'exact', 'pointer')).toBe(true);
  });

  it('unchanged: with null previous returns true (first-scan semantics)', () => {
    expect(compareScanValues(makeBuf(100, 'int32'), null, null, null, 'unchanged', 'int32')).toBe(
      true,
    );
  });

  it('unknown_initial always returns true regardless of current value', () => {
    expect(
      compareScanValues(makeBuf(0, 'int32'), null, null, null, 'unknown_initial', 'int32'),
    ).toBe(true);
    expect(
      compareScanValues(makeBuf(-999999, 'int32'), null, null, null, 'unknown_initial', 'int32'),
    ).toBe(true);
    expect(
      compareScanValues(
        makeBuf(0xffffffff, 'uint32'),
        null,
        null,
        null,
        'unknown_initial',
        'uint32',
      ),
    ).toBe(true);
  });

  it('changed: int64 bigint values detect change', () => {
    const cur = makeBigBuf(200n, 'int64');
    const prev = makeBigBuf(100n, 'int64');
    expect(compareScanValues(cur, prev, null, null, 'changed', 'int64')).toBe(true);
  });

  it('changed: float values detect change beyond epsilon', () => {
    const cur = Buffer.allocUnsafe(4);
    cur.writeFloatLE(3.1416, 0);
    const prev = Buffer.allocUnsafe(4);
    prev.writeFloatLE(1.2345, 0);
    expect(compareScanValues(cur, prev, null, null, 'changed', 'float')).toBe(true);
  });

  it('not_equal: different int64 bigint values (uses target, not prev)', () => {
    const cur = makeBigBuf(999n, 'int64');
    const tgt = makeBigBuf(100n, 'int64');
    expect(compareScanValues(cur, null, tgt, null, 'not_equal', 'int64')).toBe(true);
  });

  it('greater_than: int64 bigint comparison', () => {
    const cur = makeBigBuf(200n, 'int64');
    const tgt = makeBigBuf(100n, 'int64');
    expect(compareScanValues(cur, null, tgt, null, 'greater_than', 'int64')).toBe(true);
  });

  it('less_than: int64 bigint comparison', () => {
    const cur = makeBigBuf(50n, 'int64');
    const tgt = makeBigBuf(100n, 'int64');
    expect(compareScanValues(cur, null, tgt, null, 'less_than', 'int64')).toBe(true);
  });

  it('between: int64 bigint values within range', () => {
    const cur = makeBigBuf(500n, 'int64');
    const lo = makeBigBuf(100n, 'int64');
    const hi = makeBigBuf(1000n, 'int64');
    expect(compareScanValues(cur, null, lo, hi, 'between', 'int64')).toBe(true);
  });

  it('between: int64 bigint values outside range', () => {
    const cur = makeBigBuf(2000n, 'int64');
    const lo = makeBigBuf(100n, 'int64');
    const hi = makeBigBuf(1000n, 'int64');
    expect(compareScanValues(cur, null, lo, hi, 'between', 'int64')).toBe(false);
  });
});

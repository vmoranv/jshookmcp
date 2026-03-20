import { describe, it, expect } from 'vitest';
import {
  readTypedValue,
  compareScanValues,
  getValueSize,
  getDefaultAlignment,
} from '../../src/native/ScanComparators';

// ── Helpers ──

function makeBuf(value: number, type: 'int32' | 'float' | 'double' | 'byte' | 'int16' | 'uint16' | 'uint32'): Buffer {
  switch (type) {
    case 'byte': {
      const b = Buffer.allocUnsafe(1);
      b.writeUInt8(value, 0);
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

// ── Tests ──

describe('ScanComparators', () => {
  describe('getValueSize', () => {
    it('returns correct sizes for all types', () => {
      expect(getValueSize('byte')).toBe(1);
      expect(getValueSize('int8')).toBe(1);
      expect(getValueSize('int16')).toBe(2);
      expect(getValueSize('uint16')).toBe(2);
      expect(getValueSize('int32')).toBe(4);
      expect(getValueSize('uint32')).toBe(4);
      expect(getValueSize('float')).toBe(4);
      expect(getValueSize('int64')).toBe(8);
      expect(getValueSize('uint64')).toBe(8);
      expect(getValueSize('double')).toBe(8);
      expect(getValueSize('pointer')).toBe(8);
      expect(getValueSize('hex')).toBe(0);
      expect(getValueSize('string')).toBe(0);
    });
  });

  describe('getDefaultAlignment', () => {
    it('returns natural alignment', () => {
      expect(getDefaultAlignment('byte')).toBe(1);
      expect(getDefaultAlignment('int16')).toBe(2);
      expect(getDefaultAlignment('int32')).toBe(4);
      expect(getDefaultAlignment('int64')).toBe(8);
      expect(getDefaultAlignment('pointer')).toBe(8);
    });
  });

  describe('readTypedValue', () => {
    it('reads byte correctly', () => {
      expect(readTypedValue(makeBuf(42, 'byte'), 'byte')).toBe(42);
    });

    it('reads int16 correctly', () => {
      expect(readTypedValue(makeBuf(1000, 'int16'), 'int16')).toBe(1000);
    });

    it('reads int32 correctly', () => {
      expect(readTypedValue(makeBuf(100, 'int32'), 'int32')).toBe(100);
    });

    it('reads float correctly', () => {
      const val = readTypedValue(makeBuf(3.14, 'float'), 'float') as number;
      expect(Math.abs(val - 3.14)).toBeLessThan(1e-5);
    });

    it('reads double correctly', () => {
      expect(readTypedValue(makeBuf(3.14159265358979, 'double'), 'double')).toBeCloseTo(3.14159265358979);
    });

    it('reads int64 correctly', () => {
      expect(readTypedValue(makeBigBuf(12345678901234n, 'int64'), 'int64')).toBe(12345678901234n);
    });

    it('reads uint64 correctly', () => {
      expect(readTypedValue(makeBigBuf(0xFFFFFFFFFFFFFFFFn, 'uint64'), 'uint64')).toBe(0xFFFFFFFFFFFFFFFFn);
    });
  });

  describe('compareScanValues', () => {
    it('exact match for int32', () => {
      expect(compareScanValues(makeBuf(100, 'int32'), null, makeBuf(100, 'int32'), null, 'exact', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(101, 'int32'), null, makeBuf(100, 'int32'), null, 'exact', 'int32')).toBe(false);
    });

    it('exact match for float with epsilon', () => {
      const a = makeBuf(1.0000001, 'float');
      const b = makeBuf(1.0000002, 'float');
      expect(compareScanValues(a, null, b, null, 'exact', 'float')).toBe(true);
    });

    it('unknown_initial always returns true', () => {
      expect(compareScanValues(makeBuf(42, 'int32'), null, null, null, 'unknown_initial', 'int32')).toBe(true);
    });

    it('changed mode', () => {
      expect(compareScanValues(makeBuf(101, 'int32'), makeBuf(100, 'int32'), null, null, 'changed', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(100, 'int32'), makeBuf(100, 'int32'), null, null, 'changed', 'int32')).toBe(false);
    });

    it('unchanged mode', () => {
      expect(compareScanValues(makeBuf(100, 'int32'), makeBuf(100, 'int32'), null, null, 'unchanged', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(101, 'int32'), makeBuf(100, 'int32'), null, null, 'unchanged', 'int32')).toBe(false);
    });

    it('increased mode', () => {
      expect(compareScanValues(makeBuf(101, 'int32'), makeBuf(100, 'int32'), null, null, 'increased', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(99, 'int32'), makeBuf(100, 'int32'), null, null, 'increased', 'int32')).toBe(false);
    });

    it('decreased mode', () => {
      expect(compareScanValues(makeBuf(99, 'int32'), makeBuf(100, 'int32'), null, null, 'decreased', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(101, 'int32'), makeBuf(100, 'int32'), null, null, 'decreased', 'int32')).toBe(false);
    });

    it('greater_than mode', () => {
      expect(compareScanValues(makeBuf(101, 'int32'), null, makeBuf(100, 'int32'), null, 'greater_than', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(100, 'int32'), null, makeBuf(100, 'int32'), null, 'greater_than', 'int32')).toBe(false);
    });

    it('less_than mode', () => {
      expect(compareScanValues(makeBuf(99, 'int32'), null, makeBuf(100, 'int32'), null, 'less_than', 'int32')).toBe(true);
    });

    it('between mode', () => {
      expect(compareScanValues(makeBuf(50, 'int32'), null, makeBuf(10, 'int32'), makeBuf(100, 'int32'), 'between', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(5, 'int32'), null, makeBuf(10, 'int32'), makeBuf(100, 'int32'), 'between', 'int32')).toBe(false);
      // boundary values
      expect(compareScanValues(makeBuf(10, 'int32'), null, makeBuf(10, 'int32'), makeBuf(100, 'int32'), 'between', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(100, 'int32'), null, makeBuf(10, 'int32'), makeBuf(100, 'int32'), 'between', 'int32')).toBe(true);
    });

    it('not_equal mode', () => {
      expect(compareScanValues(makeBuf(101, 'int32'), null, makeBuf(100, 'int32'), null, 'not_equal', 'int32')).toBe(true);
      expect(compareScanValues(makeBuf(100, 'int32'), null, makeBuf(100, 'int32'), null, 'not_equal', 'int32')).toBe(false);
    });

    it('bigint comparison for int64', () => {
      const a = makeBigBuf(200n, 'int64');
      const b = makeBigBuf(100n, 'int64');
      expect(compareScanValues(a, b, null, null, 'increased', 'int64')).toBe(true);
      expect(compareScanValues(b, a, null, null, 'decreased', 'int64')).toBe(true);
    });
  });
});

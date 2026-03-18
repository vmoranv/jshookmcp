import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  PAGE: {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    WRITECOPY: 0x08,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    GUARD: 0x100,
  },
  MEM: {
    COMMIT: 0x1000,
    RESERVE: 0x2000,
    FREE: 0x10000,
  },
  MEM_TYPE: {
    IMAGE: 0x1000000,
    MAPPED: 0x40000,
    PRIVATE: 0x20000,
  },
  isWin32KoffiAvailable: vi.fn(),
}));

vi.mock('@native/Win32API', () => ({
  PAGE: state.PAGE,
  MEM: state.MEM,
  MEM_TYPE: state.MEM_TYPE,
  isKoffiAvailable: state.isWin32KoffiAvailable,
}));

import {
  findPatternInBuffer,
  getProtectionString,
  getStateString,
  getTypeString,
  isExecutable,
  isReadable,
  isWritable,
  parsePattern,
} from '@native/NativeMemoryManager.utils';

describe('NativeMemoryManager.utils edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parsePattern extended', () => {
    it('parses hex pattern with ** wildcard', () => {
      expect(parsePattern('AA ** CC', 'hex')).toEqual({
        patternBytes: [0xaa, 0, 0xcc],
        mask: [1, 0, 1],
      });
    });

    it('returns empty for invalid hex digits', () => {
      // 'ZZ' is not a valid hex so parseInt returns NaN, skipped
      const result = parsePattern('ZZ', 'hex');
      expect(result.patternBytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });

    it('returns empty for NaN int32', () => {
      const result = parsePattern('notanumber', 'int32');
      expect(result.patternBytes).toEqual([]);
    });

    it('parses int64 pattern', () => {
      const result = parsePattern('0', 'int64');
      expect(result.patternBytes).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(result.mask).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('parses float pattern', () => {
      const result = parsePattern('0', 'float');
      expect(result.patternBytes).toEqual([0, 0, 0, 0]);
    });

    it('returns empty for NaN float', () => {
      const result = parsePattern('notanumber', 'float');
      expect(result.patternBytes).toEqual([]);
    });

    it('parses double pattern', () => {
      const result = parsePattern('0', 'double');
      expect(result.patternBytes).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('returns empty for NaN double', () => {
      const result = parsePattern('notanumber', 'double');
      expect(result.patternBytes).toEqual([]);
    });

    it('parses multi-byte UTF-8 string', () => {
      // 'AB' = 0x41, 0x42
      const result = parsePattern('AB', 'string');
      expect(result.patternBytes).toEqual([0x41, 0x42]);
      expect(result.mask).toEqual([1, 1]);
    });
  });

  describe('findPatternInBuffer edge cases', () => {
    it('returns empty for empty pattern', () => {
      expect(findPatternInBuffer(Buffer.from([0xaa]), [], [])).toEqual([]);
    });

    it('returns empty when buffer is shorter than pattern', () => {
      expect(findPatternInBuffer(Buffer.from([0xaa]), [0xaa, 0xbb], [1, 1])).toEqual([]);
    });

    it('finds overlapping exact matches', () => {
      // Buffer: AAAA, Pattern: AA => matches at 0, 1, 2
      expect(
        findPatternInBuffer(Buffer.from([0xaa, 0xaa, 0xaa, 0xaa]), [0xaa, 0xaa], [1, 1])
      ).toEqual([0, 1, 2]);
    });

    it('handles single-byte pattern', () => {
      expect(findPatternInBuffer(Buffer.from([0x00, 0xff, 0x00]), [0xff], [1])).toEqual([1]);
    });

    it('returns all positions for all-wildcard mask', () => {
      // All-zero mask means every position matches
      const result = findPatternInBuffer(Buffer.from([0xaa, 0xbb, 0xcc]), [0, 0], [0, 0]);
      expect(result).toEqual([0, 1]);
    });

    it('handles exact pattern using BMH path (all mask=1)', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x01, 0x02]);
      expect(findPatternInBuffer(buf, [0x01, 0x02], [1, 1])).toEqual([0, 3]);
    });
  });

  describe('getStateString', () => {
    it('returns RESERVE', () => {
      expect(getStateString(state.MEM.RESERVE)).toBe('RESERVE');
    });

    it('returns FREE', () => {
      expect(getStateString(state.MEM.FREE)).toBe('FREE');
    });

    it('returns UNKNOWN for unrecognized state', () => {
      expect(getStateString(0xdead)).toBe('UNKNOWN');
    });
  });

  describe('getProtectionString', () => {
    it('returns NOACCESS for zero protection', () => {
      expect(getProtectionString(0)).toBe('NOACCESS');
    });

    it('returns NOACCESS flag', () => {
      expect(getProtectionString(state.PAGE.NOACCESS)).toBe('NOACCESS');
    });

    it('returns combined protection flags', () => {
      expect(getProtectionString(state.PAGE.READWRITE | state.PAGE.EXECUTE)).toBe('RW X');
    });

    it('returns UNKNOWN for unrecognized non-zero protection', () => {
      // A value with no matching flags
      expect(getProtectionString(0x8000)).toBe('UNKNOWN');
    });

    it('returns R for readonly', () => {
      expect(getProtectionString(state.PAGE.READONLY)).toBe('R');
    });

    it('returns WC for writecopy', () => {
      expect(getProtectionString(state.PAGE.WRITECOPY)).toBe('WC');
    });

    it('returns RWX for execute_readwrite', () => {
      expect(getProtectionString(state.PAGE.EXECUTE_READWRITE)).toBe('RWX');
    });

    it('returns RX for execute_read', () => {
      expect(getProtectionString(state.PAGE.EXECUTE_READ)).toBe('RX');
    });
  });

  describe('getTypeString', () => {
    it('returns IMAGE', () => {
      expect(getTypeString(state.MEM_TYPE.IMAGE)).toBe('IMAGE');
    });

    it('returns MAPPED', () => {
      expect(getTypeString(state.MEM_TYPE.MAPPED)).toBe('MAPPED');
    });

    it('returns UNKNOWN for unrecognized type', () => {
      expect(getTypeString(0xdead)).toBe('UNKNOWN');
    });
  });

  describe('isReadable', () => {
    it('returns false when state is not COMMIT', () => {
      expect(
        isReadable({
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0,
          RegionSize: 0n,
          State: state.MEM.FREE,
          Protect: state.PAGE.READWRITE,
          Type: 0,
        })
      ).toBe(false);
    });

    it('returns true for WRITECOPY protection', () => {
      expect(
        isReadable({
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0,
          RegionSize: 0n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.WRITECOPY,
          Type: 0,
        })
      ).toBe(true);
    });

    it('returns true for EXECUTE_READWRITE', () => {
      expect(
        isReadable({
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0,
          RegionSize: 0n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.EXECUTE_READWRITE,
          Type: 0,
        })
      ).toBe(true);
    });

    it('returns false for NOACCESS with COMMIT state', () => {
      expect(
        isReadable({
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0,
          RegionSize: 0n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.NOACCESS,
          Type: 0,
        })
      ).toBe(false);
    });
  });

  describe('isWritable', () => {
    it('returns true for READWRITE', () => {
      expect(isWritable(state.PAGE.READWRITE)).toBe(true);
    });

    it('returns true for WRITECOPY', () => {
      expect(isWritable(state.PAGE.WRITECOPY)).toBe(true);
    });

    it('returns true for EXECUTE_READWRITE', () => {
      expect(isWritable(state.PAGE.EXECUTE_READWRITE)).toBe(true);
    });

    it('returns false for READONLY', () => {
      expect(isWritable(state.PAGE.READONLY)).toBe(false);
    });

    it('returns false for EXECUTE_READ', () => {
      expect(isWritable(state.PAGE.EXECUTE_READ)).toBe(false);
    });
  });

  describe('isExecutable', () => {
    it('returns true for EXECUTE', () => {
      expect(isExecutable(state.PAGE.EXECUTE)).toBe(true);
    });

    it('returns true for EXECUTE_READ', () => {
      expect(isExecutable(state.PAGE.EXECUTE_READ)).toBe(true);
    });

    it('returns true for EXECUTE_READWRITE', () => {
      expect(isExecutable(state.PAGE.EXECUTE_READWRITE)).toBe(true);
    });

    it('returns false for READONLY', () => {
      expect(isExecutable(state.PAGE.READONLY)).toBe(false);
    });

    it('returns false for READWRITE', () => {
      expect(isExecutable(state.PAGE.READWRITE)).toBe(false);
    });
  });
});

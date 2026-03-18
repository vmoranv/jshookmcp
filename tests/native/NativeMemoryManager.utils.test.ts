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
  isKoffiAvailable,
  isReadable,
  isWritable,
  parsePattern,
} from '@src/native/NativeMemoryManager.utils';

describe('NativeMemoryManager.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses hex patterns with wildcard bytes', () => {
    expect(parsePattern('AA ?? ? CC', 'hex')).toEqual({
      patternBytes: [0xaa, 0x00, 0x00, 0xcc],
      mask: [1, 0, 0, 1],
    });
  });

  it('parses scalar and string patterns into byte arrays', () => {
    expect(parsePattern('258', 'int32')).toEqual({
      patternBytes: [2, 1, 0, 0],
      mask: [1, 1, 1, 1],
    });
    expect(parsePattern('AB', 'string')).toEqual({
      patternBytes: [65, 66],
      mask: [1, 1],
    });
  });

  it('finds exact and wildcard matches in buffers', () => {
    expect(
      findPatternInBuffer(Buffer.from([0xaa, 0xbb, 0xaa, 0xbb]), [0xaa, 0xbb], [1, 1])
    ).toEqual([0, 2]);
    expect(
      findPatternInBuffer(Buffer.from([0xaa, 0xff, 0xcc]), [0xaa, 0x00, 0xcc], [1, 0, 1])
    ).toEqual([0]);
  });

  it('maps region metadata and protection flags', () => {
    const info = {
      BaseAddress: 0x1000n,
      AllocationBase: 0x1000n,
      AllocationProtect: state.PAGE.READWRITE,
      RegionSize: 0x200n,
      State: state.MEM.COMMIT,
      Protect: state.PAGE.READWRITE | state.PAGE.GUARD,
      Type: state.MEM_TYPE.PRIVATE,
    } as const;

    expect(getStateString(info.State)).toBe('COMMIT');
    expect(getProtectionString(info.Protect)).toBe('RW GUARD');
    expect(getTypeString(info.Type)).toBe('PRIVATE');
    expect(isReadable(info)).toBe(true);
    expect(isWritable(info.Protect)).toBe(true);
    expect(isExecutable(info.Protect)).toBe(false);
  });

  it('delegates koffi availability checks to the Win32 bridge module', () => {
    state.isWin32KoffiAvailable.mockReturnValue(true);

    expect(isKoffiAvailable()).toBe(true);
    expect(state.isWin32KoffiAvailable).toHaveBeenCalledTimes(1);
  });
});

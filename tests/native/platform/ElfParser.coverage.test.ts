/**
 * Coverage tests for ElfParser — header/section/symbol parsing via synthesized
 * ELF64 buffers (readFileSync mocked). Exercises the magic validation, the
 * no-sections early return, and the file-read failure path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: (p: string) => mockReadFileSync(p),
}));

import { parseElfHeader, parseElfSections, parseElfSymbols } from '@native/platform/ElfParser';

/** Minimal 64-byte ELF64 header (magic + ELFCLASS64 + LE, other fields zero). */
function elf64Header(over: Record<number, number> = {}): Buffer {
  const b = Buffer.alloc(64);
  b[0] = 0x7f;
  b[1] = 0x45; // E
  b[2] = 0x4c; // L
  b[3] = 0x46; // F
  b[4] = 0x02; // ELFCLASS64
  b[5] = 0x01; // ELFDATA2LSB
  for (const [off, val] of Object.entries(over)) b.writeUInt8(val, Number(off));
  return b;
}

beforeEach(() => {
  mockReadFileSync.mockReset();
});

describe('parseElfHeader', () => {
  it('returns null when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(parseElfHeader('/nope')).toBeNull();
  });

  it('returns null for a buffer with bad magic', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(64)); // all zeros — no magic
    expect(parseElfHeader('/x')).toBeNull();
  });

  it('returns null for a sub-64-byte buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]));
    expect(parseElfHeader('/x')).toBeNull();
  });

  it('returns null for a big-endian ELF64 header (all reads are LE)', () => {
    mockReadFileSync.mockReturnValue(elf64Header({ 5: 0x02 })); // ELFDATA2MSB
    expect(parseElfHeader('/x')).toBeNull();
    expect(parseElfSections('/x')).toEqual([]);
  });

  it('parses a minimal valid ELF64 header', () => {
    mockReadFileSync.mockReturnValue(elf64Header());
    const h = parseElfHeader('/x');
    expect(h).not.toBeNull();
    expect(h?.class).toBe(2);
    expect(h?.shnum).toBe(0);
  });
});

describe('parseElfSections', () => {
  it('returns [] when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(parseElfSections('/nope')).toEqual([]);
  });

  it('returns [] for a non-ELF buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(64));
    expect(parseElfSections('/x')).toEqual([]);
  });

  it('returns [] for a valid ELF64 header with shnum=0 (no sections)', () => {
    mockReadFileSync.mockReturnValue(elf64Header());
    expect(parseElfSections('/x')).toEqual([]);
  });

  it('returns [] for a truncated string-table header without throwing', () => {
    // shOff=64, shEntSize=64, shNum=1, shStrNdx=1 → strHdrOff=128. Buffer
    // length 156: strHdrOff+24 <= len passes the old bounds check, but the
    // readBigUInt64LE(strHdrOff+0x18) needs 8 more bytes (strHdrOff+32 > len),
    // which previously threw ERR_BUFFER_OUT_OF_BOUNDS.
    const b = elf64Header();
    b.writeBigUInt64LE(64n, 0x28); // shOff
    b.writeUInt16LE(64, 0x3a); // shEntSize
    b.writeUInt16LE(1, 0x3c); // shNum
    b.writeUInt16LE(1, 0x3e); // shStrNdx
    mockReadFileSync.mockReturnValue(Buffer.concat([b, Buffer.alloc(156 - 64)]));
    expect(() => parseElfSections('/x')).not.toThrow();
    expect(parseElfSections('/x')).toEqual([]);
  });
});

describe('parseElfSymbols', () => {
  it('returns empty symbol table when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const r = parseElfSymbols('/nope');
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });

  it('returns empty symbol table for a non-ELF buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(64));
    const r = parseElfSymbols('/x');
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });
});

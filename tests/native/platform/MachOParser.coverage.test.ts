/**
 * Coverage tests for MachOParser — error paths + minimal valid Mach-O 64-bit
 * header (readFileSync mocked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: (p: string) => mockReadFileSync(p),
}));

import {
  parseMachOHeader,
  parseMachoSections,
  parseMachOSymbols,
} from '@native/platform/MachOParser';

/** Minimal Mach-O 64-bit header: magic 0xFEEDFACF + cputype + cpusubtype + filetype. */
function macho64Header(): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  b.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_X86_64
  b.writeUInt32LE(0x80000003, 8); // CPU_SUBTYPE_X86_64_ALL | LIB64
  b.writeUInt32LE(2, 12); // MH_EXECUTE
  b.writeUInt32LE(0, 16); // ncmds
  b.writeUInt32LE(0, 20); // sizeofcmds
  b.writeUInt32LE(0, 24); // flags
  b.writeUInt32LE(0, 28); // reserved
  return b;
}

beforeEach(() => {
  mockReadFileSync.mockReset();
});

describe('parseMachOHeader', () => {
  it('returns null when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(parseMachOHeader('/nope')).toBeNull();
  });

  it('returns null for a buffer with bad magic', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(32));
    expect(parseMachOHeader('/x')).toBeNull();
  });

  it('parses a minimal valid Mach-O 64-bit header', () => {
    mockReadFileSync.mockReturnValue(macho64Header());
    const h = parseMachOHeader('/x');
    expect(h).not.toBeNull();
    expect(h?.cpuType).toBe(0x0100000c); // CPU_TYPE_X86_64
    expect(h?.fileType).toBe(2); // MH_EXECUTE
  });
});

describe('parseMachoSections', () => {
  it('returns [] when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(parseMachoSections('/nope')).toEqual([]);
  });

  it('returns [] for a non-Mach-O buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(32));
    expect(parseMachoSections('/x')).toEqual([]);
  });

  it('returns [] for a valid header with zero load commands', () => {
    mockReadFileSync.mockReturnValue(macho64Header());
    expect(parseMachoSections('/x')).toEqual([]);
  });

  it('reads the section file offset from the section_64 offset field (secoff+48)', () => {
    // header(32) + LC_SEGMENT_64(72) + one section_64(80) = 184 bytes
    const b = Buffer.alloc(184, 0);
    // Mach-O 64 header
    b.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
    b.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
    b.writeUInt32LE(1, 16); // ncmds
    b.writeUInt32LE(152, 20); // sizeofcmds (72 + 80)

    // LC_SEGMENT_64 at offset 32
    const seg = 32;
    b.writeUInt32LE(0x19, seg); // cmd = LC_SEGMENT_64
    b.writeUInt32LE(152, seg + 4); // cmdsize
    b.write('__TEXT\0', seg + 8, 'ascii'); // segname
    b.writeBigUInt64LE(0x100000000n, seg + 24); // vmaddr
    b.writeBigUInt64LE(0x4000n, seg + 32); // vmsize
    b.writeBigUInt64LE(0n, seg + 40); // fileoff
    b.writeBigUInt64LE(0x4000n, seg + 48); // filesize
    b.writeUInt32LE(0x5, seg + 56); // maxprot = R|X
    b.writeUInt32LE(0x5, seg + 60); // initprot
    b.writeUInt32LE(1, seg + 64); // nsects = 1

    // section_64 at offset 104
    const sec = 104;
    b.write('__text\0', sec, 'ascii'); // sectname
    b.write('__TEXT\0', sec + 16, 'ascii'); // segname
    b.writeBigUInt64LE(0x100000000n, sec + 32); // addr
    b.writeBigUInt64LE(0x4000n, sec + 40); // size
    b.writeUInt32LE(0x4000, sec + 48); // offset — real file offset of the section data
    b.writeUInt32LE(0x80000000, sec + 64); // flags = S_ATTR_PURE_INSTRUCTIONS

    mockReadFileSync.mockReturnValue(b);
    const sections = parseMachoSections('/x');

    expect(sections).toHaveLength(1);
    expect(sections[0]!.name).toBe('__TEXT.__text');
    // Must be the offset field value (0x4000), NOT the struct's own file offset (104).
    expect(sections[0]!.fileOffset).toBe(0x4000);
    expect(sections[0]!.isExecutable).toBe(true);
    expect(sections[0]!.isWritable).toBe(false);
  });

  it('rebases section offsets by the FAT slice offset', () => {
    const SLICE = 0x100;
    const b = Buffer.alloc(SLICE + 184, 0);
    // FAT header: magic, nfat_arch=1, then one big-endian fat_arch.
    b.writeUInt32LE(0xcafebabe, 0);
    b.writeUInt32BE(1, 4);
    b.writeUInt32BE(0x0100000c, 8); // CPU_TYPE_ARM64
    b.writeUInt32BE(0, 12); // cpusubtype
    b.writeUInt32BE(SLICE, 16); // offset
    b.writeUInt32BE(184, 20); // size

    const o = SLICE;
    b.writeUInt32LE(0xfeedfacf, o); // MH_MAGIC_64
    b.writeUInt32LE(0x0100000c, o + 4);
    b.writeUInt32LE(1, o + 16); // ncmds
    b.writeUInt32LE(152, o + 20); // sizeofcmds

    const seg = o + 32;
    b.writeUInt32LE(0x19, seg); // LC_SEGMENT_64
    b.writeUInt32LE(152, seg + 4);
    b.write('__TEXT\0', seg + 8, 'ascii');
    b.writeUInt32LE(1, seg + 64); // nsects

    const sec = seg + 72;
    b.write('__text\0', sec, 'ascii');
    b.writeBigUInt64LE(0x4000n, sec + 40); // size
    b.writeUInt32LE(0x40, sec + 48); // slice-relative file offset

    mockReadFileSync.mockReturnValue(b);
    const sections = parseMachoSections('/x');

    expect(sections).toHaveLength(1);
    // 0x40 is relative to the embedded slice at 0x100.
    expect(sections[0]!.fileOffset).toBe(SLICE + 0x40);
  });

  it('returns [] for a truncated FAT header (no nfat_arch field)', () => {
    mockReadFileSync.mockReturnValue(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00]));
    expect(parseMachOHeader('/x')).toBeNull();
    expect(parseMachoSections('/x')).toEqual([]);
    expect(parseMachOSymbols('/x')).toEqual({ imports: [], exports: [] });
  });
});

describe('parseMachOSymbols', () => {
  it('returns empty symbol table when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const r = parseMachOSymbols('/nope');
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });

  it('returns empty symbol table for a non-Mach-O buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(32));
    const r = parseMachOSymbols('/x');
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });
});

/**
 * L1 TDD — ElfLoader: parse ELF64 AArch64 shared objects.
 *
 * Fixtures are hand-built ELF64 byte buffers (no toolchain dependency) so the
 * parser is exercised against a known-exact layout: a 64-byte Elf64_Ehdr, one
 * 56-byte PT_LOAD program header, and a minimal .dynsym/.dynstr pair carrying a
 * single exported symbol. Byte offsets follow the ELF64 spec
 * (Ehdr: e_entry@0x18, e_phoff@0x20; Phdr: p_offset@0x08, p_vaddr@0x10,
 * p_filesz@0x20, p_memsz@0x28; EM_AARCH64=183, PT_LOAD=1).
 */
import { describe, expect, it } from 'vitest';

import { ElfLoader } from '@modules/native-emulator/ElfLoader';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;

/** Little-endian writers over a DataView. */
function buildMinimalSo(): {
  bytes: Uint8Array;
  entry: number;
  segVaddr: number;
  segBytes: number[];
} {
  // Layout plan (file offsets):
  //   0x00  Ehdr (64 bytes)
  //   0x40  Phdr (56 bytes) — single PT_LOAD
  //   0x78  segment contents (4 instructions = 16 bytes)
  const EHDR = 64;
  const PHDR = 56;
  const segOffset = EHDR + PHDR; // 0x78
  const segBytes = [
    0x00,
    0x00,
    0x80,
    0xd2, // movz x0, #0
    0x20,
    0x00,
    0x02,
    0x8b, // add  x0, x1, x2
    0x40,
    0x05,
    0x80,
    0xd2, // movz x0, #42
    0xc0,
    0x03,
    0x5f,
    0xd6, // ret
  ];
  const segVaddr = 0x1000;
  const entry = segVaddr; // entry at segment start
  const total = segOffset + segBytes.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // ── Elf64_Ehdr ──
  u8.set([0x7f, 0x45, 0x4c, 0x46], 0); // EI_MAG  \x7fELF
  dv.setUint8(4, 2); // EI_CLASS = ELFCLASS64
  dv.setUint8(5, 1); // EI_DATA  = ELFDATA2LSB (little-endian)
  dv.setUint8(6, 1); // EI_VERSION
  dv.setUint16(0x10, ET_DYN, true); // e_type = ET_DYN (shared object)
  dv.setUint16(0x12, EM_AARCH64, true); // e_machine
  dv.setUint32(0x14, 1, true); // e_version
  dv.setBigUint64(0x18, BigInt(entry), true); // e_entry
  dv.setBigUint64(0x20, BigInt(EHDR), true); // e_phoff = 64
  dv.setBigUint64(0x28, 0n, true); // e_shoff (none for this fixture)
  dv.setUint32(0x30, 0, true); // e_flags
  dv.setUint16(0x34, EHDR, true); // e_ehsize = 64
  dv.setUint16(0x36, PHDR, true); // e_phentsize = 56
  dv.setUint16(0x38, 1, true); // e_phnum = 1
  dv.setUint16(0x3a, 0, true); // e_shentsize
  dv.setUint16(0x3c, 0, true); // e_shnum
  dv.setUint16(0x3e, 0, true); // e_shstrndx

  // ── Elf64_Phdr (single PT_LOAD, R-X) at 0x40 ──
  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true); // p_type
  dv.setUint32(p + 0x04, 0b101, true); // p_flags = R|X
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true); // p_offset
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true); // p_vaddr
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true); // p_paddr
  dv.setBigUint64(p + 0x20, BigInt(segBytes.length), true); // p_filesz
  dv.setBigUint64(p + 0x28, BigInt(segBytes.length + 8), true); // p_memsz > filesz (.bss tail)
  dv.setBigUint64(p + 0x30, 0x10000n, true); // p_align (AArch64 64KB)

  // ── Segment contents ──
  u8.set(segBytes, segOffset);

  return { bytes: u8, entry, segVaddr, segBytes };
}

describe('ElfLoader — L1 ELF64 AArch64 parsing', () => {
  it('rejects a non-ELF buffer', () => {
    expect(() => new ElfLoader(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toThrow(/not an elf/i);
  });

  it('parses the ELF64 header (class, machine, type, entry)', () => {
    const { bytes, entry } = buildMinimalSo();
    const elf = new ElfLoader(bytes);
    expect(elf.is64Bit).toBe(true);
    expect(elf.isLittleEndian).toBe(true);
    expect(elf.machine).toBe(EM_AARCH64);
    expect(elf.type).toBe(ET_DYN);
    expect(elf.entry).toBe(entry);
  });

  it('enumerates PT_LOAD segments with offset/vaddr/filesz/memsz/flags', () => {
    const { bytes, segVaddr, segBytes } = buildMinimalSo();
    const elf = new ElfLoader(bytes);
    const loads = elf.loadableSegments();
    expect(loads).toHaveLength(1);
    const seg = loads[0]!;
    expect(seg.vaddr).toBe(segVaddr);
    expect(seg.fileSize).toBe(segBytes.length);
    expect(seg.memSize).toBe(segBytes.length + 8);
    expect(seg.readable).toBe(true);
    expect(seg.executable).toBe(true);
    expect(seg.writable).toBe(false);
  });

  it('exposes segment bytes including zero-filled .bss tail', () => {
    const { bytes, segBytes } = buildMinimalSo();
    const elf = new ElfLoader(bytes);
    const seg = elf.loadableSegments()[0]!;
    // First filesz bytes match the file; the extra memsz tail is zero.
    expect(Array.from(seg.data.slice(0, segBytes.length))).toEqual(segBytes);
    expect(seg.data.length).toBe(segBytes.length + 8);
    expect(Array.from(seg.data.slice(segBytes.length))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

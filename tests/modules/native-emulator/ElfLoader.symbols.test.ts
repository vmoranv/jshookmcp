/**
 * L2 TDD — ElfLoader dynamic symbol parsing (.dynsym / .dynstr).
 *
 * Extends the L1 fixture with a section header table, a SHT_DYNSYM section, and
 * its linked SHT_STRTAB (.dynstr). Verifies `exportedSymbols()` resolves symbol
 * names to their virtual addresses.
 *
 * Elf64_Sym (24B): st_name@0x00 (u32), st_info@0x04 (u8), st_other@0x05 (u8),
 *   st_shndx@0x06 (u16), st_value@0x08 (u64), st_size@0x10 (u64).
 * Elf64_Shdr (64B): sh_name@0x00, sh_type@0x04, sh_flags@0x08, sh_addr@0x10,
 *   sh_offset@0x18, sh_size@0x20, sh_link@0x28, sh_info@0x2c, sh_addralign@0x30,
 *   sh_entsize@0x38.
 */
import { describe, expect, it } from 'vitest';

import { ElfLoader } from '@modules/native-emulator/ElfLoader';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;
const SHT_STRTAB = 3;
const SHT_DYNSYM = 11;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

/**
 * Build an ELF64 .so with one PT_LOAD code segment and a .dynsym/.dynstr pair
 * exporting two function symbols at known virtual addresses.
 */
function buildSoWithSymbols(): { bytes: Uint8Array; sign: number; helper: number } {
  const EHDR = 64;
  const PHDR = 56;
  const SHDR = 64;

  const code = [
    0xc0,
    0x03,
    0x5f,
    0xd6, // ret  (at sign)
    0xc0,
    0x03,
    0x5f,
    0xd6, // ret  (at helper)
  ];
  const segVaddr = 0x1000;
  const signAddr = segVaddr; // first symbol
  const helperAddr = segVaddr + 4; // second symbol

  // .dynstr: "\0sign\0helper\0"
  const dynstr = Uint8Array.from([
    0x00,
    ...[...'sign'].map((c) => c.charCodeAt(0)),
    0x00,
    ...[...'helper'].map((c) => c.charCodeAt(0)),
    0x00,
  ]);
  const nameSign = 1; // offset of "sign" in dynstr
  const nameHelper = 6; // offset of "helper"

  // .dynsym: index 0 is the reserved null symbol, then sign, helper.
  const SYM = 24;
  const dynsym = new Uint8Array(SYM * 3);
  {
    const dv = new DataView(dynsym.buffer);
    // [1] sign
    dv.setUint32(SYM * 1 + 0x00, nameSign, true);
    dv.setUint8(SYM * 1 + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
    dv.setUint16(SYM * 1 + 0x06, 1, true); // st_shndx (some defined section)
    dv.setBigUint64(SYM * 1 + 0x08, BigInt(signAddr), true);
    // [2] helper
    dv.setUint32(SYM * 2 + 0x00, nameHelper, true);
    dv.setUint8(SYM * 2 + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
    dv.setUint16(SYM * 2 + 0x06, 1, true);
    dv.setBigUint64(SYM * 2 + 0x08, BigInt(helperAddr), true);
  }

  // File layout:
  //   0x00            Ehdr
  //   EHDR            Phdr (1 PT_LOAD)
  //   segOffset       code
  //   dynstrOffset    .dynstr
  //   dynsymOffset    .dynsym
  //   shoff           section headers (4 entries: null, .dynsym, .dynstr, +pad)
  const segOffset = EHDR + PHDR;
  const dynstrOffset = segOffset + code.length;
  const dynsymOffset = dynstrOffset + dynstr.length;
  const shoff = dynsymOffset + dynsym.length;
  const SH_NULL = 0;
  const SH_DYNSYM = 1;
  const SH_DYNSTR = 2;
  const shnum = 3;
  const total = shoff + SHDR * shnum;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Ehdr
  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setUint32(0x14, 1, true);
  dv.setBigUint64(0x18, BigInt(signAddr), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true); // e_phoff
  dv.setBigUint64(0x28, BigInt(shoff), true); // e_shoff
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true); // e_phnum
  dv.setUint16(0x3a, SHDR, true); // e_shentsize
  dv.setUint16(0x3c, shnum, true); // e_shnum
  dv.setUint16(0x3e, 0, true); // e_shstrndx

  // Phdr
  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b101, true);
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true);
  dv.setBigUint64(p + 0x28, BigInt(code.length), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);

  // Contents
  u8.set(code, segOffset);
  u8.set(dynstr, dynstrOffset);
  u8.set(dynsym, dynsymOffset);

  // Section headers
  const writeShdr = (
    idx: number,
    shType: number,
    shOffset: number,
    shSize: number,
    shLink: number,
    shEntsize: number,
  ): void => {
    const s = shoff + idx * SHDR;
    dv.setUint32(s + 0x00, 0, true); // sh_name (unused here)
    dv.setUint32(s + 0x04, shType, true);
    dv.setBigUint64(s + 0x18, BigInt(shOffset), true);
    dv.setBigUint64(s + 0x20, BigInt(shSize), true);
    dv.setUint32(s + 0x28, shLink, true);
    dv.setBigUint64(s + 0x38, BigInt(shEntsize), true);
  };
  writeShdr(SH_NULL, 0, 0, 0, 0, 0);
  writeShdr(SH_DYNSYM, SHT_DYNSYM, dynsymOffset, dynsym.length, SH_DYNSTR, SYM);
  writeShdr(SH_DYNSTR, SHT_STRTAB, dynstrOffset, dynstr.length, 0, 0);

  return { bytes: u8, sign: signAddr, helper: helperAddr };
}

describe('ElfLoader — L2 dynamic symbol parsing', () => {
  it('resolves exported symbol names to virtual addresses', () => {
    const { bytes, sign, helper } = buildSoWithSymbols();
    const elf = new ElfLoader(bytes);
    const symbols = elf.exportedSymbols();
    expect(symbols.get('sign')).toBe(sign);
    expect(symbols.get('helper')).toBe(helper);
  });

  it('skips the reserved null symbol (index 0)', () => {
    const { bytes } = buildSoWithSymbols();
    const elf = new ElfLoader(bytes);
    const symbols = elf.exportedSymbols();
    expect(symbols.has('')).toBe(false);
    expect(symbols.size).toBe(2);
  });

  it('returns an empty map when there is no dynamic symbol table', () => {
    // Reuse the L1-style fixture path: an object with no section headers.
    const minimal = new Uint8Array(64 + 56);
    const dv = new DataView(minimal.buffer);
    minimal.set([0x7f, 0x45, 0x4c, 0x46], 0);
    dv.setUint8(4, 2);
    dv.setUint8(5, 1);
    dv.setUint16(0x12, EM_AARCH64, true);
    dv.setBigUint64(0x20, 64n, true);
    dv.setUint16(0x36, 56, true);
    dv.setUint16(0x38, 0, true); // no segments
    const elf = new ElfLoader(minimal);
    expect(elf.exportedSymbols().size).toBe(0);
  });
});

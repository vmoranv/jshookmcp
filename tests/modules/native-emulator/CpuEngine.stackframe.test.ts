/**
 * L3 TDD — STP/LDP pair instructions + real AAPCS nested calls with stack frames.
 *
 * With LDR/STR in place we can now spill/restore registers, which unlocks the
 * standard AArch64 function prologue/epilogue:
 *   stp x29, x30, [sp, #-16]!   ; save FP+LR, allocate frame
 *   ...                          ; body (may BL into a helper)
 *   ldp x29, x30, [sp], #16      ; restore FP+LR, free frame
 *   ret                          ; return through restored LR
 *
 * This is the nested-call case that callSymbol.test.ts deferred ("needs STR/LDR
 * (L3 memory)"). callSymbol now seeds SP with a real stack region so prologues
 * have somewhere to push to.
 *
 * Encodings (verified against an assembler):
 *   stp x29,x30,[sp,#-16]! = 0xA9BF7BFD  (pre-index, imm7=-2 → ×8 = -16)
 *   ldp x29,x30,[sp],#16   = 0xA8C17BFD  (post-index, imm7=+2 → ×8 = +16)
 *   stp x0,x1,[sp,#16]     = 0xA90107E0  (signed offset)
 *   ldp x0,x1,[sp,#16]     = 0xA94107E0
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;
const SHT_DYNSYM = 11;
const SHT_STRTAB = 3;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

interface SymbolSpec {
  name: string;
  codeOffset: number;
}

/** Assemble a .so with a code segment and named function exports (shared with callSymbol tests). */
function buildSo(code: number[], symbols: SymbolSpec[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const SHDR = 64;
  const SYM = 24;

  let dynstrStr = '\0';
  const nameOffsets = new Map<string, number>();
  for (const s of symbols) {
    nameOffsets.set(s.name, dynstrStr.length);
    dynstrStr += s.name + '\0';
  }
  const dynstr = Uint8Array.from([...dynstrStr].map((c) => c.charCodeAt(0)));

  const dynsym = new Uint8Array(SYM * (symbols.length + 1));
  {
    const dv = new DataView(dynsym.buffer);
    symbols.forEach((s, i) => {
      const base = SYM * (i + 1);
      dv.setUint32(base + 0x00, nameOffsets.get(s.name)!, true);
      dv.setUint8(base + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
      dv.setUint16(base + 0x06, 1, true);
      dv.setBigUint64(base + 0x08, BigInt(segVaddr + s.codeOffset), true);
    });
  }

  const segOffset = EHDR + PHDR;
  const dynstrOffset = segOffset + code.length;
  const dynsymOffset = dynstrOffset + dynstr.length;
  const shoff = dynsymOffset + dynsym.length;
  const shnum = 3;
  const total = shoff + SHDR * shnum;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setBigUint64(0x18, BigInt(segVaddr), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setBigUint64(0x28, BigInt(shoff), true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true);
  dv.setUint16(0x3a, SHDR, true);
  dv.setUint16(0x3c, shnum, true);

  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b101, true);
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true);
  dv.setBigUint64(p + 0x28, BigInt(code.length), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);

  u8.set(code, segOffset);
  u8.set(dynstr, dynstrOffset);
  u8.set(dynsym, dynsymOffset);

  const writeShdr = (
    idx: number,
    shType: number,
    shOffset: number,
    shSize: number,
    shLink: number,
    shEntsize: number,
  ): void => {
    const s = shoff + idx * SHDR;
    dv.setUint32(s + 0x04, shType, true);
    dv.setBigUint64(s + 0x18, BigInt(shOffset), true);
    dv.setBigUint64(s + 0x20, BigInt(shSize), true);
    dv.setUint32(s + 0x28, shLink, true);
    dv.setBigUint64(s + 0x38, BigInt(shEntsize), true);
  };
  writeShdr(0, 0, 0, 0, 0, 0);
  writeShdr(1, SHT_DYNSYM, dynsymOffset, dynsym.length, 2, SYM);
  writeShdr(2, SHT_STRTAB, dynstrOffset, dynstr.length, 0, 0);

  return u8;
}

/** Little-endian split of a 32-bit instruction word into 4 code bytes. */
function le(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

describe('CpuEngine STP/LDP + nested stack frames — L3', () => {
  it('STP (pre-index) writes both registers and updates the base', () => {
    const engine = new CpuEngine();
    const STACK = 0x9000;
    engine.mapMemory(STACK - 64, 128);
    engine.writeRegister('sp', STACK);
    engine.writeRegister('x29', 0xaa);
    engine.writeRegister('x30', 0xbb);
    // stp x29, x30, [sp, #-16]!  = 0xA9BF7BFD
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le(0xa9bf7bfd)));
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('sp')).toBe(STACK - 16);
    expect(engine.readRegister('x29')).toBe(0xaa);
    expect(Array.from(engine.readMemory(STACK - 16, 1))).toEqual([0xaa]); // Rt at [sp]
    expect(Array.from(engine.readMemory(STACK - 8, 1))).toEqual([0xbb]); // Rt2 at [sp+8]
  });

  it('LDP (post-index) reads both registers then advances the base', () => {
    const engine = new CpuEngine();
    const STACK = 0x9000;
    engine.mapMemory(STACK - 64, 128);
    engine.writeRegister('sp', STACK);
    engine.writeCode(STACK, Uint8Array.from([0x11, 0, 0, 0, 0, 0, 0, 0])); // → x0
    engine.writeCode(STACK + 8, Uint8Array.from([0x22, 0, 0, 0, 0, 0, 0, 0])); // → x1
    // ldp x0, x1, [sp], #16  = 0xA8C107E0
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le(0xa8c107e0)));
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('x0')).toBe(0x11);
    expect(engine.readRegister('x1')).toBe(0x22);
    expect(engine.readRegister('sp')).toBe(STACK + 16);
  });

  it('callSymbol runs a real nested call with prologue/epilogue stack frame', () => {
    // caller(x0): saves FP/LR, BLs helper (which clobbers nothing of ours),
    //             adds helper result, restores FP/LR, returns.
    //   caller @0x1000:
    //     stp x29,x30,[sp,#-16]!   0xA9BF7BFD
    //     bl  helper (@0x1014, +0x10 = 4 insns from 0x1004)  0x94000004
    //     add x0, x0, x1            (x1 set by helper)   0x8B010000
    //     ldp x29,x30,[sp],#16     0xA8C17BFD
    //     ret                       0xD65F03C0
    //   helper @0x1014: movz x1,#5 ; ret
    //     movz x1,#5               0x528000A1
    //     ret                      0xD65F03C0
    const code = [
      ...le(0xa9bf7bfd), // 0x1000 stp x29,x30,[sp,#-16]!
      ...le(0x94000004), // 0x1004 bl helper (0x1004 + 4*4 = 0x1014)
      ...le(0x8b010000), // 0x1008 add x0, x0, x1
      ...le(0xa8c17bfd), // 0x100c ldp x29,x30,[sp],#16
      ...le(0xd65f03c0), // 0x1010 ret
      ...le(0x528000a1), // 0x1014 movz x1, #5   (helper)
      ...le(0xd65f03c0), // 0x1018 ret
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'caller', codeOffset: 0 }]));
    // caller(37) → 37 + 5 = 42, proving LR survived the nested BL via the stack.
    expect(engine.callSymbol('caller', [37])).toBe(42);
  });
});

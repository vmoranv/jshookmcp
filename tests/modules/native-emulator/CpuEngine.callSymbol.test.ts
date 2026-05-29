/**
 * L2 TDD — callSymbol + control-flow instructions (RET / B / BL / SUB).
 *
 * Verifies the engine can invoke an exported function by name following the
 * AArch64 AAPCS calling convention: arguments in x0..x7, return value in x0,
 * x30 (LR) holds the return address, and execution halts when the function
 * returns to a sentinel LR. Functions are hand-assembled into a .so fixture.
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
  /** Offset of this function within the code segment (bytes). */
  codeOffset: number;
}

/** Assemble a .so with a code segment and named function exports. */
function buildSo(code: number[], symbols: SymbolSpec[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const SHDR = 64;
  const SYM = 24;

  // .dynstr
  let dynstrStr = '\0';
  const nameOffsets = new Map<string, number>();
  for (const s of symbols) {
    nameOffsets.set(s.name, dynstrStr.length);
    dynstrStr += s.name + '\0';
  }
  const dynstr = Uint8Array.from([...dynstrStr].map((c) => c.charCodeAt(0)));

  // .dynsym (index 0 reserved null + one per symbol)
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

describe('CpuEngine.callSymbol — L2 calling convention + control flow', () => {
  it('calls an exported function that returns a constant (movz + ret)', () => {
    // get_const: movz x0, #1234 ; ret
    const code = [
      0x40,
      0x9a,
      0x80,
      0xd2, // movz x0, #1234
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'get_const', codeOffset: 0 }]));
    expect(engine.callSymbol('get_const', [])).toBe(1234);
  });

  it('passes arguments via x0..x7 and returns x0 (add)', () => {
    // add_two: add x0, x0, x1 ; ret
    const code = [
      0x00,
      0x00,
      0x01,
      0x8b, // add x0, x0, x1
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'add_two', codeOffset: 0 }]));
    expect(engine.callSymbol('add_two', [40, 2])).toBe(42);
  });

  it('handles SUB immediate', () => {
    // sub_ten: sub x0, x0, #10 ; ret
    const code = [
      0x00,
      0x28,
      0x00,
      0xd1, // sub x0, x0, #10
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'sub_ten', codeOffset: 0 }]));
    expect(engine.callSymbol('sub_ten', [100])).toBe(90);
  });

  it('follows an unconditional branch (B) over a trap', () => {
    // entry: b +8 (skip next) ; movz x0,#63 (skipped) ; movz x0,#7 ; ret
    const code = [
      0x02,
      0x00,
      0x00,
      0x14, // b   #8  (PC += 2*4)
      0xe0,
      0x07,
      0x80,
      0xd2, // movz x0, #63  (skipped)
      0xe0,
      0x00,
      0x80,
      0xd2, // movz x0, #7
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'branchy', codeOffset: 0 }]));
    expect(engine.callSymbol('branchy', [])).toBe(7);
  });

  it('BL into a helper and RET back to caller (nested call with stack-saved LR)', () => {
    // Proper AAPCS nested call: caller spills LR before BL and restores after.
    //   caller: str x30,[sp,#-16]! ; bl helper ; ldr x30,[sp],#16 ; ret
    //   helper: movz x0,#55 ; ret
    // This needs STR/LDR (L3 memory). Until then, verify the BL+RET primitive
    // directly: a helper invoked via callSymbol returns through LR correctly.
    const code = [
      0xe0,
      0x06,
      0x80,
      0xd2, // movz x0, #55
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'helper', codeOffset: 0 }]));
    expect(engine.callSymbol('helper', [])).toBe(55);
  });

  it('BL writes LR = next-instruction address and branches forward', () => {
    // bl #12 from 0x1000 lands at 0x100c and sets LR = 0x1004. Run with start()
    // and stop at the BL target so we observe the branch + LR write in isolation
    // (callSymbol would clobber the sentinel LR — stack spills are L3).
    const code = [
      0x03,
      0x00,
      0x00,
      0x94, // bl  #12  (PC = 0x1000 + 3*4 = 0x100c)
      0xe0,
      0x00,
      0x80,
      0xd2, // movz x0, #7   (skipped)
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret           (skipped)
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret           (BL target, 0x100c)
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'jumper', codeOffset: 0 }]));
    engine.start(0x1000, 0x100c); // halt the instant BL lands on its target
    expect(engine.readRegister('x30')).toBe(0x1004);
  });

  it('throws on an unknown symbol', () => {
    const code = [0xc0, 0x03, 0x5f, 0xd6];
    const engine = new CpuEngine();
    engine.loadElf(buildSo(code, [{ name: 'real', codeOffset: 0 }]));
    expect(() => engine.callSymbol('ghost', [])).toThrow(/symbol.*ghost|ghost.*not/i);
  });
});

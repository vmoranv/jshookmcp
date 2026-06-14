/**
 * L6 TDD — extended integer ISA (Phase 1b).
 *
 * Covers the instruction families added to lift the engine from a hand-built
 * demo subset toward executing real compiler output: wide-immediate MOVK/MOVN,
 * PC-relative ADRP/ADR, logical-immediate AND/ORR, bitfield LSL/LSR (UBFM),
 * multiply/divide (MADD/MSUB/UMULH/UDIV/SDIV), variable shifts (LSLV/LSRV/RORV),
 * conditional select (CSEL/CSINC), CCMP, TBZ/TBNZ, ADC, and 1-source
 * RBIT/REV/CLZ. Encodings are assembler-verified (computed against the standard
 * AArch64 field layout); each test runs a tiny program through start()/registers.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/** Little-endian split of a 32-bit instruction word into 4 code bytes. */
function le32(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

/** Map a program at BASE, run from BASE to BASE+len, return the engine. */
function runProgram(words: number[], base = 0x1000): CpuEngine {
  const engine = new CpuEngine();
  const bytes = words.flatMap(le32);
  engine.mapMemory(base, bytes.length + 16);
  engine.writeCode(base, Uint8Array.from(bytes));
  engine.start(base, base + words.length * 4);
  return engine;
}

/**
 * Run a program that ends by storing x0 to a scratch buffer (str x0,[x1] =
 * 0xf9000020, with x1 pre-pointed at SCRATCH), and return the 8 stored bytes.
 * Lets us assert full 64-bit results without readRegister's Number precision loss.
 */
const SCRATCH = 0x4000;
function runAndReadX0(words: number[], base = 0x1000): number[] {
  const engine = new CpuEngine();
  engine.mapMemory(SCRATCH, 16);
  engine.writeRegister('x1', SCRATCH);
  const full = [...words, 0xf9000020]; // str x0,[x1]
  const bytes = full.flatMap(le32);
  engine.mapMemory(base, bytes.length + 16);
  engine.writeCode(base, Uint8Array.from(bytes));
  engine.start(base, base + full.length * 4);
  return Array.from(engine.readMemory(SCRATCH, 8));
}

describe('CpuEngine extended ISA — wide immediates', () => {
  it('MOVK keeps other lanes and inserts the 16-bit field (movz #5 ; movk #0x1234,lsl16)', () => {
    // movz x0,#5 (0xd28000a0) ; movk x0,#0x1234,lsl#16 (0xf2a24680)
    const engine = runProgram([0xd28000a0, 0xf2a24680]);
    expect(engine.readRegister('x0')).toBe(0x12340005);
  });

  it('MOVN moves the inverted immediate (movn x0,#0 → all ones)', () => {
    // movn x0,#0 (0x92800000) → ~0 = 0xffffffffffffffff (all bytes 0xff)
    expect(runAndReadX0([0x92800000])).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });
});

describe('CpuEngine extended ISA — PC-relative addressing', () => {
  it('ADR computes PC + immediate', () => {
    // adr x0, #(2<<2 | 0) from PC=0x1000 → 0x1000 + 8 = 0x1008
    const engine = runProgram([0x10000040]);
    expect(engine.readRegister('x0')).toBe(0x1008);
  });

  it('ADRP computes (PC & ~0xfff) + (imm << 12)', () => {
    // adrp x0, immhi=2 (0x90000040): imm21 = (2<<2)|0 = 8 → 8<<12 = 0x8000.
    // base = 0x1000 & ~0xfff = 0x1000. Result = 0x1000 + 0x8000 = 0x9000.
    const engine = runProgram([0x90000040], 0x1000);
    expect(engine.readRegister('x0')).toBe(0x9000);
  });
});

describe('CpuEngine extended ISA — logical immediate', () => {
  it('AND (immediate) masks the low byte (movz #0x1ff ; and x0,x0,#0xff)', () => {
    // movz x0,#0x1ff (0xd2803fe0) ; and x0,x0,#0xff (0x92401c00)
    const engine = runProgram([0xd2803fe0, 0x92401c00]);
    expect(engine.readRegister('x0')).toBe(0xff);
  });

  it('ORR (immediate) sets a bit (movz #0 ; orr x0,x0,#1)', () => {
    const engine = runProgram([0xd2800000, 0xb2400000]);
    expect(engine.readRegister('x0')).toBe(1);
  });
});

describe('CpuEngine extended ISA — bitfield (UBFM aliases)', () => {
  it('LSL #4 via UBFM (movz #3 ; lsl x0,x0,#4)', () => {
    // movz x0,#3 (0xd2800060) ; lsl x0,x0,#4 (0xd37cec00)
    const engine = runProgram([0xd2800060, 0xd37cec00]);
    expect(engine.readRegister('x0')).toBe(48);
  });

  it('LSR #4 via UBFM (movz #0x80 ; lsr x0,x0,#4)', () => {
    // movz x0,#0x80 (0xd2801000) ; lsr x0,x0,#4 (0xd344fc00)
    const engine = runProgram([0xd2801000, 0xd344fc00]);
    expect(engine.readRegister('x0')).toBe(8);
  });
});

describe('CpuEngine extended ISA — multiply / divide', () => {
  it('MADD computes Ra + Rn*Rm (3*4 + 5 = 17)', () => {
    // movz x1,#3 ; movz x2,#4 ; movz x3,#5 ; madd x0,x1,x2,x3
    const engine = runProgram([0xd2800061, 0xd2800082, 0xd28000a3, 0x9b020c20]);
    expect(engine.readRegister('x0')).toBe(17);
  });

  it('32-bit MSUB truncates operands to Wn/Wm before multiply (dirty high bits dropped)', () => {
    // Regression: a real .so hit MSUB where Rn carried garbage above bit 31
    // (0x5de9bd37ff). The 32-bit form must read only Wn<31:0>, multiply Wm,
    // subtract from Wa, and zero-extend — never fold the dirty high bits in.
    // Before the fix the 64-bit product leaked through and the subsequent
    // indexed load read an unmapped 14 GB address, crashing sqlite3_initialize.
    //   insn 0x1b15a128 = MSUB w8, w9, w21, w8  (sf=0, o0=1, Rm=21, Ra=8, Rn=9, Rd=8)
    //   Wd = Wa - Wn*Wm, all 32-bit.
    const engine = new CpuEngine();
    engine.writeGprValue(9, 0x5de9bd37ffn); // dirty: high bits set
    engine.writeGprValue(21, 0x17n);
    engine.writeGprValue(8, 0x87n);
    const bytes = le32(0x1b15a128);
    engine.mapMemory(0x1000, bytes.length + 16);
    engine.writeCode(0x1000, Uint8Array.from(bytes));
    engine.start(0x1000, 0x1000 + 4);
    const got = engine.readGprValue(8);
    // Reference: 32-bit MSUB on truncated operands.
    const wn = 0x5de9bd37ffn & 0xffffffffn; // 0xe9bd37ff
    const wm = 0x17n;
    const wa = 0x87n;
    const expected = (wa - wn * wm) & 0xffffffffn;
    expect(got).toBe(expected);
    // The dirty high bits must NOT push the result toward the pre-fix value
    // (0x70000014, which dereferenced 14 GB and crashed).
    expect(got).not.toBe(0x70000014n);
  });

  it('MSUB computes Ra - Rn*Rm (32-bit: 5 - 3*4 = -7 → 0xfffffff9)', () => {
    // 32-bit W-regs so the result fits a JS number exactly:
    // movz w1,#3 ; movz w2,#4 ; movz w3,#5 ; msub w0,w1,w2,w3
    const engine = runProgram([0x52800061, 0x52800082, 0x528000a3, 0x1b028c20]);
    expect(engine.readRegister('x0')).toBe(0xfffffff9);
  });

  it('UDIV truncates toward zero (20 / 6 = 3)', () => {
    // movz x0,#20 ; movz x1,#6 ; udiv x0,x0,x1
    const engine = runProgram([0xd2800280, 0xd28000c1, 0x9ac10800]);
    expect(engine.readRegister('x0')).toBe(3);
  });

  it('UDIV by zero yields 0 (AArch64 semantics)', () => {
    // movz x0,#20 ; movz x1,#0 ; udiv x0,x0,x1
    const engine = runProgram([0xd2800280, 0xd2800001, 0x9ac10800]);
    expect(engine.readRegister('x0')).toBe(0);
  });

  it('SDIV handles signed operands (32-bit: -10 / 5 = -2 → 0xfffffffe)', () => {
    // movn w0,#9 (=-10) ; movz w1,#5 ; sdiv w0,w0,w1 → -2 → 0xfffffffe (W-reg)
    const engine = runProgram([0x12800120, 0x528000a1, 0x1ac10c00]);
    expect(engine.readRegister('x0')).toBe(0xfffffffe);
  });

  it('SMADDL widens 32-bit operands into a 64-bit accumulate (3*4 + 5 = 17)', () => {
    // movz w1,#3 ; movz w2,#4 ; movz x3,#5 ; smaddl x0,w1,w2,x3
    const engine = runProgram([0x52800061, 0x52800082, 0xd28000a3, 0x9b220c20]);
    expect(engine.readRegister('x0')).toBe(17);
  });

  it('UMADDL widens unsigned 32-bit operands (3*4 + 5 = 17)', () => {
    // movz w1,#3 ; movz w2,#4 ; movz x3,#5 ; umaddl x0,w1,w2,x3
    const engine = runProgram([0x52800061, 0x52800082, 0xd28000a3, 0x9ba20c20]);
    expect(engine.readRegister('x0')).toBe(17);
  });
});

describe('CpuEngine extended ISA — variable shifts', () => {
  it('LSLV shifts left by a register amount (1 << 4 = 16)', () => {
    // movz x0,#1 ; movz x1,#4 ; lslv x0,x0,x1
    const engine = runProgram([0xd2800020, 0xd2800081, 0x9ac12000]);
    expect(engine.readRegister('x0')).toBe(16);
  });

  it('LSRV shifts right by a register amount (0x80 >> 3 = 16)', () => {
    // movz x0,#0x80 ; movz x1,#3 ; lsrv x0,x0,x1
    const engine = runProgram([0xd2801000, 0xd2800061, 0x9ac12400]);
    expect(engine.readRegister('x0')).toBe(16);
  });
});

describe('CpuEngine extended ISA — conditional select', () => {
  it('CSEL picks Rn when cond holds (cmp equal → EQ true → x1)', () => {
    // movz x1,#11 ; movz x2,#22 ; cmp x1,x1 (subs xzr,x1,x1=0xeb01003f) ; csel x0,x1,x2,eq
    const engine = runProgram([0xd2800161, 0xd28002c2, 0xeb01003f, 0x9a820020]);
    expect(engine.readRegister('x0')).toBe(11);
  });

  it('CSINC returns Rm+1 when cond fails (cmp unequal → EQ false → x2+1=23)', () => {
    // movz x1,#11 ; movz x2,#22 ; cmp x1,x2 (subs xzr,x1,x2=0xeb02003f) ; csinc x0,x1,x2,eq
    const engine = runProgram([0xd2800161, 0xd28002c2, 0xeb02003f, 0x9a820420]);
    expect(engine.readRegister('x0')).toBe(23);
  });

  it('CCMP (immediate) compares when cond holds (5==5 → EQ → ccmp sets Z)', () => {
    // movz x0,#5 ; movz x1,#5 ; subs xzr,x0,x1 (EQ true, 0xeb01001f) ;
    // ccmp x0,#5,#0,eq (0xfa450800) → since EQ holds, compare x0-5 → Z=1 ;
    // cset x0,eq (0x9a9f17e0) materializes Z into x0.
    const engine = runProgram([0xd28000a0, 0xd28000a1, 0xeb01001f, 0xfa450800, 0x9a9f17e0]);
    expect(engine.readRegister('x0')).toBe(1);
  });
});

describe('CpuEngine extended ISA — test-bit branch', () => {
  it('TBZ branches when the tested bit is zero (skips a trap)', () => {
    // movz x0,#0 (bit3=0) ; tbz x0,#3,+2w (skip next) ; movz x0,#63 (skipped) ; movz x0,#7
    const engine = runProgram([0xd2800000, 0x36180040, 0xd28007e0, 0xd28000e0]);
    expect(engine.readRegister('x0')).toBe(7);
  });

  it('TBNZ branches when the tested bit is one', () => {
    // movz x0,#8 (bit3=1) ; tbnz x0,#3,+2w (taken, skip next) ; movz x0,#63 (skipped) ; movz x0,#7
    // tbnz x0,#3,+2 = 0x37180040
    const engine = runProgram([0xd2800100, 0x37180040, 0xd28007e0, 0xd28000e0]);
    expect(engine.readRegister('x0')).toBe(7);
  });
});

describe('CpuEngine extended ISA — add-with-carry', () => {
  it('ADC adds the carry flag (subs sets C=1, then adc adds 1 extra)', () => {
    // movz x0,#5 ; movz x1,#3 ; subs xzr,x0,x1 (C=1 no borrow=0xeb01001f) ; adc x0,x0,x1 → 5+3+1=9
    const engine = runProgram([0xd28000a0, 0xd2800061, 0xeb01001f, 0x9a010000]);
    expect(engine.readRegister('x0')).toBe(9);
  });
});

describe('CpuEngine extended ISA — 1-source bit ops', () => {
  it('CLZ counts leading zeros (movz #1 → 63 in 64-bit)', () => {
    // movz x0,#1 ; clz x0,x0
    const engine = runProgram([0xd2800020, 0xdac01000]);
    expect(engine.readRegister('x0')).toBe(63);
  });

  it('REV byte-reverses a 64-bit value (0x1122 → 0x2211000000000000)', () => {
    // movz x0,#0x1122 (0xd2822440) ; rev x0,x0 (0xdac00c00).
    // 0x0000000000001122 byte-reversed = 0x2211000000000000 → LE bytes below.
    expect(runAndReadX0([0xd2822440, 0xdac00c00])).toEqual([0, 0, 0, 0, 0, 0, 0x11, 0x22]);
  });

  it('RBIT reverses bit order (movz #1 → bit0 → bit63)', () => {
    // movz x0,#1 ; rbit x0,x0 → 0x8000000000000000 little-endian
    expect(runAndReadX0([0xd2800020, 0xdac00000])).toEqual([0, 0, 0, 0, 0, 0, 0, 0x80]);
  });
});

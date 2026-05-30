/**
 * L1 TDD — NEON F-2 groups (Phase F-2): two-register-misc, copy (DUP),
 * modified-immediate (MOVI/MVNI), shift-by-immediate (SHL/USHR/SSHR),
 * across-lanes (ADDV/SMAXV/UMINV), permute (ZIP/UZP/TRN), EXT, TBL.
 *
 * Each test runs a real instruction word through CpuEngine and checks the V
 * register / GPR result, proving the named-bitfield decode for that group.
 * Bases are assembler-verified (scripts/_verify_neon_f2_encoding.mjs).
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const hex = (v: Uint8Array): string => [...v].map((x) => x.toString(16).padStart(2, '0')).join('');
const reg2 = (base: number, rd: number, rn: number): number =>
  (base | (rd & 31) | ((rn & 31) << 5)) >>> 0;
const reg3 = (base: number, rd: number, rn: number, rm: number): number =>
  (base | (rd & 31) | ((rn & 31) << 5) | ((rm & 31) << 16)) >>> 0;

function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const bytes = le(insn);
  const code = 0x5000;
  engine.mapMemory(code, bytes.length + 8);
  engine.writeCode(code, Uint8Array.from(bytes));
  engine.start(code, code + bytes.length);
  return engine;
}
const v = (...bytes: number[]): Uint8Array => {
  const o = new Uint8Array(16);
  o.set(bytes);
  return o;
};
const v4s = (a: number, b: number, c: number, d: number): Uint8Array => {
  const o = new Uint8Array(16);
  const dv = new DataView(o.buffer);
  dv.setUint32(0, a >>> 0, true);
  dv.setUint32(4, b >>> 0, true);
  dv.setUint32(8, c >>> 0, true);
  dv.setUint32(12, d >>> 0, true);
  return o;
};
const u32 = (vv: Uint8Array, lane: number): number =>
  new DataView(vv.buffer).getUint32(lane * 4, true) >>> 0;

describe('NEON two-register misc instructions', () => {
  it('NEG 16B negates each byte', () => {
    const e = runOne((eng) => eng.writeVReg(1, v(1, 5, 0)), reg2(0x6e20b800, 0, 1));
    expect(hex(e.readVReg(0)).slice(0, 6)).toBe('fffb00'); // -1=ff, -5=fb, -0=00
  });
  it('CNT counts set bits per byte', () => {
    const e = runOne((eng) => eng.writeVReg(1, v(0xff, 0x0f, 0x01)), reg2(0x4e205800, 0, 1));
    expect(hex(e.readVReg(0)).slice(0, 6)).toBe('080401');
  });
  it('NOT (U=1) complements bytes', () => {
    const e = runOne((eng) => eng.writeVReg(1, v(0x0f, 0xf0)), reg2(0x6e205800, 0, 1));
    expect(hex(e.readVReg(0)).slice(0, 4)).toBe('f00f');
  });
  it('REV64 16B reverses bytes within 8-byte groups', () => {
    const e = runOne(
      (eng) => eng.writeVReg(1, v(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)),
      reg2(0x4e200800, 0, 1),
    );
    expect(hex(e.readVReg(0))).toBe('07060504030201000f0e0d0c0b0a0908');
  });
});

describe('NEON copy (DUP) instructions', () => {
  it('DUP element 4S broadcasts a lane', () => {
    // DUP V0.4S, V1.S[1] : imm5 = 01100 (size=2 index=1) → base 0x4e0c0400
    const e = runOne(
      (eng) => eng.writeVReg(1, v4s(0xaaaa, 0xdeadbeef | 0, 0xcccc, 0xdddd)),
      reg2(0x4e0c0400, 0, 1),
    );
    const out = e.readVReg(0);
    expect(u32(out, 0)).toBe(0xdeadbeef);
    expect(u32(out, 3)).toBe(0xdeadbeef);
  });
  it('DUP general 4S broadcasts a GPR', () => {
    // DUP V0.4S, W1 : imm5=01100 imm4=0001 → base 0x4e0c0c00
    const e = runOne((eng) => eng.writeGprValue(1, 0x12345678n), reg2(0x4e0c0c00, 0, 1));
    expect(u32(e.readVReg(0), 0)).toBe(0x12345678);
    expect(u32(e.readVReg(0), 2)).toBe(0x12345678);
  });
});

describe('NEON modified immediate (MOVI/MVNI)', () => {
  it('MOVI 4S #1 loads the immediate into every lane', () => {
    // MOVI V0.4S, #1 : cmode=0000 op=0, imm8=1. imm8 splits abc[18:16]:defgh[9:5];
    // value 1 lives entirely in defgh, so OR (1<<5) — NOT bit0 (that is Rd).
    const insn = (0x4f000400 | (1 << 5)) >>> 0;
    const e = runOne(() => {}, insn);
    // cmode 0000 places the byte in each 32-bit lane: 0x00000001 per lane.
    expect(u32(e.readVReg(0), 0)).toBe(1);
    expect(u32(e.readVReg(0), 3)).toBe(1);
  });
  it('MVNI 4S inverts the immediate', () => {
    // MVNI V0.4S, #1 : op=1 cmode=0000 → ~0x00000001 = 0xfffffffe per lane
    const insn = (0x6f000400 | (1 << 5)) >>> 0;
    const e = runOne(() => {}, insn);
    expect(u32(e.readVReg(0), 0)).toBe(0xfffffffe);
  });
});

describe('NEON shift by immediate', () => {
  it('SHL 4S #4 shifts each lane left', () => {
    // SHL V0.4S, V1.4S, #4 : immh:immb = esize+shift = 32+4 = 36 = 0b0100100.
    // immh:immb sits at [22:16]; Rn=1 at [9:5] — without it we'd read the zero V0.
    const insn = (0x4f005400 | (0b0100100 << 16) | (1 << 5)) >>> 0;
    const e = runOne((eng) => eng.writeVReg(1, v4s(1, 2, 3, 4)), insn);
    expect(u32(e.readVReg(0), 0)).toBe(16);
    expect(u32(e.readVReg(0), 1)).toBe(32);
  });
  it('USHR 16B #1 logical-shifts each byte right', () => {
    // USHR with 8-bit: immh:immb = 2*esize - shift = 16-1 = 15 = 0b0001111. Rn=1.
    const insn = (0x6f000400 | (0b0001111 << 16) | (1 << 5)) >>> 0;
    const e = runOne((eng) => eng.writeVReg(1, v(0xff, 0x80)), insn);
    expect(hex(e.readVReg(0)).slice(0, 4)).toBe('7f40');
  });
});

describe('NEON across-lanes reductions', () => {
  it('ADDV 4S sums all lanes', () => {
    // ADDV S0, V1.4S : base 0x4eb1b800
    const e = runOne((eng) => eng.writeVReg(1, v4s(10, 20, 30, 40)), reg2(0x4eb1b800, 0, 1));
    expect(u32(e.readVReg(0), 0)).toBe(100);
  });
  it('SMAXV 16B finds the signed maximum', () => {
    // SMAXV B0, V1.16B : base 0x4e30a800
    const e = runOne((eng) => eng.writeVReg(1, v(0xff, 5, 3, 0xfe, 7)), reg2(0x4e30a800, 0, 1));
    expect(e.readVReg(0)[0]).toBe(7); // max(-1,5,3,-2,7,0...)=7
  });
});

describe('NEON permute (ZIP/UZP/TRN)', () => {
  it('ZIP1 4S interleaves low halves', () => {
    // ZIP1 V0.4S, V1.4S, V2.4S : base 0x4e823800
    const e = runOne(
      (eng) => {
        eng.writeVReg(1, v4s(0xa0, 0xa1, 0xa2, 0xa3));
        eng.writeVReg(2, v4s(0xb0, 0xb1, 0xb2, 0xb3));
      },
      reg3(0x4e823800, 0, 1, 2),
    );
    const out = e.readVReg(0);
    expect([u32(out, 0), u32(out, 1), u32(out, 2), u32(out, 3)]).toEqual([0xa0, 0xb0, 0xa1, 0xb1]);
  });
  it('UZP1 4S de-interleaves even lanes', () => {
    // UZP1 V0.4S, V1.4S, V2.4S : base 0x4e821800
    const e = runOne(
      (eng) => {
        eng.writeVReg(1, v4s(0xa0, 0xa1, 0xa2, 0xa3));
        eng.writeVReg(2, v4s(0xb0, 0xb1, 0xb2, 0xb3));
      },
      reg3(0x4e821800, 0, 1, 2),
    );
    const out = e.readVReg(0);
    expect([u32(out, 0), u32(out, 1), u32(out, 2), u32(out, 3)]).toEqual([0xa0, 0xa2, 0xb0, 0xb2]);
  });
});

describe('NEON EXT and TBL', () => {
  it('EXT #8 extracts a byte window from the Rn:Rm pair', () => {
    // EXT V0.16B, V1.16B, V2.16B, #8 : base 0x6e000000 | imm4(8)<<11
    const insn = (0x6e000000 | (2 << 16) | (8 << 11) | (1 << 5)) >>> 0;
    const e = runOne((eng) => {
      eng.writeVReg(1, v(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15));
      eng.writeVReg(2, v(16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31));
    }, insn);
    expect(hex(e.readVReg(0))).toBe('08090a0b0c0d0e0f1011121314151617');
  });
  it('TBL looks up bytes, zeroing out-of-range indices', () => {
    // TBL V0.16B, {V1.16B}, V2.16B : base 0x4e000000, len=0, tbx=0
    const insn = (0x4e000000 | (2 << 16) | (1 << 5)) >>> 0;
    const e = runOne((eng) => {
      eng.writeVReg(
        1,
        v(100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115),
      );
      eng.writeVReg(2, v(0, 5, 15, 16, 3)); // index 16 is out of range → 0
    }, insn);
    expect(hex(e.readVReg(0)).slice(0, 10)).toBe('6469730067'); // 100,105,115,0,103
  });
});

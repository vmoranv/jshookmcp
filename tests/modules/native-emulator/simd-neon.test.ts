/**
 * L1 TDD — NEON "three same" integer lane operations (Phase F-1). Two layers:
 *   1. The lane primitives (simd-neon) compute correct per-lane results across
 *      element sizes, with overflow wrap and signed/unsigned distinction.
 *   2. The *instructions* (ADD/SUB/MUL/AND/ORR/EOR/CMEQ/CMGT/SMAX/UMIN…),
 *      decoded and executed by CpuEngine from their real opcodes, drive the V
 *      register file to the same result — proving the named-bitfield decode.
 *
 * Instruction words use the verified three-same layout
 * (scripts/_verify_neon_encoding.mjs): 0 Q U 01110 size 1 Rm opcode[15:11] 1 Rn Rd.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import {
  neonAdd,
  neonAnd,
  neonCmgt,
  neonEor,
  neonMul,
  neonOrr,
  neonSmax,
  neonSub,
  neonUmin,
} from '@modules/native-emulator/simd-neon';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const hex = (v: Uint8Array): string => [...v].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Build a three-same instruction word: base carries Q/U/size/opcode; overlay Rd/Rn/Rm. */
const tsi = (base: number, rd: number, rn: number, rm: number): number =>
  (base | (rd & 31) | ((rn & 31) << 5) | ((rm & 31) << 16)) >>> 0;

// Verified bases (Rd=Rn=Rm=0):
const ADD_4S = 0x4ea08400;
const SUB_16B = 0x6e208400;
const MUL_8H = 0x4e609c00;
const AND_16B = 0x4e201c00;
const ORR_16B = 0x4ea01c00;
const EOR_16B = 0x6e201c00;
const CMGT_16B = 0x4e203400;
const CMEQ_4S = 0x6ea08c00;
const SMAX_16B = 0x4e206400;
const UMIN_16B = 0x6e206c00;

function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const bytes = le(insn);
  const code = 0x4000;
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

describe('NEON three-same primitives (simd-neon)', () => {
  it('ADD wraps per lane at each element size', () => {
    expect(hex(neonAdd(v(0xff), v(2), 0, 1))).toBe(hex(v(1))); // byte wrap
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    new DataView(a.buffer).setUint32(0, 0xffffffff, true);
    new DataView(b.buffer).setUint32(0, 2, true);
    expect(new DataView(neonAdd(a, b, 2, 1).buffer).getUint32(0, true)).toBe(1); // 32-bit wrap
  });

  it('SUB/MUL per lane', () => {
    expect(hex(neonSub(v(5), v(8), 0, 1))).toBe(hex(v(0xfd))); // 5-8 = -3
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    new DataView(a.buffer).setUint16(0, 300, true);
    new DataView(b.buffer).setUint16(0, 300, true);
    expect(new DataView(neonMul(a, b, 1, 1).buffer).getUint16(0, true)).toBe(0x5f90); // 90000 & 0xffff
  });

  it('logical AND/ORR/EOR', () => {
    expect(hex(neonAnd(v(0xf0), v(0x3c), 1))).toBe(hex(v(0x30)));
    expect(hex(neonOrr(v(0xf0), v(0x0c), 1))).toBe(hex(v(0xfc)));
    expect(hex(neonEor(v(0xff), v(0x0f), 1))).toBe(hex(v(0xf0)));
  });

  it('CMGT signed vs SMAX/UMIN', () => {
    expect(hex(neonCmgt(v(0x7f), v(0x80), 0, 1))).toBe(hex(v(0xff))); // 127 > -128
    expect(hex(neonSmax(v(0x80), v(0x7f), 0, 1))).toBe(hex(v(0x7f))); // max(-128,127)=127
    expect(hex(neonUmin(v(0x80), v(0x7f), 0, 1))).toBe(hex(v(0x7f))); // min(128,127)=127
  });
});

describe('NEON three-same instructions (CpuEngine) — decode + execution', () => {
  it('ADD 4S executes lane-wise', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    new DataView(a.buffer).setUint32(0, 100, true);
    new DataView(a.buffer).setUint32(4, 200, true);
    new DataView(b.buffer).setUint32(0, 1, true);
    new DataView(b.buffer).setUint32(4, 2, true);
    const e = runOne(
      (eng) => {
        eng.writeVReg(1, a);
        eng.writeVReg(2, b);
      },
      tsi(ADD_4S, 0, 1, 2),
    );
    expect(hex(e.readVReg(0))).toBe(hex(neonAdd(a, b, 2, 1)));
  });

  it('SUB 16B / MUL 8H match primitives', () => {
    const e1 = runOne(
      (eng) => {
        eng.writeVReg(1, v(10, 20, 30));
        eng.writeVReg(2, v(1, 5, 40));
      },
      tsi(SUB_16B, 0, 1, 2),
    );
    expect(hex(e1.readVReg(0))).toBe(hex(neonSub(v(10, 20, 30), v(1, 5, 40), 0, 1)));

    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    new DataView(a.buffer).setUint16(0, 7, true);
    new DataView(b.buffer).setUint16(0, 9, true);
    const e2 = runOne(
      (eng) => {
        eng.writeVReg(1, a);
        eng.writeVReg(2, b);
      },
      tsi(MUL_8H, 0, 1, 2),
    );
    expect(hex(e2.readVReg(0))).toBe(hex(neonMul(a, b, 1, 1)));
  });

  it('AND/ORR/EOR 16B match primitives', () => {
    const a = v(0xf0, 0xff, 0xaa);
    const b = v(0x3c, 0x0f, 0x55);
    expect(
      hex(
        runOne(
          (e) => {
            e.writeVReg(1, a);
            e.writeVReg(2, b);
          },
          tsi(AND_16B, 0, 1, 2),
        ).readVReg(0),
      ),
    ).toBe(hex(neonAnd(a, b, 1)));
    expect(
      hex(
        runOne(
          (e) => {
            e.writeVReg(1, a);
            e.writeVReg(2, b);
          },
          tsi(ORR_16B, 0, 1, 2),
        ).readVReg(0),
      ),
    ).toBe(hex(neonOrr(a, b, 1)));
    expect(
      hex(
        runOne(
          (e) => {
            e.writeVReg(1, a);
            e.writeVReg(2, b);
          },
          tsi(EOR_16B, 0, 1, 2),
        ).readVReg(0),
      ),
    ).toBe(hex(neonEor(a, b, 1)));
  });

  it('CMGT 16B / CMEQ 4S produce mask lanes', () => {
    // CMGT signed: lane0 0x7f>0x80(-128)? yes→0xff ; lane1 0x80(-128)>0x7f? no→0x00
    const e = runOne(
      (eng) => {
        eng.writeVReg(1, v(0x7f, 0x80));
        eng.writeVReg(2, v(0x80, 0x7f));
      },
      tsi(CMGT_16B, 0, 1, 2),
    );
    expect(hex(e.readVReg(0)).slice(0, 4)).toBe('ff00');

    // CMEQ 4S: equal lane → all ones.
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    new DataView(a.buffer).setUint32(0, 42, true);
    new DataView(b.buffer).setUint32(0, 42, true);
    new DataView(a.buffer).setUint32(4, 1, true);
    new DataView(b.buffer).setUint32(4, 2, true);
    const e2 = runOne(
      (eng) => {
        eng.writeVReg(1, a);
        eng.writeVReg(2, b);
      },
      tsi(CMEQ_4S, 0, 1, 2),
    );
    const out = e2.readVReg(0);
    expect(new DataView(out.buffer).getUint32(0, true)).toBe(0xffffffff);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(0);
  });

  it('SMAX/UMIN 16B with signed/unsigned distinction', () => {
    const a = v(0x80, 100);
    const b = v(0x7f, 50);
    expect(
      hex(
        runOne(
          (e) => {
            e.writeVReg(1, a);
            e.writeVReg(2, b);
          },
          tsi(SMAX_16B, 0, 1, 2),
        ).readVReg(0),
      ).slice(0, 4),
    ).toBe(hex(neonSmax(a, b, 0, 1)).slice(0, 4));
    expect(
      hex(
        runOne(
          (e) => {
            e.writeVReg(1, a);
            e.writeVReg(2, b);
          },
          tsi(UMIN_16B, 0, 1, 2),
        ).readVReg(0),
      ).slice(0, 4),
    ).toBe(hex(neonUmin(a, b, 0, 1)).slice(0, 4));
  });

  it('does not collide with PMULL (three-different, bit10=0)', () => {
    // PMULL V0,V1,V2 (0x0ee0e000) must still route to PMULL, not three-same.
    const a = new Uint8Array(16);
    new DataView(a.buffer).setBigUint64(0, 3n, true);
    const e = runOne(
      (eng) => {
        eng.writeVReg(1, a);
        eng.writeVReg(2, a);
      },
      (0x0ee0e000 | (2 << 16) | (1 << 5)) >>> 0,
    );
    // 3 * 3 carry-less = 5
    expect(new DataView(e.readVReg(0).buffer).getBigUint64(0, true)).toBe(5n);
  });
});

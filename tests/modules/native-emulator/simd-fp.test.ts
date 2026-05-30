/**
 * L1 TDD — scalar floating-point (Phase E). Two layers, mirroring the crypto
 * tests:
 *   1. The IEEE-754 primitives (simd-fp) compute bit-exact results, including
 *      float32 intermediate rounding via Math.fround, FCVTZS saturation/NaN→0,
 *      and FCMP's NZCV ordering.
 *   2. The *instructions* (FADD/FMUL/FDIV/FSQRT/FCMP/FCSEL/FCVTZS/SCVTF/FMOV),
 *      decoded and executed by CpuEngine from their real opcodes, drive the V
 *      register file / GPRs / NZCV flags to the same result — proving the
 *      named-bitfield decode is correct.
 *
 * Instruction words are built from assembler-verified base encodings
 * (scripts/_verify_fp_encoding.mjs) with Rd[4:0], Rn[9:5], Rm[20:16] overlaid.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import {
  fadd,
  fcmpFlags,
  fcvtPrecision,
  fdiv,
  fmul,
  fpToInt,
  intToFp,
  readF32,
  readF64,
} from '@modules/native-emulator/simd-fp';

// ── instruction-word builders (base encodings, Rd/Rn/Rm overlaid) ──
const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const reg3 = (base: number, rd: number, rn: number, rm: number): number =>
  (base | (rd & 31) | ((rn & 31) << 5) | ((rm & 31) << 16)) >>> 0;
const reg2 = (base: number, rd: number, rn: number): number =>
  (base | (rd & 31) | ((rn & 31) << 5)) >>> 0;

// single-precision (ftype=00) two-source bases
const FADD_S = 0x1e202800;
const FMUL_S = 0x1e200800;
const FDIV_S = 0x1e201800;
// double-precision (ftype=01)
const FADD_D = 0x1e602800;
const FMUL_D = 0x1e600800;
// one-source
const FSQRT_S = 0x1e21c000;
const FABS_S = 0x1e20c000;
const FNEG_S = 0x1e214000;
const FMOV_S = 0x1e204000;
const FCVT_S2D = 0x1e22c000; // ftype=00, to double
const FCVT_D2S = 0x1e624000; // ftype=01, to single
// compare (ftype=00)
const FCMP_S = 0x1e202000;
// cond-select (ftype=00), cond in [15:12]
const FCSEL_S = 0x1e200c00;
// int-conv
const FCVTZS_W_S = 0x1e380000; // sf=0 ftype=00 rmode=11 op=000
const SCVTF_S_W = 0x1e220000; // rmode=00 op=010
const FMOV_W_S = 0x1e260000; // op=110 fp→gpr
const FMOV_S_W = 0x1e270000; // op=111 gpr→fp

const f32 = (x: number): number => Math.fround(x);

/** Run a single instruction word and return the engine for inspection. */
function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const bytes = le(insn);
  const code = 0x3000;
  engine.mapMemory(code, bytes.length + 8);
  engine.writeCode(code, Uint8Array.from(bytes));
  engine.start(code, code + bytes.length);
  return engine;
}
const sBytes = (x: number): Uint8Array => {
  const out = new Uint8Array(16);
  new DataView(out.buffer).setFloat32(0, x, true);
  return out;
};
const dBytes = (x: number): Uint8Array => {
  const out = new Uint8Array(16);
  new DataView(out.buffer).setFloat64(0, x, true);
  return out;
};

describe('FP primitives (simd-fp) — IEEE-754 bit-exact', () => {
  it('single precision rounds every step through float32', () => {
    // Hardware FADD multiplies the float32 values stored in registers, so the
    // honest reference quantises inputs first. fadd(x,y,false) = f32(x+y); with
    // already-float32 inputs that equals the hardware result f32(f32x+f32y).
    const a = f32(0.1);
    const b = f32(0.2);
    expect(fadd(a, b, false)).toBe(f32(a + b));
    expect(fadd(a, b, false)).not.toBe(0.1 + 0.2); // differs from the double sum
    expect(fmul(f32(1 / 3), 3, false)).toBe(f32(f32(1 / 3) * 3));
  });

  it('double precision is the native JS double', () => {
    expect(fadd(0.1, 0.2, true)).toBe(0.1 + 0.2);
    expect(fdiv(1, 3, true)).toBe(1 / 3);
  });

  it('FCVTZS saturates and maps NaN→0', () => {
    expect(fpToInt(3.9, 'zero', true, 32)).toBe(3n);
    expect(fpToInt(-3.9, 'zero', true, 32)).toBe(-3n);
    expect(fpToInt(NaN, 'zero', true, 32)).toBe(0n);
    expect(fpToInt(1e30, 'zero', true, 32)).toBe(2147483647n);
    expect(fpToInt(-1e30, 'zero', true, 32)).toBe(-2147483648n);
    expect(fpToInt(Infinity, 'zero', false, 64)).toBe(2n ** 64n - 1n);
    expect(fpToInt(-1, 'zero', false, 32)).toBe(0n); // unsigned clamps negatives
  });

  it('SCVTF rounds 2^24+1 to even in single precision', () => {
    expect(intToFp(0x1000001n, true, 64, false)).toBe(16777216); // not representable, rounds down
    expect(intToFp(0x1000001n, true, 64, true)).toBe(16777217); // exact in double
  });

  it('FCMP produces the IEEE ordering flags', () => {
    expect(fcmpFlags(1, 2)).toEqual({ n: true, z: false, c: false, v: false }); // less
    expect(fcmpFlags(2, 2)).toEqual({ n: false, z: true, c: true, v: false }); // equal
    expect(fcmpFlags(3, 2)).toEqual({ n: false, z: false, c: true, v: false }); // greater
    expect(fcmpFlags(NaN, 2)).toEqual({ n: false, z: false, c: true, v: true }); // unordered
  });

  it('FCVT round-trips single↔double for representable values', () => {
    expect(fcvtPrecision(1.5, true)).toBe(1.5);
    expect(fcvtPrecision(1.5, false)).toBe(1.5);
  });
});

describe('FP instructions (CpuEngine) — decode + execution', () => {
  it('FADD/FMUL/FDIV single precision match the primitives', () => {
    // V1 = 1.5, V2 = 2.25 ; FADD S0, S1, S2
    let e = runOne(
      (eng) => {
        eng.writeVReg(1, sBytes(1.5));
        eng.writeVReg(2, sBytes(2.25));
      },
      reg3(FADD_S, 0, 1, 2),
    );
    expect(readF32(e.readVReg(0))).toBe(fadd(1.5, 2.25, false));

    e = runOne(
      (eng) => {
        eng.writeVReg(1, sBytes(0.1));
        eng.writeVReg(2, sBytes(0.2));
      },
      reg3(FMUL_S, 0, 1, 2),
    );
    // The register inputs are already float32-quantised by sBytes, so the
    // reference must quantise its inputs too (hardware multiplies the stored
    // float32 values, not the original doubles).
    expect(readF32(e.readVReg(0))).toBe(fmul(f32(0.1), f32(0.2), false));

    e = runOne(
      (eng) => {
        eng.writeVReg(1, sBytes(1));
        eng.writeVReg(2, sBytes(3));
      },
      reg3(FDIV_S, 0, 1, 2),
    );
    expect(readF32(e.readVReg(0))).toBe(fdiv(1, 3, false));
  });

  it('FADD/FMUL double precision use the native double', () => {
    let e = runOne(
      (eng) => {
        eng.writeVReg(1, dBytes(0.1));
        eng.writeVReg(2, dBytes(0.2));
      },
      reg3(FADD_D, 0, 1, 2),
    );
    expect(readF64(e.readVReg(0))).toBe(0.1 + 0.2);

    e = runOne(
      (eng) => {
        eng.writeVReg(1, dBytes(1.5));
        eng.writeVReg(2, dBytes(2.0));
      },
      reg3(FMUL_D, 0, 1, 2),
    );
    expect(readF64(e.readVReg(0))).toBe(3.0);
  });

  it('FSQRT/FABS/FNEG/FMOV one-source forms', () => {
    expect(
      readF32(runOne((eng) => eng.writeVReg(1, sBytes(16)), reg2(FSQRT_S, 0, 1)).readVReg(0)),
    ).toBe(4);
    expect(
      readF32(runOne((eng) => eng.writeVReg(1, sBytes(-3.5)), reg2(FABS_S, 0, 1)).readVReg(0)),
    ).toBe(3.5);
    expect(
      readF32(runOne((eng) => eng.writeVReg(1, sBytes(3.5)), reg2(FNEG_S, 0, 1)).readVReg(0)),
    ).toBe(-3.5);
    expect(
      readF32(runOne((eng) => eng.writeVReg(1, sBytes(2.75)), reg2(FMOV_S, 0, 1)).readVReg(0)),
    ).toBe(2.75);
  });

  it('FCVT converts single↔double', () => {
    // FCVT D0, S1 (single→double): 0.5 is exact.
    expect(
      readF64(runOne((eng) => eng.writeVReg(1, sBytes(0.5)), reg2(FCVT_S2D, 0, 1)).readVReg(0)),
    ).toBe(0.5);
    // FCVT S0, D1 (double→single): round 0.1 to float32.
    expect(
      readF32(runOne((eng) => eng.writeVReg(1, dBytes(0.1)), reg2(FCVT_D2S, 0, 1)).readVReg(0)),
    ).toBe(f32(0.1));
  });

  it('FCVTZS writes a saturated signed integer to a GPR', () => {
    // FCVTZS W0, S1 ; S1 = 3.9 → 3
    const e = runOne((eng) => eng.writeVReg(1, sBytes(3.9)), reg2(FCVTZS_W_S, 0, 1));
    expect(e.readGprValue(0)).toBe(3n);
    // saturation: 1e30 → INT32_MAX
    const e2 = runOne((eng) => eng.writeVReg(1, sBytes(1e30)), reg2(FCVTZS_W_S, 0, 1));
    expect(e2.readGprValue(0)).toBe(2147483647n);
  });

  it('SCVTF converts a GPR integer to float', () => {
    // SCVTF S0, W1 ; W1 = 42 → 42.0
    const e = runOne((eng) => eng.writeGprValue(1, 42n), reg2(SCVTF_S_W, 0, 1));
    expect(readF32(e.readVReg(0))).toBe(42);
  });

  it('FMOV moves raw bits between FPR and GPR', () => {
    // FMOV W0, S1 : read the float32 bit pattern of 1.0 = 0x3f800000.
    const e = runOne((eng) => eng.writeVReg(1, sBytes(1.0)), reg2(FMOV_W_S, 0, 1));
    expect(e.readGprValue(0)).toBe(0x3f800000n);
    // FMOV S0, W1 : write 0x40000000 → 2.0f.
    const e2 = runOne((eng) => eng.writeGprValue(1, 0x40000000n), reg2(FMOV_S_W, 0, 1));
    expect(readF32(e2.readVReg(0))).toBe(2.0);
  });

  it('FCMP sets NZCV, and FCSEL selects on the condition', () => {
    // FCMP S1, S2 with 2.0 vs 2.0 → Z=1,C=1 (EQ holds); then FCSEL S0,S3,S4,EQ → S3.
    const engine = new CpuEngine();
    engine.writeVReg(1, sBytes(2.0));
    engine.writeVReg(2, sBytes(2.0));
    engine.writeVReg(3, sBytes(7.0));
    engine.writeVReg(4, sBytes(9.0));
    const words = [reg3(FCMP_S, 0, 1, 2), reg3(FCSEL_S, 0, 3, 4)]; // FCSEL cond=0000 (EQ)
    const bytes: number[] = [];
    for (const w of words) bytes.push(...le(w));
    const code = 0x3100;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    expect(readF32(engine.readVReg(0))).toBe(7.0); // EQ held → first source

    // greater-than: 5.0 vs 2.0 → not equal, FCSEL EQ picks the second (9.0).
    const e2 = new CpuEngine();
    e2.writeVReg(1, sBytes(5.0));
    e2.writeVReg(2, sBytes(2.0));
    e2.writeVReg(3, sBytes(7.0));
    e2.writeVReg(4, sBytes(9.0));
    const bytes2: number[] = [];
    for (const w of words) bytes2.push(...le(w));
    e2.mapMemory(code, bytes2.length + 8);
    e2.writeCode(code, Uint8Array.from(bytes2));
    e2.start(code, code + bytes2.length);
    expect(readF32(e2.readVReg(0))).toBe(9.0); // EQ failed → second source
  });
});

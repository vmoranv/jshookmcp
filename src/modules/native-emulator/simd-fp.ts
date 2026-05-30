/**
 * simd-fp — AArch64 scalar floating-point (the FP data-processing, compare,
 * conditional-select and integer-conversion encoding groups). Kept beside the
 * SIMD dispatcher so the IEEE-754 behaviour can be tested in isolation.
 *
 * A scalar FP register is the low element of a V register: an S register is V
 * bytes[0:4] (float32), a D register is V bytes[0:8] (float64); the ARM ARM zeroes
 * the unused upper bytes on a write. JS numbers are IEEE-754 doubles, so the
 * double-precision operations are bit-exact directly; single-precision variants
 * round every result through `Math.fround` to match float32 hardware exactly.
 *
 * `ftype` (insn bits[23:22]) selects precision: 00 = single, 01 = double.
 * (11 = half/FP16 needs FEAT_FP16 and is not yet handled.)
 */

/** float32 rounding of a JS double — one hardware single-precision step. */
const f32 = (x: number): number => Math.fround(x);

/** Read the scalar S (float32) value held in the low 4 bytes of a V register. */
export function readF32(v: Uint8Array): number {
  return new DataView(v.buffer, v.byteOffset, 16).getFloat32(0, true);
}

/** Read the scalar D (float64) value held in the low 8 bytes of a V register. */
export function readF64(v: Uint8Array): number {
  return new DataView(v.buffer, v.byteOffset, 16).getFloat64(0, true);
}

/** Pack a float32 into a fresh 16-byte V register (upper 12 bytes zeroed). */
export function packF32(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(16);
  new DataView(out.buffer).setFloat32(0, f32(value), true);
  return out;
}

/** Pack a float64 into a fresh 16-byte V register (upper 8 bytes zeroed). */
export function packF64(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(16);
  new DataView(out.buffer).setFloat64(0, value, true);
  return out;
}

/** Read a scalar FP value at the precision selected by `isDouble`. */
export function readFp(v: Uint8Array, isDouble: boolean): number {
  return isDouble ? readF64(v) : readF32(v);
}

/** Pack a scalar FP value at the precision selected by `isDouble`. */
export function packFp(value: number, isDouble: boolean): Uint8Array<ArrayBuffer> {
  return isDouble ? packF64(value) : packF32(value);
}

// ── two-source arithmetic (opcode[15:12]): FMUL=0 FDIV=1 FADD=2 FSUB=3 ──
// Single precision rounds each result to float32; double uses the JS double.

/** FADD: a + b, rounded to the operand precision. */
export const fadd = (a: number, b: number, isDouble: boolean): number =>
  isDouble ? a + b : f32(a + b);
/** FSUB: a - b. */
export const fsub = (a: number, b: number, isDouble: boolean): number =>
  isDouble ? a - b : f32(a - b);
/** FMUL: a * b. */
export const fmul = (a: number, b: number, isDouble: boolean): number =>
  isDouble ? a * b : f32(a * b);
/** FDIV: a / b (IEEE-754 division: x/0 = ±Inf, 0/0 = NaN). */
export const fdiv = (a: number, b: number, isDouble: boolean): number =>
  isDouble ? a / b : f32(a / b);
/** FNMUL: -(a * b). */
export const fnmul = (a: number, b: number, isDouble: boolean): number =>
  isDouble ? -(a * b) : f32(-(a * b));
/** FMAX / FMIN — ARM returns the numeric operand when one is NaN only for FMAXNM/FMINNM; FMAX/FMIN propagate NaN. */
export const fmax = (a: number, b: number, isDouble: boolean): number => {
  if (Number.isNaN(a) || Number.isNaN(b)) return isDouble ? NaN : f32(NaN);
  // +0 > -0 in FMAX
  if (a === 0 && b === 0) return Object.is(a, -0) ? b : a;
  return isDouble ? Math.max(a, b) : f32(Math.max(a, b));
};
export const fmin = (a: number, b: number, isDouble: boolean): number => {
  if (Number.isNaN(a) || Number.isNaN(b)) return isDouble ? NaN : f32(NaN);
  if (a === 0 && b === 0) return Object.is(a, -0) ? a : b;
  return isDouble ? Math.min(a, b) : f32(Math.min(a, b));
};

// ── one-source (opcode[20:15]): FMOV=0 FABS=1 FNEG=2 FSQRT=3 + FCVT(4..) ──

/** FABS: clear the sign bit (Math.abs matches for all finite/Inf; NaN stays NaN). */
export const fabs = (a: number, isDouble: boolean): number =>
  isDouble ? Math.abs(a) : f32(Math.abs(a));
/** FNEG: flip the sign bit. */
export const fneg = (a: number, isDouble: boolean): number => (isDouble ? -a : f32(-a));
/** FSQRT: IEEE-754 square root (sqrt(-x) = NaN, sqrt(-0) = -0). */
export const fsqrt = (a: number, isDouble: boolean): number =>
  isDouble ? Math.sqrt(a) : f32(Math.sqrt(a));

// ── FCMP / FCMPE — produce the four NZCV flags ──

export interface Nzcv {
  n: boolean;
  z: boolean;
  c: boolean;
  v: boolean;
}

/**
 * IEEE-754 quiet compare → NZCV. The four orderings map to fixed flag patterns:
 *   less-than  N=1 Z=0 C=0 V=0
 *   equal      N=0 Z=1 C=1 V=0
 *   greater    N=0 Z=0 C=1 V=0
 *   unordered  N=0 Z=0 C=1 V=1   (either operand NaN)
 */
export function fcmpFlags(a: number, b: number): Nzcv {
  if (Number.isNaN(a) || Number.isNaN(b)) return { n: false, z: false, c: true, v: true };
  if (a < b) return { n: true, z: false, c: false, v: false };
  if (a === b) return { n: false, z: true, c: true, v: false };
  return { n: false, z: false, c: true, v: false };
}

// ── FP ⇄ integer conversion (rmode[20:19], opcode[18:16]) ──

/**
 * FCVTZS/FCVTZU and the rounded variants → fixed integer, saturating, NaN → 0
 * (ARM `FPToFixed`). `rounding` selects the mode; `signed` and `intBits`
 * (32 or 64) select the target. Returns a BigInt in two's-complement range.
 */
export type FpRounding = 'zero' | 'nearest' | 'minus' | 'plus' | 'away';

function roundToInt(value: number, rounding: FpRounding): number {
  switch (rounding) {
    case 'zero':
      return Math.trunc(value);
    case 'minus':
      return Math.floor(value);
    case 'plus':
      return Math.ceil(value);
    case 'away':
      return value < 0 ? -Math.round(-value) : Math.round(value);
    case 'nearest': {
      // round-to-nearest, ties to even
      const fl = Math.floor(value);
      const diff = value - fl;
      if (diff < 0.5) return fl;
      if (diff > 0.5) return fl + 1;
      return fl % 2 === 0 ? fl : fl + 1;
    }
  }
}

export function fpToInt(
  value: number,
  rounding: FpRounding,
  signed: boolean,
  intBits: 32 | 64,
): bigint {
  if (Number.isNaN(value)) return 0n;
  const rounded = roundToInt(value, rounding);
  if (signed) {
    const min = intBits === 64 ? -(2n ** 63n) : -(2n ** 31n);
    const max = intBits === 64 ? 2n ** 63n - 1n : 2n ** 31n - 1n;
    if (rounded === Infinity || rounded > Number(max)) return max;
    if (rounded === -Infinity || rounded < Number(min)) return min;
    let v = BigInt(Math.trunc(rounded));
    if (v > max) v = max;
    if (v < min) v = min;
    return v;
  }
  const max = intBits === 64 ? 2n ** 64n - 1n : 2n ** 32n - 1n;
  if (rounded <= 0) return 0n;
  if (rounded === Infinity || rounded > Number(max)) return max;
  let v = BigInt(Math.trunc(rounded));
  if (v > max) v = max;
  return v;
}

/**
 * SCVTF/UCVTF → floating-point of the given precision. `signed` interprets the
 * `intBits`-wide integer; single precision rounds the result to float32.
 */
export function intToFp(raw: bigint, signed: boolean, intBits: 32 | 64, isDouble: boolean): number {
  const masked = BigInt.asUintN(intBits, raw);
  const value = signed ? BigInt.asIntN(intBits, masked) : masked;
  return isDouble ? Number(value) : f32(Number(value));
}

/** FCVT between single and double precision (the 1-source opcode 000100/000101 forms). */
export function fcvtPrecision(value: number, toDouble: boolean): number {
  return toDouble ? value : f32(value);
}

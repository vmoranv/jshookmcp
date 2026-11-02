/**
 * simd-fp16 — IEEE-754 binary16 (half-precision) software FP model.
 *
 * Node 22 lacks `DataView.getFloat16` / `Math.f16round` (those arrive in
 * Node 23+), so this module implements half-precision entirely in software with
 * BigInt bit-twiddling. Every operation is rounded to binary16 via
 * round-to-nearest-ties-to-even (the default FPCR rounding mode), which makes
 * the results bit-exact against the ARM ARM FP16 reference vectors.
 *
 * Encoded value layout (binary16, big-endian bit order):
 *   sign[15] exponent[14:10] fraction[9:0]
 *   bias = 15, exponent range 0..31
 *
 * Class boundaries:
 *   exp=0, frac=0         → ±0
 *   exp=0, frac≠0         → subnormal:  (-1)^s * 2^-14 * (frac/1024)
 *   exp=1..30,            → normal:     (-1)^s * 2^(exp-15) * (1 + frac/1024)
 *   exp=31, frac=0        → ±Inf
 *   exp=31, frac≠0        → NaN (quiet if frac[9]=1)
 */

const H_BIAS = 15;
const H_MIN_EXP = -14; // subnormal exponent
const H_MAX_EXP = 15; // 2^(31-15) is the Inf exponent
const H_MANT_BITS = 10;
const H_MANT_MASK = (1n << BigInt(H_MANT_BITS)) - 1n; // 0x3FF
const H_HIDDEN = 1n << BigInt(H_MANT_BITS); // 0x400
const QNAN_H = 0x7e00n; // exp=31, frac[9]=1 (quiet NaN)

/** Pack an f16 bit pattern (u16) into a fresh 16-byte V register (bytes 2..15 zero). */
export function packF16Bits(bits16: number | bigint): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(16);
  const b = BigInt(bits16) & 0xffffn;
  out[0] = Number(b & 0xffn);
  out[1] = Number((b >> 8n) & 0xffn);
  return out;
}

/** Read the low 2 bytes of a V register as an f16 bit pattern (u16). */
function readF16Bits(v: Uint8Array): bigint {
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  return BigInt(dv.getUint16(0, true));
}

/**
 * Decode an f16 bit pattern to a JS double (bit-exact; subnormals expand to
 * their exact dyadic-rational value, normals to 2^exp * (1.frac)).
 */
export function f16BitsToNumber(bits: bigint): number {
  const u = bits & 0xffffn;
  const sign = (u >> 15n) & 1n;
  const exp = Number((u >> 10n) & 0x1fn);
  const frac = u & H_MANT_MASK;
  const signMul = sign === 1n ? -1 : 1;
  if (exp === 0) {
    if (frac === 0n) return signMul === -1 ? -0 : 0;
    // subnormal: value = 2^-14 * (frac/1024)
    return signMul * Math.pow(2, H_MIN_EXP) * (Number(frac) / Number(H_HIDDEN));
  }
  if (exp === 31) {
    if (frac === 0n) return signMul === -1 ? -Infinity : Infinity;
    return NaN;
  }
  // normal
  const value = Math.pow(2, exp - H_BIAS) * (1 + Number(frac) / Number(H_HIDDEN));
  return signMul === -1 ? -value : value;
}

/** Convenience: read f16 from a V register's low 2 bytes. */
export const readF16 = (v: Uint8Array): number => f16BitsToNumber(readF16Bits(v));

/**
 * Round a JS double to the nearest binary16 value, ties-to-even, producing the
 * 16-bit pattern. The pipeline:
 *   - ±0, ±Inf, NaN pass through directly (NaN → canonical quiet NaN).
 *   - values below half the smallest subnormal round to ±0 (underflow).
 *   - values above the largest normal saturate to ±Inf (overflow).
 *   - otherwise decompose |x| = m * 2^e where m has MANT_BITS+1 significant bits
 *     (hidden + fraction) for normals, or ≤ MANT_BITS bits for subnormals, then
 *     apply round-to-nearest-ties-to-even on the truncation boundary.
 */
export function f16RoundBits(value: number): bigint {
  if (Number.isNaN(value)) return QNAN_H;
  if (value === 0) return Object.is(value, -0) ? 0x8000n : 0n;
  if (value === Infinity) return 0x7c00n;
  if (value === -Infinity) return 0xfc00n;

  const sign = value < 0;
  const mag = Math.abs(value);

  const minSub = Math.pow(2, -24); // smallest subnormal = 2^-14 * 2^-10
  if (mag < minSub / 2) return sign ? 0x8000n : 0n; // rounds to ±0

  const maxNormal = (2 - Math.pow(2, -10)) * Math.pow(2, 15); // ≈ 65504
  if (mag > maxNormal) return sign ? 0xfc00n : 0x7c00n; // overflow → ±Inf

  // |x| = m * 2^e with 1 ≤ m < 2 for normals. e = floor(log2(|x|)).
  const e = Math.floor(Math.log2(mag));
  // Subnormals share e = -14 (the exp=0 field): values in [2^-24, 2^-14).
  const isSubnormal = e < H_MIN_EXP;
  const expUnbiased = isSubnormal ? H_MIN_EXP : e;

  // Scale |x| by 2^(MANT_BITS - expUnbiased) so the hidden bit (normals) lands
  // at bit MANT_BITS, i.e. scaled ∈ [2^MANT_BITS, 2^(MANT_BITS+1)) for normals.
  // For subnormals scaled ∈ [0, 2^MANT_BITS).
  const scaleExp = H_MANT_BITS - expUnbiased;
  const scaled = mag * Math.pow(2, scaleExp);

  // Round scaled to the nearest integer, ties-to-even. frac encodes the part
  // beyond bit 0 of the mantissa; if frac > 0.5 round up, if exactly 0.5 round
  // to the even neighbour.
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  let mantInt = floor;
  if (frac > 0.5) mantInt += 1;
  else if (frac === 0.5 && mantInt % 2 !== 0) mantInt += 1;

  let expField: number;
  let fracField: bigint;

  if (isSubnormal) {
    if (BigInt(mantInt) >= H_HIDDEN) {
      // Rounding carried into the hidden bit → smallest normal (exp=1, frac=0).
      expField = 1;
      fracField = 0n;
    } else {
      expField = 0;
      fracField = BigInt(mantInt) & H_MANT_MASK;
    }
  } else {
    // Normal: mantInt should be in [2^MANT_BITS, 2^(MANT_BITS+1)). If rounding
    // pushed it to 2^(MANT_BITS+1), bump the exponent and reset the fraction.
    if (BigInt(mantInt) >= 1n << BigInt(H_MANT_BITS + 1)) {
      const newExp = expUnbiased + 1;
      if (newExp > H_MAX_EXP) return sign ? 0xfc00n : 0x7c00n;
      expField = newExp + H_BIAS;
      fracField = 0n; // 1.0 * 2^newExp → frac = 0
    } else {
      expField = expUnbiased + H_BIAS;
      fracField = BigInt(mantInt) & H_MANT_MASK;
    }
  }

  let bits = (sign ? 1n : 0n) << 15n;
  bits |= BigInt(expField) << 10n;
  bits |= fracField;
  return bits & 0xffffn;
}

/** Round a JS double to binary16 and return the resulting f64 value (bit-exact). */
export const f16round = (value: number): number => f16BitsToNumber(f16RoundBits(value));

/** Pack an f64 value into a fresh V register as binary16 (upper 14 bytes zero). */
export const packF16 = (value: number): Uint8Array<ArrayBuffer> => packF16Bits(f16RoundBits(value));

// ── Arithmetic (each rounds the result to binary16) ──────────────────────────

export const f16add = (a: number, b: number): number => f16round(a + b);
export const f16sub = (a: number, b: number): number => f16round(a - b);
export const f16mul = (a: number, b: number): number => f16round(a * b);
export const f16div = (a: number, b: number): number => f16round(a / b);
export const f16sqrt = (a: number): number => f16round(Math.sqrt(a));
export const f16abs = (a: number): number => f16round(Math.abs(a));
export const f16neg = (a: number): number => {
  // Negation is exact in IEEE-754 (just flip sign bit); no rounding needed.
  const bits = f16RoundBits(a);
  return f16BitsToNumber(bits ^ 0x8000n);
};

// ── Conversions ──────────────────────────────────────────────────────────────

/** Convert a signed/unsigned integer to binary16 (FCVTZS inverse / SCVTF/UCVTF). */
export function intToF16(raw: bigint, signed: boolean, intBits: 32 | 64): number {
  const masked = BigInt.asUintN(intBits, raw);
  const value = signed ? BigInt.asIntN(intBits, masked) : masked;
  return f16round(Number(value));
}

// ── Compare → NZCV (same flag semantics as fp32/fp64) ────────────────────────

export interface HNzcv {
  n: boolean;
  z: boolean;
  c: boolean;
  v: boolean;
}

export function f16CmpFlags(a: number, b: number): HNzcv {
  if (Number.isNaN(a) || Number.isNaN(b)) return { n: false, z: false, c: true, v: true };
  if (a < b) return { n: true, z: false, c: false, v: false };
  if (a === b) return { n: false, z: true, c: true, v: false };
  return { n: false, z: false, c: true, v: false };
}

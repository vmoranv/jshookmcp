/**
 * simd-neon-saturating — AArch64 NEON Saturating Instructions
 *
 * Implements all ARM64 NEON saturating arithmetic, shift, and narrowing
 * instructions with QC flag tracking. Saturating operations clamp results
 * to the representable range and set the FPSR QC flag (bit 27) on overflow.
 */

import { laneBytes, readLaneSigned } from './simd-utils';

/** Mask for the low `bytes*8` bits. */
const widthMask = (bytes: number): bigint => (1n << BigInt(bytes * 8)) - 1n;

/** Context for tracking saturation events (QC flag). */
export interface SaturatingContext {
  /** Set FPSR QC flag (bit 27) to indicate saturation occurred. */
  setQC(): void;
}

/**
 * Read a lane from a V register at the given size, zero-extended.
 */
function readLaneUnsigned(v: Uint8Array, index: number, size: number): bigint {
  const bytes = laneBytes(size);
  const offset = index * bytes;
  const dv = new DataView(v.buffer, v.byteOffset, 16);

  switch (bytes) {
    case 1:
      return BigInt(dv.getUint8(offset));
    case 2:
      return BigInt(dv.getUint16(offset, true));
    case 4:
      return BigInt(dv.getUint32(offset, true));
    default:
      return dv.getBigUint64(offset, true);
  }
}

/**
 * Write a lane to a V register at the given size (truncated to width).
 */
function writeLane(v: Uint8Array, index: number, size: number, value: bigint): void {
  const bytes = laneBytes(size);
  const offset = index * bytes;
  const dv = new DataView(v.buffer, v.byteOffset, 16);

  switch (bytes) {
    case 1:
      dv.setUint8(offset, Number(value & 0xffn));
      break;
    case 2:
      dv.setUint16(offset, Number(value & 0xffffn), true);
      break;
    case 4:
      dv.setUint32(offset, Number(value & 0xffff_ffffn), true);
      break;
    default:
      dv.setBigUint64(offset, value & 0xffff_ffff_ffff_ffffn, true);
      break;
  }
}

/**
 * Saturate a signed value to fit in `bits` bits, set QC on overflow.
 */
function saturateSigned(value: bigint, bits: number, ctx: SaturatingContext): bigint {
  const max = (1n << BigInt(bits - 1)) - 1n;
  const min = -(1n << BigInt(bits - 1));

  if (value > max) {
    ctx.setQC();
    return max;
  }
  if (value < min) {
    ctx.setQC();
    return min;
  }
  return value;
}

/**
 * Saturate an unsigned value to fit in `bits` bits, set QC on overflow.
 */
function saturateUnsigned(value: bigint, bits: number, ctx: SaturatingContext): bigint {
  const max = (1n << BigInt(bits)) - 1n;

  if (value > max) {
    ctx.setQC();
    return max;
  }
  if (value < 0n) {
    ctx.setQC();
    return 0n;
  }
  return value;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 1. Saturating Add/Subtract Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SQADD: Signed Saturating Add
 * Encoding: 0 Q 0 01110 size 1 Rm 000011 Rn Rd
 */
export function neonSqadd(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const a = readLaneSigned(vn, i, size);
    const b = readLaneSigned(vm, i, size);
    const sum = a + b;
    const sat = saturateSigned(sum, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

/**
 * UQADD: Unsigned Saturating Add
 * Encoding: 0 Q 1 01110 size 1 Rm 000011 Rn Rd
 */
export function neonUqadd(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const a = readLaneUnsigned(vn, i, size);
    const b = readLaneUnsigned(vm, i, size);
    const sum = a + b;
    const sat = saturateUnsigned(sum, bits, ctx);
    writeLane(vd, i, size, sat);
  }
}

/**
 * SQSUB: Signed Saturating Subtract
 * Encoding: 0 Q 0 01110 size 1 Rm 001011 Rn Rd
 */
export function neonSqsub(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const a = readLaneSigned(vn, i, size);
    const b = readLaneSigned(vm, i, size);
    const diff = a - b;
    const sat = saturateSigned(diff, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

/**
 * UQSUB: Unsigned Saturating Subtract
 * Encoding: 0 Q 1 01110 size 1 Rm 001011 Rn Rd
 */
export function neonUqsub(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const a = readLaneUnsigned(vn, i, size);
    const b = readLaneUnsigned(vm, i, size);
    const diff = a - b;
    const sat = saturateUnsigned(diff, bits, ctx);
    writeLane(vd, i, size, sat);
  }
}

/**
 * SUQADD: Signed saturating Accumulate of Unsigned value
 * Encoding: 0 Q 0 01110 size 10000 000111 Rn Rd
 * Vd = sat_signed(Vd_signed + Vn_unsigned)
 */
export function neonSuqadd(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const a = readLaneSigned(vd, i, size);
    const b = readLaneUnsigned(vn, i, size);
    const sum = a + b;
    const sat = saturateSigned(sum, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

/**
 * USQADD: Unsigned saturating Accumulate of Signed value
 * Encoding: 0 Q 1 01110 size 10000 000111 Rn Rd
 * Vd = sat_unsigned(Vd_unsigned + Vn_signed)
 */
export function neonUsqadd(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const a = readLaneUnsigned(vd, i, size);
    const b = readLaneSigned(vn, i, size);
    const sum = BigInt(a) + b;
    const sat = saturateUnsigned(sum, bits, ctx);
    writeLane(vd, i, size, sat);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 2. Saturating Shift Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SQSHL (register): Signed Saturating Shift Left
 * Encoding: 0 Q 0 01110 size 1 Rm 010011 Rn Rd
 * Shift amount from register, negative = right shift
 */
export function neonSqshl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneSigned(vn, i, size);
    const shiftRaw = readLaneSigned(vm, i, size);
    // ARM ARM: the shift is the SIGNED lane value; negative = right shift.
    const shift = Number(shiftRaw);

    let result: bigint;
    if (shift >= 0) {
      // Left shift with saturation
      if (shift >= bits) {
        result = value >= 0n ? (1n << BigInt(bits - 1)) - 1n : -(1n << BigInt(bits - 1));
        ctx.setQC();
      } else {
        result = value << BigInt(shift);
      }
    } else {
      // Right shift (arithmetic)
      const absShift = -shift;
      result = value >> BigInt(absShift);
    }

    const sat = saturateSigned(result, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

/**
 * UQSHL (register): Unsigned Saturating Shift Left
 * Encoding: 0 Q 1 01110 size 1 Rm 010011 Rn Rd
 */
export function neonUqshl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneUnsigned(vn, i, size);
    const shiftRaw = readLaneSigned(vm, i, size);
    // ARM ARM: the shift is the SIGNED lane value; negative = right shift.
    const shift = Number(shiftRaw);

    let result: bigint;
    if (shift >= 0) {
      if (shift >= bits) {
        result = (1n << BigInt(bits)) - 1n;
        ctx.setQC();
      } else {
        result = value << BigInt(shift);
      }
    } else {
      const absShift = -shift;
      result = value >> BigInt(absShift);
    }

    const sat = saturateUnsigned(result, bits, ctx);
    writeLane(vd, i, size, sat);
  }
}

/**
 * SQSHLU: Signed saturating Shift Left Unsigned
 * Encoding: 0 Q 1 01111 immh:immb 011001 Rn Rd
 * Read as signed, shift left, saturate as unsigned
 */
export function neonSqshlu(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneSigned(vn, i, size);
    const result = value << BigInt(shift);
    const sat = saturateUnsigned(result, bits, ctx);
    writeLane(vd, i, size, sat);
  }
}

/**
 * SQRSHL: Signed Saturating Rounding Shift Left
 * Encoding: 0 Q 0 01110 size 1 Rm 010111 Rn Rd
 */
export function neonSqrshl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneSigned(vn, i, size);
    const shiftRaw = readLaneSigned(vm, i, size);
    // Signed lane: negative = rounding right shift. Any shift >= bits
    // saturates identically and any shift <= -(bits+1) rounds to 0, so clamp
    // the magnitude to keep huge lanes from ballooning the BigInt shifts.
    const shift = Math.max(-(bits + 1), Math.min(bits, Number(shiftRaw)));

    let result: bigint;
    if (shift >= 0) {
      result = value << BigInt(shift);
    } else {
      const absShift = -shift;
      const round = absShift > 0 ? 1n << BigInt(absShift - 1) : 0n;
      result = (value + round) >> BigInt(absShift);
    }

    const sat = saturateSigned(result, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

/**
 * UQRSHL: Unsigned Saturating Rounding Shift Left
 * Encoding: 0 Q 1 01110 size 1 Rm 010111 Rn Rd
 */
export function neonUqrshl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneUnsigned(vn, i, size);
    const shiftRaw = readLaneSigned(vm, i, size);
    // Signed lane: negative = rounding right shift; clamped as in SQRSHL.
    const shift = Math.max(-(bits + 1), Math.min(bits, Number(shiftRaw)));

    let result: bigint;
    if (shift >= 0) {
      result = value << BigInt(shift);
    } else {
      const absShift = -shift;
      const round = absShift > 0 ? 1n << BigInt(absShift - 1) : 0n;
      result = (value + round) >> BigInt(absShift);
    }

    const sat = saturateUnsigned(result, bits, ctx);
    writeLane(vd, i, size, sat);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 3. Saturating Narrowing Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SQXTN/SQXTN2: Signed Saturating Extract Narrow
 * Encoding: 0 Q 0 01110 size 10100 100010 Rn Rd
 * Reads wide lanes, saturates to narrow width
 */
export function neonSqxtn(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('SQXTN: invalid size (must be 0-2)');

  // ARM ARM SQXTN#advsimd: elements = 64 DIV esize over 2*esize-wide lanes —
  // both Q=0 and Q=1 narrow the FULL 128-bit source; Q only picks the
  // destination half (low for Q=0 via the dispatcher's zeroed result, high
  // for Q=1 via the dispatcher's pre-filled old Vd).
  const inputSize = size + 1;
  const laneCount = 16 >> inputSize;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0; // Destination offset in narrow lanes

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneSigned(vn, i, inputSize);
    const narrow = saturateSigned(wide, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow & widthMask(laneBytes(size)));
  }
}

/**
 * UQXTN/UQXTN2: Unsigned Saturating Extract Narrow
 * Encoding: 0 Q 1 01110 size 10100 100010 Rn Rd
 */
export function neonUqxtn(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('UQXTN: invalid size (must be 0-2)');

  // As SQXTN: both Q forms narrow the full 128-bit source; Q picks the half.
  const inputSize = size + 1;
  const laneCount = 16 >> inputSize;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0; // Destination offset in narrow lanes

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneUnsigned(vn, i, inputSize);
    const narrow = saturateUnsigned(wide, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow);
  }
}

/**
 * SQXTUN/SQXTUN2: Signed saturating extract Unsigned Narrow
 * Encoding: 0 Q 1 01110 size 10010 100010 Rn Rd
 * Read as signed, saturate to unsigned range
 */
export function neonSqxtun(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('SQXTUN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneSigned(vn, i, inputSize);
    const narrow = saturateUnsigned(wide, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow);
  }
}

/**
 * SQSHRN/SQSHRN2: Signed Saturating Shift Right Narrow
 * Encoding: 0 Q 0 01111 immh:immb 100101 Rn Rd
 */
export function neonSqshrn(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('SQSHRN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneSigned(vn, i, inputSize);
    const shifted = wide >> BigInt(shift);
    const narrow = saturateSigned(shifted, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow & widthMask(laneBytes(size)));
  }
}

/**
 * UQSHRN/UQSHRN2: Unsigned Saturating Shift Right Narrow
 * Encoding: 0 Q 1 01111 immh:immb 100101 Rn Rd
 */
export function neonUqshrn(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('UQSHRN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneUnsigned(vn, i, inputSize);
    const shifted = wide >> BigInt(shift);
    const narrow = saturateUnsigned(shifted, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow);
  }
}

/**
 * SQRSHRN/SQRSHRN2: Signed Saturating Rounded Shift Right Narrow
 * Encoding: 0 Q 0 01111 immh:immb 100111 Rn Rd
 */
export function neonSqrshrn(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('SQRSHRN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneSigned(vn, i, inputSize);
    const round = shift > 0 ? 1n << BigInt(shift - 1) : 0n;
    const shifted = (wide + round) >> BigInt(shift);
    const narrow = saturateSigned(shifted, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow & widthMask(laneBytes(size)));
  }
}

/**
 * UQRSHRN/UQRSHRN2: Unsigned Saturating Rounded Shift Right Narrow
 * Encoding: 0 Q 1 01111 immh:immb 100111 Rn Rd
 */
export function neonUqrshrn(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('UQRSHRN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneUnsigned(vn, i, inputSize);
    const round = shift > 0 ? 1n << BigInt(shift - 1) : 0n;
    const shifted = (wide + round) >> BigInt(shift);
    const narrow = saturateUnsigned(shifted, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow);
  }
}

/**
 * SQSHRUN/SQSHRUN2: Signed saturating Shift Right Unsigned Narrow
 * Encoding: 0 Q 1 01111 immh:immb 100001 Rn Rd
 * Read as signed, shift right, saturate to unsigned range
 */
export function neonSqshrun(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('SQSHRUN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneSigned(vn, i, inputSize);
    const shifted = wide >> BigInt(shift);
    const narrow = saturateUnsigned(shifted, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow);
  }
}

/**
 * SQRSHRUN/SQRSHRUN2: Signed saturating Rounded Shift Right Unsigned Narrow
 * Encoding: 0 Q 1 01111 immh:immb 100011 Rn Rd
 */
export function neonSqrshrun(
  vd: Uint8Array,
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  if (size >= 3) throw new Error('SQRSHRUN: invalid size (must be 0-2)');

  const laneCount = 8 >> size;
  const inputSize = size + 1;
  const outputBits = 8 << size;
  const offset = q === 1 ? laneCount : 0;

  for (let i = 0; i < laneCount; i++) {
    const wide = readLaneSigned(vn, i, inputSize);
    const round = shift > 0 ? 1n << BigInt(shift - 1) : 0n;
    const shifted = (wide + round) >> BigInt(shift);
    const narrow = saturateUnsigned(shifted, outputBits, ctx);
    writeLane(vd, offset + i, size, narrow);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 5. Other Saturating Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SQABS: Signed Saturating Absolute value
 * Encoding: 0 Q 0 01110 size 10000 001110 Rn Rd
 * Special case: abs(INT_MIN) saturates to INT_MAX
 */
export function neonSqabs(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneSigned(vn, i, size);
    const abs = value < 0n ? -value : value;
    const sat = saturateSigned(abs, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

/**
 * SQNEG: Signed Saturating Negate
 * Encoding: 0 Q 1 01110 size 10000 001110 Rn Rd
 * Special case: neg(INT_MIN) saturates to INT_MAX
 */
export function neonSqneg(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  ctx: SaturatingContext,
): void {
  const laneCount = (16 >> size) * (q === 1 ? 1 : 0.5);
  const bits = 8 << size;

  for (let i = 0; i < laneCount; i++) {
    const value = readLaneSigned(vn, i, size);
    const neg = -value;
    const sat = saturateSigned(neg, bits, ctx);
    writeLane(vd, i, size, sat & widthMask(laneBytes(size)));
  }
}

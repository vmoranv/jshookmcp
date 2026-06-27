/**
 * simd-neon-widening — AArch64 NEON Widening Instructions
 *
 * Widening operations that process narrow lanes and produce wider results.
 * Examples: 8-bit → 16-bit, 16-bit → 32-bit, 32-bit → 64-bit
 */

/** Number of bytes per lane for an element-size field (0=1,1=2,2=4,3=8). */
const laneBytes = (size: number): number => 1 << size;

/** Interpret an unsigned lane as signed (two's complement) at the lane width. */
function toSigned(v: bigint, bytes: number): bigint {
  const bits = BigInt(bytes * 8);
  const signBit = 1n << (bits - 1n);
  return (v & signBit) !== 0n ? v - (1n << bits) : v;
}

/** Pack unsigned BigInt lanes back into a fresh 16-byte V register. */
export function packLanes(lanes: bigint[], size: number): Uint8Array<ArrayBuffer> {
  const bytes = laneBytes(size);
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < lanes.length; i++) {
    const off = i * bytes;
    if (off + bytes > 16) break;
    const v = lanes[i] ?? 0n;
    switch (bytes) {
      case 1:
        dv.setUint8(off, Number(v & 0xffn));
        break;
      case 2:
        dv.setUint16(off, Number(v & 0xffffn), true);
        break;
      case 4:
        dv.setUint32(off, Number(v & 0xffff_ffffn), true);
        break;
      default:
        dv.setBigUint64(off, v & 0xffff_ffff_ffff_ffffn, true);
        break;
    }
  }
  return out;
}

/** Read a V register as an array of unsigned BigInt lanes. */
export function readLanes(v: Uint8Array, size: number, q: number): bigint[] {
  const bytes = laneBytes(size);
  const active = q === 1 ? 16 : 8;
  const count = active / bytes;
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * bytes;
    switch (bytes) {
      case 1:
        out.push(BigInt(dv.getUint8(off)));
        break;
      case 2:
        out.push(BigInt(dv.getUint16(off, true)));
        break;
      case 4:
        out.push(BigInt(dv.getUint32(off, true)));
        break;
      default:
        out.push(dv.getBigUint64(off, true));
        break;
    }
  }
  return out;
}

/**
 * Helper: Read a lane from a V register at the given size, sign-extended.
 */
function readLaneSigned(v: Uint8Array, index: number, size: number): bigint {
  const bytes = laneBytes(size);
  const offset = index * bytes;
  const dv = new DataView(v.buffer, v.byteOffset, 16);

  let value: bigint;
  switch (bytes) {
    case 1:
      value = BigInt(dv.getInt8(offset));
      break;
    case 2:
      value = BigInt(dv.getInt16(offset, true));
      break;
    case 4:
      value = BigInt(dv.getInt32(offset, true));
      break;
    default:
      value = dv.getBigInt64(offset, true);
      break;
  }
  return value;
}

/**
 * Helper: Read a lane from a V register at the given size, zero-extended.
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

// ══════════════════════════════════════════════════════════════════════════════
// ── Widening Add/Subtract Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SADDL/SADDL2: Signed Add Long
 * Encoding: 0 Q 0 01110 size 1 Rm 000000 Rn Rd
 * Adds corresponding elements from lower (Q=0) or upper (Q=1) halves of Vn and Vm,
 * widens to double width, stores in Vd.
 */
export function neonSaddl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SADDL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size; // 8 lanes for B→H, 4 for H→S, 2 for S→D
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const sum = nVal + mVal;
    result.push(sum);
  }

  return packLanes(result, outputSize);
}

/**
 * UADDL/UADDL2: Unsigned Add Long
 */
export function neonUaddl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UADDL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const sum = nVal + mVal;
    result.push(sum);
  }

  return packLanes(result, outputSize);
}

/**
 * SSUBL/SSUBL2: Signed Subtract Long
 */
export function neonSsubl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SSUBL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const diff = nVal - mVal;
    result.push(diff);
  }

  return packLanes(result, outputSize);
}

/**
 * USUBL/USUBL2: Unsigned Subtract Long
 */
export function neonUsubl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('USUBL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const diff = nVal - mVal;
    result.push(diff);
  }

  return packLanes(result, outputSize);
}

/**
 * SADDW/SADDW2: Signed Add Wide
 * Adds narrow elements from Vn to wide elements in Vd.
 */
export function neonSaddw(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SADDW: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  // Read wide lanes from Vd
  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const wideVal = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const narrowVal = readLaneSigned(vn, offset + i, size);
    const sum = wideVal + narrowVal;
    result.push(sum);
  }

  return packLanes(result, wideSize);
}

/**
 * UADDW/UADDW2: Unsigned Add Wide
 */
export function neonUaddw(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UADDW: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const wideVal = wideLanes[i] ?? 0n;
    const narrowVal = readLaneUnsigned(vn, offset + i, size);
    const sum = wideVal + narrowVal;
    result.push(sum);
  }

  return packLanes(result, wideSize);
}

/**
 * SSUBW/SSUBW2: Signed Subtract Wide
 */
export function neonSsubw(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SSUBW: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const wideVal = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const narrowVal = readLaneSigned(vn, offset + i, size);
    const diff = wideVal - narrowVal;
    result.push(diff);
  }

  return packLanes(result, wideSize);
}

/**
 * USUBW/USUBW2: Unsigned Subtract Wide
 */
export function neonUsubw(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('USUBW: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const wideVal = wideLanes[i] ?? 0n;
    const narrowVal = readLaneUnsigned(vn, offset + i, size);
    const diff = wideVal - narrowVal;
    result.push(diff);
  }

  return packLanes(result, wideSize);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Widening Multiply Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SMULL/SMULL2: Signed Multiply Long
 */
export function neonSmull(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SMULL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const product = nVal * mVal;
    result.push(product);
  }

  return packLanes(result, outputSize);
}

/**
 * UMULL/UMULL2: Unsigned Multiply Long
 */
export function neonUmull(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UMULL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const product = nVal * mVal;
    result.push(product);
  }

  return packLanes(result, outputSize);
}

/**
 * SMLAL/SMLAL2: Signed Multiply-Accumulate Long
 * Vd = Vd + (Vn * Vm)
 */
export function neonSmlal(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SMLAL: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const sum = acc + nVal * mVal;
    result.push(sum);
  }

  return packLanes(result, wideSize);
}

/**
 * UMLAL/UMLAL2: Unsigned Multiply-Accumulate Long
 */
export function neonUmlal(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UMLAL: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = wideLanes[i] ?? 0n;
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const sum = acc + nVal * mVal;
    result.push(sum);
  }

  return packLanes(result, wideSize);
}

/**
 * SMLSL/SMLSL2: Signed Multiply-Subtract Long
 * Vd = Vd - (Vn * Vm)
 */
export function neonSmlsl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SMLSL: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const diff = acc - nVal * mVal;
    result.push(diff);
  }

  return packLanes(result, wideSize);
}

/**
 * UMLSL/UMLSL2: Unsigned Multiply-Subtract Long
 */
export function neonUmlsl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UMLSL: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = wideLanes[i] ?? 0n;
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const diff = acc - nVal * mVal;
    result.push(diff);
  }

  return packLanes(result, wideSize);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Pairwise Widening Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SADDLP: Signed Add Long Pairwise
 * Adds pairs of adjacent narrow lanes to produce wider result.
 */
export function neonSaddlp(vn: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SADDLP: invalid size (must be 0-2)');

  const inputLaneCount = (q === 1 ? 16 : 8) / laneBytes(size);
  const outputSize = size + 1;

  const result: bigint[] = [];
  for (let i = 0; i < inputLaneCount; i += 2) {
    const val1 = readLaneSigned(vn, i, size);
    const val2 = readLaneSigned(vn, i + 1, size);
    const sum = val1 + val2;
    result.push(sum);
  }

  return packLanes(result, outputSize);
}

/**
 * UADDLP: Unsigned Add Long Pairwise
 */
export function neonUaddlp(vn: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UADDLP: invalid size (must be 0-2)');

  const inputLaneCount = (q === 1 ? 16 : 8) / laneBytes(size);
  const outputSize = size + 1;

  const result: bigint[] = [];
  for (let i = 0; i < inputLaneCount; i += 2) {
    const val1 = readLaneUnsigned(vn, i, size);
    const val2 = readLaneUnsigned(vn, i + 1, size);
    const sum = val1 + val2;
    result.push(sum);
  }

  return packLanes(result, outputSize);
}

/**
 * SADALP: Signed Accumulate Add Long Pairwise
 * Vd = Vd + pairwise_add(Vn)
 */
export function neonSadalp(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SADALP: invalid size (must be 0-2)');

  const inputLaneCount = (q === 1 ? 16 : 8) / laneBytes(size);
  const outputSize = size + 1;
  const wideLanes = readLanes(vd, outputSize, q);

  const result: bigint[] = [];
  for (let i = 0; i < inputLaneCount / 2; i++) {
    const val1 = readLaneSigned(vn, i * 2, size);
    const val2 = readLaneSigned(vn, i * 2 + 1, size);
    const acc = toSigned(wideLanes[i] ?? 0n, laneBytes(outputSize));
    const sum = acc + val1 + val2;
    result.push(sum);
  }

  return packLanes(result, outputSize);
}

/**
 * UADALP: Unsigned Accumulate Add Long Pairwise
 */
export function neonUadalp(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UADALP: invalid size (must be 0-2)');

  const inputLaneCount = (q === 1 ? 16 : 8) / laneBytes(size);
  const outputSize = size + 1;
  const wideLanes = readLanes(vd, outputSize, q);

  const result: bigint[] = [];
  for (let i = 0; i < inputLaneCount / 2; i++) {
    const val1 = readLaneUnsigned(vn, i * 2, size);
    const val2 = readLaneUnsigned(vn, i * 2 + 1, size);
    const acc = wideLanes[i] ?? 0n;
    const sum = acc + val1 + val2;
    result.push(sum);
  }

  return packLanes(result, outputSize);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Shift and Extend Widening Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SSHLL/SSHLL2: Signed Shift Left Long
 * Shifts narrow signed lanes left and widens to double width.
 */
export function neonSshll(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SSHLL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;
  const shiftAmount = BigInt(shift);

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const val = readLaneSigned(vn, offset + i, size);
    const shifted = val << shiftAmount;
    result.push(shifted);
  }

  return packLanes(result, outputSize);
}

/**
 * USHLL/USHLL2: Unsigned Shift Left Long
 */
export function neonUshll(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('USHLL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;
  const shiftAmount = BigInt(shift);

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const val = readLaneUnsigned(vn, offset + i, size);
    const shifted = val << shiftAmount;
    result.push(shifted);
  }

  return packLanes(result, outputSize);
}

/**
 * SXTL/SXTL2: Signed Extend Long
 * Alias for SSHLL with shift amount #0 (sign-extends narrow to wide).
 */
export function neonSxtl(vn: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> {
  return neonSshll(vn, 0, size, q);
}

/**
 * UXTL/UXTL2: Unsigned Extend Long
 * Alias for USHLL with shift amount #0 (zero-extends narrow to wide).
 */
export function neonUxtl(vn: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> {
  return neonUshll(vn, 0, size, q);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Narrowing Instructions (High Half) ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ADDHN/ADDHN2: Add returning High Narrow
 * Adds wide elements and narrows by taking the high half.
 */
export function neonAddhn(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('ADDHN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputLanes = readLanes(vn, inputSize, 1);
  const inputLanesM = readLanes(vm, inputSize, 1);
  const laneCount = inputLanes.length;

  const narrowBytes = laneBytes(size);
  const shiftAmount = BigInt(narrowBytes * 8);

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  // Copy existing low half if q=1
  if (q === 1) {
    result.set(vn.subarray(0, laneCount * narrowBytes), 0);
  }

  const outView = new DataView(result.buffer);
  for (let i = 0; i < laneCount; i++) {
    const sum = (inputLanes[i] ?? 0n) + (inputLanesM[i] ?? 0n);
    const high = sum >> shiftAmount; // Extract high half
    const off = (offset + i) * narrowBytes;
    if (off + narrowBytes > 16) continue;
    switch (narrowBytes) {
      case 1:
        outView.setUint8(off, Number(high & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(high & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(high & 0xffff_ffffn), true);
        break;
    }
  }

  return result;
}

/**
 * SUBHN/SUBHN2: Subtract returning High Narrow
 */
export function neonSubhn(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SUBHN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputLanes = readLanes(vn, inputSize, 1);
  const inputLanesM = readLanes(vm, inputSize, 1);
  const laneCount = inputLanes.length;

  const narrowBytes = laneBytes(size);
  const shiftAmount = BigInt(narrowBytes * 8);

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * narrowBytes), 0);
  }

  const outView = new DataView(result.buffer);
  for (let i = 0; i < laneCount; i++) {
    const diff = (inputLanes[i] ?? 0n) - (inputLanesM[i] ?? 0n);
    const high = diff >> shiftAmount;
    const off = (offset + i) * narrowBytes;
    if (off + narrowBytes > 16) continue;
    switch (narrowBytes) {
      case 1:
        outView.setUint8(off, Number(high & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(high & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(high & 0xffff_ffffn), true);
        break;
    }
  }

  return result;
}

/**
 * RADDHN/RADDHN2: Rounding Add returning High Narrow
 */
export function neonRaddhn(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('RADDHN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputLanes = readLanes(vn, inputSize, 1);
  const inputLanesM = readLanes(vm, inputSize, 1);
  const laneCount = inputLanes.length;

  const narrowBytes = laneBytes(size);
  const shiftAmount = BigInt(narrowBytes * 8);
  const roundConst = 1n << (shiftAmount - 1n);

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * narrowBytes), 0);
  }

  const outView = new DataView(result.buffer);
  for (let i = 0; i < laneCount; i++) {
    const sum = (inputLanes[i] ?? 0n) + (inputLanesM[i] ?? 0n);
    const rounded = sum + roundConst;
    const high = rounded >> shiftAmount;
    const off = (offset + i) * narrowBytes;
    if (off + narrowBytes > 16) continue;
    switch (narrowBytes) {
      case 1:
        outView.setUint8(off, Number(high & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(high & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(high & 0xffff_ffffn), true);
        break;
    }
  }

  return result;
}

/**
 * RSUBHN/RSUBHN2: Rounding Subtract returning High Narrow
 */
export function neonRsubhn(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('RSUBHN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputLanes = readLanes(vn, inputSize, 1);
  const inputLanesM = readLanes(vm, inputSize, 1);
  const laneCount = inputLanes.length;

  const narrowBytes = laneBytes(size);
  const shiftAmount = BigInt(narrowBytes * 8);
  const roundConst = 1n << (shiftAmount - 1n);

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * narrowBytes), 0);
  }

  const outView = new DataView(result.buffer);
  for (let i = 0; i < laneCount; i++) {
    const diff = (inputLanes[i] ?? 0n) - (inputLanesM[i] ?? 0n);
    const rounded = diff + roundConst;
    const high = rounded >> shiftAmount;
    const off = (offset + i) * narrowBytes;
    if (off + narrowBytes > 16) continue;
    switch (narrowBytes) {
      case 1:
        outView.setUint8(off, Number(high & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(high & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(high & 0xffff_ffffn), true);
        break;
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Saturating Multiply Widening Instructions ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: Saturate a signed value to the specified bit width.
 */
function saturateSigned(value: bigint, bits: number): bigint {
  const max = (1n << BigInt(bits - 1)) - 1n;
  const min = -(1n << BigInt(bits - 1));
  if (value > max) return max;
  if (value < min) return min;
  return value;
}

/**
 * SQDMULL/SQDMULL2: Signed Saturating Doubling Multiply Long
 * Multiplies narrow signed elements, doubles the result, and widens.
 */
export function neonSqdmull(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size < 1 || size > 2) throw new Error('SQDMULL: only 16-bit and 32-bit sizes supported');

  const outputSize = size + 1;
  const outputBits = laneBytes(outputSize) * 8;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);

    // Doubling multiply
    const product = nVal * mVal * 2n;

    // Saturate to output width
    const saturated = saturateSigned(product, outputBits);
    result.push(saturated);
  }

  return packLanes(result, outputSize);
}

/**
 * SQDMLAL/SQDMLAL2: Signed Saturating Doubling Multiply-Accumulate Long
 * Vd = saturate(Vd + 2 * Vn * Vm)
 */
export function neonSqdmlal(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size < 1 || size > 2) throw new Error('SQDMLAL: only 16-bit and 32-bit sizes supported');

  const wideSize = size + 1;
  const wideBits = laneBytes(wideSize) * 8;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);

    const product = nVal * mVal * 2n;
    const sum = acc + product;

    const saturated = saturateSigned(sum, wideBits);
    result.push(saturated);
  }

  return packLanes(result, wideSize);
}

/**
 * SQDMLSL/SQDMLSL2: Signed Saturating Doubling Multiply-Subtract Long
 * Vd = saturate(Vd - 2 * Vn * Vm)
 */
export function neonSqdmlsl(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size < 1 || size > 2) throw new Error('SQDMLSL: only 16-bit and 32-bit sizes supported');

  const wideSize = size + 1;
  const wideBits = laneBytes(wideSize) * 8;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);

    const product = nVal * mVal * 2n;
    const diff = acc - product;

    const saturated = saturateSigned(diff, wideBits);
    result.push(saturated);
  }

  return packLanes(result, wideSize);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Absolute Difference Instructions (SABAL/UABAL/SABDL/UABDL) ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SABAL/SABAL2: Signed Absolute difference Accumulate Long
 * Vd = Vd + |Vn - Vm| (lane-wise, signed narrow → widened result)
 */
export function neonSabal(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SABAL: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = toSigned(wideLanes[i] ?? 0n, laneBytes(wideSize));
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const diff = nVal > mVal ? nVal - mVal : mVal - nVal;
    const sum = acc + diff;
    result.push(sum);
  }

  return packLanes(result, wideSize);
}

/**
 * UABAL/UABAL2: Unsigned Absolute difference Accumulate Long
 * Vd = Vd + |Vn - Vm| (lane-wise, unsigned narrow → widened result)
 */
export function neonUabal(
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UABAL: invalid size (must be 0-2)');

  const wideSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const wideLanes = readLanes(vd, wideSize, 1);

  const result: bigint[] = [];
  for (let i = 0; i < wideLanes.length; i++) {
    const acc = wideLanes[i] ?? 0n;
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const diff = nVal > mVal ? nVal - mVal : mVal - nVal;
    const sum = acc + diff;
    result.push(sum);
  }

  return packLanes(result, wideSize);
}

/**
 * SABDL/SABDL2: Signed Absolute difference Long
 * Vd = |Vn - Vm| (lane-wise, signed narrow → widened result, no accumulate)
 */
export function neonSabdl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SABDL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneSigned(vn, offset + i, size);
    const mVal = readLaneSigned(vm, offset + i, size);
    const diff = nVal > mVal ? nVal - mVal : mVal - nVal;
    result.push(diff);
  }

  return packLanes(result, outputSize);
}

/**
 * UABDL/UABDL2: Unsigned Absolute difference Long
 * Vd = |Vn - Vm| (lane-wise, unsigned narrow → widened result, no accumulate)
 */
export function neonUabdl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UABDL: invalid size (must be 0-2)');

  const outputSize = size + 1;
  const laneCount = 8 >> size;
  const offset = q === 1 ? laneCount : 0;

  const result: bigint[] = [];
  for (let i = 0; i < laneCount; i++) {
    const nVal = readLaneUnsigned(vn, offset + i, size);
    const mVal = readLaneUnsigned(vm, offset + i, size);
    const diff = nVal > mVal ? nVal - mVal : mVal - nVal;
    result.push(diff);
  }

  return packLanes(result, outputSize);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Polynomial Multiply Long (PMULL/PMULL2) ──
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PMULL/PMULL2: Polynomial Multiply Long over GF(2).
 *
 * Operates on each lane of Vn and Vm as an 8-bit polynomial (size=0, .8B→.8H)
 * or 64-bit polynomial (size=3, .1Q→.1Q). The product is computed without
 * carries (XOR-based arithmetic), yielding a double-width result.
 *
 * This is the primitive used in GCM (Galois/Counter Mode) for GHASH and other
 * GF(2^n) cryptographic operations.
 */
export function neonPmull(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  if (size !== 0 && size !== 3) throw new Error('PMULL: size must be 0 (.8B→.8H) or 3 (.1Q→.1Q)');

  if (size === 0) {
    // .8B input → .8H output (8-bit poly lanes → 16-bit products)
    const offset = q === 1 ? 8 : 0;
    const outLanes: bigint[] = [];

    for (let i = 0; i < 8; i++) {
      const a = readLaneUnsigned(vn, offset + i, 0); // size=0 → 1 byte
      const b = readLaneUnsigned(vm, offset + i, 0);
      // Polynomial multiply: for each set bit in a, XOR (b << bit_pos)
      let product = 0n;
      for (let bit = 0; bit < 8; bit++) {
        if ((a >> BigInt(bit)) & 1n) {
          product ^= b << BigInt(bit);
        }
      }
      outLanes.push(product & 0xffffn); // 16-bit result
    }
    return packLanes(outLanes, 1); // size=1 → 2 bytes per lane
  }

  // size=3: .1Q → .1Q (single 64-bit lane → 128-bit result)
  const a = q === 1 ? readLaneUnsigned(vn, 1, 3) : readLaneUnsigned(vn, 0, 3);
  const b = q === 1 ? readLaneUnsigned(vm, 1, 3) : readLaneUnsigned(vm, 0, 3);

  let product = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if ((a >> BigInt(bit)) & 1n) {
      product ^= b << BigInt(bit);
    }
  }

  const result = new Uint8Array(16);
  const dv = new DataView(result.buffer);
  dv.setBigUint64(0, product & 0xffff_ffff_ffff_ffffn, true);
  dv.setBigUint64(8, (product >> 64n) & 0xffff_ffff_ffff_ffffn, true);
  return result;
}

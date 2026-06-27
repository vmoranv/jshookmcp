/**
 * simd-neon — AArch64 Advanced SIMD (NEON) integer lane operations, kept beside
 * the dispatcher so the per-lane behaviour can be tested in isolation.
 *
 * Every routine works on a 16-byte V register viewed as a vector of lanes whose
 * width is `esize = 8 << size` bytes (size: 0=B/8b, 1=H/16b, 2=S/32b, 3=D/64b).
 * `q` selects how much of the register is active — Q=1 uses all 128 bits, Q=0
 * only the low 64 (the high 8 bytes are zeroed on write). Lanes are little-endian
 * and processed independently, exactly as the hardware does.
 */

/** Number of bytes per lane for an element-size field (0=1,1=2,2=4,3=8). */
const laneBytes = (size: number): number => 1 << size;

/** Read a V register as an array of unsigned BigInt lanes at the given size/width. */
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

/** Pack unsigned BigInt lanes back into a fresh 16-byte V register (unused high bytes zeroed). */
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

/** Mask for the low `bytes*8` bits. */
const widthMask = (bytes: number): bigint => (1n << BigInt(bytes * 8)) - 1n;

/** Interpret an unsigned lane as signed (two's complement) at the lane width. */
function toSigned(v: bigint, bytes: number): bigint {
  const bits = BigInt(bytes * 8);
  const signBit = 1n << (bits - 1n);
  return (v & signBit) !== 0n ? v - (1n << bits) : v;
}

/** Apply a binary per-lane op across two registers, returning a packed result. */
function mapLanes2(
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
  op: (x: bigint, y: bigint, mask: bigint, bytes: number) => bigint,
): Uint8Array<ArrayBuffer> {
  const la = readLanes(a, size, q);
  const lb = readLanes(b, size, q);
  const bytes = laneBytes(size);
  const mask = widthMask(bytes);
  const out = la.map((x, i) => op(x, lb[i] ?? 0n, mask, bytes) & mask);
  return packLanes(out, size);
}

// ── arithmetic ──
export const neonAdd = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes2(a, b, size, q, (x, y) => x + y);
export const neonSub = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes2(a, b, size, q, (x, y) => x - y);
export const neonMul = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes2(a, b, size, q, (x, y) => x * y);

export const neonSqadd = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapSignedSaturating(a, b, size, q, (x, y) => x + y);
export const neonUqadd = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapUnsignedSaturating(a, b, size, q, (x, y) => x + y);
export const neonSqsub = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapSignedSaturating(a, b, size, q, (x, y) => x - y);
export const neonUqsub = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapUnsignedSaturating(a, b, size, q, (x, y) => x - y);

function mapSignedSaturating(
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
  op: (x: bigint, y: bigint) => bigint,
): Uint8Array<ArrayBuffer> {
  return mapLanes2(a, b, size, q, (x, y, _mask, bytes) => {
    const bits = BigInt(bytes * 8);
    const min = -(1n << (bits - 1n));
    const max = (1n << (bits - 1n)) - 1n;
    const v = op(toSigned(x, bytes), toSigned(y, bytes));
    const saturated = v < min ? min : v > max ? max : v;
    return saturated < 0 ? (1n << bits) + saturated : saturated;
  });
}

function mapUnsignedSaturating(
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
  op: (x: bigint, y: bigint) => bigint,
): Uint8Array<ArrayBuffer> {
  return mapLanes2(a, b, size, q, (x, y, mask) => {
    const v = op(x, y);
    if (v < 0n) return 0n;
    return v > mask ? mask : v;
  });
}

// ── bitwise logical (size selects AND/BIC/ORR/ORN for U=0; EOR/BSL/BIT/BIF for U=1) ──
export const neonAnd = (a: Uint8Array, b: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, 3, q, (x, y) => x & y);
export const neonOrr = (a: Uint8Array, b: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, 3, q, (x, y) => x | y);
export const neonEor = (a: Uint8Array, b: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, 3, q, (x, y) => x ^ y);
export const neonBic = (a: Uint8Array, b: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, 3, q, (x, y, mask) => x & (~y & mask));
export const neonOrn = (a: Uint8Array, b: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, 3, q, (x, y, mask) => x | (~y & mask));
/** BSL: Vd = (Vd & Vm) | (Vn & ~Vm) — bit select, dst is also an operand. */
export const neonBsl = (
  vd: Uint8Array,
  vn: Uint8Array,
  vm: Uint8Array,
  q: number,
): Uint8Array<ArrayBuffer> => {
  const d = readLanes(vd, 3, q);
  const n = readLanes(vn, 3, q);
  const m = readLanes(vm, 3, q);
  const mask = widthMask(8);
  return packLanes(
    d.map((dd, i) => ((dd & (n[i] ?? 0n)) | ((m[i] ?? 0n) & (~(n[i] ?? 0n) & mask))) & mask),
    3,
  );
};

// ── comparisons (all-ones / all-zeros per lane) ──
const TRUE = (mask: bigint): bigint => mask;
const FALSE = 0n;
export const neonCmeq = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, mask) => (x === y ? TRUE(mask) : FALSE));
/** CMGT (signed greater-than). */
export const neonCmgt = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, mask, bytes) =>
    toSigned(x, bytes) > toSigned(y, bytes) ? TRUE(mask) : FALSE,
  );
/** CMGE (signed greater-or-equal). */
export const neonCmge = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, mask, bytes) =>
    toSigned(x, bytes) >= toSigned(y, bytes) ? TRUE(mask) : FALSE,
  );
/** CMHI (unsigned higher). */
export const neonCmhi = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, mask) => (x > y ? TRUE(mask) : FALSE));
/** CMHS (unsigned higher-or-same). */
export const neonCmhs = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, mask) => (x >= y ? TRUE(mask) : FALSE));
/** CMTST (bitwise test → nonzero AND). */
export const neonCmtst = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, mask) => ((x & y) !== 0n ? TRUE(mask) : FALSE));

// ── min/max (signed + unsigned) ──
export const neonSmax = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, _mask, bytes) => {
    const sx = toSigned(x, bytes);
    const sy = toSigned(y, bytes);
    return sx > sy ? x : y;
  });
export const neonSmin = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes2(a, b, size, q, (x, y, _mask, bytes) => {
    const sx = toSigned(x, bytes);
    const sy = toSigned(y, bytes);
    return sx < sy ? x : y;
  });
export const neonUmax = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes2(a, b, size, q, (x, y) => (x > y ? x : y));
export const neonUmin = (
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes2(a, b, size, q, (x, y) => (x < y ? x : y));

// ── two-register misc (single source, per-lane) ──

function mapLanes1(
  a: Uint8Array,
  size: number,
  q: number,
  op: (x: bigint, mask: bigint, bytes: number) => bigint,
): Uint8Array<ArrayBuffer> {
  const la = readLanes(a, size, q);
  const bytes = laneBytes(size);
  const mask = widthMask(bytes);
  return packLanes(
    la.map((x) => op(x, mask, bytes) & mask),
    size,
  );
}

/** NEG: two's-complement negate per lane. */
export const neonNeg = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, size, q, (x, mask) => (~x + 1n) & mask);
/** ABS: absolute value of the signed lane. */
export const neonAbs = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, size, q, (x, mask, bytes) => {
    const s = toSigned(x, bytes);
    return (s < 0n ? -s : s) & mask;
  });
/** NOT (a.k.a. MVN): bitwise complement; operates byte-wise (size is always 00). */
export const neonNot = (a: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, 0, q, (x, mask) => ~x & mask);
/** CNT: population count per byte. */
export const neonCnt = (a: Uint8Array, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, 0, q, (x) => {
    let v = x & 0xffn;
    let c = 0n;
    while (v) {
      c += v & 1n;
      v >>= 1n;
    }
    return c;
  });
/** CLZ: count leading zeros per lane at the element width. */
export const neonClz = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, size, q, (x, _mask, bytes) => {
    const bits = bytes * 8;
    if (x === 0n) return BigInt(bits);
    let c = 0n;
    for (let i = bits - 1; i >= 0; i--) {
      if ((x >> BigInt(i)) & 1n) break;
      c++;
    }
    return c;
  });
/** CMEQ #0: compare each lane to zero → all-ones/all-zeros. */
export const neonCmeqZero = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, size, q, (x, mask) => (x === 0n ? mask : 0n));

/** REVn: reverse the order of `groupBytes`-sized sub-elements within each container.
 * REV64 reverses bytes within each 8-byte group, REV32 within 4, REV16 within 2. */
export function neonRev(a: Uint8Array, containerBytes: number, q: number): Uint8Array<ArrayBuffer> {
  const active = q === 1 ? 16 : 8;
  const out = new Uint8Array(16);
  for (let base = 0; base < active; base += containerBytes) {
    for (let i = 0; i < containerBytes; i++) {
      out[base + i] = a[base + containerBytes - 1 - i] ?? 0;
    }
  }
  return out;
}

// ── DUP: replicate one element across all lanes ──

/** DUP (element): broadcast lane `index` of `a` (element size `size`) to all lanes. */
export function neonDupElement(
  a: Uint8Array,
  size: number,
  index: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(a, size, 1); // read from full register
  const value = lanes[index] ?? 0n;
  const active = q === 1 ? 16 : 8;
  const count = active / laneBytes(size);
  return packLanes(
    Array.from({ length: count }, () => value),
    size,
  );
}

/** DUP (general): broadcast a GPR value to all lanes of element size `size`. */
export function neonDupGeneral(raw: bigint, size: number, q: number): Uint8Array<ArrayBuffer> {
  const mask = widthMask(laneBytes(size));
  const value = raw & mask;
  const active = q === 1 ? 16 : 8;
  const count = active / laneBytes(size);
  return packLanes(
    Array.from({ length: count }, () => value),
    size,
  );
}

// ── shift by immediate ──

/** SHL: logical left shift each lane by `shift`. */
export const neonShl = (
  a: Uint8Array,
  size: number,
  shift: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes1(a, size, q, (x, mask) => (x << BigInt(shift)) & mask);
/** USHR: unsigned (logical) right shift each lane by `shift`. */
export const neonUshr = (
  a: Uint8Array,
  size: number,
  shift: number,
  q: number,
): Uint8Array<ArrayBuffer> => mapLanes1(a, size, q, (x) => x >> BigInt(shift));
/** SSHR: signed (arithmetic) right shift each lane by `shift`. */
export const neonSshr = (
  a: Uint8Array,
  size: number,
  shift: number,
  q: number,
): Uint8Array<ArrayBuffer> =>
  mapLanes1(a, size, q, (x, mask, bytes) => {
    const s = toSigned(x, bytes);
    return (s >> BigInt(shift)) & mask;
  });

// ── across-lanes reductions → scalar in lane 0 ──

function reduce(
  a: Uint8Array,
  size: number,
  q: number,
  fold: (acc: bigint, x: bigint, bytes: number) => bigint,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(a, size, q);
  const bytes = laneBytes(size);
  let acc = lanes[0] ?? 0n;
  for (let i = 1; i < lanes.length; i++) acc = fold(acc, lanes[i] ?? 0n, bytes);
  return packLanes([acc & widthMask(bytes)], size);
}
export const neonAddv = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  reduce(a, size, q, (acc, x) => acc + x);
export const neonSmaxv = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  reduce(a, size, q, (acc, x, bytes) => (toSigned(acc, bytes) >= toSigned(x, bytes) ? acc : x));
export const neonSminv = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  reduce(a, size, q, (acc, x, bytes) => (toSigned(acc, bytes) <= toSigned(x, bytes) ? acc : x));
export const neonUmaxv = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  reduce(a, size, q, (acc, x) => (acc >= x ? acc : x));
export const neonUminv = (a: Uint8Array, size: number, q: number): Uint8Array<ArrayBuffer> =>
  reduce(a, size, q, (acc, x) => (acc <= x ? acc : x));

// ── permute (ZIP/UZP/TRN) ──

/** ZIP1/ZIP2: interleave lanes from the lower (part=0) or upper (part=1) halves. */
export function neonZip(
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
  part: number,
): Uint8Array<ArrayBuffer> {
  const la = readLanes(a, size, q);
  const lb = readLanes(b, size, q);
  const count = la.length;
  const base = (part * count) / 2;
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const src = i >> 1;
    out.push((i & 1) === 0 ? (la[base + src] ?? 0n) : (lb[base + src] ?? 0n));
  }
  return packLanes(out, size);
}
/** UZP1/UZP2: de-interleave — even (part=0) or odd (part=1) lanes, Rn then Rm. */
export function neonUzp(
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
  part: number,
): Uint8Array<ArrayBuffer> {
  const la = readLanes(a, size, q);
  const lb = readLanes(b, size, q);
  const count = la.length;
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const idx = 2 * i + part;
    out.push(idx < count ? (la[idx] ?? 0n) : (lb[idx - count] ?? 0n));
  }
  return packLanes(out, size);
}
/** TRN1/TRN2: transpose — pick even-or-odd (part) positions alternately from Rn/Rm. */
export function neonTrn(
  a: Uint8Array,
  b: Uint8Array,
  size: number,
  q: number,
  part: number,
): Uint8Array<ArrayBuffer> {
  const la = readLanes(a, size, q);
  const lb = readLanes(b, size, q);
  const count = la.length;
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (i & ~1) + part;
    out.push((i & 1) === 0 ? (la[idx] ?? 0n) : (lb[idx] ?? 0n));
  }
  return packLanes(out, size);
}

// ── EXT: extract a byte window from the concatenation Rn:Rm ──

export function neonExt(
  a: Uint8Array,
  b: Uint8Array,
  index: number,
  q: number,
): Uint8Array<ArrayBuffer> {
  const active = q === 1 ? 16 : 8;
  const cat = new Uint8Array(active * 2);
  cat.set(a.subarray(0, active), 0);
  cat.set(b.subarray(0, active), active);
  const out = new Uint8Array(16);
  for (let i = 0; i < active; i++) out[i] = cat[index + i] ?? 0;
  return out;
}

// ── TBL/TBX: table lookup over 1..4 consecutive table registers ──

/** Look up each index byte of `indices` in `table` (concatenated bytes). For TBL,
 * out-of-range indices write 0; for TBX (isTbx), they leave the destination byte. */
export function neonTbl(
  table: Uint8Array,
  indices: Uint8Array,
  q: number,
  dest: Uint8Array,
  isTbx: boolean,
): Uint8Array<ArrayBuffer> {
  const active = q === 1 ? 16 : 8;
  const tableLen = table.length;
  const out = new Uint8Array(16);
  if (isTbx) out.set(dest.subarray(0, 16));
  for (let i = 0; i < active; i++) {
    const idx = indices[i] ?? 0;
    if (idx < tableLen) out[i] = table[idx] ?? 0;
    else if (!isTbx) out[i] = 0;
  }
  if (q === 0) out.fill(0, 8);
  return out;
}

/** Replicate a 32-bit pattern into both halves of a 64-bit lane. */
const rep32 = (v: bigint): bigint => v | (v << 32n);

/** AdvSIMDExpandImm — build the 64-bit MOVI/MVNI immediate from cmode + imm8.
 * Returns the per-64-bit-lane value; the caller replicates and applies op. */
export function advSimdExpandImm(op: number, cmode: number, imm8: number): bigint {
  const cmodeHi = (cmode >> 1) & 0b111;
  const cmodeLo = cmode & 1;
  const byte = BigInt(imm8 & 0xff);
  switch (cmodeHi) {
    case 0b000:
      return rep32(byte);
    case 0b001:
      return rep32(byte << 8n);
    case 0b010:
      return rep32(byte << 16n);
    case 0b011:
      return rep32(byte << 24n);
    case 0b100: {
      const h = byte | (byte << 16n);
      return rep32(h);
    }
    case 0b101: {
      const h = (byte << 8n) | (byte << 24n);
      return rep32(h);
    }
    case 0b110: {
      // MSL: byte shifted left by 8 or 16, low bits set to ones.
      const amount = cmodeLo === 0 ? 8n : 16n;
      const ones = (1n << amount) - 1n;
      const v = (byte << amount) | ones;
      return rep32(v);
    }
    default: {
      // cmode == 0b111x
      if (cmodeLo === 0) {
        // 8-bit per byte replicate.
        let r = 0n;
        for (let i = 0; i < 8; i++) r |= byte << BigInt(i * 8);
        return r;
      }
      if (op === 0) {
        // cmode=1110 op=1: each bit of imm8 expands to a full byte of ones/zeros.
        let r = 0n;
        for (let i = 0; i < 8; i++) {
          if ((imm8 >> i) & 1) r |= 0xffn << BigInt(i * 8);
        }
        return r;
      }
      // FMOV-style single-precision immediate (cmode=1111 op=0 handled by FP path).
      return rep32(byte);
    }
  }
}

// ── Saturating Arithmetic Instructions ──

/**
 * Saturate a signed value to the specified bit width.
 * Sets QC flag if saturation occurs.
 */
function saturateSigned(value: bigint, bits: number, setQC: () => void): bigint {
  const max = (1n << BigInt(bits - 1)) - 1n;
  const min = -(1n << BigInt(bits - 1));

  if (value > max) {
    setQC();
    return max;
  }
  if (value < min) {
    setQC();
    return min;
  }
  return value;
}

/**
 * Saturate an unsigned value to the specified bit width.
 * Sets QC flag if saturation occurs.
 */
function saturateUnsigned(value: bigint, bits: number, setQC: () => void): bigint {
  const max = (1n << BigInt(bits)) - 1n;

  if (value > max) {
    setQC();
    return max;
  }
  if (value < 0n) {
    setQC();
    return 0n;
  }
  return value;
}

/**
 * Convert signed value to unsigned representation at the given bit width.
 */
function signedToUnsigned(value: bigint, bits: number): bigint {
  if (value < 0n) {
    return (1n << BigInt(bits)) + value;
  }
  return value;
}

/** SUQADD: Signed saturating add of unsigned value. */
export function neonSuqadd(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vd, size, q);
  const addends = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const signedVal = toSigned(lane, bytes);
    const unsignedAddend = addends[i] ?? 0n;
    const sum = signedVal + unsignedAddend;
    const saturated = saturateSigned(sum, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

/** USQADD: Unsigned saturating add of signed value. */
export function neonUsqadd(
  vd: Uint8Array,
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vd, size, q);
  const addends = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const unsignedVal = lane;
    const signedAddend = toSigned(addends[i] ?? 0n, bytes);
    const sum = unsignedVal + signedAddend;
    return saturateUnsigned(sum, bits, setQC);
  });

  return packLanes(result, size);
}

// ── Saturating Shift Instructions ──

/** SQSHL (register): Signed saturating shift left by signed variable. */
export function neonSqshl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const shifts = readLanes(vm, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const value = toSigned(lane, bytes);
    const shift = toSigned(shifts[i] ?? 0n, bytes);

    let shifted: bigint;
    if (shift >= 0n) {
      // Left shift - check for overflow
      if (shift >= BigInt(bits)) {
        // Shift amount >= bits, result saturates
        shifted = value >= 0n ? (1n << BigInt(bits - 1)) - 1n : -(1n << BigInt(bits - 1));
        setQC();
      } else {
        shifted = value << shift;
      }
    } else {
      // Right shift (arithmetic)
      const absShift = -shift;
      if (absShift >= BigInt(bits)) {
        shifted = value >= 0n ? 0n : -1n;
      } else {
        shifted = value >> absShift;
      }
    }

    const saturated = saturateSigned(shifted, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

/** UQSHL (register): Unsigned saturating shift left by signed variable. */
export function neonUqshl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const shifts = readLanes(vm, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const value = lane;
    const shift = toSigned(shifts[i] ?? 0n, bytes);

    let shifted: bigint;
    if (shift >= 0n) {
      // Left shift
      if (shift >= BigInt(bits)) {
        shifted = value === 0n ? 0n : (1n << BigInt(bits)) - 1n;
        if (value !== 0n) setQC();
      } else {
        shifted = value << shift;
      }
    } else {
      // Right shift (logical)
      const absShift = -shift;
      shifted = absShift >= BigInt(bits) ? 0n : value >> absShift;
    }

    return saturateUnsigned(shifted, bits, setQC);
  });

  return packLanes(result, size);
}

/** SQSHL (immediate): Signed saturating shift left by immediate. */
export function neonSqshlImm(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;
  const shiftAmount = BigInt(shift);

  const result = lanes.map((lane) => {
    const value = toSigned(lane, bytes);
    const shifted = shiftAmount === 0n ? value : value << shiftAmount;
    const saturated = saturateSigned(shifted, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

/** UQSHL (immediate): Unsigned saturating shift left by immediate. */
export function neonUqshlImm(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;
  const shiftAmount = BigInt(shift);

  const result = lanes.map((lane) => {
    const shifted = shiftAmount === 0n ? lane : lane << shiftAmount;
    return saturateUnsigned(shifted, bits, setQC);
  });

  return packLanes(result, size);
}

/** SQSHLU: Signed saturating shift left unsigned (result is unsigned). */
export function neonSqshlu(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;
  const shiftAmount = BigInt(shift);

  const result = lanes.map((lane) => {
    const value = toSigned(lane, bytes);
    const shifted = shiftAmount === 0n ? value : value << shiftAmount;
    return saturateUnsigned(shifted, bits, setQC);
  });

  return packLanes(result, size);
}

/** SQRSHL: Signed saturating rounding shift left. */
export function neonSqrshl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const shifts = readLanes(vm, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const value = toSigned(lane, bytes);
    const shift = toSigned(shifts[i] ?? 0n, bytes);

    let shifted: bigint;
    if (shift >= 0n) {
      // Left shift (no rounding needed)
      if (shift >= BigInt(bits)) {
        shifted = value >= 0n ? (1n << BigInt(bits - 1)) - 1n : -(1n << BigInt(bits - 1));
        setQC();
      } else {
        shifted = value << shift;
      }
    } else {
      // Right shift with rounding
      const absShift = -shift;
      if (absShift >= BigInt(bits)) {
        shifted = value >= 0n ? 0n : -1n;
      } else {
        const roundBit = absShift > 0n ? (value >> (absShift - 1n)) & 1n : 0n;
        shifted = (value >> absShift) + roundBit;
      }
    }

    const saturated = saturateSigned(shifted, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

/** UQRSHL: Unsigned saturating rounding shift left. */
export function neonUqrshl(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const shifts = readLanes(vm, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const value = lane;
    const shift = toSigned(shifts[i] ?? 0n, bytes);

    let shifted: bigint;
    if (shift >= 0n) {
      // Left shift
      if (shift >= BigInt(bits)) {
        shifted = value === 0n ? 0n : (1n << BigInt(bits)) - 1n;
        if (value !== 0n) setQC();
      } else {
        shifted = value << shift;
      }
    } else {
      // Right shift with rounding
      const absShift = -shift;
      if (absShift >= BigInt(bits)) {
        shifted = 0n;
      } else {
        const roundBit = absShift > 0n ? (value >> (absShift - 1n)) & 1n : 0n;
        shifted = (value >> absShift) + roundBit;
      }
    }

    return saturateUnsigned(shifted, bits, setQC);
  });

  return packLanes(result, size);
}

// ── Saturating Narrowing Instructions ──

/** SQXTN: Signed saturating extract narrow (high half if q=1). */
export function neonSqxtn(
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SQXTN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputBytes = laneBytes(inputSize);
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;

  const inputLanes = readLanes(vn, inputSize, 1); // Always read full register
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const wideValue = toSigned(lane, inputBytes);
    const saturated = saturateSigned(wideValue, outputBits, setQC);
    return signedToUnsigned(saturated, outputBits);
  });

  // Copy existing low half if q=1
  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  // Write narrowed values
  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** UQXTN: Unsigned saturating extract narrow (high half if q=1). */
export function neonUqxtn(
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UQXTN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    return saturateUnsigned(lane, outputBits, setQC);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** SQXTUN: Signed saturating extract unsigned narrow (high half if q=1). */
export function neonSqxtun(
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SQXTUN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputBytes = laneBytes(inputSize);
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const wideValue = toSigned(lane, inputBytes);
    return saturateUnsigned(wideValue, outputBits, setQC);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** SQSHRN: Signed saturating shift right narrow (high half if q=1). */
export function neonSqshrn(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SQSHRN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputBytes = laneBytes(inputSize);
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;
  const shiftAmount = BigInt(shift);

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const wideValue = toSigned(lane, inputBytes);
    const shifted = wideValue >> shiftAmount;
    const saturated = saturateSigned(shifted, outputBits, setQC);
    return signedToUnsigned(saturated, outputBits);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** UQSHRN: Unsigned saturating shift right narrow (high half if q=1). */
export function neonUqshrn(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UQSHRN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;
  const shiftAmount = BigInt(shift);

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const shifted = lane >> shiftAmount;
    return saturateUnsigned(shifted, outputBits, setQC);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** SQSHRUN: Signed saturating shift right unsigned narrow (high half if q=1). */
export function neonSqshrun(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SQSHRUN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputBytes = laneBytes(inputSize);
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;
  const shiftAmount = BigInt(shift);

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const wideValue = toSigned(lane, inputBytes);
    const shifted = wideValue >> shiftAmount;
    return saturateUnsigned(shifted, outputBits, setQC);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** SQRSHRN: Signed saturating rounded shift right narrow (high half if q=1). */
export function neonSqrshrn(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SQRSHRN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputBytes = laneBytes(inputSize);
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;
  const shiftAmount = BigInt(shift);

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const wideValue = toSigned(lane, inputBytes);
    const roundBit = shiftAmount > 0n ? (wideValue >> (shiftAmount - 1n)) & 1n : 0n;
    const shifted = (wideValue >> shiftAmount) + roundBit;
    const saturated = saturateSigned(shifted, outputBits, setQC);
    return signedToUnsigned(saturated, outputBits);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** UQRSHRN: Unsigned saturating rounded shift right narrow (high half if q=1). */
export function neonUqrshrn(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('UQRSHRN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;
  const shiftAmount = BigInt(shift);

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const roundBit = shiftAmount > 0n ? (lane >> (shiftAmount - 1n)) & 1n : 0n;
    const shifted = (lane >> shiftAmount) + roundBit;
    return saturateUnsigned(shifted, outputBits, setQC);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

/** SQRSHRUN: Signed saturating rounded shift right unsigned narrow (high half if q=1). */
export function neonSqrshrun(
  vn: Uint8Array,
  shift: number,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size >= 3) throw new Error('SQRSHRUN: invalid size (must be 0-2)');

  const inputSize = size + 1;
  const inputBytes = laneBytes(inputSize);
  const outputBytes = laneBytes(size);
  const outputBits = outputBytes * 8;
  const shiftAmount = BigInt(shift);

  const inputLanes = readLanes(vn, inputSize, 1);
  const laneCount = inputLanes.length;

  const result = new Uint8Array(16);
  const offset = q === 1 ? laneCount : 0;

  const narrowed = inputLanes.map((lane) => {
    const wideValue = toSigned(lane, inputBytes);
    const roundBit = shiftAmount > 0n ? (wideValue >> (shiftAmount - 1n)) & 1n : 0n;
    const shifted = (wideValue >> shiftAmount) + roundBit;
    return saturateUnsigned(shifted, outputBits, setQC);
  });

  if (q === 1) {
    result.set(vn.subarray(0, laneCount * outputBytes), 0);
  }

  const outView = new DataView(result.buffer);
  narrowed.forEach((val, i) => {
    const off = (offset + i) * outputBytes;
    if (off + outputBytes > 16) return;
    switch (outputBytes) {
      case 1:
        outView.setUint8(off, Number(val & 0xffn));
        break;
      case 2:
        outView.setUint16(off, Number(val & 0xffffn), true);
        break;
      case 4:
        outView.setUint32(off, Number(val & 0xffff_ffffn), true);
        break;
    }
  });

  return result;
}

// ── Saturating Multiply Instructions ──

/** SQDMULH: Signed saturating doubling multiply returning high half. */
export function neonSqdmulh(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size < 1 || size > 2) throw new Error('SQDMULH: only 16-bit and 32-bit sizes supported');

  const lanes = readLanes(vn, size, q);
  const multipliers = readLanes(vm, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const a = toSigned(lane, bytes);
    const b = toSigned(multipliers[i] ?? 0n, bytes);

    // Doubling multiply: product × 2
    const product = a * b * 2n;

    // Extract high half
    const high = product >> BigInt(bits);

    // Saturate
    const saturated = saturateSigned(high, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

/** SQRDMULH: Signed saturating rounding doubling multiply returning high half. */
export function neonSqrdmulh(
  vn: Uint8Array,
  vm: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  if (size < 1 || size > 2) throw new Error('SQRDMULH: only 16-bit and 32-bit sizes supported');

  const lanes = readLanes(vn, size, q);
  const multipliers = readLanes(vm, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane, i) => {
    const a = toSigned(lane, bytes);
    const b = toSigned(multipliers[i] ?? 0n, bytes);

    // Doubling multiply: product × 2
    const product = a * b * 2n;

    // Add rounding constant (2^(bits-1))
    const roundConst = 1n << BigInt(bits - 1);
    const rounded = product + roundConst;

    // Extract high half
    const high = rounded >> BigInt(bits);

    // Saturate
    const saturated = saturateSigned(high, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

// ── Saturating Absolute Value and Negate ──

/** SQABS: Signed saturating absolute value. */
export function neonSqabs(
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane) => {
    const value = toSigned(lane, bytes);
    const abs = value < 0n ? -value : value;
    const saturated = saturateSigned(abs, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

/** SQNEG: Signed saturating negate. */
export function neonSqneg(
  vn: Uint8Array,
  size: number,
  q: number,
  setQC: () => void,
): Uint8Array<ArrayBuffer> {
  const lanes = readLanes(vn, size, q);
  const bytes = laneBytes(size);
  const bits = bytes * 8;

  const result = lanes.map((lane) => {
    const value = toSigned(lane, bytes);
    const negated = -value;
    const saturated = saturateSigned(negated, bits, setQC);
    return signedToUnsigned(saturated, bits);
  });

  return packLanes(result, size);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── NEON Widening Instructions (re-exported from simd-neon-widening.ts) ──
// ══════════════════════════════════════════════════════════════════════════════

export {
  neonSaddl,
  neonUaddl,
  neonSsubl,
  neonUsubl,
  neonSaddw,
  neonUaddw,
  neonSsubw,
  neonUsubw,
  neonSmull,
  neonUmull,
  neonSmlal,
  neonUmlal,
  neonSmlsl,
  neonUmlsl,
  neonSaddlp,
  neonUaddlp,
  neonSadalp,
  neonUadalp,
  neonSshll,
  neonUshll,
  neonSxtl,
  neonUxtl,
  neonAddhn,
  neonSubhn,
  neonRaddhn,
  neonRsubhn,
  neonSqdmull,
  neonSqdmlal,
  neonSqdmlsl,
  neonSabal,
  neonUabal,
  neonSabdl,
  neonUabdl,
  neonPmull,
} from './simd-neon-widening';

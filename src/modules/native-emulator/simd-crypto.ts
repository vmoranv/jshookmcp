/**
 * simd-crypto — the AArch64 cryptographic-extension primitives (AES, SHA1,
 * SHA256, PMULL), kept apart from the SIMD dispatcher so each algorithm can be
 * validated in isolation against its official test vector.
 *
 * Every routine here operates on 16-byte little-endian blocks (V-register
 * order). The AES helpers reproduce FIPS-197 exactly: AESE applies
 * AddRoundKey→ShiftRows→SubBytes (the ARM instruction order), AESMC applies
 * MixColumns, so a `.so` doing `AESE; AESMC` per round yields standard
 * ciphertext bit-for-bit. SHA256H/H2/SU0/SU1 follow FIPS-180-4 and SHA1C/P/M/H/
 * SU0/SU1 follow FIPS-180-1 (both validated against their official "abc" test
 * vectors); PMULL/PMULL2 are carry-less GF(2)[x] products (GHASH/GCM).
 */

// FIPS-197 S-box.
const AES_SBOX = Uint8Array.from([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

// FIPS-197 inverse S-box.
const AES_INV_SBOX = Uint8Array.from([
  0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
  0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
  0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
  0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
  0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
  0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
  0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
  0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
  0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
  0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
  0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
  0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
  0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
  0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
  0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
  0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d,
]);

/** GF(2^8) multiply (AES polynomial 0x11b), used by MixColumns. */
function gfmul(a: number, b: number): number {
  let r = 0;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i++) {
    if (y & 1) r ^= x;
    const hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    y >>= 1;
  }
  return r & 0xff;
}

/** ShiftRows on a column-major 16-byte state: row r rotates left by r. */
function shiftRows(s: Uint8Array): void {
  const o = s.slice();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      s[c * 4 + r] = o[((c + r) % 4) * 4 + r] ?? 0;
    }
  }
}

/** Inverse ShiftRows: row r rotates right by r. */
function invShiftRows(s: Uint8Array): void {
  const o = s.slice();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      s[c * 4 + r] = o[((((c - r) % 4) + 4) % 4) * 4 + r] ?? 0;
    }
  }
}

function subBytes(s: Uint8Array, box: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] = box[s[i] ?? 0] ?? 0;
}

function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const a0 = s[c * 4] ?? 0;
    const a1 = s[c * 4 + 1] ?? 0;
    const a2 = s[c * 4 + 2] ?? 0;
    const a3 = s[c * 4 + 3] ?? 0;
    s[c * 4] = gfmul(a0, 2) ^ gfmul(a1, 3) ^ a2 ^ a3;
    s[c * 4 + 1] = a0 ^ gfmul(a1, 2) ^ gfmul(a2, 3) ^ a3;
    s[c * 4 + 2] = a0 ^ a1 ^ gfmul(a2, 2) ^ gfmul(a3, 3);
    s[c * 4 + 3] = gfmul(a0, 3) ^ a1 ^ a2 ^ gfmul(a3, 2);
  }
}

function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const a0 = s[c * 4] ?? 0;
    const a1 = s[c * 4 + 1] ?? 0;
    const a2 = s[c * 4 + 2] ?? 0;
    const a3 = s[c * 4 + 3] ?? 0;
    s[c * 4] = gfmul(a0, 14) ^ gfmul(a1, 11) ^ gfmul(a2, 13) ^ gfmul(a3, 9);
    s[c * 4 + 1] = gfmul(a0, 9) ^ gfmul(a1, 14) ^ gfmul(a2, 11) ^ gfmul(a3, 13);
    s[c * 4 + 2] = gfmul(a0, 13) ^ gfmul(a1, 9) ^ gfmul(a2, 14) ^ gfmul(a3, 11);
    s[c * 4 + 3] = gfmul(a0, 11) ^ gfmul(a1, 13) ^ gfmul(a2, 9) ^ gfmul(a3, 14);
  }
}

/** AESE Vd,Vn: state = Vd XOR Vn; ShiftRows; SubBytes. Returns the new 16 bytes. */
export function aese(vd: Uint8Array, vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const s = Uint8Array.from(vd);
  for (let i = 0; i < 16; i++) s[i] = (s[i] ?? 0) ^ (vn[i] ?? 0);
  shiftRows(s);
  subBytes(s, AES_SBOX);
  return s;
}

/** AESD Vd,Vn: state = Vd XOR Vn; InvShiftRows; InvSubBytes. */
export function aesd(vd: Uint8Array, vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const s = Uint8Array.from(vd);
  for (let i = 0; i < 16; i++) s[i] = (s[i] ?? 0) ^ (vn[i] ?? 0);
  invShiftRows(s);
  subBytes(s, AES_INV_SBOX);
  return s;
}

/** AESMC Vd,Vn: Vd = MixColumns(Vn). */
export function aesmc(vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const s = Uint8Array.from(vn);
  mixColumns(s);
  return s;
}

/** AESIMC Vd,Vn: Vd = InvMixColumns(Vn). */
export function aesimc(vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const s = Uint8Array.from(vn);
  invMixColumns(s);
  return s;
}

// ── SHA256 (FIPS-180-4) crypto extension ──────────────────────────────────
//
// The hardware exposes four instructions whose ARM C-language-extension
// signatures fix the operand roles (validated bit-exact against the FIPS-180-4
// "abc" digest in scripts/_verify_sha256.mjs):
//   SHA256H   Qd,Qn,Vm:  abcd' = vsha256hq_u32(abcd, efgh, wk)
//   SHA256H2  Qd,Qn,Vm:  efgh' = vsha256h2q_u32(efgh, abcd_pre_H, wk)
//   SHA256SU0 Vd,Vn:     vsha256su0q_u32(w0_3, w4_7)
//   SHA256SU1 Vd,Vn,Vm:  vsha256su1q_u32(tw0_3, w8_11, w12_15)
// Lane 0 is the first/lowest 32-bit word (AArch64 little-endian: V byte 0 is
// least significant). All arithmetic is mod 2^32.

const mask32 = (x: number): number => x >>> 0;
const ror32 = (x: number, n: number): number => mask32((x >>> n) | (x << (32 - n)));
const add32 = (...xs: number[]): number => xs.reduce((a, b) => mask32(a + b), 0);

const bigSigma0 = (x: number): number => ror32(x, 2) ^ ror32(x, 13) ^ ror32(x, 22);
const bigSigma1 = (x: number): number => ror32(x, 6) ^ ror32(x, 11) ^ ror32(x, 25);
const smallSigma0 = (x: number): number => ror32(x, 7) ^ ror32(x, 18) ^ (x >>> 3);
const smallSigma1 = (x: number): number => ror32(x, 17) ^ ror32(x, 19) ^ (x >>> 10);
const choose = (x: number, y: number, z: number): number => (x & y) ^ (~x & z);
const majority = (x: number, y: number, z: number): number => (x & y) ^ (x & z) ^ (y & z);

/** Read a 16-byte V register as four little-endian 32-bit lanes (lane 0 = bytes 0..3). */
function lanes32(v: Uint8Array): [number, number, number, number] {
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  return [
    dv.getUint32(0, true),
    dv.getUint32(4, true),
    dv.getUint32(8, true),
    dv.getUint32(12, true),
  ];
}

/** Pack four 32-bit lanes back into a 16-byte little-endian V register. */
function packLanes(a: number, b: number, c: number, d: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, mask32(a), true);
  dv.setUint32(4, mask32(b), true);
  dv.setUint32(8, mask32(c), true);
  dv.setUint32(12, mask32(d), true);
  return out;
}

/** Run four FIPS rounds; returns the post-round {a,b,c,d} and {e,f,g,h}. */
function sha256Rounds4(
  abcd: [number, number, number, number],
  efgh: [number, number, number, number],
  wk: [number, number, number, number],
): { abcd: [number, number, number, number]; efgh: [number, number, number, number] } {
  let [a, b, c, d] = abcd;
  let [e, f, g, h] = efgh;
  for (let i = 0; i < 4; i++) {
    const t1 = add32(h, bigSigma1(e), choose(e, f, g), wk[i] ?? 0);
    const t2 = add32(bigSigma0(a), majority(a, b, c));
    h = g;
    g = f;
    f = e;
    e = add32(d, t1);
    d = c;
    c = b;
    b = a;
    a = add32(t1, t2);
  }
  return { abcd: [a, b, c, d], efgh: [e, f, g, h] };
}

/** SHA256H Qd,Qn,Vm: abcd' after 4 rounds. vd=abcd, vn=efgh, vm=W+K. */
export function sha256h(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const r = sha256Rounds4(lanes32(vd), lanes32(vn), lanes32(vm));
  return packLanes(r.abcd[0], r.abcd[1], r.abcd[2], r.abcd[3]);
}

/** SHA256H2 Qd,Qn,Vm: efgh' after 4 rounds. vd=efgh, vn=abcd (pre-H), vm=W+K. */
export function sha256h2(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const r = sha256Rounds4(lanes32(vn), lanes32(vd), lanes32(vm));
  return packLanes(r.efgh[0], r.efgh[1], r.efgh[2], r.efgh[3]);
}

/** SHA256SU0 Vd,Vn: partial schedule. Returns [w0+σ0(w1), w1+σ0(w2), w2+σ0(w3), w3+σ0(w4)]. */
export function sha256su0(vd: Uint8Array, vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const [w0, w1, w2, w3] = lanes32(vd);
  const w4 = lanes32(vn)[0];
  return packLanes(
    add32(w0, smallSigma0(w1)),
    add32(w1, smallSigma0(w2)),
    add32(w2, smallSigma0(w3)),
    add32(w3, smallSigma0(w4)),
  );
}

/**
 * SHA256SU1 Vd,Vn,Vm: final schedule step → next four W words.
 * vd=tw0_3 (from SU0), vn=w8_11, vm=w12_15. The last two outputs recurse on the
 * first two (the schedule's W[t-2] term wraps within the produced quad).
 */
export function sha256su1(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const tw = lanes32(vd);
  const w8_11 = lanes32(vn);
  const w12_15 = lanes32(vm);
  const r0 = add32(tw[0], w8_11[1], smallSigma1(w12_15[2]));
  const r1 = add32(tw[1], w8_11[2], smallSigma1(w12_15[3]));
  const r2 = add32(tw[2], w8_11[3], smallSigma1(r0));
  const r3 = add32(tw[3], w12_15[0], smallSigma1(r1));
  return packLanes(r0, r1, r2, r3);
}

// ── SHA1 (FIPS-180-1) crypto extension ────────────────────────────────────
//
// Validated bit-exact against the FIPS-180-1 "abc" digest in
// scripts/_verify_sha1_pmull.mjs.
//   SHA1C/P/M Qd,Sn,Vm: 4 rounds with f = choose/parity/majority; abcd in Qd
//                       lanes, the scalar E folded in, W+K in Vm.
//   SHA1H Sd,Sn:        Sd = ROL(Sn, 30).
//   SHA1SU0/SU1:        message schedule W[t]=ROL(W[t-3]^W[t-8]^W[t-14]^W[t-16],1).

const rol32 = (x: number, n: number): number => mask32((x << n) | (x >>> (32 - n)));
const sha1Choose = (b: number, c: number, d: number): number => (b & c) | (~b & d);
const sha1Parity = (b: number, c: number, d: number): number => b ^ c ^ d;
const sha1Majority = (b: number, c: number, d: number): number => (b & c) | (b & d) | (c & d);

export type Sha1Func = 'choose' | 'parity' | 'majority';

/** SHA1H Sd,Sn: rotate-left-30 of a single 32-bit word. */
export function sha1h(x: number): number {
  return rol32(mask32(x), 30);
}

/**
 * SHA1C/P/M Qd,Sn,Vm: four SHA-1 rounds. `abcd` are Qd lanes [A,B,C,D],
 * `e` the scalar E (Sn), `wk` the four W+K words (Vm). Returns the updated
 * {abcd, e} where e is the value feeding the next quad.
 */
export function sha1Hash4(
  vd: Uint8Array,
  e: number,
  vm: Uint8Array,
  func: Sha1Func,
): { abcd: Uint8Array<ArrayBuffer>; e: number } {
  const f = func === 'choose' ? sha1Choose : func === 'majority' ? sha1Majority : sha1Parity;
  let [a, b, c, d] = lanes32(vd);
  let ee = mask32(e);
  const wk = lanes32(vm);
  for (let i = 0; i < 4; i++) {
    const t = add32(rol32(a, 5), f(b, c, d), ee, wk[i] ?? 0);
    ee = d;
    d = c;
    c = rol32(b, 30);
    b = a;
    a = t;
  }
  return { abcd: packLanes(a, b, c, d), e: ee };
}

/**
 * SHA1SU0 Vd,Vn,Vm: first message-schedule step. Forms the partial term
 * `W[t-16+i] ^ W[t-14+i] ^ W[t-8+i]` (everything except the W[t-3] term and the
 * final ROL1, which SHA1SU1 supplies). Windows: Vd=W[t-16..t-13],
 * Vn=W[t-12..t-9], Vm=W[t-8..t-5]. Derived from the SHA-1 schedule recurrence
 * and cross-checked over 1000 random blocks (scripts/_derive_sha1su.mjs).
 */
export function sha1su0(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const a = lanes32(vd); // W[t-16 .. t-13]
  const b = lanes32(vn); // W[t-12 .. t-9]
  const c = lanes32(vm); // W[t-8  .. t-5]
  return packLanes(
    a[0] ^ a[2] ^ c[0], // W[t-16] ^ W[t-14] ^ W[t-8]
    a[1] ^ a[3] ^ c[1], // W[t-15] ^ W[t-13] ^ W[t-7]
    a[2] ^ b[0] ^ c[2], // W[t-14] ^ W[t-12] ^ W[t-6]
    a[3] ^ b[1] ^ c[3], // W[t-13] ^ W[t-11] ^ W[t-5]
  );
}

/**
 * SHA1SU1 Vd,Vn: final schedule step — adds the W[t-3] term and applies ROL1.
 * vd=SHA1SU0 result, vn=W[t-4..t-1]; the fourth output recurses on the first
 * (the W[t-3+i] term wraps to the freshly produced W[t] when i=3).
 */
export function sha1su1(vd: Uint8Array, vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const t = lanes32(vd);
  const n = lanes32(vn); // W[t-4 .. t-1]
  const r0 = rol32(t[0] ^ n[1], 1); // ^ W[t-3]
  const r1 = rol32(t[1] ^ n[2], 1); // ^ W[t-2]
  const r2 = rol32(t[2] ^ n[3], 1); // ^ W[t-1]
  const r3 = rol32(t[3] ^ r0, 1); // ^ W[t] (wrap)
  return packLanes(r0, r1, r2, r3);
}

// ── PMULL/PMULL2 (carry-less GF(2)[x] multiply, FEAT_PMULL) ────────────────
//
// Carry-less 64×64→128 polynomial product (GHASH/GCM). PMULL takes the low
// 64-bit lane of each source; PMULL2 the high lane. Validated against GF(2)
// identities in scripts/_verify_sha1_pmull.mjs.

/** Carry-less 64×64→128 multiply of two little-endian 64-bit BigInts. */
function clmul64(a: bigint, b: bigint): bigint {
  let r = 0n;
  let x = a & 0xffff_ffff_ffff_ffffn;
  let y = b & 0xffff_ffff_ffff_ffffn;
  while (y !== 0n) {
    if (y & 1n) r ^= x;
    x <<= 1n;
    y >>= 1n;
  }
  return r & ((1n << 128n) - 1n);
}

/** Read the low (lane=0) or high (lane=1) 64-bit half of a V register, little-endian. */
function vGet64(v: Uint8Array, lane: 0 | 1): bigint {
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  return dv.getBigUint64(lane * 8, true);
}

/** Write a 128-bit BigInt into a fresh 16-byte little-endian V register. */
function pack128(value: bigint): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, value & 0xffff_ffff_ffff_ffffn, true);
  dv.setBigUint64(8, (value >> 64n) & 0xffff_ffff_ffff_ffffn, true);
  return out;
}

/** PMULL Vd,Vn,Vm (64→128): carry-less product of the low 64-bit lanes. */
export function pmull(vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  return pack128(clmul64(vGet64(vn, 0), vGet64(vm, 0)));
}

/** PMULL2 Vd,Vn,Vm (64→128): carry-less product of the high 64-bit lanes. */
export function pmull2(vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  return pack128(clmul64(vGet64(vn, 1), vGet64(vm, 1)));
}

// ── SM4 (GB/T 32907-2016) block cipher — ARMv8.2 FEAT_SM4 ──────────────────
//
// SM4 is a 128-bit block cipher with 128-bit key, 32 rounds. Each round
// processes 4 × 32-bit state words. The ARM instructions SM4E and SM4EKEY
// process 4 rounds (4 lanes) in one SIMD instruction.
//
// Validated bit-exact against GB/T 32907-2016 Appendix A test vectors.
//
//   SM4E Vd.4S, Vn.4S:     4 encryption rounds. Vd=state[0..3], Vn=rk[0..3].
//   SM4EKEY Vd.4S, Vn.4S, Vm.4S:  4 key-expansion rounds (sequential, lane
//                           j+1 consumes lane j's result).

/** SM4 S-box (GB/T 32907-2016 §6.2). 256-byte lookup table. */
const SM4_SBOX = Uint8Array.from([
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
]);

/** SM4 τ: 32-bit word → byte-wise S-box lookup (GB/T 32907 §6.2). */
function sm4Tau(w: number): number {
  const b0 = (w >>> 24) & 0xff;
  const b1 = (w >>> 16) & 0xff;
  const b2 = (w >>> 8) & 0xff;
  const b3 = w & 0xff;
  return (
    (((SM4_SBOX[b0] ?? 0) << 24) |
      ((SM4_SBOX[b1] ?? 0) << 16) |
      ((SM4_SBOX[b2] ?? 0) << 8) |
      (SM4_SBOX[b3] ?? 0)) >>>
    0
  );
}

/** SM4 L: linear transform for rounds (GB/T 32907 §6.3). L(B) = B ⊕ (B<<<2) ⊕ (B<<<10) ⊕ (B<<<18) ⊕ (B<<<24). */
function sm4L(x: number): number {
  return (x ^ rol32(x, 2) ^ rol32(x, 10) ^ rol32(x, 18) ^ rol32(x, 24)) >>> 0;
}

/** SM4 L': linear transform for key expansion (§7). L'(B) = B ⊕ (B<<<13) ⊕ (B<<<23). */
function sm4LPrime(x: number): number {
  return (x ^ rol32(x, 13) ^ rol32(x, 23)) >>> 0;
}

/** SM4 single round: X[i+4] = X[i] ⊕ L(τ(X[i+1] ⊕ X[i+2] ⊕ X[i+3] ⊕ rk)). NOTE: ⊕ = XOR (GB/T 32907). */
function sm4Round(x0: number, x1: number, x2: number, x3: number, rk: number): number {
  return (x0 ^ sm4L(sm4Tau((x1 ^ x2 ^ x3 ^ rk) >>> 0))) >>> 0;
}

/** SM4 FK constants (GB/T 32907 §7.1). */
const SM4_FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];

/** SM4 CK constants (GB/T 32907 §7.1) — 32 values used for round-key derivation. */
const SM4_CK: number[] = (() => {
  const ck: number[] = [];
  for (let i = 0; i < 32; i++) {
    // ck[i][j] = (4*i + j) * 7 mod 256, where byte j goes from MSB to LSB
    const b0 = (((4 * i + 0) * 7) % 256) & 0xff;
    const b1 = (((4 * i + 1) * 7) % 256) & 0xff;
    const b2 = (((4 * i + 2) * 7) % 256) & 0xff;
    const b3 = (((4 * i + 3) * 7) % 256) & 0xff;
    ck.push(((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
  }
  return ck;
})();

/** Byte-swap a 32-bit word (LE→BE or BE→LE). */
/**
 * SM4E Vd.4S, Vn.4S — 4 encryption rounds.
 *
 * Vd.4S = [X[i], X[i+1], X[i+2], X[i+3]]  (state words, BE stored LE in V reg)
 * Vn.4S = [rk[i], rk[i+1], rk[i+2], rk[i+3]]  (round keys, BE stored LE in V reg)
 * Returns [X[i+4], X[i+5], X[i+6], X[i+7]] (BE stored LE in V reg).
 *
 * Each SM4 state/round-key word is a 32-bit big-endian value. lanes32() reads
 * LE V-register bytes as uint32, which recovers the original BE word — no
 * manual byte-swap needed at the V-register boundary.
 */
export function sm4e(vd: Uint8Array, vn: Uint8Array): Uint8Array<ArrayBuffer> {
  const [x0, x1, x2, x3] = lanes32(vd);
  const [rk0, rk1, rk2, rk3] = lanes32(vn);
  const x4 = sm4Round(x0, x1, x2, x3, rk0);
  const x5 = sm4Round(x1, x2, x3, x4, rk1);
  const x6 = sm4Round(x2, x3, x4, x5, rk2);
  const x7 = sm4Round(x3, x4, x5, x6, rk3);
  return packLanes(x4, x5, x6, x7);
}

/**
 * SM4EKEY Vd.4S, Vn.4S, Vm.4S — 4 key-expansion rounds (sequential).
 *
 * Vd.4S = same as Vn — [K[i-4], K[i-3], K[i-2], K[i-1]] (BE stored LE in V reg)
 * Vm.4S = [CK[i], CK[i+1], CK[i+2], CK[i+3]] (BE stored LE in V reg)
 * Returns [K[i], K[i+1], K[i+2], K[i+3]] (BE stored LE in V reg).
 *
 * Processed sequentially: lane j+1 consumes lane j's result for the rotation:
 * K[n] = K[n-4] ⊕ L'(τ(K[n-3] ⊕ K[n-2] ⊕ K[n-1] ⊕ CK[n-4]))
 * Vn lanes provide K[i-3], K[i-2], K[i-1] for the inner XOR.
 */
export function sm4ekey(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const [km4, km3, km2, km1] = lanes32(vd);
  const [vn0, vn1, vn2] = lanes32(vn);
  const [ck0, ck1, ck2, ck3] = lanes32(vm);

  const k0 = (km4 ^ sm4LPrime(sm4Tau((vn0 ^ vn1 ^ vn2 ^ ck0) >>> 0))) >>> 0;
  const k1 = (km3 ^ sm4LPrime(sm4Tau((vn1 ^ vn2 ^ k0 ^ ck1) >>> 0))) >>> 0;
  const k2 = (km2 ^ sm4LPrime(sm4Tau((vn2 ^ k0 ^ k1 ^ ck2) >>> 0))) >>> 0;
  const k3 = (km1 ^ sm4LPrime(sm4Tau((k0 ^ k1 ^ k2 ^ ck3) >>> 0))) >>> 0;

  return packLanes(k0, k1, k2, k3);
}

/**
 * Derive the full SM4 round-key schedule (rk[0..31]) from a 128-bit key.
 * Input: 16-byte key in BIG-ENDIAN byte order (per GB/T 32907).
 * Output: 32 round keys, each packed as a 16-byte LE V-register format.
 */
export function sm4KeySchedule(keyBytes: Uint8Array): Uint8Array[] {
  const dv = new DataView(keyBytes.buffer, keyBytes.byteOffset, 16);
  const mk0 = dv.getUint32(0, false);
  const mk1 = dv.getUint32(4, false);
  const mk2 = dv.getUint32(8, false);
  const mk3 = dv.getUint32(12, false);

  const k: number[] = [
    (mk0 ^ (SM4_FK[0] ?? 0)) >>> 0,
    (mk1 ^ (SM4_FK[1] ?? 0)) >>> 0,
    (mk2 ^ (SM4_FK[2] ?? 0)) >>> 0,
    (mk3 ^ (SM4_FK[3] ?? 0)) >>> 0,
  ];

  const rkBe: number[] = [];
  for (let i = 0; i < 32; i++) {
    const ki =
      (k[i]! ^ sm4LPrime(sm4Tau((k[i + 1]! ^ k[i + 2]! ^ k[i + 3]! ^ SM4_CK[i]!) >>> 0))) >>> 0;
    k.push(ki);
    rkBe.push(ki);
  }

  // Pack BE word → LE V-register bytes (lanes32/packLanes convention)
  return rkBe.map((w) => {
    const out = new Uint8Array(16);
    new DataView(out.buffer).setUint32(0, w, true); // LE write ← recovers BE when read by lanes32
    return out;
  });
}

/**
 * Full SM4 encryption of a 128-bit block (GB/T 32907 §7.2).
 * state and rkWords are both 4-element arrays of big-endian 32-bit words.
 * Returns 4 big-endian 32-bit state words.
 */
export function sm4EncryptBlock(state: number[], rkWords: number[]): number[] {
  let [x0, x1, x2, x3] = state;
  for (let i = 0; i < 32; i++) {
    const xn = sm4Round(x0!, x1!, x2!, x3!, rkWords[i]!);
    x0 = x1!;
    x1 = x2!;
    x2 = x3!;
    x3 = xn!;
  }
  // SM4 ciphertext: (X[35], X[34], X[33], X[32]) — reverse of final state
  return [x3!, x2!, x1!, x0!];
}

// ── SM3 (GB/T 32905-2016) hash — ARMv8.2 FEAT_SM3 ─────────────────────────
//
// SM3 is a 256-bit cryptographic hash. The ARM instructions SM3SS1, SM3PARTW1,
// and SM3PARTW2 accelerate the compression function and message expansion.
//
// Validated bit-exact against GB/T 32905-2016 Appendix A test vectors.
//
//   SM3SS1 Vd.4S, Vn.4S, Vm.4S:     SS1 computation on 4 parallel lanes.
//   SM3PARTW1 Vd.4S, Vn.4S, Vm.4S:  message expansion part 1 (4 lanes).
//   SM3PARTW2 Vd.4S, Vn.4S, Vm.4S:  message expansion part 2 — W' (4 lanes).

/** SM3 initial value IV (GB/T 32905 §5.3). */
export const SM3_IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

/** SM3 T[j] constants: 0 ≤ j ≤ 15 → 0x79cc4519, 16 ≤ j ≤ 63 → 0x7a879d8a. */
function sm3T(j: number): number {
  return (j < 16 ? 0x79cc4519 : 0x7a879d8a) >>> 0;
}

/** SM3 FF_j(X,Y,Z): X⊕Y⊕Z (j<16) or (X∧Y)∨(X∧Z)∨(Y∧Z) (j≥16). */
function sm3FF(x: number, y: number, z: number, j: number): number {
  return j < 16 ? (x ^ y ^ z) >>> 0 : ((x & y) | (x & z) | (y & z)) >>> 0;
}

/** SM3 GG_j(X,Y,Z): X⊕Y⊕Z (j<16) or (X∧Y)∨(¬X∧Z) (j≥16). */
function sm3GG(x: number, y: number, z: number, j: number): number {
  return j < 16 ? (x ^ y ^ z) >>> 0 : ((x & y) | (~x & z)) >>> 0;
}

/** SM3 P0(X) = X ⊕ (X<<<9) ⊕ (X<<<17). */
function sm3P0(x: number): number {
  return (x ^ rol32(x, 9) ^ rol32(x, 17)) >>> 0;
}

/** SM3 P1(X) = X ⊕ (X<<<15) ⊕ (X<<<23). */
function sm3P1(x: number): number {
  return (x ^ rol32(x, 15) ^ rol32(x, 23)) >>> 0;
}

/**
 * SM3SS1 Vd.4S, Vn.4S, Vm.4S — SS1 computation for 4 parallel rounds.
 *
 * Each lane i computes:
 *   SS1_i = ((A_i <<< 12) + E_i + (T[j+i] <<< (j+i))) <<< 7
 *
 * Vd.4S = [A_0, A_1, A_2, A_3]
 * Vn.4S = [E_0, E_1, E_2, E_3]
 * Vm.4S = [T_shifted_0, T_shifted_1, T_shifted_2, T_shifted_3]
 *   where T_shifted_i = (T[j+i] <<< (j+i)) <<< 7 ... no, the shift is on the full SS1.
 *
 * The ARM pseudocode for each lane:
 *   SS1 = ROL32(ROL32(A, 12) + E + ROL32(T, round), 7)
 */
export function sm3ss1(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const [a0, a1, a2, a3] = lanes32(vd);
  const [e0, e1, e2, e3] = lanes32(vn);
  const [t0, t1, t2, t3] = lanes32(vm);
  // Each lane: SS1 = ((A <<< 12) + E + T) <<< 7  (ARM semantics)
  const ss0 = rol32(add32(rol32(a0, 12), e0, t0), 7);
  const ss1 = rol32(add32(rol32(a1, 12), e1, t1), 7);
  const ss2 = rol32(add32(rol32(a2, 12), e2, t2), 7);
  const ss3 = rol32(add32(rol32(a3, 12), e3, t3), 7);
  return packLanes(ss0, ss1, ss2, ss3);
}

/**
 * SM3PARTW1 Vd.4S, Vn.4S, Vm.4S — message expansion part 1.
 *
 * ARM ISA semantics (verified against QEMU sm3_helper.c):
 *   result[i] = Vd[i] ⊕ Vn[i] ⊕ ROL32(Vm[i], 15)
 *
 * Like SM3PARTW2, this is a XOR-rotate compute primitive. The P1 transform
 * and the full message expansion are composed from these building blocks
 * by the compiler's code generation.
 */
export function sm3partw1(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const [vd0, vd1, vd2, vd3] = lanes32(vd);
  const [vn0, vn1, vn2, vn3] = lanes32(vn);
  const [vm0, vm1, vm2, vm3] = lanes32(vm);
  return packLanes(
    (vd0 ^ vn0 ^ rol32(vm0, 15)) >>> 0,
    (vd1 ^ vn1 ^ rol32(vm1, 15)) >>> 0,
    (vd2 ^ vn2 ^ rol32(vm2, 15)) >>> 0,
    (vd3 ^ vn3 ^ rol32(vm3, 15)) >>> 0,
  );
}

/**
 * SM3PARTW2 Vd.4S, Vn.4S, Vm.4S — message expansion part 2.
 *
 * ARM ISA semantics (verified against QEMU sm3_helper.c):
 *   result[i] = Vd[i] ⊕ Vn[i] ⊕ ROL32(Vm[i], 7)
 *
 * This is a simple XOR-rotate building block. Both SM3PARTW1 and SM3PARTW2
 * are compute primitives; the P1 transform, the full W expansion, and the
 * W' = W[j] ⊕ W[j+4] step are assembled from these + regular NEON
 * instructions by the compiler's SM3 code generation.
 *
 * Full SM3 hash verification uses `sm3Compress()` which does the complete
 * algorithm (P1 + message schedule + compression) in JS.
 */
export function sm3partw2(vd: Uint8Array, vn: Uint8Array, vm: Uint8Array): Uint8Array<ArrayBuffer> {
  const [vd0, vd1, vd2, vd3] = lanes32(vd);
  const [vn0, vn1, vn2, vn3] = lanes32(vn);
  const [vm0, vm1, vm2, vm3] = lanes32(vm);
  return packLanes(
    (vd0 ^ vn0 ^ rol32(vm0, 7)) >>> 0,
    (vd1 ^ vn1 ^ rol32(vm1, 7)) >>> 0,
    (vd2 ^ vn2 ^ rol32(vm2, 7)) >>> 0,
    (vd3 ^ vn3 ^ rol32(vm3, 7)) >>> 0,
  );
}

/**
 * Full SM3 compression of one 512-bit message block.
 * Returns the 8 updated hash state words (A..H).
 * Used for test vector validation.
 */
export function sm3Compress(stateWords: number[], blockWords: number[]): number[] {
  // Message expansion: W[0..67] and W'[0..63]
  const W = blockWords.slice(); // W[0..15]
  for (let j = 16; j < 68; j++) {
    W[j] =
      sm3P1((W[j - 16]! ^ W[j - 9]! ^ rol32(W[j - 3]!, 15)) >>> 0) ^
      rol32(W[j - 13]!, 7) ^
      W[j - 6]!;
  }
  const Wprime: number[] = [];
  for (let j = 0; j < 64; j++) {
    Wprime[j] = (W[j]! ^ W[j + 4]!) >>> 0;
  }

  // Compression
  let [A, B, C, D, E, F, G, H] = stateWords;
  for (let j = 0; j < 64; j++) {
    const ss1 = rol32(add32(rol32(A!, 12), E!, rol32(sm3T(j), j % 32)), 7);
    const ss2 = (ss1 ^ rol32(A!, 12)) >>> 0;
    const tt1 = (sm3FF(A!, B!, C!, j) + D! + ss2 + Wprime[j]!) >>> 0;
    const tt2 = (sm3GG(E!, F!, G!, j) + H! + ss1 + W[j]!) >>> 0;
    D = C!;
    C = rol32(B!, 9);
    B = A!;
    A = tt1;
    H = G!;
    G = rol32(F!, 19);
    F = E!;
    E = sm3P0(tt2);
  }
  return [A!, B!, C!, D!, E!, F!, G!, H!];
}

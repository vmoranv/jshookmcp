/**
 * simd-decode — SIMD/FP instruction field decoding and classification predicates,
 * extracted from simd.ts for better modularity.
 *
 * All predicates are pure functions that classify a decoded `SimdFields` struct
 * into one of the 14 SIMD/FP encoding classes — no execution, just pattern matching.
 */

/** The named bitfields shared across the SIMD/FP encoding classes (ARM ARM C4.1). */
export interface SimdFields {
  insn: number;
  high8: number; // bits[31:24] — class tag (0x4E/0x5E/0x0E/0x4E…)
  q: number; // bit[30] — vector/upper-lane select
  u: number; // bit[29]
  base28_24: number; // bits[28:24] — the SIMD "01110" family marker
  size: number; // bits[23:22] — element-size / variant
  bit21: number; // bit[21]
  field21_17: number; // bits[21:17] — fixed marker for the two-register/AES forms
  bit15: number; // bit[15]
  op16_12: number; // bits[16:12] — opcode (two-register + AES forms)
  op15_12: number; // bits[15:12] — opcode (three-different / PMULL)
  op14_12: number; // bits[14:12] — opcode (three-register SHA)
  low11_10: number; // bits[11:10] — fixed marker
  rm: number; // bits[20:16]
  rn: number; // bits[9:5]
  rd: number; // bits[4:0]
  // Scalar FP fields (ARM ARM C4.1.8/C4.1.9): the FP-prefix is M=0,bit30=0,S=0,
  // bits[28:24]=11110, then bit21=1; ftype picks precision and the low bits the form.
  ftype: number; // bits[23:22] — 00=single 01=double 11=half
  fpOp1Src: number; // bits[20:15] — one-source opcode
  fpOp2Src: number; // bits[15:12] — two-source opcode
  fpCond: number; // bits[15:12] — FCSEL condition
  fpRmode: number; // bits[20:19] — int-conv rounding/direction
  fpConvOp: number; // bits[18:16] — int-conv opcode
  sf: number; // bit[31] — int-conv integer size (0=W/32, 1=X/64)
  // NEON "three same" (ARM ARM C4.1.6): 0 Q U 01110 size 1 Rm opcode[15:11] 1 Rn Rd.
  neonOpcode: number; // bits[15:11] — three-same operation selector
  // NEON F-2 group fields.
  base29_24: number; // bits[29:24] — distinguishes EXT (101110) from permute (001110)
  base28_19: number; // bits[28:19] — modified-immediate marker 0111100000
  op29: number; // bit[29] — MOVI/MVNI op bit (also U elsewhere; alias for clarity)
  neonOp16_12: number; // bits[16:12] — two-register-misc / across opcode
  neonOp14_12: number; // bits[14:12] — permute opcode
  imm5: number; // bits[20:16] — copy element selector
  imm4: number; // bits[14:11] — copy/EXT index
  cmode: number; // bits[15:12] — modified-immediate mode
  immh: number; // bits[22:19] — shift-immediate high
  immb: number; // bits[18:16] — shift-immediate low
  len: number; // bits[14:13] — TBL/TBX table length
  tbx: number; // bit[12] — TBL(0)/TBX(1)
}

/**
 * Decode all SIMD/FP bitfields from a 32-bit instruction word. This is a pure
 * function — it just extracts bit slices, no side effects.
 */
export function decodeSimdFields(insn: number): SimdFields {
  return {
    insn,
    high8: (insn >>> 24) & 0xff,
    q: (insn >>> 30) & 1,
    u: (insn >>> 29) & 1,
    base28_24: (insn >>> 24) & 0b11111,
    size: (insn >>> 22) & 0b11,
    bit21: (insn >>> 21) & 1,
    field21_17: (insn >>> 17) & 0b11111,
    bit15: (insn >>> 15) & 1,
    op16_12: (insn >>> 12) & 0b11111,
    op15_12: (insn >>> 12) & 0b1111,
    op14_12: (insn >>> 12) & 0b111,
    low11_10: (insn >>> 10) & 0b11,
    rm: (insn >>> 16) & 0b11111,
    rn: (insn >>> 5) & 0b11111,
    rd: insn & 0b11111,
    ftype: (insn >>> 22) & 0b11,
    fpOp1Src: (insn >>> 15) & 0b111111,
    fpOp2Src: (insn >>> 12) & 0b1111,
    fpCond: (insn >>> 12) & 0b1111,
    fpRmode: (insn >>> 19) & 0b11,
    fpConvOp: (insn >>> 16) & 0b111,
    sf: (insn >>> 31) & 1,
    neonOpcode: (insn >>> 11) & 0b11111,
    base29_24: (insn >>> 24) & 0b111111,
    base28_19: (insn >>> 19) & 0b1111111111,
    op29: (insn >>> 29) & 1,
    neonOp16_12: (insn >>> 12) & 0b11111,
    neonOp14_12: (insn >>> 12) & 0b111,
    imm5: (insn >>> 16) & 0b11111,
    imm4: (insn >>> 11) & 0b1111,
    cmode: (insn >>> 12) & 0b1111,
    immh: (insn >>> 19) & 0b1111,
    immb: (insn >>> 16) & 0b111,
    len: (insn >>> 13) & 0b11,
    tbx: (insn >>> 12) & 1,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Classification Predicates — 14 SIMD/FP encoding classes
// ────────────────────────────────────────────────────────────────────────────

/** Cryptographic AES (ARM ARM C4.1: high8=0x4E, [21:17]=10100, [11:10]=10). */
export const isCryptoAes = (f: SimdFields): boolean =>
  f.high8 === 0x4e && f.field21_17 === 0b10100 && f.low11_10 === 0b10;

/** Cryptographic three-register SHA (high8=0x5E, size=00, [21]=0, [15]=0, [11:10]=00). */
export const isCryptoSha3Reg = (f: SimdFields): boolean =>
  f.high8 === 0x5e && f.size === 0 && f.bit21 === 0 && f.bit15 === 0 && f.low11_10 === 0;

/** Cryptographic two-register SHA (high8=0x5E, size=00, [21:17]=10100, [11:10]=10). */
export const isCryptoSha2Reg = (f: SimdFields): boolean =>
  f.high8 === 0x5e && f.size === 0 && f.field21_17 === 0b10100 && f.low11_10 === 0b10;

/**
 * Cryptographic SM3/SM4 (ARMv8.2 FEAT_SM3 + FEAT_SM4). All SM3/SM4
 * instructions share high8=0xCE (bits[31:24]), size=01 (bits[23:22]),
 * and bits[28:24]=01110. The sub-encoding varies:
 *
 * Three-register (bit21=1): SM3PARTW1 (low11_10=00), SM3PARTW2 (10),
 *   SM4EKEY (10).  Opcode in bits[15:10].
 * Two-register (bit21=0): SM3SS1 (bit15=0, low11_10=01),
 *   SM4E (bit15=1, low11_10=00).
 *
 * Single broad predicate; fine-grained dispatch in execCryptoSm3Sm4.
 */
export const isCryptoSm3Sm4 = (f: SimdFields): boolean => f.high8 === 0xce && f.size === 1;

/** SM4E two-register form: high8=0xCE, size=01, bit21=0, bit15=1, low11_10=00. */
export const isCryptoSm4e = (f: SimdFields): boolean =>
  f.high8 === 0xce && f.size === 1 && f.bit21 === 0 && f.bit15 === 1 && f.low11_10 === 0;

/**
 * PMULL/PMULL2 (polynomial multiply long). PMULL has U=1 always.
 * Encoding: 0 Q 1 01110 size 1 Rm 1110 00 Rn Rd
 *
 * Two variants:
 *   size=00: .8B→.8H — handled by execNeonThreeDifferent (case 0b1110=PMULL)
 *   size=11: .1Q→.1Q — handled by execPmull (FEAT_PMULL 64→128)
 *
 * Only intercept the 64-bit variant here; the 8-bit variant falls through
 * to isNeonThreeDifferent.
 */
export const isPmull = (f: SimdFields): boolean => {
  const h = f.high8;
  // 64-bit PMULL: U=1, size=3, [15:10]=111000
  const is64bit =
    (h === 0x2e || h === 0x6e) &&
    f.size === 3 &&
    f.bit21 === 1 &&
    ((f.insn >>> 10) & 0b111111) === 0b111000;
  // Also accept the crypto-extension form: high8=0x0E/0x4E
  const isCryptoForm =
    (h === 0x0e || h === 0x4e) && f.bit21 === 1 && ((f.insn >>> 10) & 0b111111) === 0b111000;
  return is64bit || isCryptoForm;
};

/**
 * Scalar floating-point (ARM ARM C4.1.8/C4.1.9): M=0, bit30=0, S=0, [28:24]=11110,
 * bit21=1. Covers FADD/FSUB/FMUL/FDIV/FMAX/FMIN/FCMP/FCSEL/FMOV/FCVT/SCVTF/
 * UCVTF/FCVTZS/FCVTZU/FABS/FNEG/FSQRT/FRINT*. The `ftype` field (bits[23:22])
 * selects precision: 00=single, 01=double, 11=half (FEAT_FP16).
 */
export const isScalarFp = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  ((f.insn >>> 30) & 1) === 0 &&
  ((f.insn >>> 29) & 1) === 0 &&
  f.base28_24 === 0b11110 &&
  f.bit21 === 1;

/**
 * NEON "three same" (ARM ARM C4.1.6): 0 Q U 01110 size 1 Rm opcode[15:11] 1 Rn Rd.
 * Covers ADD/SUB/MUL, bitwise AND/ORR/EOR/BIC/ORN/BSL, comparisons CMEQ/CMGE/CMGT/
 * CMHI/CMHS/CMTST, SMAX/SMIN/UMAX/UMIN, saturating add/sub SQADD/SQSUB/UQADD/UQSUB.
 */
export const isNeonThreeSame = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base28_24 === 0b01110 &&
  f.bit21 === 1 &&
  ((f.insn >>> 10) & 1) === 1;

/**
 * NEON three different (widening/narrowing/long): 0 Q U 01110 size 1 Rm opcode[15:12] 00 Rn Rd.
 * Covers SADDL/UADDL/SSUBL/USUBL/SMULL/UMULL/SMLAL/UMLAL/SADDW/UADDW/SSUBW/USUBW/
 * SADDLP/UADDLP/SXTL/UXTL and their 2 (high-half) variants.
 */
export const isNeonThreeDifferent = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 && f.base28_24 === 0b01110 && f.bit21 === 1 && f.low11_10 === 0b00;

/**
 * NEON two-register miscellaneous: 0 Q U 01110 size 10000 opcode[16:12] 10 Rn Rd.
 * Covers NEG/ABS/NOT/CNT/CLZ/REV16/REV32/REV64 per-lane transforms.
 */
export const isNeonTwoRegMisc = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base28_24 === 0b01110 &&
  ((f.insn >>> 17) & 0b11111) === 0b10000 &&
  f.low11_10 === 0b10;

/**
 * NEON across-lanes: 0 Q U 01110 size 11000 opcode[16:12] 10 Rn Rd. Covers ADDV/
 * SADDLV/UADDLV/SMAXV/SMINV/UMAXV/UMINV — reduce vector to scalar.
 */
export const isNeonAcross = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base28_24 === 0b01110 &&
  ((f.insn >>> 17) & 0b11111) === 0b11000 &&
  f.low11_10 === 0b10;

/**
 * NEON copy (DUP element/general, INS element/general, UMOV/SMOV): 0 Q op 01110000
 * imm5[20:16] 0 imm4[14:11] 1 Rn Rd. Currently only DUP implemented.
 */
export const isNeonCopy = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  ((f.insn >>> 21) & 0b11111111) === 0b01110000 &&
  ((f.insn >>> 10) & 1) === 1;

/**
 * NEON modified immediate (MOVI/MVNI/ORR/BIC vector-imm): 0 Q op 0111100000 abc[18:16]
 * cmode[15:12] o2[11] 1 defgh[9:5] Rd. Expands an 8-bit immediate via `cmode`.
 */
export const isNeonModImm = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 && f.base28_19 === 0b0111100000 && ((f.insn >>> 10) & 1) === 1;

/**
 * NEON shift by immediate (SHL/SSHR/USHR/SLI/SRI/SRSHR/…): 0 Q U 011110 immh[22:19]
 * immb[18:16] opcode[15:11] 1 Rn Rd. immh!=0000; highest-set-bit of immh picks size.
 */
export const isNeonShiftImm = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  ((f.insn >>> 23) & 0b111111) === 0b011110 &&
  f.immh !== 0b0000 &&
  ((f.insn >>> 10) & 1) === 1;

/**
 * NEON EXT (extract from pair): 0 Q 101110 000 Rm 0 imm4[14:11] 0 Rn Rd. Rotates
 * 16/32 bytes from {Vn,Vm} by `imm4` bytes into Vd.
 */
export const isNeonExt = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base29_24 === 0b101110 &&
  ((f.insn >>> 21) & 0b111) === 0b000 &&
  ((f.insn >>> 15) & 1) === 0 &&
  ((f.insn >>> 10) & 1) === 0;

/**
 * NEON permute (ZIP1/ZIP2/UZP1/UZP2/TRN1/TRN2): 0 Q 001110 size 0 Rm 0 opcode[14:12]
 * 10 Rn Rd. Interleaves or de-interleaves lanes from two vectors.
 */
export const isNeonPermute = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base29_24 === 0b001110 &&
  ((f.insn >>> 21) & 1) === 0 &&
  ((f.insn >>> 15) & 1) === 0 &&
  f.low11_10 === 0b10;

/**
 * NEON table lookup (TBL/TBX): 0 Q 001110 00 0 Rm 0 len[14:13] tbx[12] 00 Rn Rd.
 * Looks up `len+1` consecutive table registers starting at Vn using indices in Vm.
 */
export const isNeonTable = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base29_24 === 0b001110 &&
  ((f.insn >>> 21) & 0b11) === 0b00 &&
  ((f.insn >>> 15) & 1) === 0 &&
  f.low11_10 === 0b00;

// ────────────────────────────────────────────────────────────────────────────
// Sub-decoders
// ────────────────────────────────────────────────────────────────────────────

/**
 * Decode the NEON copy `imm5` field (bits[20:16]) into [size, index]. The trailing
 * zeros of `imm5` encode the element size (0..3 → B/H/S/D), and the remaining bits
 * encode the lane index. Returns null for the reserved `imm5=00000` encoding.
 */
export function decodeCopyImm5(imm5: number): { size: number; index: number } | null {
  if ((imm5 & 0b1) === 1) return { size: 0, index: imm5 >> 1 };
  if ((imm5 & 0b11) === 0b10) return { size: 1, index: imm5 >> 2 };
  if ((imm5 & 0b111) === 0b100) return { size: 2, index: imm5 >> 3 };
  if ((imm5 & 0b1111) === 0b1000) return { size: 3, index: imm5 >> 4 };
  return null;
}

/**
 * Decode the NEON shift-immediate `immh` field (bits[22:19]) into the element size
 * (0..3 → B/H/S/D). The highest set bit position in `immh` selects the size; `immh=0000`
 * is reserved and should have been rejected by `isNeonShiftImm`.
 */
export function shiftSize(immh: number): number {
  if (immh & 0b1000) return 3;
  if (immh & 0b0100) return 2;
  if (immh & 0b0010) return 1;
  return 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Unified Classifier
// ────────────────────────────────────────────────────────────────────────────

/** The 14 SIMD/FP encoding classes we can decode. */
export type SimdFpClass =
  | 'crypto-aes'
  | 'crypto-sha3'
  | 'crypto-sha2'
  | 'crypto-sm3-sm4'
  | 'crypto-sm4e'
  | 'pmull'
  | 'scalar-fp'
  | 'neon-three-same'
  | 'neon-mod-imm'
  | 'neon-shift-imm'
  | 'neon-two-reg-misc'
  | 'neon-across'
  | 'neon-copy'
  | 'neon-ext'
  | 'neon-permute'
  | 'neon-table';

/**
 * Classify a decoded instruction into one of the 14 SIMD/FP classes, or null if
 * none match. This is the single dispatch point for the execution layer — replaces
 * the 14-branch if-chain with a type-safe classifier + lookup table.
 */
export function classifySimdFp(f: SimdFields): SimdFpClass | null {
  if (isCryptoAes(f)) return 'crypto-aes';
  if (isCryptoSha3Reg(f)) return 'crypto-sha3';
  if (isCryptoSha2Reg(f)) return 'crypto-sha2';
  if (isCryptoSm3Sm4(f)) return 'crypto-sm3-sm4';
  if (isCryptoSm4e(f)) return 'crypto-sm4e';
  if (isPmull(f)) return 'pmull';
  if (isScalarFp(f)) return 'scalar-fp';
  if (isNeonThreeSame(f)) return 'neon-three-same';
  if (isNeonModImm(f)) return 'neon-mod-imm';
  if (isNeonShiftImm(f)) return 'neon-shift-imm';
  if (isNeonTwoRegMisc(f)) return 'neon-two-reg-misc';
  if (isNeonAcross(f)) return 'neon-across';
  if (isNeonCopy(f)) return 'neon-copy';
  if (isNeonExt(f)) return 'neon-ext';
  if (isNeonPermute(f)) return 'neon-permute';
  if (isNeonTable(f)) return 'neon-table';
  return null;
}

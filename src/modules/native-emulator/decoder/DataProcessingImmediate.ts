/**
 * DataProcessingImmediate — immediate-operand instruction family.
 *
 * Encoding space: bits[28:25] = 100x (8, 9)
 *
 * Covers:
 * - ADR / ADRP (PC-relative address calculation)
 * - ADD / ADDS / SUB / SUBS immediate (CMN / CMP aliases)
 * - MOVZ / MOVN / MOVK (move wide immediate)
 * - Logical immediate (AND / ORR / EOR / ANDS, TST alias)
 * - Bitfield (SBFM / BFM / UBFM, including LSL/LSR/ASR immediate aliases)
 * - EXTR (extract register, ROR alias)
 */

import type { ExecutionContext } from '../cpu/ExecutionContext';

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;

/**
 * Per-block decoders for execDataProcessingImmediate. Extracted verbatim from the former
 * single function so each stays under the complexity gate. Block evaluation order matches the former if-chain.
 */
function tryAdrAdrp(ctx: ExecutionContext, insn: number): boolean {
  // ADR / ADRP: op | immlo(2) | 10000 | immhi(19) | Rd
  //   ADR (op=0): Rd = PC + SignExtend(immhi:immlo). ADRP (op=1): Rd = (PC &
  //   ~0xfff) + SignExtend(immhi:immlo) << 12. The workhorse of PIC addressing.
  if (((insn >>> 24) & 0b11111) === 0b10000) {
    const op = insn >>> 31;
    const immlo = (insn >>> 29) & 0b11;
    const immhi = (insn >>> 5) & 0x7ffff;
    const rd = insn & 0b11111;
    const imm = ctx.signExtend(BigInt((immhi << 2) | immlo), 21);
    // BigInt mask: `ctx.pc & ~0xfff` would coerce PC to a signed 32-bit int,
    // truncating the page base for PCs above 4 GiB (typical .so mappings).
    const value = op === 1 ? (BigInt(ctx.pc) & ~0xfffn) + (imm << 12n) : BigInt(ctx.pc) + imm;
    ctx.writeGpr(rd, BigInt.asUintN(64, value));
    return true;
  }
  return false;
}

function tryAddImmediate(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // ADD (immediate): sf | 0 | 0 | 100010 | sh | imm12 | Rn | Rd  (Rn/Rd use SP semantics)
  if (op2829 === 0b00 && ((insn >>> 23) & 0b111111) === 0b100010) {
    const sf = insn >>> 31;
    const sh = (insn >>> 22) & 1;
    let imm12 = (insn >>> 10) & 0xfff;
    if (sh === 1) imm12 <<= 12;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const sum = ctx.readGprSp(rn) + BigInt(imm12);
    ctx.writeGprSp(rd, sf === 1 ? BigInt.asUintN(64, sum) : BigInt.asUintN(32, sum));
    return true;
  }
  return false;
}

function tryAddsImmediate(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // ADDS (immediate): sf | 0 | 1 | 100010 | sh | imm12 | Rn | Rd  (S=1 sets flags)
  //   CMN is ADDS with Rd=XZR. Rn uses SP semantics.
  if (op2829 === 0b01 && ((insn >>> 23) & 0b111111) === 0b100010) {
    const sf = insn >>> 31;
    const sh = (insn >>> 22) & 1;
    let imm12 = (insn >>> 10) & 0xfff;
    if (sh === 1) imm12 <<= 12;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const result = ctx.addWithFlags(ctx.readGprSp(rn), BigInt(imm12), sf);
    ctx.writeGpr(rd, result);
    return true;
  }
  return false;
}

function trySubImmediate(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // SUB (immediate): sf | 1 | 0 | 100010 | sh | imm12 | Rn | Rd
  if (op2829 === 0b10 && ((insn >>> 23) & 0b111111) === 0b100010) {
    const sf = insn >>> 31;
    const sh = (insn >>> 22) & 1; // shift imm12 left by 12 when set
    let imm12 = (insn >>> 10) & 0xfff;
    if (sh === 1) imm12 <<= 12;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    // SUB uses SP semantics for Rn/Rd (encoding 31 = SP, not XZR).
    const diff = ctx.readGprSp(rn) - BigInt(imm12);
    ctx.writeGprSp(rd, sf === 1 ? BigInt.asUintN(64, diff) : BigInt.asUintN(32, diff));
    return true;
  }
  return false;
}

function tryMovn(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // MOVN (move wide immediate, inverted): sf | 00 | 100101 | hw | imm16 | Rd
  if (op2829 === 0b00 && ((insn >>> 23) & 0b111111) === 0b100101) {
    const sf = insn >>> 31;
    const hw = (insn >>> 21) & 0b11;
    const imm16 = (insn >>> 5) & 0xffff;
    const rd = insn & 0b11111;
    const value = ~(BigInt(imm16) << BigInt(hw * 16));
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
    return true;
  }
  return false;
}

function tryMovz(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // MOVZ (move wide immediate): sf | 10 | 100101 | hw | imm16 | Rd
  if (op2829 === 0b10 && ((insn >>> 23) & 0b111111) === 0b100101) {
    const sf = insn >>> 31;
    const hw = (insn >>> 21) & 0b11;
    const imm16 = (insn >>> 5) & 0xffff;
    const rd = insn & 0b11111;
    const value = BigInt(imm16) << BigInt(hw * 16);
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
    return true;
  }
  return false;
}

function tryMovk(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // MOVK (move wide immediate, keep): sf | 11 | 100101 | hw | imm16 | Rd
  //   Insert imm16 into the hw-th 16-bit lane, preserving the other bits.
  if (op2829 === 0b11 && ((insn >>> 23) & 0b111111) === 0b100101) {
    const sf = insn >>> 31;
    const hw = (insn >>> 21) & 0b11;
    const imm16 = (insn >>> 5) & 0xffff;
    const rd = insn & 0b11111;
    const shift = BigInt(hw * 16);
    const current = ctx.readGpr(rd);
    const cleared = current & ~(0xffffn << shift);
    const value = cleared | (BigInt(imm16) << shift);
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
    return true;
  }
  return false;
}

function trySubsImmediate(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // SUBS/CMP (immediate): sf | 1 | 1 | 100010 | sh | imm12 | Rn | Rd  (S=1 sets flags)
  //   CMP is SUBS with Rd=XZR. Rn uses SP semantics.
  if (op2829 === 0b11 && ((insn >>> 23) & 0b111111) === 0b100010) {
    const sf = insn >>> 31;
    const sh = (insn >>> 22) & 1;
    let imm12 = (insn >>> 10) & 0xfff;
    if (sh === 1) imm12 <<= 12;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const result = ctx.subWithFlags(ctx.readGprSp(rn), BigInt(imm12), sf);
    ctx.writeGpr(rd, result); // Rd=31 → XZR, write discarded
    return true;
  }
  return false;
}

function tryLogicalImmediate(ctx: ExecutionContext, insn: number): boolean {
  // Logical (immediate): sf | opc(2) | 100100 | N | immr(6) | imms(6) | Rn | Rd
  //   opc: 00 AND, 01 ORR, 10 EOR, 11 ANDS. AND/ORR/EOR write Rd with SP
  //   semantics (enc 31 = SP); ANDS uses XZR and sets NZCV (C=V=0).
  if (((insn >>> 23) & 0b111111) === 0b100100) {
    const sf = insn >>> 31;
    const opc = (insn >>> 29) & 0b11;
    const nBit = (insn >>> 22) & 1;
    const immr = (insn >>> 16) & 0x3f;
    const imms = (insn >>> 10) & 0x3f;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    if (sf === 0 && nBit === 1) return false; // reserved for 32-bit
    const imm = ctx.decodeBitMask(nBit, immr, imms, sf);
    const a = ctx.readGpr(rn);
    let value: bigint;
    switch (opc) {
      case 0b00:
      case 0b11:
        value = a & imm;
        break;
      case 0b01:
        value = a | imm;
        break;
      default:
        value = a ^ imm;
        break;
    }
    value = sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value);
    if (opc === 0b11) {
      // ANDS / TST: set NZ from the result, clear C and V.
      const width = sf === 1 ? 64n : 32n;
      const n = value >> (width - 1n) === 1n;
      const z = value === 0n;
      ctx.setFlags(n, z, false, false);
      ctx.writeGpr(rd, value);
    } else {
      ctx.writeGprSp(rd, value);
    }
    return true;
  }
  return false;
}

function tryBitfield(ctx: ExecutionContext, insn: number): boolean {
  // Bitfield: sf | opc(2) | 100110 | N | immr(6) | imms(6) | Rn | Rd
  //   opc: 00 SBFM, 01 BFM, 10 UBFM. Covers LSL/LSR/ASR imm, [SU]XT[BHW],
  //   [SU]BFX, BFI/BFXIL via the standard immr/imms field algorithm.
  if (((insn >>> 23) & 0b111111) === 0b100110) {
    const sf = insn >>> 31;
    const opc = (insn >>> 29) & 0b11;
    if (opc === 0b11) return false; // reserved
    const immr = (insn >>> 16) & 0x3f;
    const imms = (insn >>> 10) & 0x3f;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const width = sf === 1 ? 64 : 32;
    const src = ctx.readGpr(rn) & (sf === 1 ? MASK64 : MASK32);
    const r = immr % width;
    const sBits = imms;
    // UBFM field extraction (ARMv8 ARM C4.1.6). The canonical rotate-then-mask
    // only holds when imms >= immr; otherwise the field wraps and the result is
    // the low (imms+1) bits of ROR(src, r). The previous single rotate+full-mask
    // form mishandled the common LSR alias (imms == width-1): it kept the
    // high bits reintroduced by the `src << (width-r)` half of the rotate,
    // so LSR #36 of 0x73 returned 0x730000000 instead of 0 — corrupting every
    // downstream address derived from such a shift.
    const wB = BigInt(width);
    let bottom: bigint;
    let fieldLen: number;
    if (sBits >= r) {
      // Non-wrapping: take (sBits-r+1) bits of (src >> r).
      fieldLen = sBits - r + 1;
      bottom = (src >> BigInt(r)) & ((1n << BigInt(fieldLen)) - 1n);
    } else {
      // Wrapping: ROR(src, r), take low (sBits+1) bits.
      const rotated =
        ((src >> BigInt(r)) | (src << (wB - BigInt(r)))) & (sf === 1 ? MASK64 : MASK32);
      fieldLen = sBits + 1;
      bottom = rotated & ((1n << BigInt(fieldLen)) - 1n);
    }
    const fieldMask = (1n << BigInt(fieldLen)) - 1n;
    let result: bigint;
    if (opc === 0b01) {
      // BFM: merge bottom into the existing Rd, preserving bits outside the field.
      const dstOld = ctx.readGpr(rd) & (sf === 1 ? MASK64 : MASK32);
      result = (dstOld & ~fieldMask) | bottom;
    } else if (opc === 0b10) {
      // UBFM: zero-extend the extracted field.
      result = bottom;
    } else {
      // SBFM: sign-extend from bit (fieldLen-1) of the extracted field.
      result = ctx.signExtend(bottom, fieldLen);
      result = BigInt.asUintN(64, result);
    }
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
    return true;
  }
  return false;
}

function tryExtr(ctx: ExecutionContext, insn: number): boolean {
  // EXTR: sf | 00 | 100111 | N | 0 | Rm | imms(6) | Rn | Rd  (ROR alias when Rn==Rm)
  if (((insn >>> 23) & 0b111111) === 0b100111) {
    const sf = insn >>> 31;
    const rm = (insn >>> 16) & 0b11111;
    const imms = (insn >>> 10) & 0x3f;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const width = sf === 1 ? 64 : 32;
    const hi = ctx.readGpr(rn) & (sf === 1 ? MASK64 : MASK32);
    const lo = ctx.readGpr(rm) & (sf === 1 ? MASK64 : MASK32);
    const concat = (hi << BigInt(width)) | lo;
    const result = (concat >> BigInt(imms)) & (sf === 1 ? MASK64 : MASK32);
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
    return true;
  }

  return false;
}

const execDataProcessingImmediate_DECODERS: Array<
  (ctx: ExecutionContext, insn: number) => boolean
> = [
  tryAdrAdrp,
  tryAddImmediate,
  tryAddsImmediate,
  trySubImmediate,
  tryMovn,
  tryMovz,
  tryMovk,
  trySubsImmediate,
  tryLogicalImmediate,
  tryBitfield,
  tryExtr,
];

/**
 * Try to execute a Data Processing -- Immediate instruction.
 * Ordering is load-bearing and matches the former if-chain exactly.
 */
export function execDataProcessingImmediate(ctx: ExecutionContext, insn: number): boolean {
  for (const decode of execDataProcessingImmediate_DECODERS) {
    if (decode(ctx, insn)) return true;
  }
  return false;
}

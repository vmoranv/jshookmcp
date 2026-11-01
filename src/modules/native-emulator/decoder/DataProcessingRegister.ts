/**
 * DataProcessingRegister — register-operand instruction family.
 *
 * Encoding space: bits[28:25] = x101 (5, 13)
 *
 * Covers:
 * - ADD / SUB / SUBS / ADDS (shifted register)
 * - Logical operations (AND / ORR / EOR / ANDS, shifted register, including BIC/ORN/EON/BICS)
 * - Add/subtract with carry (ADC / ADCS / SBC / SBCS)
 * - Add/subtract extended register
 * - Data-processing (3 source): MADD / MSUB / SMULH / UMULH / SMADDL / SMSUBL / UMADDL / UMSUBL
 * - Pointer Authentication register form (PACIA/PACIB/PACDA/PACDB/AUTIA/AUTIB/AUTDA/AUTDB)
 * - PACGA (3-source, full 64-bit QARMA output)
 * - XPACI/XPACD (unverified register strip, 1-source window)
 * - Data-processing (2 source): UDIV / SDIV / LSLV / LSRV / ASRV / RORV
 * - Conditional select (CSEL / CSINC / CSINV / CSNEG)
 * - Conditional compare (CCMP / CCMN, register and immediate)
 * - Data-processing (1 source): RBIT / REV16 / REV32 / REV / CLZ
 */

import type { ExecutionContext } from '../cpu/ExecutionContext';
import { reverseBits, reverseBytes, countLeadingZeros } from '../utils/BitOperations';
import { computeArmCrc32 } from '../crc32';
import { execPointerAuth3Source, execPacga, execXpac } from './PointerAuth';

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;

/**
 * Per-block decoders for the Data Processing -- Register encoding space.
 * Extracted verbatim from the former single execDataProcessingRegister
 * body so each function stays under the complexity gate. Ordering is
 * load-bearing (pointer-auth/PACGA/XPAC must win over the 1-source and
 * 2-source windows they overlap with); the DECODERS array preserves it.
 */
/** ADD (shifted register): sf | 0 | 0 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd */
function tryAddShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // ADD (shifted register): sf | 0 | 0 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
  if (op2829 === 0b00 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
    const sf = insn >>> 31;
    const shiftType = (insn >>> 22) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const imm6 = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const sum =
      imm6 === 0
        ? ctx.readGpr(rn) + ctx.readGpr(rm) // no-shift fast path (most common)
        : ctx.readGpr(rn) + ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, sum) : BigInt.asUintN(32, sum));
    return true;
  }

  return false;
}

function trySubShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // SUB (shifted register): sf | 1 | 0 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
  if (op2829 === 0b10 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
    const sf = insn >>> 31;
    const shiftType = (insn >>> 22) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const imm6 = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const operand2 = ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
    const diff = ctx.readGpr(rn) - operand2;
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, diff) : BigInt.asUintN(32, diff));
    return true;
  }

  return false;
}

function tryOrrShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // ORR (shifted register): sf | 01 | 01010 | shift | 0 | Rm | imm6 | Rn | Rd
  //   MOV (register) is the alias ORR Rd, XZR, Rm. Rn/Rm use XZR for enc 31.
  if (op2829 === 0b01 && ((insn >>> 24) & 0b11111) === 0b01010 && ((insn >>> 21) & 1) === 0) {
    const sf = insn >>> 31;
    const shiftType = (insn >>> 22) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const imm6 = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const operand2 = ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
    const value = ctx.readGpr(rn) | operand2;
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
    return true;
  }

  return false;
}

function tryEorShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // EOR (shifted register): sf | 10 | 01010 | shift | 0 | Rm | imm6 | Rn | Rd
  if (op2829 === 0b10 && ((insn >>> 24) & 0b11111) === 0b01010 && ((insn >>> 21) & 1) === 0) {
    const sf = insn >>> 31;
    const shiftType = (insn >>> 22) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const imm6 = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const operand2 = ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
    const value = ctx.readGpr(rn) ^ operand2;
    ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
    return true;
  }

  return false;
}

function trySubsShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // SUBS/CMP (shifted register): sf | 1 | 1 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
  if (op2829 === 0b11 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
    const sf = insn >>> 31;
    const shiftType = (insn >>> 22) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const imm6 = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const operand2 = ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
    const result = ctx.subWithFlags(ctx.readGpr(rn), operand2, sf);
    ctx.writeGpr(rd, result);
    return true;
  }

  return false;
}

function tryAddsShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  const op2829 = (insn >>> 29) & 0b11;
  // ADDS (shifted register): sf | 0 | 1 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
  if (op2829 === 0b01 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
    const sf = insn >>> 31;
    const shiftType = (insn >>> 22) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const imm6 = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const operand2 = ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
    const result = ctx.addWithFlags(ctx.readGpr(rn), operand2, sf);
    ctx.writeGpr(rd, result);
    return true;
  }

  return false;
}

function tryLogicalShiftedRegister(ctx: ExecutionContext, insn: number): boolean {
  // Logical (shifted register), N-bit selects the complement variants:
  //   opc 00 + N0 = AND, N1 = BIC; opc 01 + N0 = ORR (handled above), N1 = ORN;
  //   opc 10 + N0 = EOR (handled above), N1 = EON; opc 11 + N0 = ANDS, N1 = BICS.
  //   sf | opc(2) | 01010 | shift(2) | N | Rm | imm6 | Rn | Rd
  if (((insn >>> 24) & 0b11111) === 0b01010) {
    const sf = insn >>> 31;
    const opc = (insn >>> 29) & 0b11;
    const nBit = (insn >>> 21) & 1;
    // ORR/EOR with N=0 are already handled above; only take the remaining forms.
    const alreadyHandled = nBit === 0 && (opc === 0b01 || opc === 0b10);
    if (!alreadyHandled) {
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      let operand2 = ctx.applyShift(ctx.readGpr(rm), shiftType, imm6, sf);
      if (nBit === 1) operand2 = ~operand2; // BIC/ORN/EON/BICS invert operand2
      const a = ctx.readGpr(rn);
      let value: bigint;
      if (opc === 0b00 || opc === 0b11) value = a & operand2; // AND/BIC/ANDS/BICS
      else if (opc === 0b01) value = a | operand2; // ORN
      else value = a ^ operand2; // EON
      value = sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value);
      if (opc === 0b11) {
        const width = sf === 1 ? 64n : 32n;
        const n = value >> (width - 1n) === 1n;
        const z = value === 0n;
        ctx.setFlags(n, z, false, false);
      }
      ctx.writeGpr(rd, value);
      return true;
    }
  }

  return false;
}

const SHIFTED_REGISTER_DECODERS: Array<(ctx: ExecutionContext, insn: number) => boolean> = [
  tryAddShiftedRegister,
  trySubShiftedRegister,
  tryOrrShiftedRegister,
  tryEorShiftedRegister,
  trySubsShiftedRegister,
  tryAddsShiftedRegister,
  tryLogicalShiftedRegister,
];

/** Shifted-register ops (ADD/SUB/ORR/EOR/SUBS/ADDS + the logical family).
 * Sub-decoder order matches the ARM encoding table and the former single
 * block: ORR/EOR (N=0) win before the general logical fallthrough. */
function tryShiftedRegisterOps(ctx: ExecutionContext, insn: number): boolean {
  for (const decode of SHIFTED_REGISTER_DECODERS) {
    if (decode(ctx, insn)) return true;
  }
  return false;
}

function tryAddSubExtendedRegister(ctx: ExecutionContext, insn: number): boolean {
  // Add/subtract (extended register): sf | op | S | 01011 | 00 | 1 | Rm |
  //   option(3) | imm3 | Rn | Rd. Used for SP-relative arithmetic with a
  //   zero/sign-extended Rm (e.g. add x0, sp, w1, uxtw #2). Rn uses SP semantics.
  if (((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 0b111) === 0b001) {
    const sf = insn >>> 31;
    const op = (insn >>> 30) & 1; // 0 add, 1 sub
    const s = (insn >>> 29) & 1; // set flags
    const rm = (insn >>> 16) & 0b11111;
    const option = (insn >>> 13) & 0b111;
    const imm3 = (insn >>> 10) & 0b111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const operand2 = ctx.extendReg(ctx.readGpr(rm), option, imm3, sf);
    if (s === 1) {
      const result =
        op === 0
          ? ctx.addWithFlags(ctx.readGprSp(rn), operand2, sf)
          : ctx.subWithFlags(ctx.readGprSp(rn), operand2, sf);
      ctx.writeGpr(rd, result);
    } else {
      const base = ctx.readGprSp(rn);
      const value = op === 0 ? base + operand2 : base - operand2;
      ctx.writeGprSp(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
    }
    return true;
  }

  return false;
}

function tryAddSubWithCarry(ctx: ExecutionContext, insn: number): boolean {
  // Add/subtract (with carry): sf | op | S | 11010000 | Rm | 000000 | Rn | Rd
  //   ADC/ADCS (op=0) and SBC/SBCS (op=1). Carry-in from flagC.
  if (((insn >>> 21) & 0xff) === 0b11010000) {
    const sf = insn >>> 31;
    const op = (insn >>> 30) & 1;
    const s = (insn >>> 29) & 1;
    const rm = (insn >>> 16) & 0b11111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const carry = ctx.c ? 1n : 0n;
    if (op === 0) {
      // ADC: Rn + Rm + C
      const result =
        s === 1
          ? ctx.addWithFlags(ctx.readGpr(rn), ctx.readGpr(rm), sf, carry)
          : ctx.readGpr(rn) + ctx.readGpr(rm) + carry;
      ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
    } else {
      // SBC: Rn - Rm - (1 - C) = Rn + ~Rm + C
      const notRm = ~ctx.readGpr(rm);
      const result =
        s === 1
          ? ctx.addWithFlags(ctx.readGpr(rn), notRm, sf, carry)
          : ctx.readGpr(rn) + notRm + carry;
      ctx.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
    }
    return true;
  }

  return false;
}

function tryPointerAuthGroup(ctx: ExecutionContext, insn: number): boolean {
  // Pointer Authentication (register form, ARMv8.3): sits in the Data
  // Processing (1 source) window (bits[30:21] = 1x11010110) with opcode2
  // bits[20:16] = 00001 fixed — base 0xDAC10000. Must run BEFORE the 1-source
  // block below, or a real `pacia x3, x2` (0xDAC10043, opcode bits[15:10] =
  // 000000) executes as RBIT — silent corruption.
  if (execPointerAuth3Source(ctx, insn)) return true;

  // PACGA (3-source): base 0x9AC03000, bits[15:10] = 001100 fixed. It shares
  // the (insn >>> 21) & 0xff == 0b11010110 window with the 2-source block
  // below (bit30=0), so it must be checked BEFORE that block; the fixed
  // opcode bits[15:10] = 001100 disambiguates (the 2-source opcodes handled
  // there are UDIV/SDIV/LSLV/LSRV/ASRV/RORV — none is 001100).
  if (execPacga(ctx, insn)) return true;

  // XPACI/XPACD (register strip): 0xDAC143E0|Xd / 0xDAC147E0|Xd. These also
  // sit in the 1-source window (bits[15:10] = 010000/010001) and would fall to
  // that block's switch default → NOP, so they must be intercepted first.
  if (execXpac(ctx, insn)) return true;

  return false;
}

function tryDataProcessing3Source(ctx: ExecutionContext, insn: number): boolean {
  // Data-processing (3 source): sf | 00 | 11011 | op31(3) | Rm | o0 | Ra | Rn | Rd
  //   MADD/MSUB (Rd = Ra ± Rn*Rm), SMULH/UMULH (high 64 bits of 64×64).
  if (((insn >>> 24) & 0b11111) === 0b11011) {
    const sf = insn >>> 31;
    const op31 = (insn >>> 21) & 0b111;
    const o0 = (insn >>> 15) & 1;
    const rm = (insn >>> 16) & 0b11111;
    const ra = (insn >>> 10) & 0b11111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    if (op31 === 0b000) {
      // MADD (o0=0) / MSUB (o0=1).
      // 32-bit form (sf=0) operates on W-regs: operands are truncated to
      // their low 32 bits BEFORE the multiply. Folding in dirty high bits of
      // Rn/Rm (common when a value was narrowed earlier but the full X reg
      // still holds garbage above bit 31) produced a wrong product whose
      // low-32 leaked into an indexed load address — crashing real .so code.
      if (sf === 0) {
        const wn = ctx.readGpr(rn) & MASK32;
        const wm = ctx.readGpr(rm) & MASK32;
        const wa = ctx.readGpr(ra) & MASK32;
        const product = wn * wm;
        const value = o0 === 0 ? wa + product : wa - product;
        ctx.writeGpr(rd, BigInt.asUintN(32, value));
      } else {
        const product = ctx.readGpr(rn) * ctx.readGpr(rm);
        const acc = ctx.readGpr(ra);
        const value = o0 === 0 ? acc + product : acc - product;
        ctx.writeGpr(rd, BigInt.asUintN(64, value));
      }
      return true;
    }
    if (op31 === 0b010 && o0 === 0) {
      // SMULH: signed high 64 bits of the 128-bit product.
      const a = BigInt.asIntN(64, ctx.readGpr(rn));
      const b = BigInt.asIntN(64, ctx.readGpr(rm));
      ctx.writeGpr(rd, BigInt.asUintN(64, (a * b) >> 64n));
      return true;
    }
    if (op31 === 0b110 && o0 === 0) {
      // UMULH: unsigned high 64 bits of the 128-bit product.
      const a = ctx.readGpr(rn) & MASK64;
      const b = ctx.readGpr(rm) & MASK64;
      ctx.writeGpr(rd, ((a * b) >> 64n) & MASK64);
      return true;
    }
    if (op31 === 0b001) {
      // SMADDL/SMSUBL: Xd = Xa ± (SignExtend(Wn) * SignExtend(Wm)).
      const a = BigInt.asIntN(32, ctx.readGpr(rn) & MASK32);
      const b = BigInt.asIntN(32, ctx.readGpr(rm) & MASK32);
      const acc = BigInt.asIntN(64, ctx.readGpr(ra));
      const value = o0 === 0 ? acc + a * b : acc - a * b;
      ctx.writeGpr(rd, BigInt.asUintN(64, value));
      return true;
    }
    if (op31 === 0b101) {
      // UMADDL/UMSUBL: Xd = Xa ± (ZeroExtend(Wn) * ZeroExtend(Wm)).
      const a = ctx.readGpr(rn) & MASK32;
      const b = ctx.readGpr(rm) & MASK32;
      const acc = ctx.readGpr(ra) & MASK64;
      const value = o0 === 0 ? acc + a * b : acc - a * b;
      ctx.writeGpr(rd, BigInt.asUintN(64, value));
      return true;
    }
  }

  return false;
}

function tryDataProcessing2Source(ctx: ExecutionContext, insn: number): boolean {
  // Data-processing (2 source): sf | 0 | S | 11010110 | Rm | opcode(6) | Rn | Rd
  //   UDIV/SDIV and the variable shifts LSLV/LSRV/ASRV/RORV. bit30=0 here
  //   (bit30=1 is the 1-source class below, same 11010110 discriminant).
  if (((insn >>> 21) & 0xff) === 0b11010110 && ((insn >>> 30) & 1) === 0) {
    const sf = insn >>> 31;
    const opcode = (insn >>> 10) & 0b111111;
    const rm = (insn >>> 16) & 0b11111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const width = sf === 1 ? 64 : 32;
    const wMask = sf === 1 ? MASK64 : MASK32;
    const dividend = ctx.readGpr(rn) & wMask;
    const divisor = ctx.readGpr(rm) & wMask;
    switch (opcode) {
      case 0b000010: {
        // UDIV — division by zero yields 0 (AArch64 semantics).
        const q = divisor === 0n ? 0n : dividend / divisor;
        ctx.writeGpr(rd, q & wMask);
        return true;
      }
      case 0b000011: {
        // SDIV — signed; division by zero yields 0.
        const a = BigInt.asIntN(width, dividend);
        const b = BigInt.asIntN(width, divisor);
        const q = b === 0n ? 0n : a / b; // BigInt division truncates toward zero
        ctx.writeGpr(rd, BigInt.asUintN(width, q));
        return true;
      }
      case 0b001000: // LSLV
        ctx.writeGpr(rd, ctx.applyShift(dividend, 0b00, Number(divisor % BigInt(width)), sf));
        return true;
      case 0b001001: // LSRV
        ctx.writeGpr(rd, ctx.applyShift(dividend, 0b01, Number(divisor % BigInt(width)), sf));
        return true;
      case 0b001010: // ASRV
        ctx.writeGpr(rd, ctx.applyShift(dividend, 0b10, Number(divisor % BigInt(width)), sf));
        return true;
      case 0b001011: // RORV
        ctx.writeGpr(rd, ctx.applyShift(dividend, 0b11, Number(divisor % BigInt(width)), sf));
        return true;
      default:
        break;
    }
  }

  return false;
}

function tryConditionalSelect(ctx: ExecutionContext, insn: number): boolean {
  // Conditional select: sf | op | S | 11010100 | Rm | cond(4) | op2(2) | Rn | Rd
  //   CSEL/CSINC/CSINV/CSNEG. The op2 low bit selects increment/negate, op
  //   (bit30) selects invert/negate. Covers CSET/CSETM/CINC/CINV aliases.
  if (((insn >>> 21) & 0xff) === 0b11010100) {
    const sf = insn >>> 31;
    const op = (insn >>> 30) & 1;
    const rm = (insn >>> 16) & 0b11111;
    const cond = (insn >>> 12) & 0b1111;
    const op2 = (insn >>> 10) & 0b11;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const wMask = sf === 1 ? MASK64 : MASK32;
    let value: bigint;
    if (ctx.conditionHolds(cond)) {
      value = ctx.readGpr(rn) & wMask;
    } else {
      // op:op2 selects the transform applied to Rm: 0:00 CSEL, 0:01 CSINC,
      // 1:00 CSINV, 1:01 CSNEG.
      let other = ctx.readGpr(rm) & wMask;
      if (op === 0 && op2 === 0b01) other = (other + 1n) & wMask; // CSINC
      else if (op === 1 && op2 === 0b00) other = ~other & wMask; // CSINV
      else if (op === 1 && op2 === 0b01) other = (~other + 1n) & wMask; // CSNEG
      value = other;
    }
    ctx.writeGpr(rd, value);
    return true;
  }

  return false;
}

function tryConditionalCompareRegister(ctx: ExecutionContext, insn: number): boolean {
  // Conditional compare (register): sf | op | 1 | 11010010 | Rm | cond | 0 | Rn | 0 | nzcv
  //   CCMP (op=1) / CCMN (op=0). If cond holds, compare Rn vs Rm and set NZCV;
  //   else load the immediate nzcv field into the flags.
  if (
    ((insn >>> 21) & 0xff) === 0b11010010 &&
    ((insn >>> 11) & 1) === 0 &&
    ((insn >>> 4) & 1) === 0
  ) {
    const sf = insn >>> 31;
    const op = (insn >>> 30) & 1;
    const rm = (insn >>> 16) & 0b11111;
    const cond = (insn >>> 12) & 0b1111;
    const rn = (insn >>> 5) & 0b11111;
    const nzcv = insn & 0b1111;
    if (ctx.conditionHolds(cond)) {
      if (op === 1) ctx.subWithFlags(ctx.readGpr(rn), ctx.readGpr(rm), sf);
      else ctx.addWithFlags(ctx.readGpr(rn), ctx.readGpr(rm), sf);
    } else {
      ctx.setFlags(
        ((nzcv >> 3) & 1) === 1,
        ((nzcv >> 2) & 1) === 1,
        ((nzcv >> 1) & 1) === 1,
        (nzcv & 1) === 1,
      );
    }
    return true;
  }

  return false;
}

function tryConditionalCompareImmediate(ctx: ExecutionContext, insn: number): boolean {
  // Conditional compare (immediate): sf | op | 1 | 11010010 | imm5 | cond | 1 | Rn | 0 | nzcv
  //   Same as the register form but the second operand is a 5-bit zero-extended
  //   immediate. Distinguished from the register form by bit11 = 1.
  if (
    ((insn >>> 21) & 0xff) === 0b11010010 &&
    ((insn >>> 11) & 1) === 1 &&
    ((insn >>> 4) & 1) === 0
  ) {
    const sf = insn >>> 31;
    const op = (insn >>> 30) & 1;
    const imm5 = BigInt((insn >>> 16) & 0b11111);
    const cond = (insn >>> 12) & 0b1111;
    const rn = (insn >>> 5) & 0b11111;
    const nzcv = insn & 0b1111;
    if (ctx.conditionHolds(cond)) {
      if (op === 1) ctx.subWithFlags(ctx.readGpr(rn), imm5, sf);
      else ctx.addWithFlags(ctx.readGpr(rn), imm5, sf);
    } else {
      ctx.setFlags(
        ((nzcv >> 3) & 1) === 1,
        ((nzcv >> 2) & 1) === 1,
        ((nzcv >> 1) & 1) === 1,
        (nzcv & 1) === 1,
      );
    }
    return true;
  }

  return false;
}

function tryDataProcessing1Source(ctx: ExecutionContext, insn: number): boolean {
  // Data-processing (1 source): sf | 1 | S | 11010110 | opcode2(5) | opcode(6) | Rn | Rd
  //   RBIT/REV16/REV32/REV, CLZ/CLS. Distinguished from 2-source by bit30=1.
  if (((insn >>> 21) & 0xff) === 0b11010110 && ((insn >>> 30) & 1) === 1) {
    const sf = insn >>> 31;
    const opcode = (insn >>> 10) & 0b111111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    const width = sf === 1 ? 64 : 32;
    const src = ctx.readGpr(rn) & (sf === 1 ? MASK64 : MASK32);
    switch (opcode) {
      case 0b000000: // RBIT
        ctx.writeGpr(rd, reverseBits(src, width));
        return true;
      case 0b000001: // REV16
        ctx.writeGpr(rd, reverseBytes(src, width, 2));
        return true;
      case 0b000010: // REV32 (or REV for 32-bit when sf=0)
        ctx.writeGpr(rd, reverseBytes(src, width, sf === 1 ? 4 : width / 8));
        return true;
      case 0b000011: // REV (64-bit)
        ctx.writeGpr(rd, reverseBytes(src, width, width / 8));
        return true;
      case 0b000100: // CLZ
        ctx.writeGpr(rd, BigInt(countLeadingZeros(src, width)));
        return true;
      default:
        break;
    }
  }

  return false;
}

function tryCrc32(ctx: ExecutionContext, insn: number): boolean {
  // CRC32 / CRC32C (ARMv8): CRC32B/H/W/X + CRC32CB/CH/CW/CX.
  // bits[30:21] = 0b0110101100 (0x1AC); size 11 (CRC32X/CRC32CX) requires sf=1.
  // Bit12 selects CRC32 (0) vs CRC32C Castagnoli (1); bits[11:10] = operand size.
  if (((insn >>> 21) & 0x3ff) === 0b0110101100) {
    const sf = insn >>> 31;
    const c = (insn >>> 12) & 1;
    const size = (insn >>> 10) & 0b11;
    const rm = (insn >>> 16) & 0b11111;
    const rn = (insn >>> 5) & 0b11111;
    const rd = insn & 0b11111;
    if (size === 0b11 && sf !== 1) {
      throw new Error('CRC32: 64-bit operand (size=11) requires sf=1');
    }
    const sizeBytes = 1 << size;
    const acc = Number(ctx.readGpr(rn) & MASK32);
    const result = computeArmCrc32(acc, ctx.readGpr(rm), sizeBytes, c === 1);
    ctx.writeGpr(rd, BigInt(result));
    return true;
  }

  return false;
}

const DECODERS: Array<(ctx: ExecutionContext, insn: number) => boolean> = [
  tryShiftedRegisterOps,
  tryAddSubExtendedRegister,
  tryAddSubWithCarry,
  tryPointerAuthGroup,
  tryDataProcessing3Source,
  tryDataProcessing2Source,
  tryConditionalSelect,
  tryConditionalCompareRegister,
  tryConditionalCompareImmediate,
  tryDataProcessing1Source,
  tryCrc32,
];

/**
 * Try to execute a Data Processing -- Register instruction.
 * Returns true if handled, false if the instruction doesn't belong to this family.
 */
export function execDataProcessingRegister(ctx: ExecutionContext, insn: number): boolean {
  for (const decode of DECODERS) {
    if (decode(ctx, insn)) return true;
  }
  return false;
}

/**
 * LoadStore — load and store instruction family.
 *
 * Encoding space: bits[28:25] = x1x0 (4, 6, 12, 14)
 *
 * Covers:
 * - LDR / STR (immediate offset: unsigned, unscaled, pre/post-index)
 * - LDR / STR (register offset)
 * - LDR (literal, PC-relative)
 * - LDP / STP (load/store pair)
 * - LDXR / STXR (exclusive load/store)
 * - LDUR / STUR (unscaled offset)
 *
 * Note: FP/SIMD load/store (V=1) is delegated to the SIMD layer.
 */

import type { ExecutionContext } from '../cpu/ExecutionContext';
import type { SimdContext } from '../simd';
import { executeSimdLoadStore } from '../simd';
import { signExtend7, signExtend9, signExtend19 } from '../simd-utils';

/**
 * Per-block decoders for execLoadStore. Extracted verbatim from the former
 * single function so each stays under the complexity gate. Block evaluation order matches the former if-chain.
 */
function tryLoadStoreExclusive(ctx: ExecutionContext, insn: number): boolean {
  // Load/store exclusive (LDXR/LDAXR/STXR/STLXR, byte/half/word/dword):
  //   size(31:30) | 001000 | o2 | L(22) | o1 | Rs(20:16) | o0 | Rt2 | Rn | Rt
  // The emulator is single-threaded, so an exclusive pair can never be broken
  // by another agent: a load reads normally, and a store always succeeds and
  // reports status 0 in Rs. This is what lets a stdlib guarding shared state
  // with LDAXR/STLXR (or a refcount) run to completion here.
  //
  // o2 (bit23) and o1 (bit21) must both be clear: the v8.1 atomics (CAS/CASP,
  // LDADD/SWP/…) set o2 and share the same 001000 prefix, and silently running
  // one as an ordinary exclusive load/store would drop its atomic semantics.
  if (
    ((insn >>> 24) & 0b111111) === 0b001000 &&
    ((insn >>> 23) & 1) === 0 &&
    ((insn >>> 21) & 1) === 0
  ) {
    const size = insn >>> 30;
    const bytes = 1 << size;
    const isLoad = ((insn >>> 22) & 1) === 1;
    const rs = (insn >>> 16) & 0b11111;
    const rn = (insn >>> 5) & 0b11111;
    const rt = insn & 0b11111;
    const addr = Number(ctx.readGprSp(rn));
    if (isLoad) {
      ctx.writeGpr(rt, ctx.loadValue(addr, bytes));
    } else {
      ctx.storeValue(addr, bytes, ctx.readGpr(rt));
      ctx.writeGpr(rs, 0n); // exclusive store status: 0 = success
    }
    return true;
  }
  return false;
}

function tryLoadStoreIntegerFamily(ctx: ExecutionContext, insn: number): boolean {
  // LDR/STR family (integer): size(31:30) | 111 | V(26)=0 | b25:24 | opc(23:22) | …
  //   opc encodes load/store + signedness: 00 STR, 01 LDR (zero-extend),
  //   10 LDRS→64-bit (sign-extend), 11 LDRS→32-bit. bits 25:24 select the form:
  //     0b01 unsigned offset; 0b00 with bit21=0 → unscaled/pre/post-index;
  //     0b00 with bit21=1 → register offset.
  if (((insn >>> 27) & 0b111) === 0b111 && ((insn >>> 26) & 1) === 0) {
    const size = insn >>> 30; // 0=byte 1=half 2=word 3=dword
    const opc = (insn >>> 22) & 0b11;
    const form = (insn >>> 24) & 0b11;
    const rn = (insn >>> 5) & 0b11111;
    const rt = insn & 0b11111;
    const bytes = 1 << size;
    const isLoad = opc !== 0b00; // 00 = store; 01/10/11 = loads
    const signed = opc === 0b10 || opc === 0b11; // sign-extended loads
    // Sign-extended load target width: opc 10 → 64-bit, opc 11 → 32-bit.
    const loadWidth = opc === 0b11 ? 32 : 64;

    const doLoad = (addr: number): void => {
      const raw = ctx.loadValue(addr, bytes);
      const value = signed ? BigInt.asUintN(loadWidth, ctx.signExtend(raw, bytes * 8)) : raw;
      ctx.writeGpr(rt, value);
    };

    if (form === 0b01) {
      // Unsigned offset: imm12 scaled by access size.
      const imm12 = (insn >>> 10) & 0xfff;
      const addr = Number(BigInt.asUintN(64, ctx.readGprSp(rn) + BigInt(imm12 * bytes)));
      if (isLoad) doLoad(addr);
      else ctx.storeValue(addr, bytes, ctx.readGpr(rt));
      return true;
    }

    if (form === 0b00 && ((insn >>> 21) & 1) === 1 && ((insn >>> 10) & 0b11) === 0b10) {
      // Register offset: [Xn, Rm{, extend {amount}}]. option(15:13), S(12) →
      // shift amount = S ? size : 0. The common case is LSL #size (option 011).
      const rm = (insn >>> 16) & 0b11111;
      const option = (insn >>> 13) & 0b111;
      const s = (insn >>> 12) & 1;
      const shift = s === 1 ? size : 0;
      let rmValue = ctx.readGpr(rm);
      // BUGFIX: For uxtw (0b010), zero-extend the 32-bit W-register value to
      // 64-bit by masking garbage in the upper 32 bits of the X-register.
      // In ARM64, Wn aliases the low 32 bits of Xn, and a prior 64-bit write
      // to Xn may leave stale data in the upper word that corrupts the
      // effective address when the register is used with uxtw extension.
      // Same class of bug as the previously-fixed LDRSW sign-extend issue.
      if (option === 0b010) {
        rmValue &= 0xffffffffn;
      }
      const offset = ctx.extendReg(rmValue, option, shift, 1);
      // BUGFIX: Do address arithmetic in bigint space. Offset is ALREADY
      // correctly extended by extendReg (sign or zero), so just add as-is.
      const base = ctx.readGprSp(rn);
      const addr = Number(BigInt.asUintN(64, base + offset));
      if (isLoad) doLoad(addr);
      else ctx.storeValue(addr, bytes, ctx.readGpr(rt));
      return true;
    }

    if (form === 0b00) {
      // imm9-offset forms, distinguished by idx (bits 11:10):
      //   00 unscaled (LDUR/STUR): address = base + imm9, no writeback.
      //   01 post-index: access at base, then writeback base + imm9.
      //   11 pre-index: access at base + imm9, with writeback.
      // (Only post-index uses the bare base; unscaled and pre-index both add
      // imm9 to form the effective address — the earlier code applied imm9 to
      // pre-index only, so every STUR/LDUR with a non-zero offset hit the wrong
      // address and silently lost the access.)
      const imm9raw = (insn >>> 12) & 0x1ff;
      const imm9 = signExtend9(imm9raw);
      const idx = (insn >>> 10) & 0b11;
      const base = ctx.readGprSp(rn);
      // BUGFIX: Do address arithmetic in bigint space
      const addr = idx === 0b01 ? Number(base) : Number(BigInt.asUintN(64, base + BigInt(imm9)));
      if (isLoad) doLoad(addr);
      else ctx.storeValue(addr, bytes, ctx.readGpr(rt));
      if (idx === 0b11 || idx === 0b01) {
        ctx.writeGprSp(rn, BigInt.asUintN(64, base + BigInt(imm9))); // writeback (pre/post only)
      }
      return true;
    }
  }
  return false;
}

function tryLoadLiteral(ctx: ExecutionContext, insn: number): boolean {
  // LDR / LDRSW (literal): opc(31:30) | 011 | V(26)=0 | 00 | imm19 | Rt
  //   PC-relative load: Rt = *(PC + SignExtend(imm19 << 2)).
  //   opc 00 → 32-bit zero-extend,  01 → 64-bit,
  //   10 → 32-bit sign-extend (LDRSW). Also matches the canonical LDRSW
  //   encoding (bit 29 = 0, mask 0b_0011_0000 at bits [29:24]).
  if (((insn >>> 24) & 0b111111) === 0b011000 || ((insn >>> 24) & 0b111111) === 0b001100) {
    const opc = insn >>> 30;
    // opc=11 encodes PRFM (literal) — a prefetch hint with no architectural
    // effect on GPRs or memory. Consume it as a no-op instead of executing a
    // bogus 4-byte load into Rt (which would fault on unmapped addresses).
    if (opc === 0b11) return true;
    const signExtend = opc === 0b10; // LDRSW
    const bytes = opc === 0b01 ? 8 : 4;
    const rt = insn & 0b11111;
    const imm19 = (insn >>> 5) & 0x7ffff;
    const offset = signExtend19(imm19) * 4;
    const addr = ctx.pc + offset;
    const raw = ctx.loadValue(addr, bytes);
    if (signExtend && bytes === 4) {
      ctx.writeGpr(rt, BigInt.asIntN(32, raw));
    } else {
      ctx.writeGpr(rt, raw);
    }
    return true;
  }
  return false;
}

function tryLoadStorePair(ctx: ExecutionContext, insn: number): boolean {
  // LDP/STP (load/store pair): opc | 101 | V(0) | idx(24:23) | L | imm7 | Rt2 | Rn | Rt
  //   bits 29:25 === 0b10100 (V=0, integer); opc(31:30): 0b00 = STP 32-bit,
  //   0b01 = LDP 32-bit, 0b10 = STP 64-bit, 0b11 = LDP 64-bit.
  //   idx(24:23): 0b00 non-temporal (LDNP/STNP, signed offset, no writeback),
  //   0b01 post-index, 0b11 pre-index, 0b10 signed offset.
  //   L(bit22): 0 store, 1 load. imm7 signed, scaled by access size.
  if (((insn >>> 25) & 0b11111) === 0b10100) {
    const opc = insn >>> 30;
    const is64 = opc === 0b10 || opc === 0b11; // 64-bit LDP is opc=11, not just STP's 10
    const bytes = is64 ? 8 : 4;
    const idx = (insn >>> 23) & 0b11;
    const isLoad = ((insn >>> 22) & 1) === 1;
    const imm7raw = (insn >>> 15) & 0x7f;
    const imm7 = signExtend7(imm7raw) * bytes;
    const rt2 = (insn >>> 10) & 0b11111;
    const rn = (insn >>> 5) & 0b11111;
    const rt = insn & 0b11111;
    const base = ctx.readGprSp(rn);
    // BUGFIX: Do address arithmetic in bigint space
    const addr = idx === 0b01 ? Number(base) : Number(BigInt.asUintN(64, base + BigInt(imm7)));
    if (isLoad) {
      ctx.writeGpr(rt, ctx.loadValue(addr, bytes));
      ctx.writeGpr(rt2, ctx.loadValue(addr + bytes, bytes));
    } else {
      ctx.storeValue(addr, bytes, ctx.readGpr(rt));
      ctx.storeValue(addr + bytes, bytes, ctx.readGpr(rt2));
    }
    // Only pre/post-index (0b01/0b11) write the updated base back; signed
    // offset (0b10) and non-temporal LDNP/STNP (0b00) do not.
    if (idx === 0b01 || idx === 0b11) {
      ctx.writeGprSp(rn, BigInt.asUintN(64, base + BigInt(imm7)));
    }
    return true;
  }

  return false;
}

const execLoadStore_DECODERS: Array<(ctx: ExecutionContext, insn: number) => boolean> = [
  tryLoadStoreExclusive,
  tryLoadStoreIntegerFamily,
  tryLoadLiteral,
  tryLoadStorePair,
];

/**
 * Try to execute a Loads and Stores instruction.
 * Ordering is load-bearing and matches the former if-chain exactly.
 */
export function execLoadStore(
  ctx: ExecutionContext,
  insn: number,
  simdContext: SimdContext,
): boolean {
  // FP/SIMD register transfers (V=1, bit 26) split off to the SIMD layer —
  // LDR/STR/LDP/STP of B/H/S/D/Q move bytes between guest memory and the V
  // register file, not the GPRs the rest of this method serves.
  if (((insn >>> 26) & 1) === 1) {
    return executeSimdLoadStore(simdContext, insn);
  }

  for (const decode of execLoadStore_DECODERS) {
    if (decode(ctx, insn)) return true;
  }
  return false;
}

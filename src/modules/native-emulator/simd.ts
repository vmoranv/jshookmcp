/**
 * simd — AArch64 Advanced SIMD (NEON), scalar floating-point, and the AES/SHA
 * crypto-extension instructions for the self-built interpreter.
 *
 * The integer core lives in CpuEngine; this module owns the V register file's
 * *behaviour* (the bytes themselves are held by CpuEngine so a session snapshots
 * cleanly). CpuEngine hands us a `SimdContext` — a narrow window onto the V
 * registers, guest memory, the GPRs (for FMOV gpr↔fpr and SIMD addressing), the
 * NZCV flags (FCMP), and the PC (literal loads) — and we decode + execute the
 * SIMD/FP encoding groups against it.
 *
 * Two top-level entry points mirror the two AArch64 encoding groups SIMD lives
 * in:
 *   - `executeSimdLoadStore` — the load/store group with V=1 (FP/SIMD register
 *     transfers: LDR/STR/LDP/STP of B/H/S/D/Q).
 *   - `executeSimdFp` — the data-processing group bits[28:25]=x111 (NEON integer
 *     lane arithmetic, scalar floating-point, and the crypto extension).
 *
 * Both return `true` when they consume the instruction and `false` to let
 * CpuEngine fall through to its honest "unsupported opcode" throw — so the gap
 * stays visible and testable, exactly as the integer core does.
 *
 * Correctness bar: the crypto instructions are validated against the official
 * FIPS-197 (AES) and NIST FIPS-180-4 (SHA) test vectors, so AESE/AESMC and
 * SHA256H reproduce standard ciphertext/digests bit-for-bit — not an
 * approximation. AArch64 is little-endian: V-register byte 0 is the least
 * significant, and all DataView access uses littleEndian=true.
 */
import {
  aesd,
  aese,
  aesimc,
  aesmc,
  pmull,
  pmull2,
  sha1h,
  sha1Hash4,
  sha1su0,
  sha1su1,
  sha256h,
  sha256h2,
  sha256su0,
  sha256su1,
  type Sha1Func,
} from './simd-crypto';
import {
  fabs,
  fadd,
  fcmpFlags,
  fcvtPrecision,
  fdiv,
  fmax,
  fmin,
  fmul,
  fneg,
  fnmul,
  fpToInt,
  type FpRounding,
  frinta,
  frinti,
  frintm,
  frintn,
  frintp,
  frintx,
  frintz,
  fsqrt,
  fsub,
  intToFp,
  packFp,
  readFp,
} from './simd-fp';
import {
  neonAdd,
  neonAnd,
  neonBic,
  neonBsl,
  neonCmeq,
  neonCmge,
  neonCmgt,
  neonCmhi,
  neonCmhs,
  neonCmtst,
  neonEor,
  neonMul,
  neonOrn,
  neonOrr,
  neonSmax,
  neonSmin,
  neonSqadd,
  neonSqsub,
  neonSub,
  neonUqadd,
  neonUqsub,
  neonUmax,
  neonUmin,
} from './simd-neon';
import {
  advSimdExpandImm,
  neonAbs,
  neonAddv,
  neonClz,
  neonCmeqZero,
  neonCnt,
  neonDupElement,
  neonDupGeneral,
  neonExt,
  neonNeg,
  neonNot,
  neonRev,
  neonShl,
  neonSmaxv,
  neonSminv,
  neonSshr,
  neonTbl,
  neonTrn,
  neonUmaxv,
  neonUminv,
  neonUshr,
  neonUzp,
  neonZip,
  packLanes as neonPackLanes,
} from './simd-neon';

/**
 * The narrow capability window CpuEngine grants the SIMD layer. Structural
 * typing means CpuEngine can satisfy this with thin private accessors without a
 * nominal dependency in either direction.
 */
export interface SimdContext {
  /** Read the full 16 bytes of V register `reg` (0..31). Returns a live-copy. */
  vGetBytes(reg: number): Uint8Array;
  /** Overwrite the full 16 bytes of V register `reg`. */
  vSetBytes(reg: number, bytes: Uint8Array): void;
  /** Read V register `reg` as a single 128-bit value (little-endian). */
  vGet128(reg: number): bigint;
  /** Write V register `reg` as a single 128-bit value (little-endian). */
  vSet128(reg: number, value: bigint): void;
  /**
   * Read lane `index` of V register `reg` at element size 2^`sizeLog2` bytes
   * (0=B, 1=H, 2=S, 3=D), zero-extended into a BigInt.
   */
  vGetLane(reg: number, sizeLog2: number, index: number): bigint;
  /** Write lane `index` of V register `reg` at element size 2^`sizeLog2` bytes. */
  vSetLane(reg: number, sizeLog2: number, index: number, value: bigint): void;
  /** Read `length` bytes of guest memory at `address`. */
  memRead(address: number, length: number): Uint8Array;
  /** Write bytes into guest memory at `address`. */
  memWrite(address: number, bytes: Uint8Array): void;
  /** Read GPR xN (0..30) as BigInt; index 31 reads 0 (XZR). */
  gprRead(index: number): bigint;
  /** Write GPR xN (0..30); index 31 is discarded (XZR). */
  gprWrite(index: number, value: bigint): void;
  /** Read GPR with SP semantics for index 31 (used for base addressing). */
  gprReadSp(index: number): bigint;
  /** Set the NZCV condition flags (FCMP/FCCMP). */
  setNZCV(n: boolean, z: boolean, c: boolean, v: boolean): void;
  /** Evaluate an AArch64 condition code (0..15) against the current NZCV flags (FCSEL). */
  conditionHolds(cond: number): boolean;
  /** Current program counter (for PC-relative literal loads). */
  getPc(): number;
}

/**
 * Decode + execute a load/store-group instruction with V=1 (FP/SIMD register
 * transfer): scalar LDR/STR (B/H/S/D/Q), LDP/STP pairs (S/D/Q), and LDR literal.
 * Returns true when handled.
 *
 * The element width across all forms is recovered as `eszLog2 = size | (opc<1> << 2)`
 * giving 0=B(1B) … 4=Q(16B); `opc<0>` is the load(1)/store(0) bit for scalar forms.
 */
export function executeSimdLoadStore(ctx: SimdContext, insn: number): boolean {
  const b = (hi: number, lo: number): number => (insn >>> lo) & ((1 << (hi - lo + 1)) - 1);
  const group = b(29, 27); // 111 = scalar single, 101 = pair, 011 = literal, 001 = multi-struct

  if (group === 0b111) {
    return execScalarLoadStore(ctx, insn);
  }
  if (group === 0b101) {
    return execPairLoadStore(ctx, insn);
  }
  if (group === 0b011 && b(25, 24) === 0b00) {
    return execLiteralLoad(ctx, insn);
  }
  // AdvSIMD load/store multiple structures (LD1/ST1/…): bits[29:27]=001, bit24=0.
  if (group === 0b001 && b(24, 24) === 0) {
    return execMultiStructLoadStore(ctx, insn);
  }
  return false;
}

/**
 * AdvSIMD load/store *multiple structures* — the contiguous LD1/ST1 forms NEON
 * kernels (ffmpeg's `ff_*_neon`) use to stream pixel/sample rows into V registers.
 *
 *   no-offset:   0 Q 0011000 L 000000 opcode[15:12] size[11:10] Rn Rt
 *   post-index:  0 Q 0011001 L 0  Rm[20:16] opcode[15:12] size[11:10] Rn Rt
 *
 * `opcode` gives both the access and the register count:
 * 0111→1 reg, 1010→2, 0110→3, 0010→4 consecutive registers, each Q?16:8 bytes,
 * copied verbatim (no de-interleave). LD2/3/4 use opcodes 1000/0100/0000 and
 * move interleaved elements across 2/3/4 consecutive registers.
 * Post-index write-back adds the transfer size (Rm=31) or an Xm register value.
 */
function execMultiStructLoadStore(ctx: SimdContext, insn: number): boolean {
  const q = (insn >>> 30) & 1;
  const isLoad = ((insn >>> 22) & 1) === 1;
  const isPost = ((insn >>> 23) & 1) === 1;
  const opcode = (insn >>> 12) & 0b1111;
  const rm = (insn >>> 16) & 0b11111;
  const rn = (insn >>> 5) & 0b11111;
  const rt = insn & 0b11111;
  const size = (insn >>> 10) & 0b11;

  // LD1/ST1 contiguous: opcode → number of consecutive registers.
  const regCount =
    opcode === 0b0111
      ? 1
      : opcode === 0b1010
        ? 2
        : opcode === 0b0110
          ? 3
          : opcode === 0b0010
            ? 4
            : 0;
  const structCount = opcode === 0b1000 ? 2 : opcode === 0b0100 ? 3 : opcode === 0b0000 ? 4 : 0;
  if (regCount === 0 && structCount === 0) return false;

  const regBytes = q === 1 ? 16 : 8; // Q selects the full 128-bit or low 64-bit register
  const base = Number(ctx.gprReadSp(rn));
  const transferBytes = (regCount || structCount) * regBytes;

  if (regCount > 0) {
    let addr = base;
    for (let i = 0; i < regCount; i++) {
      const reg = (rt + i) % 32;
      if (isLoad) {
        const data = ctx.memRead(addr, regBytes);
        const full = new Uint8Array(16); // a 64-bit (Q=0) load zeroes the upper half
        full.set(data.subarray(0, regBytes));
        ctx.vSetBytes(reg, full);
      } else {
        ctx.memWrite(addr, ctx.vGetBytes(reg).subarray(0, regBytes));
      }
      addr += regBytes;
    }
  } else {
    transferInterleavedStructs(ctx, {
      isLoad,
      base,
      rt,
      structCount,
      regBytes,
      elementBytes: 1 << size,
    });
  }

  if (isPost) {
    // Rm=31 (XZR slot here) means "immediate" write-back of the transfer size;
    // any other Rm is an index register added to the base.
    const increment = rm === 31 ? transferBytes : Number(ctx.gprRead(rm));
    ctx.gprWrite(rn, BigInt(base + increment));
  }
  return true;
}

function transferInterleavedStructs(
  ctx: SimdContext,
  options: {
    isLoad: boolean;
    base: number;
    rt: number;
    structCount: number;
    regBytes: number;
    elementBytes: number;
  },
): void {
  const { isLoad, base, rt, structCount, regBytes, elementBytes } = options;
  const lanes = regBytes / elementBytes;
  if (!Number.isInteger(lanes) || lanes <= 0) return;

  if (isLoad) {
    const data = ctx.memRead(base, structCount * regBytes);
    const regs = Array.from({ length: structCount }, () => new Uint8Array(16));
    for (let lane = 0; lane < lanes; lane++) {
      for (let member = 0; member < structCount; member++) {
        const src = (lane * structCount + member) * elementBytes;
        const dst = lane * elementBytes;
        regs[member]!.set(data.subarray(src, src + elementBytes), dst);
      }
    }
    for (let member = 0; member < structCount; member++) {
      ctx.vSetBytes((rt + member) % 32, regs[member]!);
    }
    return;
  }

  const out = new Uint8Array(structCount * regBytes);
  const regs = Array.from({ length: structCount }, (_, member) =>
    ctx.vGetBytes((rt + member) % 32),
  );
  for (let lane = 0; lane < lanes; lane++) {
    for (let member = 0; member < structCount; member++) {
      const src = lane * elementBytes;
      const dst = (lane * structCount + member) * elementBytes;
      out.set(regs[member]!.subarray(src, src + elementBytes), dst);
    }
  }
  ctx.memWrite(base, out);
}

/** Move `bytes` bytes between V[reg] (low end) and a guest address. */
function transfer(
  ctx: SimdContext,
  isLoad: boolean,
  reg: number,
  addr: number,
  bytes: number,
): void {
  if (isLoad) {
    const data = ctx.memRead(addr, bytes);
    const full = new Uint8Array(16);
    full.set(data.subarray(0, bytes));
    ctx.vSetBytes(reg, full); // a scalar/vector load zeroes the unused high bytes
  } else {
    ctx.memWrite(addr, ctx.vGetBytes(reg).subarray(0, bytes));
  }
}

/** Scalar single-register LDR/STR (B/H/S/D/Q): unsigned-offset, unscaled, pre/post-index, register-offset. */
function execScalarLoadStore(ctx: SimdContext, insn: number): boolean {
  const size = (insn >>> 30) & 0b11;
  const opc = (insn >>> 22) & 0b11;
  const eszLog2 = size | ((opc >> 1) << 2);
  if (eszLog2 > 4) return false; // only B/H/S/D/Q
  const bytes = 1 << eszLog2;
  const isLoad = (opc & 1) === 1;
  const rn = (insn >>> 5) & 0b11111;
  const rt = insn & 0b11111;
  const base = Number(ctx.gprReadSp(rn));

  // Unsigned immediate offset: bits[25:24]=01, imm12 scaled by element size.
  if (((insn >>> 24) & 0b11) === 0b01) {
    const imm12 = (insn >>> 10) & 0xfff;
    transfer(ctx, isLoad, rt, base + imm12 * bytes, bytes);
    return true;
  }

  // bits[25:24]=00: register-offset (bit21=1) or unscaled/pre/post (bit21=0).
  if (((insn >>> 24) & 0b11) === 0b00) {
    if (((insn >>> 21) & 1) === 1) {
      // Register offset: [Xn, Xm{, extend{ #amount}}]. option(15:13), S(12).
      const rm = (insn >>> 16) & 0b11111;
      const option = (insn >>> 13) & 0b111;
      const s = (insn >>> 12) & 1;
      const offRaw = ctx.gprRead(rm);
      const off = extendOffset(offRaw, option, s ? eszLog2 : 0);
      transfer(ctx, isLoad, rt, base + Number(off), bytes);
      return true;
    }
    // Unscaled / pre / post index: simm9 at bits[20:12], addressing mode in [11:10].
    const simm9 = signExtend9((insn >>> 12) & 0x1ff);
    const mode = (insn >>> 10) & 0b11; // 00 unscaled(LDUR), 01 post, 11 pre
    let addr = base;
    if (mode === 0b11)
      addr = base + simm9; // pre-index: address uses the offset
    else if (mode === 0b00) addr = base + simm9; // unscaled: base + simm9
    // post-index (01): access at base, write-back after — base reg is a GPR here.
    transfer(ctx, isLoad, rt, addr, bytes);
    if (mode === 0b01 || mode === 0b11) ctx.gprWrite(rn, BigInt(base + simm9));
    return true;
  }
  return false;
}

/** LDP/STP of S/D/Q pairs (group 101). */
function execPairLoadStore(ctx: SimdContext, insn: number): boolean {
  const opc = (insn >>> 30) & 0b11; // 00=S(4B) 01=D(8B) 10=Q(16B)
  if (opc > 0b10) return false;
  const bytes = opc === 0b00 ? 4 : opc === 0b01 ? 8 : 16;
  const isLoad = ((insn >>> 22) & 1) === 1;
  const simm7 = signExtend7((insn >>> 15) & 0x7f) * bytes;
  const rt2 = (insn >>> 10) & 0b11111;
  const rn = (insn >>> 5) & 0b11111;
  const rt = insn & 0b11111;
  const mode = (insn >>> 23) & 0b11; // 01 post, 10 offset, 11 pre
  const base = Number(ctx.gprReadSp(rn));
  const addr = mode === 0b01 ? base : base + simm7; // post-index accesses at base
  transfer(ctx, isLoad, rt, addr, bytes);
  transfer(ctx, isLoad, rt2, addr + bytes, bytes);
  if (mode === 0b01 || mode === 0b11) ctx.gprWrite(rn, BigInt(base + simm7));
  return true;
}

/** LDR (literal) of S/D/Q — PC-relative, opc(31:30): 00=S 01=D 10=Q. */
function execLiteralLoad(ctx: SimdContext, insn: number): boolean {
  const opc = (insn >>> 30) & 0b11;
  if (opc > 0b10) return false;
  const bytes = opc === 0b00 ? 4 : opc === 0b01 ? 8 : 16;
  const imm19 = signExtend19((insn >>> 5) & 0x7ffff);
  const rt = insn & 0b11111;
  transfer(ctx, true, rt, ctx.getPc() + imm19 * 4, bytes);
  return true;
}

/** Apply a register-offset extend (UXTW/LSL/SXTW/SXTX) with optional shift. */
function extendOffset(value: bigint, option: number, shift: number): bigint {
  let v: bigint;
  switch (option) {
    case 0b010: // UXTW
      v = value & 0xffff_ffffn;
      break;
    case 0b110: // SXTW
      v = BigInt.asIntN(32, value & 0xffff_ffffn);
      break;
    case 0b111: // SXTX
      v = BigInt.asIntN(64, value);
      break;
    default: // 011 = LSL (UXTX)
      v = value;
      break;
  }
  return v << BigInt(shift);
}

const signExtend9 = (v: number): number => (v & 0x100 ? v - 0x200 : v);
const signExtend7 = (v: number): number => (v & 0x40 ? v - 0x80 : v);
const signExtend19 = (v: number): number => (v & 0x40000 ? v - 0x80000 : v);

/**
 * Decode + execute a data-processing SIMD/FP instruction (bits[28:25]=x111):
 * NEON integer lane arithmetic, scalar floating-point, and the AES/SHA crypto
 * extension. Returns true when handled.
 *
 * Rather than match raw opcodes against magic masks, we destructure the word
 * into the named bitfields the ARM ARM uses (Q/U/size/opcode/Rd/Rn/Rm) and
 * dispatch on the encoding *class* — mirroring the integer core's
 * bits[28:25]-group dispatch in CpuEngine.execute().
 */
export function executeSimdFp(ctx: SimdContext, insn: number): boolean {
  const f = decodeSimdFields(insn);
  if (isCryptoAes(f)) return execCryptoAes(ctx, f);
  if (isCryptoSha3Reg(f)) return execCryptoSha3Reg(ctx, f);
  if (isCryptoSha2Reg(f)) return execCryptoSha2Reg(ctx, f);
  if (isPmull(f)) return execPmull(ctx, f);
  if (isScalarFp(f)) return execScalarFp(ctx, f);
  if (isNeonThreeSame(f)) return execNeonThreeSame(ctx, f);
  if (isNeonModImm(f)) return execNeonModImm(ctx, f);
  if (isNeonShiftImm(f)) return execNeonShiftImm(ctx, f);
  if (isNeonTwoRegMisc(f)) return execNeonTwoRegMisc(ctx, f);
  if (isNeonAcross(f)) return execNeonAcross(ctx, f);
  if (isNeonCopy(f)) return execNeonCopy(ctx, f);
  if (isNeonExt(f)) return execNeonExt(ctx, f);
  if (isNeonPermute(f)) return execNeonPermute(ctx, f);
  if (isNeonTable(f)) return execNeonTable(ctx, f);
  return false;
}

/** The named bitfields shared across the SIMD/FP encoding classes (ARM ARM C4.1). */
interface SimdFields {
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

function decodeSimdFields(insn: number): SimdFields {
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

// ── Cryptographic AES (ARM ARM C4.1: high8=0x4E, [21:17]=10100, [11:10]=10) ──
const isCryptoAes = (f: SimdFields): boolean =>
  f.high8 === 0x4e && f.field21_17 === 0b10100 && f.low11_10 === 0b10;

/** opcode[16:12]: AESE=00100 AESD=00101 AESMC=00110 AESIMC=00111. Operates on Vd,Vn. */
function execCryptoAes(ctx: SimdContext, f: SimdFields): boolean {
  const vd = ctx.vGetBytes(f.rd);
  const vn = ctx.vGetBytes(f.rn);
  switch (f.op16_12) {
    case 0b00100:
      ctx.vSetBytes(f.rd, aese(vd, vn));
      return true;
    case 0b00101:
      ctx.vSetBytes(f.rd, aesd(vd, vn));
      return true;
    case 0b00110:
      ctx.vSetBytes(f.rd, aesmc(vn));
      return true;
    case 0b00111:
      ctx.vSetBytes(f.rd, aesimc(vn));
      return true;
    default:
      return false;
  }
}

// ── Cryptographic three-register SHA (high8=0x5E, size=00, [21]=0, [15]=0, [11:10]=00) ──
const isCryptoSha3Reg = (f: SimdFields): boolean =>
  f.high8 === 0x5e && f.size === 0 && f.bit21 === 0 && f.bit15 === 0 && f.low11_10 === 0;

/**
 * opcode[14:12]: 0=SHA1C 1=SHA1P 2=SHA1M 3=SHA1SU0 (bit14=0, SHA1 family);
 * 4=SHA256H 5=SHA256H2 6=SHA256SU1 (bit14=1, SHA256 family).
 */
function execCryptoSha3Reg(ctx: SimdContext, f: SimdFields): boolean {
  switch (f.op14_12) {
    case 0b000:
    case 0b001:
    case 0b010: {
      // SHA1C/P/M Qd,Sn,Vm: Qd holds ABCD; Sn (Rn lane 0) is the scalar E; Vm is W+K.
      // The 4-round result's ABCD is written back to Qd; E is regenerated by the
      // program's next SHA1H, so only Qd is updated here.
      const func: Sha1Func =
        f.op14_12 === 0b000 ? 'choose' : f.op14_12 === 0b010 ? 'majority' : 'parity';
      const e = Number(ctx.vGetLane(f.rn, 2, 0) & 0xffffffffn);
      const r = sha1Hash4(ctx.vGetBytes(f.rd), e, ctx.vGetBytes(f.rm), func);
      ctx.vSetBytes(f.rd, r.abcd);
      return true;
    }
    case 0b011:
      // SHA1SU0 Vd,Vn,Vm.
      ctx.vSetBytes(f.rd, sha1su0(ctx.vGetBytes(f.rd), ctx.vGetBytes(f.rn), ctx.vGetBytes(f.rm)));
      return true;
    case 0b100:
      // SHA256H Qd,Qn,Vm: Qd=abcd, Qn=efgh, Vm=W+K.
      ctx.vSetBytes(f.rd, sha256h(ctx.vGetBytes(f.rd), ctx.vGetBytes(f.rn), ctx.vGetBytes(f.rm)));
      return true;
    case 0b101:
      // SHA256H2 Qd,Qn,Vm: Qd=efgh, Qn=abcd (pre-H), Vm=W+K.
      ctx.vSetBytes(f.rd, sha256h2(ctx.vGetBytes(f.rd), ctx.vGetBytes(f.rn), ctx.vGetBytes(f.rm)));
      return true;
    case 0b110:
      // SHA256SU1 Vd,Vn,Vm.
      ctx.vSetBytes(f.rd, sha256su1(ctx.vGetBytes(f.rd), ctx.vGetBytes(f.rn), ctx.vGetBytes(f.rm)));
      return true;
    default:
      return false;
  }
}

// ── Cryptographic two-register SHA (high8=0x5E, [21:17]=10100, [11:10]=10) ──
const isCryptoSha2Reg = (f: SimdFields): boolean =>
  f.high8 === 0x5e && f.field21_17 === 0b10100 && f.low11_10 === 0b10;

/** opcode[16:12]: SHA1H=00000 SHA1SU1=00001 SHA256SU0=00010. Operates on Vd,Vn. */
function execCryptoSha2Reg(ctx: SimdContext, f: SimdFields): boolean {
  switch (f.op16_12) {
    case 0b00000: {
      // SHA1H Sd,Sn: Sd = ROL(Sn,30) on the low 32-bit lane; as an S-register
      // write the upper 96 bits of Vd are zeroed.
      const x = Number(ctx.vGetLane(f.rn, 2, 0) & 0xffffffffn);
      const out = new Uint8Array(16);
      new DataView(out.buffer).setUint32(0, sha1h(x) >>> 0, true);
      ctx.vSetBytes(f.rd, out);
      return true;
    }
    case 0b00001:
      // SHA1SU1 Vd,Vn.
      ctx.vSetBytes(f.rd, sha1su1(ctx.vGetBytes(f.rd), ctx.vGetBytes(f.rn)));
      return true;
    case 0b00010:
      // SHA256SU0 Vd,Vn.
      ctx.vSetBytes(f.rd, sha256su0(ctx.vGetBytes(f.rd), ctx.vGetBytes(f.rn)));
      return true;
    default:
      return false;
  }
}

// ── PMULL/PMULL2 — Advanced SIMD three-different (U=0, [28:24]=01110, size=11,
//    [21]=1, opcode[15:12]=1110, [11:10]=00); the 64→128 form needs FEAT_PMULL. ──
const isPmull = (f: SimdFields): boolean =>
  f.u === 0 &&
  f.base28_24 === 0b01110 &&
  f.size === 0b11 &&
  f.bit21 === 1 &&
  f.op15_12 === 0b1110 &&
  f.low11_10 === 0b00;

/** Q selects the operand lane: Q=0 → PMULL (low 64), Q=1 → PMULL2 (high 64). */
function execPmull(ctx: SimdContext, f: SimdFields): boolean {
  const vn = ctx.vGetBytes(f.rn);
  const vm = ctx.vGetBytes(f.rm);
  ctx.vSetBytes(f.rd, f.q === 1 ? pmull2(vn, vm) : pmull(vn, vm));
  return true;
}

// ── Scalar floating-point (ARM ARM C4.1.8/C4.1.9) ──────────────────────────
//
// The whole scalar-FP space shares the prefix M=0(bit31), bit30=0, S=0(bit29),
// bits[28:24]=11110, bit21=1. `ftype` (bits[23:22]) picks precision: 00=single,
// 01=double. Within that, the low fixed bits select the sub-form, exactly as the
// integer core dispatches on encoding-group bits rather than whole-word masks.

const FP_PREFIX_28_24 = 0b11110;
const isScalarFp = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 && // M
  ((f.insn >>> 30) & 1) === 0 &&
  f.u === 0 && // S
  f.base28_24 === FP_PREFIX_28_24 &&
  f.bit21 === 1 &&
  (f.ftype === 0b00 || f.ftype === 0b01); // single/double; half (11) not yet handled

/** Decode `ftype`→precision and route to the matching FP sub-form. */
function execScalarFp(ctx: SimdContext, f: SimdFields): boolean {
  const isDouble = f.ftype === 0b01;
  const bits15_10 = (f.insn >>> 10) & 0b111111;
  const bits14_10 = (f.insn >>> 10) & 0b11111;
  const bits13_10 = (f.insn >>> 10) & 0b1111;
  const low11_10 = (f.insn >>> 10) & 0b11;

  // FP immediate: bits[11:10]=00, bits[12]=1 → FMOV (immediate)
  if (low11_10 === 0b00 && ((f.insn >>> 12) & 1) === 1) {
    return execFpImmediate(ctx, f, isDouble);
  }
  // int ⇄ fp conversion: bits[15:10]=000000 (rmode[20:19], opcode[18:16]).
  if (bits15_10 === 0b000000) return execFpIntConv(ctx, f, isDouble);
  // compare: bits[13:10]=1000 (opcode2 in [4:0], op in [15:14]).
  if (bits13_10 === 0b1000) return execFpCompare(ctx, f, isDouble);
  // one-source: bits[14:10]=10000 (opcode in [20:15]).
  if (bits14_10 === 0b10000) return execFpOneSource(ctx, f, isDouble);
  // two-source: bits[11:10]=10 (opcode in [15:12]).
  if (low11_10 === 0b10) return execFpTwoSource(ctx, f, isDouble);
  // conditional select: bits[11:10]=11 (cond in [15:12]).
  if (low11_10 === 0b11) return execFpCondSelect(ctx, f, isDouble);
  return false;
}

/** Two-source arithmetic, opcode[15:12]: FMUL=0 FDIV=1 FADD=2 FSUB=3 FMAX=4 FMIN=5 FNMUL=8. */
function execFpTwoSource(ctx: SimdContext, f: SimdFields, isDouble: boolean): boolean {
  const a = readFp(ctx.vGetBytes(f.rn), isDouble);
  const b = readFp(ctx.vGetBytes(f.rm), isDouble);
  let r: number;
  switch (f.fpOp2Src) {
    case 0b0000:
      r = fmul(a, b, isDouble);
      break;
    case 0b0001:
      r = fdiv(a, b, isDouble);
      break;
    case 0b0010:
      r = fadd(a, b, isDouble);
      break;
    case 0b0011:
      r = fsub(a, b, isDouble);
      break;
    case 0b0100:
      r = fmax(a, b, isDouble);
      break;
    case 0b0101:
      r = fmin(a, b, isDouble);
      break;
    case 0b1000:
      r = fnmul(a, b, isDouble);
      break;
    default:
      return false; // FMAXNM/FMINNM/FNMUL variants not yet modelled
  }
  ctx.vSetBytes(f.rd, packFp(r, isDouble));
  return true;
}

/**
 * FP immediate: FMOV Sd/Dd, #imm.
 * imm8 is encoded in bits[20:13], expanded to IEEE-754 via VFPExpandImm.
 * Single-precision: aBbbbbbc defgh000 00000000 00000000 (32 bits)
 * Double-precision: aBbbbbbb bbcdefgh 00000000 ... 00000000 (64 bits)
 * where a=sign, B=NOT(b), b=exp bit, cdefgh=mantissa.
 */
function execFpImmediate(ctx: SimdContext, f: SimdFields, isDouble: boolean): boolean {
  const imm8 = (f.insn >>> 13) & 0xff;
  const a = (imm8 >>> 7) & 1; // sign
  const b = (imm8 >>> 6) & 1;
  const cdefgh = imm8 & 0b111111;

  if (isDouble) {
    // Double: aBbbbbbb bbcdefgh 0000... (11 exp bits, 52 frac bits)
    const B = b ? 0 : 1; // NOT(b)
    const exp =
      (a << 10) |
      (B << 9) |
      (B << 8) |
      (B << 7) |
      (B << 6) |
      (B << 5) |
      (B << 4) |
      (B << 3) |
      (b << 2) |
      (cdefgh >>> 4);
    const frac = (cdefgh & 0b1111) << 48; // low 4 bits → high 4 bits of 52-bit mantissa
    const bits64 = (BigInt(a) << 63n) | (BigInt(exp) << 52n) | BigInt(frac);
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, bits64, true);
    const value = view.getFloat64(0, true);
    ctx.vSetBytes(f.rd, packFp(value, true));
  } else {
    // Single: aBbbbbbc defgh000 00000000 00000000 (8 exp bits, 23 frac bits)
    const B = b ? 0 : 1;
    const c = (cdefgh >>> 5) & 1;
    const defgh = cdefgh & 0b11111;
    const exp = (a << 7) | (B << 6) | (B << 5) | (B << 4) | (B << 3) | (B << 2) | (B << 1) | c;
    const frac = defgh << 18; // 5 bits → high 5 bits of 23-bit mantissa
    const bits32 = (a << 31) | (exp << 23) | frac;
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, bits32 >>> 0, true);
    const value = view.getFloat32(0, true);
    ctx.vSetBytes(f.rd, packFp(value, false));
  }
  return true;
}

/**
 * One-source, opcode[20:15]: FMOV=0 FABS=1 FNEG=2 FSQRT=3; FCVT to single=000100,
 * to double=000101 (the FCVT opcode encodes the *target* size in bits[16:15]).
 */
function execFpOneSource(ctx: SimdContext, f: SimdFields, isDouble: boolean): boolean {
  const src = ctx.vGetBytes(f.rn);
  const a = readFp(src, isDouble);
  switch (f.fpOp1Src) {
    case 0b000000: // FMOV (register): copy the scalar verbatim, zeroing upper bytes.
      ctx.vSetBytes(f.rd, packFp(a, isDouble));
      return true;
    case 0b000001:
      ctx.vSetBytes(f.rd, packFp(fabs(a, isDouble), isDouble));
      return true;
    case 0b000010:
      ctx.vSetBytes(f.rd, packFp(fneg(a, isDouble), isDouble));
      return true;
    case 0b000011:
      ctx.vSetBytes(f.rd, packFp(fsqrt(a, isDouble), isDouble));
      return true;
    case 0b000100: {
      // FCVT to single (from the source precision given by ftype).
      const v = fcvtPrecision(a, false);
      ctx.vSetBytes(f.rd, packFp(v, false));
      return true;
    }
    case 0b000101: {
      // FCVT to double.
      const v = fcvtPrecision(a, true);
      ctx.vSetBytes(f.rd, packFp(v, true));
      return true;
    }
    // FRINT* family: round FP to integral value
    case 0b000110: // FRINTN: round to nearest, ties to even
      ctx.vSetBytes(f.rd, packFp(frintn(a, isDouble), isDouble));
      return true;
    case 0b000111: // FRINTP: round toward +Inf
      ctx.vSetBytes(f.rd, packFp(frintp(a, isDouble), isDouble));
      return true;
    case 0b001000: // FRINTM: round toward -Inf
      ctx.vSetBytes(f.rd, packFp(frintm(a, isDouble), isDouble));
      return true;
    case 0b001001: // FRINTZ: round toward zero
      ctx.vSetBytes(f.rd, packFp(frintz(a, isDouble), isDouble));
      return true;
    case 0b001010: // FRINTA: round to nearest, ties away from zero
      ctx.vSetBytes(f.rd, packFp(frinta(a, isDouble), isDouble));
      return true;
    case 0b001110: // FRINTX: round to integral, exact
      ctx.vSetBytes(f.rd, packFp(frintx(a, isDouble), isDouble));
      return true;
    case 0b001111: // FRINTI: round using current rounding mode
      ctx.vSetBytes(f.rd, packFp(frinti(a, isDouble), isDouble));
      return true;
    default:
      return false;
  }
}

/** FCMP/FCMPE — bits[4:0] opcode2 bit3 selects compare-with-zero; sets NZCV.
 * FCMP and FCMPE differ only in whether a quiet NaN raises Invalid Operation,
 * which this interpreter does not trap, so both map to the same flag result. */
function execFpCompare(ctx: SimdContext, f: SimdFields, isDouble: boolean): boolean {
  const opcode2 = f.insn & 0b11111; // bits[4:0]: bit3 = compare-with-zero
  const a = readFp(ctx.vGetBytes(f.rn), isDouble);
  const b = (opcode2 & 0b01000) !== 0 ? 0 : readFp(ctx.vGetBytes(f.rm), isDouble);
  const flags = fcmpFlags(a, b);
  ctx.setNZCV(flags.n, flags.z, flags.c, flags.v);
  return true;
}

/** FCSEL — bits[15:12]=cond; Vd = cond ? Vn : Vm at the operand precision. */
function execFpCondSelect(ctx: SimdContext, f: SimdFields, isDouble: boolean): boolean {
  const take = ctx.conditionHolds(f.fpCond) ? f.rn : f.rm;
  ctx.vSetBytes(f.rd, packFp(readFp(ctx.vGetBytes(take), isDouble), isDouble));
  return true;
}

/**
 * FP ⇄ integer conversion, rmode[20:19] + opcode[18:16]. Covers FCVT{N,P,M,Z}{S,U}
 * (fp→int, rounding chosen by rmode), SCVTF/UCVTF (int→fp), and FMOV (gpr↔fpr).
 */
function execFpIntConv(ctx: SimdContext, f: SimdFields, isDouble: boolean): boolean {
  const intBits: 32 | 64 = f.sf === 1 ? 64 : 32;
  const rmode = f.fpRmode;
  const op = f.fpConvOp;

  // opcode[18:16]: 000=FCVT?S 001=FCVT?U 010=SCVTF 011=UCVTF 110=FMOV(F→gpr) 111=FMOV(gpr→F)
  // rmode[20:19]: 00=N(earest) 01=P(+inf) 10=M(-inf) 11=Z(ero)
  const rounding: FpRounding =
    rmode === 0b00 ? 'nearest' : rmode === 0b01 ? 'plus' : rmode === 0b10 ? 'minus' : 'zero';

  switch (op) {
    case 0b000: {
      // FCVT?S — fp → signed int with rmode rounding.
      const val = readFp(ctx.vGetBytes(f.rn), isDouble);
      ctx.gprWrite(f.rd, BigInt.asUintN(64, fpToInt(val, rounding, true, intBits)));
      return true;
    }
    case 0b001: {
      // FCVT?U — fp → unsigned int.
      const val = readFp(ctx.vGetBytes(f.rn), isDouble);
      ctx.gprWrite(f.rd, BigInt.asUintN(64, fpToInt(val, rounding, false, intBits)));
      return true;
    }
    case 0b010: {
      // SCVTF — signed int → fp (FPCR rounding ≈ nearest).
      const raw = ctx.gprRead(f.rn);
      ctx.vSetBytes(f.rd, packFp(intToFp(raw, true, intBits, isDouble), isDouble));
      return true;
    }
    case 0b011: {
      // UCVTF — unsigned int → fp.
      const raw = ctx.gprRead(f.rn);
      ctx.vSetBytes(f.rd, packFp(intToFp(raw, false, intBits, isDouble), isDouble));
      return true;
    }
    case 0b110: {
      // FMOV fp → gpr: copy the raw bits (no conversion).
      const bytes = ctx.vGetBytes(f.rn);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, 16);
      ctx.gprWrite(f.rd, isDouble ? dv.getBigUint64(0, true) : BigInt(dv.getUint32(0, true)));
      return true;
    }
    case 0b111: {
      // FMOV gpr → fp: copy the raw bits into the scalar register.
      const raw = ctx.gprRead(f.rn);
      const out = new Uint8Array(16);
      const dv = new DataView(out.buffer);
      if (isDouble) dv.setBigUint64(0, BigInt.asUintN(64, raw), true);
      else dv.setUint32(0, Number(BigInt.asUintN(32, raw)), true);
      ctx.vSetBytes(f.rd, out);
      return true;
    }
    default:
      return false;
  }
}

// ── NEON "three same" integer lane operations (ARM ARM C4.1.6) ─────────────
//
// 0 Q[30] U[29] 01110[28:24] size[23:22] 1[21] Rm[20:16] opcode[15:11] 1[10] Rn Rd.
// Each lane (esize = 8<<size bytes) is processed independently; Q selects the
// 64- or 128-bit vector. U disambiguates signed/unsigned or paired mnemonics.

const isNeonThreeSame = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base28_24 === 0b01110 &&
  f.bit21 === 1 &&
  ((f.insn >>> 10) & 1) === 1; // bit[10]=1 marks the three-same family

/**
 * Dispatch a three-same op on (opcode[15:11], U). `size` selects lane width and,
 * for the logical opcode 00011, also selects AND/BIC/ORR/ORN (U=0) or
 * EOR/BSL/… (U=1). Returns false for opcodes not yet modelled so the engine
 * still reports the raw opcode honestly.
 */
function execNeonThreeSame(ctx: SimdContext, f: SimdFields): boolean {
  const { rd, rn, rm, size, q, u } = f;
  const a = ctx.vGetBytes(rn);
  const b = ctx.vGetBytes(rm);

  switch (f.neonOpcode) {
    case 0b00001: // SQADD (U=0) / UQADD (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonSqadd(a, b, size, q) : neonUqadd(a, b, size, q));
      return true;
    case 0b00101: // SQSUB (U=0) / UQSUB (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonSqsub(a, b, size, q) : neonUqsub(a, b, size, q));
      return true;
    case 0b00011: {
      // Bitwise logical: size (and U) pick the exact operation.
      if (u === 0) {
        switch (size) {
          case 0b00:
            ctx.vSetBytes(rd, neonAnd(a, b, q));
            return true;
          case 0b01:
            ctx.vSetBytes(rd, neonBic(a, b, q));
            return true;
          case 0b10:
            ctx.vSetBytes(rd, neonOrr(a, b, q));
            return true;
          default:
            ctx.vSetBytes(rd, neonOrn(a, b, q));
            return true;
        }
      }
      // U=1: EOR (size 00), BSL (01); BIT/BIF (10/11) not yet modelled.
      if (size === 0b00) {
        ctx.vSetBytes(rd, neonEor(a, b, q));
        return true;
      }
      if (size === 0b01) {
        ctx.vSetBytes(rd, neonBsl(ctx.vGetBytes(rd), a, b, q));
        return true;
      }
      return false;
    }
    case 0b10000: // ADD (U=0) / SUB (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonAdd(a, b, size, q) : neonSub(a, b, size, q));
      return true;
    case 0b10011: // MUL (U=0); PMUL (U=1) not yet modelled
      if (u === 0) {
        ctx.vSetBytes(rd, neonMul(a, b, size, q));
        return true;
      }
      return false;
    case 0b00110: // CMGT (U=0) / CMHI (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonCmgt(a, b, size, q) : neonCmhi(a, b, size, q));
      return true;
    case 0b00111: // CMGE (U=0) / CMHS (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonCmge(a, b, size, q) : neonCmhs(a, b, size, q));
      return true;
    case 0b10001: // CMTST (U=0) / CMEQ (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonCmtst(a, b, size, q) : neonCmeq(a, b, size, q));
      return true;
    case 0b01100: // SMAX (U=0) / UMAX (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonSmax(a, b, size, q) : neonUmax(a, b, size, q));
      return true;
    case 0b01101: // SMIN (U=0) / UMIN (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonSmin(a, b, size, q) : neonUmin(a, b, size, q));
      return true;
    default:
      return false;
  }
}

// ── NEON two-register miscellaneous (single source, per-lane transform) ────
// 0 Q U 01110 size 10000 opcode[16:12] 10 Rn Rd.
const isNeonTwoRegMisc = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base28_24 === 0b01110 &&
  f.field21_17 === 0b10000 &&
  f.low11_10 === 0b10;

function execNeonTwoRegMisc(ctx: SimdContext, f: SimdFields): boolean {
  const { rd, rn, size, q, u } = f;
  const a = ctx.vGetBytes(rn);
  switch (f.neonOp16_12) {
    case 0b00000: // REV64
      ctx.vSetBytes(rd, neonRev(a, 8, q));
      return true;
    case 0b00001: // REV16
      ctx.vSetBytes(rd, neonRev(a, 2, q));
      return true;
    case 0b00010: // REV32 (U=1) — bits distinguish; here opcode 00010 with U as needed
      ctx.vSetBytes(rd, neonRev(a, 4, q));
      return true;
    case 0b00100: // CLZ
      ctx.vSetBytes(rd, neonClz(a, size, q));
      return true;
    case 0b00101: // CNT (U=0) / NOT (U=1, size=00)
      ctx.vSetBytes(rd, u === 0 ? neonCnt(a, q) : neonNot(a, q));
      return true;
    case 0b01011: // ABS (U=0) / NEG (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonAbs(a, size, q) : neonNeg(a, size, q));
      return true;
    case 0b01001: // CMEQ #0 (U=0)
      if (u === 0) {
        ctx.vSetBytes(rd, neonCmeqZero(a, size, q));
        return true;
      }
      return false;
    default:
      return false;
  }
}

// ── NEON across-lanes reductions ───────────────────────────────────────────
// 0 Q U 01110 size 11000 opcode[16:12] 10 Rn Rd.
const isNeonAcross = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base28_24 === 0b01110 &&
  f.field21_17 === 0b11000 &&
  f.low11_10 === 0b10;

function execNeonAcross(ctx: SimdContext, f: SimdFields): boolean {
  const { rd, rn, size, q, u } = f;
  const a = ctx.vGetBytes(rn);
  switch (f.neonOp16_12) {
    case 0b11011: // ADDV
      ctx.vSetBytes(rd, neonAddv(a, size, q));
      return true;
    case 0b01010: // SMAXV (U=0) / UMAXV (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonSmaxv(a, size, q) : neonUmaxv(a, size, q));
      return true;
    case 0b11010: // SMINV (U=0) / UMINV (U=1)
      ctx.vSetBytes(rd, u === 0 ? neonSminv(a, size, q) : neonUminv(a, size, q));
      return true;
    default:
      return false;
  }
}

// ── NEON copy: DUP element/general, INS ────────────────────────────────────
// 0 Q op 01110000 imm5 0 imm4 1 Rn Rd.  imm5 trailing-zero count picks size.
const isNeonCopy = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  ((f.insn >>> 21) & 0b11111111) === 0b01110000 &&
  ((f.insn >>> 10) & 1) === 1;

/** Decode the copy `imm5` field → [size, index] (size = trailing-zero position). */
function decodeCopyImm5(imm5: number): { size: number; index: number } | null {
  if ((imm5 & 0b1) === 1) return { size: 0, index: imm5 >> 1 };
  if ((imm5 & 0b11) === 0b10) return { size: 1, index: imm5 >> 2 };
  if ((imm5 & 0b111) === 0b100) return { size: 2, index: imm5 >> 3 };
  if ((imm5 & 0b1111) === 0b1000) return { size: 3, index: imm5 >> 4 };
  return null;
}

function execNeonCopy(ctx: SimdContext, f: SimdFields): boolean {
  const dec = decodeCopyImm5(f.imm5);
  if (!dec) return false;
  const { size, index } = dec;
  // op=0, imm4=0000 → DUP (element); imm4=0001 → DUP (general, from GPR).
  if (f.op29 === 0 && f.imm4 === 0b0000) {
    ctx.vSetBytes(f.rd, neonDupElement(ctx.vGetBytes(f.rn), size, index, f.q));
    return true;
  }
  if (f.op29 === 0 && f.imm4 === 0b0001) {
    ctx.vSetBytes(f.rd, neonDupGeneral(ctx.gprRead(f.rn), size, f.q));
    return true;
  }
  return false; // INS and other copy forms not yet modelled
}

// ── NEON modified immediate: MOVI/MVNI/ORR/BIC (vector, immediate) ─────────
// 0 Q op 0111100000 abc[18:16] cmode[15:12] o2[11] 1 defgh[9:5] Rd.
const isNeonModImm = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 && f.base28_19 === 0b0111100000 && ((f.insn >>> 10) & 1) === 1;

function execNeonModImm(ctx: SimdContext, f: SimdFields): boolean {
  const abc = (f.insn >>> 16) & 0b111;
  const defgh = (f.insn >>> 5) & 0b11111;
  const imm8 = (abc << 5) | defgh;
  const cmode = f.cmode;
  const op = f.op29;
  // FMOV (vector) lives at cmode=1111 op=0; leave it to a future FP-immediate path.
  if (cmode === 0b1111 && op === 0) return false;

  const imm64 = advSimdExpandImm(op, cmode, imm8);
  const lanes = (value: bigint): bigint[] => Array.from({ length: f.q === 1 ? 2 : 1 }, () => value);
  // cmode<0> is the "logical / inverted" selector within each cmode group:
  //   op=0 cmode<0>=0 → MOVI ; op=0 cmode<0>=1 → ORR (Vd |= imm)
  //   op=1 cmode<0>=0 → MVNI ; op=1 cmode<0>=1 → BIC (Vd &= ~imm)
  const cmodeLo = cmode & 1;

  if (op === 0 && cmodeLo === 0) {
    ctx.vSetBytes(f.rd, neonPackLanes(lanes(imm64), 3));
    return true; // MOVI
  }
  if (op === 1 && cmodeLo === 0) {
    ctx.vSetBytes(f.rd, neonPackLanes(lanes(~imm64 & 0xffff_ffff_ffff_ffffn), 3));
    return true; // MVNI
  }
  // ORR / BIC read-modify the destination, OR-ing or AND-NOT-ing the immediate.
  const cur = ctx.vGetBytes(f.rd);
  const dv = new DataView(cur.buffer, cur.byteOffset, 16);
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  const apply = (lane: bigint): bigint =>
    op === 0 ? lane | imm64 : lane & (~imm64 & 0xffff_ffff_ffff_ffffn);
  odv.setBigUint64(0, apply(dv.getBigUint64(0, true)), true);
  if (f.q === 1) odv.setBigUint64(8, apply(dv.getBigUint64(8, true)), true);
  ctx.vSetBytes(f.rd, out);
  return true;
}

// ── NEON shift by immediate: SHL / USHR / SSHR ─────────────────────────────
// 0 Q U 011110 immh[22:19] immb[18:16] opcode[15:11] 1 Rn Rd.  immh!=0000.
const isNeonShiftImm = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  ((f.insn >>> 23) & 0b111111) === 0b011110 &&
  f.immh !== 0b0000 &&
  ((f.insn >>> 10) & 1) === 1;

/** Highest set bit position of immh (1..3) selects the element size. */
function shiftSize(immh: number): number {
  if (immh & 0b1000) return 3;
  if (immh & 0b0100) return 2;
  if (immh & 0b0010) return 1;
  return 0;
}

function execNeonShiftImm(ctx: SimdContext, f: SimdFields): boolean {
  const size = shiftSize(f.immh);
  const esize = 8 << size;
  const immhb = (f.immh << 3) | f.immb;
  const a = ctx.vGetBytes(f.rn);
  const opcode = (f.insn >>> 11) & 0b11111;
  // SHL: shift = immhb - esize ; right shifts: shift = 2*esize - immhb.
  switch (opcode) {
    case 0b01010: {
      // SHL
      const shift = immhb - esize;
      ctx.vSetBytes(f.rd, neonShl(a, size, shift, f.q));
      return true;
    }
    case 0b00000: {
      // SSHR (U=0) / USHR (U=1)
      const shift = 2 * esize - immhb;
      ctx.vSetBytes(
        f.rd,
        f.u === 0 ? neonSshr(a, size, shift, f.q) : neonUshr(a, size, shift, f.q),
      );
      return true;
    }
    default:
      return false;
  }
}

// ── NEON EXT: extract a byte window from Rn:Rm ─────────────────────────────
// 0 Q 101110 00 0 Rm 0 imm4[14:11] 0 Rn Rd.
const isNeonExt = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base29_24 === 0b101110 &&
  ((f.insn >>> 22) & 0b11) === 0b00 &&
  f.bit21 === 0 &&
  ((f.insn >>> 15) & 1) === 0 &&
  ((f.insn >>> 10) & 1) === 0;

function execNeonExt(ctx: SimdContext, f: SimdFields): boolean {
  ctx.vSetBytes(f.rd, neonExt(ctx.vGetBytes(f.rn), ctx.vGetBytes(f.rm), f.imm4, f.q));
  return true;
}

// ── NEON permute: ZIP/UZP/TRN ──────────────────────────────────────────────
// 0 Q 001110 size 0 Rm 0 opcode[14:12] 10 Rn Rd.
const isNeonPermute = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base29_24 === 0b001110 &&
  f.bit21 === 0 &&
  ((f.insn >>> 15) & 1) === 0 &&
  f.low11_10 === 0b10;

function execNeonPermute(ctx: SimdContext, f: SimdFields): boolean {
  const { rd, rn, rm, size, q } = f;
  const a = ctx.vGetBytes(rn);
  const b = ctx.vGetBytes(rm);
  switch (f.neonOp14_12) {
    case 0b001: // UZP1
      ctx.vSetBytes(rd, neonUzp(a, b, size, q, 0));
      return true;
    case 0b101: // UZP2
      ctx.vSetBytes(rd, neonUzp(a, b, size, q, 1));
      return true;
    case 0b010: // TRN1
      ctx.vSetBytes(rd, neonTrn(a, b, size, q, 0));
      return true;
    case 0b110: // TRN2
      ctx.vSetBytes(rd, neonTrn(a, b, size, q, 1));
      return true;
    case 0b011: // ZIP1
      ctx.vSetBytes(rd, neonZip(a, b, size, q, 0));
      return true;
    case 0b111: // ZIP2
      ctx.vSetBytes(rd, neonZip(a, b, size, q, 1));
      return true;
    default:
      return false;
  }
}

// ── NEON TBL/TBX: table lookup ─────────────────────────────────────────────
// 0 Q 001110 000 Rm 0 len[14:13] tbx[12] 00 Rn Rd.
const isNeonTable = (f: SimdFields): boolean =>
  ((f.insn >>> 31) & 1) === 0 &&
  f.base29_24 === 0b001110 &&
  ((f.insn >>> 21) & 0b111) === 0b000 &&
  ((f.insn >>> 15) & 1) === 0 &&
  f.low11_10 === 0b00;

function execNeonTable(ctx: SimdContext, f: SimdFields): boolean {
  // Build the table from `len`+1 consecutive registers starting at Rn.
  const count = f.len + 1;
  const table = new Uint8Array(count * 16);
  for (let i = 0; i < count; i++) {
    const reg = (f.rn + i) % 32;
    table.set(ctx.vGetBytes(reg).subarray(0, 16), i * 16);
  }
  ctx.vSetBytes(f.rd, neonTbl(table, ctx.vGetBytes(f.rm), f.q, ctx.vGetBytes(f.rd), f.tbx === 1));
  return true;
}

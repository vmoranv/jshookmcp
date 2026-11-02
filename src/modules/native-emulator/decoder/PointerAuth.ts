/**
 * PointerAuth — ARMv8.3-A Pointer Authentication (PAC) instruction family.
 *
 * Four entry encodings arrive here:
 *
 * - PAC/AUT register form (via the Data Processing -- Register dispatch; the
 *   encoding sits in the 1-source window, bits[30:21] = 1x11010110, with the
 *   opcode2 field bits[20:16] fixed to 00001):
 *     1101 1010 1100 0001 | op[2:0] | Rn | Rd   (base 0xDAC10000, mask 0xFFFFE000)
 *     op bits[12:10]: 0 PACIA, 1 PACIB, 2 PACDA, 3 PACDB,
 *                     4 AUTIA, 5 AUTIB, 6 AUTDA, 7 AUTDB.
 *     Rn bits[9:5] = modifier register (31 = SP) — `PACIA <Xd>, <Xn|SP>`;
 *     Rd bits[4:0] = the pointer, signed/authenticated in place (also dest).
 *     Verified against capstone 5.0.7: 0xDAC10043 `pacia x3, x2`,
 *     0xDAC11043 `autia x3, x2`, 0xDAC103E0 `pacia x0, sp`. bits[20:16] is a
 *     fixed 00001, NOT a register field (words like 0xDAC30041 are unallocated).
 *
 * - PACGA (3-source form; its own base 0x9AC03000 / mask 0xFFE0FC00):
 *     1 0011010 110 | Rm | 001100 | Rn | Rd
 *     Rm bits[20:16] = modifier (31 = SP), Rn bits[9:5] = pointer, Rd = dest.
 *     Writes the FULL 64-bit QARMA5 output (no 8-bit truncation).
 *
 * - HINT form (bits[28:25] = 101x → Branches, Exception Generating and System):
 *     1101 0101 0000 0011 0010 CRm op2 11111   (NOP-family prefix 0xD5032xxxF)
 *     CRm=3, op2 0..7: paciaz/paciasp/pacibz/pacibsp/autiaz/autiasp/autibz/
 *     autibsp — LR pointer, modifier XZR (even op2) or SP (odd op2).
 *     CRm=1, even op2: pacia1716/pacib1716/autia1716/autib1716 — X17 pointer,
 *     X16 modifier. CRm=0, op2=7: xpaclri.
 *
 * - XPACI/XPACD (register-strip variants, Data Processing -- 1-source window;
 *   implemented in execXpac, dispatched ahead of the generic 1-source block):
 *     XPACI <Xd> = 0xDAC143E0 | Xd, XPACD <Xd> = 0xDAC147E0 | Xd
 *     (mask 0xFFFFFFE0 each; bits[15:10] = 01000D, bits[9:5] fixed 11111,
 *     Rd = bits[4:0]). Verified against capstone 5.0.7: 0xDAC143E5 `xpaci x5`,
 *     0xDAC147E0 `xpacd x0`. Unverified in-place strip of Rd — no modifier, no
 *     key, no diag (Rd=31 writes XZR, discarded).
 *
 * - Still intentionally safe-NOP: the 8 zero-modifier register forms
 *   paciza/pacizb/pacdza/pacdzb/autiza/autizb/autdza/autdzb (1-source opcode
 *   bits[15:10] = 001000..001111, Rn=11111 fixed, 32 words each — capstone
 *   5.0.7 verified, e.g. 0xDAC123E5 `paciza x5`). They fall past both the
 *   0xDAC1 register-form guard and the XPACI masks into the 1-source switch
 *   default → NOP. Mainstream toolchains rarely emit them; the commonly used
 *   zero-modifier forms are covered by the HINT-page paciaz/autiaz (CRm=3)
 *   family.
 *
 * The PAC value is the QARMA5 cipher (ARM DDI 0487 C5.1.1) — a tweakable
 * 4-round-reflector Feistel over a 64-bit block (16 4-bit cells), keyed by a
 * 128-bit key (w0 || k0), with the modifier as the tweak. This implementation is
 * a faithful TypeScript port of the public reference implementation
 * (https://github.com/dkales/qarma64-python, qarma.py), verified against its
 * official-style test vectors (rounds=5, S-box 0 → ciphertext 3ee99a6c82af0c38).
 *
 * Cell layout follows the reference: a 64-bit value packs 16 nibbles BIG-endian
 * at the cell level — cell 0 = bits[63:60], cell 15 = bits[3:0]. toNibbles()
 * produces index 0 = most-significant nibble so the algorithm reads identically
 * to the Python `HexToBlock` (string left-to-right = cell 0 → cell 15).
 */

import type { ExecutionContext } from '../cpu/ExecutionContext';

/** Per-engine PAC key set. IA/IB for PACIA/PACIB/AUTIA/AUTIB, DA/DB for
 *  PACDA/PACDB/AUTDA/AUTDB, GA for PACGA. */
export interface PacKeys {
  /** 128-bit key as a 32-hex-char string (w0[0..15] || k0[0..15]). */
  ia: string;
  ib: string;
  da: string;
  db: string;
  /** 128-bit GA key used by PACGA (generic address generate). */
  ga: string;
}

// ── QARMA5 constants (S-box 0, M4,2, 64-bit block) ──────────────────────────

const SBOX = [0, 14, 2, 10, 9, 15, 8, 11, 6, 4, 3, 7, 13, 12, 1, 5];
const SBOX_INV = (() => {
  const inv = Array.from({ length: 16 }) as number[];
  for (let i = 0; i < 16; i++) inv[SBOX[i]!] = i;
  return inv;
})();

const STATE_PERM = [0, 11, 6, 13, 10, 1, 12, 7, 5, 14, 3, 8, 15, 4, 9, 2];
const STATE_PERM_INV = (() => {
  const inv = Array.from({ length: 16 }) as number[];
  for (let i = 0; i < 16; i++) inv[STATE_PERM[i]!] = i;
  return inv;
})();
const TWEAK_PERM = [6, 5, 14, 15, 0, 1, 2, 3, 7, 12, 13, 4, 8, 9, 10, 11];

const ALPHA = hexToNibbles('C0AC29B7C97C50DD');
const ROUND_CONSTANTS = [
  '0000000000000000',
  '13198A2E03707344',
  'A4093822299F31D0',
  '082EFA98EC4E6C89',
  '452821E638D01377',
  'BE5466CF34E90C6C',
  '3F84D5B5B5470917',
  '9216D5D98979FB1B',
].map(hexToNibbles);

const QARMA_ROUNDS = 5; // ARMv8.3 silicon uses r=5 ("QARMA5").

// ── nibble-array <-> 64-bit BigInt helpers ──────────────────────────────────
// index 0 = most-significant nibble (matches Python HexToBlock left-to-right).

function hexToNibbles(hex: string): number[] {
  const clean = hex.toLowerCase().replace(/^0x/, '');
  const nibbles: number[] = [];
  for (const ch of clean) nibbles.push(parseInt(ch, 16));
  return nibbles;
}

function u64ToNibbles(v: bigint): number[] {
  const nibbles = Array.from({ length: 16 }, () => 0);
  for (let i = 0; i < 16; i++) {
    nibbles[15 - i] = Number((v >> BigInt(i * 4)) & 0xfn);
  }
  return nibbles;
}

function nibblesToU64(nibbles: number[]): bigint {
  let v = 0n;
  for (let i = 0; i < 16; i++) v |= BigInt(nibbles[i]! & 0xf) << BigInt((15 - i) * 4);
  return v & ((1n << 64n) - 1n);
}

// ── QARMA5 primitives (ported verbatim from qarma.py) ───────────────────────

function subBytes(state: number[], inverse: boolean): number[] {
  const s = inverse ? SBOX_INV : SBOX;
  return state.map((b) => s[b]!);
}

function xorBlocks(a: number[], b: number[]): number[] {
  return a.map((x, i) => x ^ b[i]!);
}

/** 4-bit rotate LEFT by r (QARMA MixColumns uses left rotation). */
function rot4(b: number, r: number): number {
  r &= 3;
  return (((b << r) | (b >> (4 - r))) & 0xf) % 16;
}

/** MixColumns (M4,2) applied column-wise: incol = [state[i], state[4+i], state[8+i], state[12+i]]. */
function mixColumns(state: number[]): number[] {
  const out = Array.from({ length: 16 }, () => 0);
  for (let i = 0; i < 4; i++) {
    const c0 = state[0 + i]!;
    const c1 = state[4 + i]!;
    const c2 = state[8 + i]!;
    const c3 = state[12 + i]!;
    out[0 + i] = rot4(c1, 1) ^ rot4(c2, 2) ^ rot4(c3, 1);
    out[4 + i] = rot4(c0, 1) ^ rot4(c2, 1) ^ rot4(c3, 2);
    out[8 + i] = rot4(c0, 2) ^ rot4(c1, 1) ^ rot4(c3, 1);
    out[12 + i] = rot4(c0, 1) ^ rot4(c1, 2) ^ rot4(c2, 1);
  }
  return out;
}

function permuteState(state: number[], inverse: boolean): number[] {
  const p = inverse ? STATE_PERM_INV : STATE_PERM;
  return state.map((_, i) => state[p[i]!]!);
}

function permuteTweak(tweak: number[]): number[] {
  return tweak.map((_, i) => tweak[TWEAK_PERM[i]!]!);
}

/** LFSR ω (m=4) applied to cells {0,1,3,4,8,11,13}: (b3,b2,b1,b0) → (b0^b1, b3, b2, b1). */
function tweakLfsrForward(nibbles: number[]): number[] {
  for (const b of [0, 1, 3, 4, 8, 11, 13]) {
    const t = nibbles[b]!;
    const b3 = (t >> 3) & 1;
    const b2 = (t >> 2) & 1;
    const b1 = (t >> 1) & 1;
    const b0 = (t >> 0) & 1;
    nibbles[b] = ((b0 ^ b1) << 3) | (b3 << 2) | (b2 << 1) | b1;
  }
  return nibbles;
}

function calcTweak(tweak: number[], r: number): number[] {
  let t = tweak.slice();
  for (let i = 0; i < r; i++) {
    t = permuteTweak(t);
    t = tweakLfsrForward(t);
  }
  return t;
}

function calcRoundTweakey(tweak: number[], r: number, k0: number[], backwards: boolean): number[] {
  let tk = calcTweak(tweak, r);
  tk = xorBlocks(tk, k0);
  tk = xorBlocks(tk, ROUND_CONSTANTS[r]!);
  if (backwards) tk = xorBlocks(tk, ALPHA);
  return tk;
}

function roundForward(state: number[], tweakey: number[], r: number): number[] {
  let s = xorBlocks(state, tweakey);
  if (r !== 0) {
    s = permuteState(s, false);
    s = mixColumns(s);
  }
  s = subBytes(s, false);
  return s;
}

function roundBackward(state: number[], tweakey: number[], r: number): number[] {
  let s = subBytes(state, true);
  if (r !== 0) {
    s = mixColumns(s);
    s = permuteState(s, true);
  }
  s = xorBlocks(s, tweakey);
  return s;
}

function middleRound(state: number[], k1: number[]): number[] {
  let s = permuteState(state, false);
  s = mixColumns(s);
  s = xorBlocks(s, k1);
  s = permuteState(s, true);
  return s;
}

/**
 * QARMA5 encryption over a 64-bit block. Mirrors qarma.py `qarma64(encrypt=True)`.
 * `keyHex` = w0[16 hex] || k0[16 hex] (32 hex chars = 128 bits).
 */
export function qarma5Encrypt(plaintext: bigint, tweak: bigint, keyHex: string): bigint {
  const w0 = u64ToNibbles(BigInt('0x' + keyHex.slice(0, 16)));
  const w0Int = BigInt('0x' + keyHex.slice(0, 16));
  const w1Int = (((w0Int >> 1n) | ((w0Int & 1n) << 63n)) ^ (w0Int >> 63n)) & ((1n << 64n) - 1n);
  const w1 = u64ToNibbles(w1Int);
  const k0 = u64ToNibbles(BigInt('0x' + keyHex.slice(16, 32)));
  const k1 = k0; // encryption: k1 = k0
  const p = u64ToNibbles(plaintext);
  const t = u64ToNibbles(tweak);

  let state = xorBlocks(p, w0);
  for (let i = 0; i < QARMA_ROUNDS; i++) {
    state = roundForward(state, calcRoundTweakey(t, i, k0, false), i);
  }
  const tweakR = calcTweak(t, QARMA_ROUNDS);
  state = roundForward(state, xorBlocks(w1, tweakR), QARMA_ROUNDS);
  state = middleRound(state, k1);
  state = roundBackward(state, xorBlocks(w0, tweakR), QARMA_ROUNDS);
  for (let i = QARMA_ROUNDS - 1; i >= 0; i--) {
    state = roundBackward(state, calcRoundTweakey(t, i, k0, true), i);
  }

  const cipher = xorBlocks(state, w1);
  return nibblesToU64(cipher);
}

// ── PAC field placement (ARM ARM C5.1.5) ────────────────────────────────────
// For a canonical 48-bit VA the PAC occupies bits[55:48] (8 bits, top byte unused
// after the bottom-8 extension bits). We truncate the 64-bit QARMA output to a
// PAC field and place it there; XPAC strips it without verification.

const PAC_LSB = 48n;
const PAC_MASK = 0x00ff000000000000n;
/** Cipher plaintext mask: the pointer's canonical 48 address bits only. */
const POINTER_PLAINTEXT_MASK = 0x0000ffffffffffffn;
const MASK64 = (1n << 64n) - 1n;

function insertPac(pointer: bigint, pac: bigint): bigint {
  return (pointer & ~PAC_MASK & MASK64) | ((pac << PAC_LSB) & PAC_MASK);
}
function extractPac(pointer: bigint): bigint {
  return (pointer & PAC_MASK) >> PAC_LSB;
}
function stripPac(pointer: bigint): bigint {
  return pointer & ~PAC_MASK & MASK64;
}

/**
 * Compute the 8-bit PAC field for (key, modifier, pointer).
 * The modifier is duplicated 32→64 (ARM PAC convention) before being used as the
 * QARMA tweak. The plaintext is the pointer's canonical 48 address bits (both
 * the PAC field at bits[55:48] and the unused high byte at bits[63:56] are
 * cleared), so signing is idempotent and independent of prior PAC-field or
 * high-byte content. The full 64-bit cipher output is truncated to the PAC
 * field width (bits[55:48]).
 */
function computePacField(keyHex: string, modifier: bigint, pointer: bigint): bigint {
  const dup = ((modifier & 0xffffffffn) | ((modifier & 0xffffffffn) << 32n)) & MASK64;
  const cipher = qarma5Encrypt(pointer & POINTER_PLAINTEXT_MASK, dup, keyHex);
  // Truncate to 16 bits then mask to the 8-bit field we place at bits[55:48].
  return (cipher >> 48n) & 0xffn;
}

// ── Engine-side PAC key holder ──────────────────────────────────────────────
// The ExecutionContext passed by CpuEngine carries pacKeys (initialized in the
// engine constructor) — no fallback needed; the engine always owns a key set.
interface CpuEnginePacContext extends ExecutionContext {
  pacKeys: PacKeys;
  setPacKeys?(keys: PacKeys): void;
  /** Bounded sink for AUT mismatch diagnostics (implemented by CpuEngine). */
  recordPacMismatch?(entry: string): void;
}

/** Key-slot select: 0 = IA, 1 = IB, 2 = DA, 3 = DB (register-form opcode bits[1:0]). */
function keyHexFor(keys: PacKeys, select: number): string {
  if (select === 1) return keys.ib;
  if (select === 2) return keys.da;
  if (select === 3) return keys.db;
  return keys.ia;
}

function diag(ctx: CpuEnginePacContext, msg: string): void {
  // AUT mismatch sink — informational in the reverse-engineering workflow, not
  // fatal (the strip-anyway policy keeps control flow alive). Routed to the
  // engine's bounded PAC mismatch log, surfaced as nemu_trace pacMismatches.
  ctx.recordPacMismatch?.(msg);
}

/** Register-family mnemonics indexed by opcode bits[12:10] (diag labels match
 *  disassembler output so trace lines and disasm rows cross-grep). */
const PAC_REGISTER_MNEMONICS = [
  'pacia',
  'pacib',
  'pacda',
  'pacdb',
  'autia',
  'autib',
  'autda',
  'autdb',
] as const;

/**
 * Try to execute a PAC/AUT register-form instruction. Returns true if handled.
 *
 * Real ARMv8.3 encoding (capstone 5.0.7 verified): the family sits in the Data
 * Processing (1 source) window (bits[30:21] = 1x11010110) with the opcode2
 * field bits[20:16] fixed to 00001, so it must be intercepted before the
 * 1-source RBIT/REV/CLZ block — a real `pacia x3, x2` (0xDAC10043) has
 * opcode bits[15:10] = 000000 and otherwise executes as RBIT (silent corruption).
 *
 *     guard: (insn & 0xFFFFE000) === 0xDAC10000
 *     op bits[12:10]: 0 PACIA, 1 PACIB, 2 PACDA, 3 PACDB,
 *                     4 AUTIA, 5 AUTIB, 6 AUTDA, 7 AUTDB
 *     Rn bits[9:5] = modifier register (31 = SP) — `PACIA <Xd>, <Xn|SP>`
 *     Rd bits[4:0] = pointer, signed/authenticated in place (also destination)
 */
export function execPointerAuth3Source(ctx: ExecutionContext, insn: number): boolean {
  if ((insn & 0xffffe000) >>> 0 !== 0xdac10000) return false;
  const opcode = (insn >>> 10) & 0b111;
  const rn = (insn >>> 5) & 0b11111;
  const rd = insn & 0b11111;

  // Key select = opcode bits[1:0] (0 IA, 1 IB, 2 DA, 3 DB); bit2 selects AUT.
  const isAut = (opcode & 0b100) !== 0;
  const engine = ctx as CpuEnginePacContext;
  const keyHex = keyHexFor(engine.pacKeys, opcode & 0b11);

  // Modifier: Rn field, encoding 31 = SP. Pointer: Rd, signed in place.
  const modifier = rn === 31 ? ctx.readGprSp(31) : ctx.readGpr(rn);
  const pointer = ctx.readGpr(rd);

  if (isAut) {
    const stored = extractPac(pointer);
    const expected = computePacField(keyHex, modifier, pointer);
    if (stored !== expected) {
      diag(
        engine,
        `${PAC_REGISTER_MNEMONICS[opcode]} mismatch at pc=0x${ctx.pc.toString(16)} stored=${stored.toString(16)} expected=${expected.toString(16)}`,
      );
    }
    // Verify-and-strip: real hardware faults on mismatch; here we strip to keep
    // control flow alive for the reverse engineer (the PAC round-trips in every
    // self-consistent case anyway).
    ctx.writeGpr(rd, stripPac(pointer));
  } else {
    const pac = computePacField(keyHex, modifier, pointer);
    ctx.writeGpr(rd, insertPac(stripPac(pointer), pac));
  }
  return true;
}

/**
 * PACGA digest: the FULL 64-bit QARMA5 cipher output (no truncation to the
 * 8-bit PAC field — PACGA writes the whole cipher to Rd). Plaintext/tweak use
 * the same canonical masking as computePacField: the pointer's 48 address bits
 * and the modifier duplicated 32→64.
 */
function pacgaDigest(pointer: bigint, modifier: bigint, keyHex: string): bigint {
  const dup = ((modifier & 0xffffffffn) | ((modifier & 0xffffffffn) << 32n)) & MASK64;
  return qarma5Encrypt(pointer & POINTER_PLAINTEXT_MASK, dup, keyHex);
}

/**
 * Try to execute PACGA (pointer authenticate generic address). Returns true if
 * handled. Encoding (base 0x9AC03000, mask 0xFFE0FC00):
 *     Rm bits[20:16] = modifier register (31 = SP)
 *     Rn bits[9:5]   = pointer register
 *     Rd bits[4:0]   = destination — receives the FULL 64-bit QARMA5 output.
 */
export function execPacga(ctx: ExecutionContext, insn: number): boolean {
  if ((insn & 0xffe0fc00) >>> 0 !== 0x9ac03000) return false;
  const rm = (insn >>> 16) & 0b11111;
  const rn = (insn >>> 5) & 0b11111;
  const rd = insn & 0b11111;
  const modifier = rm === 31 ? ctx.readGprSp(31) : ctx.readGpr(rm);
  const pointer = ctx.readGpr(rn);
  ctx.writeGpr(rd, pacgaDigest(pointer, modifier, (ctx as CpuEnginePacContext).pacKeys.ga));
  return true;
}

/**
 * Try to execute XPACI/XPACD (unverified PAC strip on an arbitrary register).
 * Returns true if handled. Encoding (capstone 5.0.7 verified):
 *     XPACI <Xd> = 0xDAC143E0 | Xd   (mask 0xFFFFFFE0)
 *     XPACD <Xd> = 0xDAC147E0 | Xd   (mask 0xFFFFFFE0)
 * both in the Data Processing -- 1-source window with bits[15:10] = 01000D
 * (D = bit10), bits[9:5] fixed 11111, Rd = bits[4:0]. Same strip-anywhere
 * semantics as XPACLRI (PointerAuth HINT page) but the target is Rd instead of
 * the fixed x30: no modifier, no key, no verification, no diag. Rd=31 writes
 * XZR (discarded — harmless). e.g. 0xDAC143E5 `xpaci x5`, 0xDAC147E0 `xpacd x0`.
 */
export function execXpac(ctx: ExecutionContext, insn: number): boolean {
  const word = (insn & 0xffffffe0) >>> 0;
  if (word !== 0xdac143e0 && word !== 0xdac147e0) return false;
  const rd = insn & 0b11111;
  ctx.writeGpr(rd, stripPac(ctx.readGpr(rd)));
  return true;
}

/**
 * HINT-form PAC instructions. Returns true if the instruction was a recognised
 * HINT-space PAC opcode and was executed; false otherwise (caller falls through
 * to NOP/barrier handling).
 *
 * Real CRm/op2 map (capstone 5.0.7 verified):
 *   CRm=3, op2 0..7: paciaz/paciasp/pacibz/pacibsp/autiaz/autiasp/autibz/autibsp
 *     — pointer LR (x30, signed/authenticated in place); modifier XZR for even
 *     op2, SP for odd op2; AUT when op2 >= 4; key B when op2 & 2.
 *   CRm=1, even op2: pacia1716/pacib1716/autia1716/autib1716
 *     — pointer X17 (signed/authenticated in place), modifier X16.
 *   CRm=0, op2=7: xpaclri — strip LR without verification.
 * All other CRm/op2 combinations return false (blanket NOP handles them).
 */
export function execHintPac(ctx: ExecutionContext, insn: number): boolean {
  // HINT space prefix 0xD5032xxxF; mask aligns the CRm/op2 fields.
  if ((insn & 0xfffff01f) >>> 0 !== 0xd503201f) return false;
  const crm = (insn >>> 8) & 0xf;
  const op2 = (insn >>> 5) & 0b111;

  const engine = ctx as CpuEnginePacContext;

  // XPACLRI: 0xD50320FF (CRm=0, op2=7).
  if (crm === 0b0000 && op2 === 0b111) {
    ctx.writeGpr(30, stripPac(ctx.readGpr(30)));
    return true;
  }

  // Gate on CRm first: without it, other HINT-space encodings whose op2 lands
  // in the PAC range — YIELD (CRm=0/op2=1), WFI (op2=3), SEVL (op2=5), PSB
  // CSYNC — would be mis-executed as LR signing/auth operations instead of
  // no-ops. Only CRm=3 (zero/SP modifier family on LR) and CRm=1 (1716 family
  // on X17) are PAC opcodes.
  if (crm !== 0b0011 && crm !== 0b0001) return false;

  const isB = (op2 & 0b010) !== 0;
  const isAut = (op2 & 0b100) !== 0;
  const keyHex = keyHexFor(engine.pacKeys, isB ? 1 : 0);

  if (crm === 0b0011) {
    // LR family: modifier XZR (even op2 = "z" variants) or SP (odd op2 = "sp").
    const modifier = (op2 & 0b001) !== 0 ? ctx.readGprSp(31) : 0n;
    const lr = ctx.readGpr(30);
    if (isAut) {
      const stored = extractPac(lr);
      const expected = computePacField(keyHex, modifier, lr);
      if (stored !== expected) {
        const mnemonic = `auti${isB ? 'b' : 'a'}${(op2 & 0b001) !== 0 ? 'sp' : 'z'}`;
        diag(engine, `${mnemonic} mismatch at pc=0x${ctx.pc.toString(16)}`);
      }
      ctx.writeGpr(30, stripPac(lr));
    } else {
      const pac = computePacField(keyHex, modifier, lr);
      ctx.writeGpr(30, insertPac(stripPac(lr), pac));
    }
    return true;
  }

  // CRm=1: 1716 family — pointer X17 signed/authenticated in place, modifier
  // X16. Odd op2 is unallocated here and falls through to the blanket NOP.
  if ((op2 & 0b001) !== 0) return false;
  const pointer = ctx.readGpr(17);
  const modifier = ctx.readGpr(16);
  if (isAut) {
    const stored = extractPac(pointer);
    const expected = computePacField(keyHex, modifier, pointer);
    if (stored !== expected) {
      diag(engine, `auti${isB ? 'b' : 'a'}1716 mismatch at pc=0x${ctx.pc.toString(16)}`);
    }
    ctx.writeGpr(17, stripPac(pointer));
  } else {
    const pac = computePacField(keyHex, modifier, pointer);
    ctx.writeGpr(17, insertPac(stripPac(pointer), pac));
  }
  return true;
}

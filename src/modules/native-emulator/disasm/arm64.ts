import type { DisasmResult } from './types';

export function disassembleArm64(opcode: number, pc: bigint): string {
  const result = tryDisassemble(opcode, pc);
  if (result) {
    return `${result.mnemonic.padEnd(8)} ${result.operands}`;
  }
  return `<unknown>  0x${opcode.toString(16).padStart(8, '0')}`;
}

function tryDisassemble(insn: number, pc: bigint): DisasmResult | null {
  // ── Special cases first ──────────────────────────────────────────
  if (insn === 0xd65f03c0) return { mnemonic: 'ret', operands: '' };
  if (insn === 0xd503201f) return { mnemonic: 'nop', operands: '' };
  // BTI (Branch Target Identification) hints
  if (m(insn, 0xffffff1f, 0xd503241f)) return decodeBti(insn);

  // ── PAC HINT forms (NOP-space, check before generic NOP mask) ────
  const pacHint = decodePacHint(insn);
  if (pacHint) return pacHint;

  // ── Move register (ORR Xd, XZR, Xm) alias ───────────────────────
  // Must be checked BEFORE logical shifted register to produce the alias
  if (m(insn, 0x7fe0ffe0, 0x2a0003e0)) {
    const rm = (insn >> 16) & 0x1f;
    const rd = insn & 0x1f;
    const sf = (insn >> 31) & 1;
    const reg = sf ? 'x' : 'w';
    return { mnemonic: 'mov', operands: `${reg}${rd}, ${reg}${rm}` };
  }

  // ── System: MRS/MSR ──────────────────────────────────────────────
  if (m(insn, 0xfff00000, 0xd5300000)) return decodeMRS(insn);
  if (m(insn, 0xfff00000, 0xd5100000)) return decodeMSR(insn);

  // ── Data processing - immediate ──────────────────────────────────
  if (m(insn, 0x1f000000, 0x10000000)) return decodePCRel(insn, pc); // ADR / ADRP
  if (m(insn, 0x1f000000, 0x11000000)) return decodeAddSubImm(insn);
  if (m(insn, 0x1f800000, 0x12000000)) return decodeLogicalImm(insn);
  if (m(insn, 0x1f800000, 0x12800000)) return decodeMoveWide(insn);
  if (m(insn, 0x1f800000, 0x13000000)) return decodeBitfield(insn);

  // ── Branches ─────────────────────────────────────────────────────
  if (m(insn, 0x7c000000, 0x14000000)) return decodeBranch(insn, pc); // B and BL share bits 30-26
  if (m(insn, 0xff000010, 0x54000000)) return decodeBranchCond(insn, pc);
  if (m(insn, 0x7e000000, 0x34000000)) return decodeCBZ(insn, pc);
  if (m(insn, 0x7e000000, 0x36000000)) return decodeTBZ(insn, pc);
  // BLR / BR
  if (m(insn, 0xfffffc1f, 0xd63f0000)) {
    const rn = (insn >> 5) & 0x1f;
    return { mnemonic: 'blr', operands: `x${rn}` };
  }
  if (m(insn, 0xfffffc1f, 0xd61f0000)) {
    const rn = (insn >> 5) & 0x1f;
    return { mnemonic: 'br', operands: `x${rn}` };
  }

  // ── Data processing - register: logical (shifted register) ────────
  // Must be dispatched before loads/stores: the load/store-pair mask
  // (0x38000000 == 0x28000000) also matches ORR/ORN/ANDS-style words such as
  // 0x2a020020, while real load/store-pairs never have bits 28:24 == 01010.
  if (m(insn, 0x1f000000, 0x0a000000)) return decodeLogicalShiftedReg(insn);

  // ── Loads and stores ─────────────────────────────────────────────
  if (m(insn, 0x3b000000, 0x18000000)) return decodeLoadLiteral(insn, pc);
  if (m(insn, 0x3b000000, 0x39000000)) return decodeLoadStoreUnsigned(insn);
  if (m(insn, 0x3b200c00, 0x38200800)) return decodeLoadStoreRegOffset(insn);
  if (m(insn, 0x38000000, 0x28000000)) return decodeLoadStorePair(insn);
  if (m(insn, 0x3f000000, 0x08000000)) return decodeLoadStoreExclusive(insn);

  // ── Data processing - register ───────────────────────────────────
  if (m(insn, 0x1f200000, 0x0b000000)) return decodeAddSubShiftedReg(insn);
  if (m(insn, 0x1fe00000, 0x1a800000)) return decodeCondSelect(insn);

  // ── Pointer Authentication: register family 0xDAC1 + PACGA 0x9AC03000 ──
  // (XPACI/XPACD register strip also lives in the 0xDAC1 prefix — see the
  // xpaci/xpacd lines below; the z-register forms paciza..autdzb stay <unknown>
  // safe-NOP words.)
  if (m(insn, 0xffffe000, 0xdac10000)) return decodePacRegisterForm(insn);
  if (m(insn, 0xffe0fc00, 0x9ac03000)) return decodePacga(insn);
  // XPACI/XPACD: unverified PAC strip of Xd. Capstone-verified:
  // 0xDAC143E5 `xpaci x5`, 0xDAC147E0 `xpacd x0`, 0xDAC143FE `xpaci x30`.
  if (m(insn, 0xffffffe0, 0xdac143e0)) return { mnemonic: 'xpaci', operands: `x${insn & 0x1f}` };
  if (m(insn, 0xffffffe0, 0xdac147e0)) return { mnemonic: 'xpacd', operands: `x${insn & 0x1f}` };

  // ── FP / SIMD (scalar) ───────────────────────────────────────────
  if (m(insn, 0x1f200000, 0x0e200000) || m(insn, 0x1f200000, 0x1e200000))
    return decodeFpSimdScalar(insn);

  return null;
}

/**
 * Unsigned 32-bit pattern match — avoids JavaScript signed-32-bit mismatch
 * when bit 31 is set (e.g. BLR/B/MRS encodings where AND produces negative).
 */
function m(insn: number, mask: number, value: number): boolean {
  return (insn & mask) >>> 0 === value >>> 0;
}

// ─── ADR / ADRP ────────────────────────────────────────────────────
function decodePCRel(insn: number, pc: bigint): DisasmResult {
  const op = (insn >> 31) & 1; // 0=ADR, 1=ADRP
  const immlo = (insn >> 29) & 0x3;
  const rd = insn & 0x1f;
  const immhi = (insn >> 5) & 0x7ffff;

  const imm = (BigInt(immhi) << 2n) | BigInt(immlo);
  // Sign-extend from 21 bits
  const signBit = 1n << 20n;
  const simm = (imm ^ signBit) - signBit;

  if (op) {
    // ADRP: page-relative (shift left 12)
    const pageBase = (pc >> 12n) << 12n;
    const target = pageBase + (simm << 12n);
    return { mnemonic: 'adrp', operands: `x${rd}, 0x${target.toString(16)}` };
  }
  const target = pc + simm;
  return { mnemonic: 'adr', operands: `x${rd}, 0x${target.toString(16)}` };
}

// ─── ADD/SUB immediate ─────────────────────────────────────────────
function decodeAddSubImm(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const op = (insn >> 30) & 1;
  const s = (insn >> 29) & 1;
  const sh = (insn >> 22) & 1;
  const imm12 = (insn >> 10) & 0xfff;
  const rn = (insn >> 5) & 0x1f;
  const rd = insn & 0x1f;

  const reg = sf ? 'x' : 'w';
  const imm = sh ? imm12 << 12 : imm12;
  const mnemonic = s ? (op ? 'subs' : 'adds') : op ? 'sub' : 'add';

  return {
    mnemonic,
    operands: `${reg}${rd}, ${reg}${rn}, #${imm}`,
  };
}

// ─── Logical immediate ─────────────────────────────────────────────
function decodeLogicalImm(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const opc = (insn >> 29) & 0x3;
  const rd = insn & 0x1f;
  const rn = (insn >> 5) & 0x1f;
  const reg = sf ? 'x' : 'w';

  // Decode the immediate (N, immr, imms) into a readable value
  const immr = (insn >> 16) & 0x3f;
  const imms = (insn >> 10) & 0x3f;
  const n = (insn >> 22) & 1;
  const decoded = decodeBitmaskImmediate(n, immr, imms, sf);

  const mnemonics = ['and', 'orr', 'eor', 'ands'];
  return {
    mnemonic: mnemonics[opc] || 'logical',
    operands: `${reg}${rd}, ${reg}${rn}, #0x${decoded.toString(16)}`,
  };
}

/**
 * Decode ARM64 logical immediate bitmask (N:immr:imms).
 * Returns the actual 64-bit value.
 */
function decodeBitmaskImmediate(n: number, immr: number, imms: number, sf: number): bigint {
  // HighestSetBit(N:NOT(imms)) is a 0-based index (0..6), not a bit length.
  const nImms = ((n & 1) << 6) | (~imms & 0x3f);
  const len = 31 - Math.clz32(nImms);
  if (len < 1 || (sf === 0 && n !== 0)) return 0n;
  const levels = (1 << len) - 1;
  const s = imms & levels;
  const r = immr & levels;
  const size = 1 << len;
  // Create replicated pattern (BigInt: s may be up to 63, so `1 << 64` would wrap).
  const dmask = (1n << BigInt(s + 1)) - 1n;
  const welem = dmask;
  let elem = welem;
  // Rotate right within element
  if (r > 0) {
    const esize = BigInt(size);
    const rotR = BigInt(r);
    elem = ((elem >> rotR) | (elem << (esize - rotR))) & ((1n << BigInt(size)) - 1n);
  }
  // Replicate to fill 64 bits
  let result = 0n;
  const esize = BigInt(size);
  const full = sf ? 64n : 32n;
  for (let pos = 0n; pos < full; pos += esize) {
    result |= elem << pos;
  }
  return result;
}

// ─── MOVN / MOVZ / MOVK ────────────────────────────────────────────
function decodeMoveWide(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const opc = (insn >> 29) & 0x3;
  const hw = (insn >> 21) & 0x3;
  const imm16 = (insn >> 5) & 0xffff;
  const rd = insn & 0x1f;

  const reg = sf ? 'x' : 'w';
  const mnemonics = ['movn', 'reserved', 'movz', 'movk'];
  const shift = hw * 16;

  // Alias: MOV (wide immediate) for MOVZ
  if (opc === 2 && !shift) {
    return { mnemonic: 'mov', operands: `${reg}${rd}, #0x${imm16.toString(16)}` };
  }

  return {
    mnemonic: mnemonics[opc] || 'mov',
    operands: shift
      ? `${reg}${rd}, #0x${imm16.toString(16)}, lsl #${shift}`
      : `${reg}${rd}, #0x${imm16.toString(16)}`,
  };
}

// ─── Bitfield (UBFM / SBFM / BFM) ─────────────────────────────────
function decodeBitfield(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const opc = (insn >> 29) & 0x3;
  const immr = (insn >> 16) & 0x3f;
  const imms = (insn >> 10) & 0x3f;
  const rn = (insn >> 5) & 0x1f;
  const rd = insn & 0x1f;

  const reg = sf ? 'x' : 'w';
  const regSize = sf ? 64 : 32;

  // UBFM aliases
  if (opc === 2) {
    if (imms === regSize - 1) {
      // LSR alias: UBFM Rd, Rn, #r, #(size-1)
      return { mnemonic: 'lsr', operands: `${reg}${rd}, ${reg}${rn}, #${immr}` };
    }
    if (immr === 0) {
      // UXTB/UXTH alias
      if (imms === 7) return { mnemonic: 'uxtb', operands: `${reg}${rd}, ${reg}${rn}` };
      if (imms === 15) return { mnemonic: 'uxth', operands: `${reg}${rd}, ${reg}${rn}` };
    }
    // UBFX is `UBFM Rd, Rn, #lsb, #(lsb + width - 1)`, i.e. imms >= immr.
    if (imms >= immr) {
      return {
        mnemonic: 'ubfx',
        operands: `${reg}${rd}, ${reg}${rn}, #${immr}, #${imms - immr + 1}`,
      };
    }
    return { mnemonic: 'ubfm', operands: `${reg}${rd}, ${reg}${rn}, #${immr}, #${imms}` };
  }

  // SBFM aliases
  if (opc === 0) {
    if (imms === regSize - 1) {
      return { mnemonic: 'asr', operands: `${reg}${rd}, ${reg}${rn}, #${immr}` };
    }
    if (immr === 0) {
      if (imms === 7) return { mnemonic: 'sxtb', operands: `${reg}${rd}, ${reg}${rn}` };
      if (imms === 15) return { mnemonic: 'sxth', operands: `${reg}${rd}, ${reg}${rn}` };
      if (imms === 31 && sf) return { mnemonic: 'sxtw', operands: `x${rd}, w${rn}` };
    }
    return { mnemonic: 'sbfm', operands: `${reg}${rd}, ${reg}${rn}, #${immr}, #${imms}` };
  }

  // BFM aliases
  if (opc === 1) {
    return { mnemonic: 'bfm', operands: `${reg}${rd}, ${reg}${rn}, #${immr}, #${imms}` };
  }

  return { mnemonic: 'bfm', operands: `${reg}${rd}, ${reg}${rn}, #${immr}, #${imms}` };
}

// ─── Branches ──────────────────────────────────────────────────────
function decodeBranch(insn: number, pc: bigint): DisasmResult {
  const op = (insn >> 31) & 1;
  const imm26 = insn & 0x3ffffff;
  // Sign-extend 26-bit offset, then shift left 2
  const offset = BigInt(imm26 << 6) >> 4n; // sign extend 26→64, then ×4
  const target = pc + offset;

  return {
    mnemonic: op ? 'bl' : 'b',
    operands: `0x${target.toString(16)}`,
  };
}

function decodeBranchCond(insn: number, pc: bigint): DisasmResult {
  const cond = insn & 0xf;
  const imm19 = (insn >> 5) & 0x7ffff;
  const offset = BigInt.asIntN(64, BigInt(imm19) << 45n) >> 43n; // sign-extend 19 bits, ×4
  const target = pc + offset;

  const conds = [
    'eq',
    'ne',
    'cs',
    'cc',
    'mi',
    'pl',
    'vs',
    'vc',
    'hi',
    'ls',
    'ge',
    'lt',
    'gt',
    'le',
    'al',
    'nv',
  ];
  return {
    mnemonic: `b.${conds[cond]}`,
    operands: `0x${target.toString(16)}`,
  };
}

function decodeCBZ(insn: number, pc: bigint): DisasmResult {
  const sf = (insn >> 31) & 1;
  const op = (insn >> 24) & 1;
  const imm19 = (insn >> 5) & 0x7ffff;
  const rt = insn & 0x1f;
  const offset = BigInt.asIntN(64, BigInt(imm19) << 45n) >> 43n;
  const target = pc + offset;

  const reg = sf ? 'x' : 'w';
  return {
    mnemonic: op ? 'cbnz' : 'cbz',
    operands: `${reg}${rt}, 0x${target.toString(16)}`,
  };
}

function decodeTBZ(insn: number, pc: bigint): DisasmResult {
  const op = (insn >> 24) & 1;
  const b5 = insn >>> 31;
  const b40 = (insn >>> 19) & 0x1f;
  const bitPos = (b5 << 5) | b40;
  const rt = insn & 0x1f;
  const imm14 = (insn >>> 5) & 0x3fff;
  const offset = BigInt.asIntN(64, BigInt(imm14) << 48n) >> 46n;
  const target = pc + offset;
  return {
    mnemonic: op ? 'tbnz' : 'tbz',
    operands: `x${rt}, #${bitPos}, 0x${target.toString(16)}`,
  };
}

function decodeBti(insn: number): DisasmResult {
  const CRm = (insn >> 8) & 0xf;
  const op2 = (insn >> 5) & 0x7;
  if (op2 !== 0) return { mnemonic: 'hint', operands: `#0x${(insn & 0x7f).toString(16)}` };
  const targets: Record<number, string> = {
    0b0100: 'bti c',
    0b0101: 'bti j',
    0b0110: 'bti jc',
    0b0000: 'bti',
  };
  return { mnemonic: targets[CRm] ?? `hint`, operands: targets[CRm] ? '' : `#${CRm}` };
}

// ─── Loads and stores ──────────────────────────────────────────────
function decodeLoadLiteral(insn: number, pc: bigint): DisasmResult {
  const opc = (insn >> 30) & 0x3;
  const v = (insn >> 26) & 1;
  const imm19 = (insn >> 5) & 0x7ffff;
  const rt = insn & 0x1f;
  const offset = (BigInt(imm19) << 45n) >> 43n;
  const target = pc + offset;

  if (v) {
    const sizes = ['b', 'h', 's', 'd'] as const;
    return { mnemonic: 'ldr', operands: `${sizes[opc]}${rt}, 0x${target.toString(16)}` };
  }

  const sizes = ['w', 'w', 'x', 'x'] as const;
  const reg = sizes[opc];
  return { mnemonic: 'ldr', operands: `${reg}${rt}, 0x${target.toString(16)}` };
}

function decodeLoadStoreUnsigned(insn: number): DisasmResult {
  const size = (insn >> 30) & 0x3;
  const v = (insn >> 26) & 1;
  const opc = (insn >> 22) & 0x3;
  const imm12 = (insn >> 10) & 0xfff;
  const rn = (insn >> 5) & 0x1f;
  const rt = insn & 0x1f;

  if (v) return { mnemonic: 'ldr/str', operands: '<simd>' };

  const scale = size;
  const offset = imm12 << scale;
  const isLoad = opc & 1;
  const reg = size === 3 ? 'x' : 'w';

  return {
    mnemonic: isLoad ? 'ldr' : 'str',
    operands: offset ? `${reg}${rt}, [x${rn}, #${offset}]` : `${reg}${rt}, [x${rn}]`,
  };
}

function decodeLoadStoreRegOffset(insn: number): DisasmResult {
  const size = (insn >> 30) & 0x3;
  const opc = (insn >> 22) & 0x3;
  const rm = (insn >> 16) & 0x1f;
  const option = (insn >> 13) & 0x7;
  const s = (insn >> 12) & 1;
  const rn = (insn >> 5) & 0x1f;
  const rt = insn & 0x1f;

  const isLoad = opc & 1;
  const reg = size === 3 ? 'x' : 'w';
  const extend = ['uxtw', 'uxth', 'uxtb', 'sxtw', 'sxth', 'sxtb', 'lsl'][option] || 'lsl';
  const shift = s ? `#${size}` : '';

  return {
    mnemonic: isLoad ? 'ldr' : 'str',
    operands: `${reg}${rt}, [x${rn}, x${rm}${extend !== 'lsl' ? `, ${extend}` : ''}${shift ? ` ${shift}` : ''}]`,
  };
}

function decodeLoadStorePair(insn: number): DisasmResult {
  const opc = (insn >> 30) & 0x3;
  const v = (insn >> 26) & 1;
  const l = (insn >> 22) & 1;
  const imm7 = (insn >> 15) & 0x7f;
  const rt2 = (insn >> 10) & 0x1f;
  const rn = (insn >> 5) & 0x1f;
  const rt = insn & 0x1f;

  if (v) return { mnemonic: 'ldp/stp', operands: '<simd>' };

  // opc selects the access size: 00/01 → 4-byte scale 2 (01 is LDPSW), 10 → 8-byte scale 3.
  const scale = opc === 2 ? 3 : 2;
  const offset = ((imm7 << (32 - 7)) >> (32 - 7)) << scale;
  const reg = opc === 2 ? 'x' : 'w';

  return {
    mnemonic: l ? 'ldp' : 'stp',
    operands: `${reg}${rt}, ${reg}${rt2}, [x${rn}, #${offset}]`,
  };
}

function decodeLoadStoreExclusive(insn: number): DisasmResult {
  const size = (insn >> 30) & 0x3;
  const o0 = (insn >> 15) & 1;
  const l = (insn >> 22) & 1;
  const rs = (insn >> 16) & 0x1f;
  const rt = insn & 0x1f;
  const rn = (insn >> 5) & 0x1f;
  const reg = size === 3 ? 'x' : 'w';

  if (l) {
    if (o0) return { mnemonic: 'ldaxr', operands: `${reg}${rt}, [x${rn}]` };
    return { mnemonic: 'ldxr', operands: `${reg}${rt}, [x${rn}]` };
  }
  return { mnemonic: 'stxr', operands: `${reg}${rs}, ${reg}${rt}, [x${rn}]` };
}

// ─── Data processing - register ────────────────────────────────────
function decodeLogicalShiftedReg(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const opc = (insn >> 29) & 0x3;
  const shift = (insn >> 22) & 0x3;
  const rm = (insn >> 16) & 0x1f;
  const imm6 = (insn >> 10) & 0x3f;
  const rn = (insn >> 5) & 0x1f;
  const rd = insn & 0x1f;

  const reg = sf ? 'x' : 'w';
  // opc (bits 30:29) selects and/orr/eor/ands; N (bit 21) inverts the logical
  // operation (bic/orn/eon/bics).
  const n = (insn >> 21) & 1;
  const mnemonics = n
    ? (['bic', 'orn', 'eon', 'bics'] as const)
    : (['and', 'orr', 'eor', 'ands'] as const);
  const shifts = ['lsl', 'lsr', 'asr', 'ror'];

  return {
    mnemonic: mnemonics[opc] || 'logical',
    operands: imm6
      ? `${reg}${rd}, ${reg}${rn}, ${reg}${rm}, ${shifts[shift]} #${imm6}`
      : `${reg}${rd}, ${reg}${rn}, ${reg}${rm}`,
  };
}

function decodeAddSubShiftedReg(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const op = (insn >> 30) & 1;
  const s = (insn >> 29) & 1;
  const shift = (insn >> 22) & 0x3;
  const rm = (insn >> 16) & 0x1f;
  const imm6 = (insn >> 10) & 0x3f;
  const rn = (insn >> 5) & 0x1f;
  const rd = insn & 0x1f;

  const reg = sf ? 'x' : 'w';
  const mnemonic = s ? (op ? 'subs' : 'adds') : op ? 'sub' : 'add';
  const shifts = ['lsl', 'lsr', 'asr', 'reserved'];

  return {
    mnemonic,
    operands: imm6
      ? `${reg}${rd}, ${reg}${rn}, ${reg}${rm}, ${shifts[shift]} #${imm6}`
      : `${reg}${rd}, ${reg}${rn}, ${reg}${rm}`,
  };
}

function decodeCondSelect(insn: number): DisasmResult {
  const sf = (insn >> 31) & 1;
  const rm = (insn >> 16) & 0x1f;
  const cond = (insn >> 12) & 0xf;
  const op2 = (insn >> 10) & 0x3;
  const rn = (insn >> 5) & 0x1f;
  const rd = insn & 0x1f;

  const reg = sf ? 'x' : 'w';
  const mnemonics = ['csel', 'csinc', 'csinv', 'csneg'];
  const conds = [
    'eq',
    'ne',
    'cs',
    'cc',
    'mi',
    'pl',
    'vs',
    'vc',
    'hi',
    'ls',
    'ge',
    'lt',
    'gt',
    'le',
    'al',
    'nv',
  ];

  return {
    mnemonic: mnemonics[op2] || 'csel',
    operands: `${reg}${rd}, ${reg}${rn}, ${reg}${rm}, ${conds[cond]}`,
  };
}

// ─── MRS / MSR ─────────────────────────────────────────────────────
function decodeMRS(insn: number): DisasmResult {
  const rd = insn & 0x1f;
  const op1 = (insn >> 16) & 0x7;
  const crn = (insn >> 12) & 0xf;
  const crm = (insn >> 8) & 0xf;
  const op2 = (insn >> 5) & 0x7;
  const sysReg = `s${op1}_${crn}_${crm}_${op2}`;
  return { mnemonic: 'mrs', operands: `x${rd}, ${sysReg}` };
}

function decodeMSR(insn: number): DisasmResult {
  const op1 = (insn >> 16) & 0x7;
  const crn = (insn >> 12) & 0xf;
  const crm = (insn >> 8) & 0xf;
  const op2 = (insn >> 5) & 0x7;
  const rt = insn & 0x1f;
  const sysReg = `s${op1}_${crn}_${crm}_${op2}`;
  return { mnemonic: 'msr', operands: `${sysReg}, x${rt}` };
}

// ─── FP / SIMD (basic scalar) ──────────────────────────────────────
function decodeFpSimdScalar(insn: number): DisasmResult | null {
  // FP data processing (1-source): scalar 0x1e200000 / vector 0x0e200000
  if ((insn & 0x1f200000) === 0x0e200000 || (insn & 0x1f200000) === 0x1e200000) {
    const ftype = (insn >> 22) & 0x3;
    const opcode = (insn >> 12) & 0x1f;
    const rn = (insn >> 5) & 0x1f;
    const rd = insn & 0x1f;

    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';

    // FCVT (convert between float sizes)
    if (opcode === 0x04) {
      const dstFtype = (insn >> 15) & 0x3;
      const dstFr = fregs[dstFtype] || 's';
      return { mnemonic: 'fcvt', operands: `${dstFr}${rd}, ${fr}${rn}` };
    }
    // FABS
    if (opcode === 0x01) return { mnemonic: 'fabs', operands: `${fr}${rd}, ${fr}${rn}` };
    // FNEG
    if (opcode === 0x02) return { mnemonic: 'fneg', operands: `${fr}${rd}, ${fr}${rn}` };
    // FSQRT
    if (opcode === 0x03) return { mnemonic: 'fsqrt', operands: `${fr}${rd}, ${fr}${rn}` };
    // FCVT to integer
    if (opcode >= 0x06 && opcode <= 0x09) {
      const ops = ['frintn', 'frintm', 'frintp', 'frintz'] as const;
      return { mnemonic: ops[opcode - 6] || 'frint', operands: `${fr}${rd}, ${fr}${rn}` };
    }
    if (opcode === 0x0a) return { mnemonic: 'frinta', operands: `${fr}${rd}, ${fr}${rn}` };
    if (opcode === 0x0e) return { mnemonic: 'frintx', operands: `${fr}${rd}, ${fr}${rn}` };
    if (opcode === 0x0f) return { mnemonic: 'frinti', operands: `${fr}${rd}, ${fr}${rn}` };
  }

  // FP compare: 0x1e202000 pattern
  if ((insn & 0x5f203c00) === 0x1e202000) {
    const ftype = (insn >> 22) & 0x3;
    const rm = (insn >> 16) & 0x1f;
    const op = (insn >> 3) & 0x3;
    const rn = (insn >> 5) & 0x1f;
    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';

    if (op === 0) return { mnemonic: 'fcmp', operands: `${fr}${rn}, ${fr}${rm}` };
    if (op === 1) return { mnemonic: 'fcmpe', operands: `${fr}${rn}, ${fr}${rm}` };
  }

  // FP compare against zero
  if ((insn & 0x5f207c00) === 0x1e202000) {
    const ftype = (insn >> 22) & 0x3;
    const rn = (insn >> 5) & 0x1f;
    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';
    return { mnemonic: 'fcmp', operands: `${fr}${rn}, #0.0` };
  }

  // FP data processing (2-source): 0x1e200800 pattern
  if ((insn & 0x5f200c00) === 0x1e200800) {
    const ftype = (insn >> 22) & 0x3;
    const rm = (insn >> 16) & 0x1f;
    const opcode = (insn >> 12) & 0xf;
    const rn = (insn >> 5) & 0x1f;
    const rd = insn & 0x1f;

    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';

    const ops = ['fmul', 'fdiv', 'fadd', 'fsub', 'fmax', 'fmin', 'fmaxnm', 'fminnm'] as const;
    const mnemonic = ops[opcode];
    if (mnemonic) return { mnemonic, operands: `${fr}${rd}, ${fr}${rn}, ${fr}${rm}` };
  }

  // FMOV (register): 0x1e204000 pattern
  if ((insn & 0x5fffc000) === 0x1e204000) {
    const ftype = (insn >> 22) & 0x3;
    const rn = (insn >> 5) & 0x1f;
    const rd = insn & 0x1f;
    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';
    return { mnemonic: 'fmov', operands: `${fr}${rd}, ${fr}${rn}` };
  }

  // FCSEL: 0x1e200c00 pattern
  if ((insn & 0x5f200c00) === 0x1e200c00) {
    const ftype = (insn >> 22) & 0x3;
    const rm = (insn >> 16) & 0x1f;
    const cond = (insn >> 12) & 0xf;
    const rn = (insn >> 5) & 0x1f;
    const rd = insn & 0x1f;
    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';
    const conds = [
      'eq',
      'ne',
      'cs',
      'cc',
      'mi',
      'pl',
      'vs',
      'vc',
      'hi',
      'ls',
      'ge',
      'lt',
      'gt',
      'le',
      'al',
      'nv',
    ];
    return { mnemonic: 'fcsel', operands: `${fr}${rd}, ${fr}${rn}, ${fr}${rm}, ${conds[cond]}` };
  }

  // FMOV (immediate): 0x1e201000 pattern
  if ((insn & 0x5f201000) === 0x1e201000) {
    const ftype = (insn >> 22) & 0x3;
    const rd = insn & 0x1f;
    const fregs = ['b', 'h', 's', 'd'] as const;
    const fr = fregs[ftype] || 's';
    return { mnemonic: 'fmov', operands: `${fr}${rd}, #<fp-imm>` };
  }

  return null;
}

// ─── Pointer Authentication ────────────────────────────────────────────────

/** Decode HINT-space PAC instructions (0xD5032xxxF). Returns null if not PAC.
 *  Real CRm/op2 map (capstone 5.0.7 verified): CRm=3, op2 0..7 = paciaz/paciasp/
 *  pacibz/pacibsp/autiaz/autiasp/autibz/autibsp; CRm=1, even op2 = the 1716
 *  family (pointer X17, modifier X16 — implicit operands); CRm=0, op2=7 =
 *  xpaclri. Everything else is not PAC (blanket NOP territory). XPACI/XPACD are
 *  NOT on the HINT page — they use the 1-source register window (0xDAC143E0 /
 *  0xDAC147E0 | Xd) and are decoded in the 0xDAC1 section above. */
function decodePacHint(insn: number): DisasmResult | null {
  if ((insn & 0xfffff01f) >>> 0 !== 0xd503201f) return null;
  const crm = (insn >>> 8) & 0xf;
  const op2 = (insn >>> 5) & 0b111;
  // XPACLRI: CRm=0, op2=7
  if (crm === 0b0000 && op2 === 0b111) return { mnemonic: 'xpaclri', operands: '' };
  // CRm=3: LR family — op2[2] selects AUT, op2[1] selects key B, op2[0] SP.
  if (crm === 0b0011) {
    const prefix = (op2 & 0b100) !== 0 ? 'auti' : 'paci';
    const key = (op2 & 0b010) !== 0 ? 'b' : 'a';
    const suffix = (op2 & 0b001) !== 0 ? 'sp' : 'z';
    return { mnemonic: `${prefix}${key}${suffix}`, operands: '' };
  }
  // CRm=1, even op2: 1716 family. Odd op2 is unallocated → null.
  if (crm === 0b0001 && (op2 & 0b001) === 0) {
    const prefix = (op2 & 0b100) !== 0 ? 'auti' : 'paci';
    const key = (op2 & 0b010) !== 0 ? 'b' : 'a';
    return { mnemonic: `${prefix}${key}1716`, operands: '' };
  }
  return null;
}

/** Register-family mnemonics indexed by opcode bits[12:10]. */
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

/** Decode the PAC/AUT register family (base 0xDAC10000, mask 0xFFFFE000):
 *  `pac<key> Xd, <Xn|SP>` — the pointer register (Rd) is signed/authenticated
 *  in place; modifier is Rn bits[9:5] (31 = SP). Capstone-verified:
 *  0xDAC10043 `pacia x3, x2`, 0xDAC103E0 `pacia x0, sp`. */
function decodePacRegisterForm(insn: number): DisasmResult | null {
  if ((insn & 0xffffe000) >>> 0 !== 0xdac10000) return null;
  const opcode = (insn >>> 10) & 0b111;
  const rn = (insn >>> 5) & 0b11111;
  const rd = insn & 0b11111;
  const modifier = rn === 31 ? 'sp' : `x${rn}`;
  return { mnemonic: PAC_REGISTER_MNEMONICS[opcode]!, operands: `x${rd}, ${modifier}` };
}

/** Decode PACGA (base 0x9AC03000, mask 0xFFE0FC00): `pacga Xd, Xn, Xm|SP` —
 *  destination receives the FULL 64-bit QARMA5 digest. Capstone-verified:
 *  0x9AC13043 `pacga x3, x2, x1`, 0x9ADF3041 `pacga x1, x2, sp`. */
function decodePacga(insn: number): DisasmResult | null {
  if ((insn & 0xffe0fc00) >>> 0 !== 0x9ac03000) return null;
  const rm = (insn >>> 16) & 0b11111;
  const rn = (insn >>> 5) & 0b11111;
  const rd = insn & 0b11111;
  const modifier = rm === 31 ? 'sp' : `x${rm}`;
  return { mnemonic: 'pacga', operands: `x${rd}, x${rn}, ${modifier}` };
}

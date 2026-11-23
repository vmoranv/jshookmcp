/**
 * Unit tests for ARM64 instruction disassembler (disasm.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  disassembleArm64,
  disassembleInstruction,
  normalizeDisasmArchitecture,
  SUPPORTED_DISASSEMBLY_ARCHITECTURES,
} from '@modules/native-emulator/disasm';

function rvI(funct3: number, rd: number, rs1: number, imm: number, opcode = 0x13): number {
  return (((imm & 0xfff) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode) >>> 0;
}

function rvR(funct7: number, funct3: number, rd: number, rs1: number, rs2: number): number {
  return (
    (((funct7 & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | 0x33) >>> 0
  );
}

function rvS(funct3: number, rs1: number, rs2: number, imm: number): number {
  const low = imm & 0x1f;
  const high = (imm >> 5) & 0x7f;
  return ((high << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (low << 7) | 0x23) >>> 0;
}

function rvB(funct3: number, rs1: number, rs2: number, imm: number): number {
  const value = imm & 0x1fff;
  return (
    ((((value >> 12) & 0x1) << 31) |
      (((value >> 5) & 0x3f) << 25) |
      (rs2 << 20) |
      (rs1 << 15) |
      (funct3 << 12) |
      (((value >> 1) & 0xf) << 8) |
      (((value >> 11) & 0x1) << 7) |
      0x63) >>>
    0
  );
}

function rvJ(rd: number, imm: number): number {
  const value = imm & 0x1fffff;
  return (
    ((((value >> 20) & 0x1) << 31) |
      (((value >> 1) & 0x3ff) << 21) |
      (((value >> 11) & 0x1) << 20) |
      (((value >> 12) & 0xff) << 12) |
      (rd << 7) |
      0x6f) >>>
    0
  );
}

function mipsR(funct: number, rd: number, rs: number, rt: number, shamt = 0): number {
  return ((rs << 21) | (rt << 16) | (rd << 11) | (shamt << 6) | funct) >>> 0;
}

function mipsI(opcode: number, rt: number, rs: number, imm: number): number {
  return ((opcode << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
}

function mipsJ(opcode: number, target: number): number {
  return ((opcode << 26) | (target & 0x03ffffff)) >>> 0;
}

describe('disassembleArm64', () => {
  // ─── RET / NOP ───────────────────────────────────────────────────
  it('decodes RET', () => {
    expect(disassembleArm64(0xd65f03c0, 0x1000n)).toContain('ret');
  });

  it('decodes NOP', () => {
    expect(disassembleArm64(0xd503201f, 0x1000n)).toContain('nop');
  });

  // ─── ADRP ────────────────────────────────────────────────────────
  it('decodes ADRP (from real trace)', () => {
    const result = disassembleArm64(0xb00001e0, 0x1c79cn);
    expect(result).toContain('adrp');
    expect(result).toContain('x0');
  });

  // ─── ADD/SUB immediate ───────────────────────────────────────────
  it('decodes SUB sp, sp, #16', () => {
    const result = disassembleArm64(0xd10043ff, 0x1000n);
    expect(result).toContain('sub');
    expect(result).toContain('#16');
  });

  it('decodes ADD x0, sp, #0', () => {
    const result = disassembleArm64(0x910003e0, 0x1000n);
    expect(result).toContain('add');
    expect(result).toContain('x0');
  });

  it('decodes ADD with shifted immediate (from trace)', () => {
    const result = disassembleArm64(0x91261c00, 0x1c7a0n);
    expect(result).toContain('add');
    expect(result).toContain('x0');
  });

  // ─── MOV (wide immediate) ────────────────────────────────────────
  it('decodes MOVZ as MOV alias', () => {
    // MOVZ w0, #5 → mov w0, #0x5
    // 0 10 100101 00 0000000000000101 00000
    const insn = 0x528000a0;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('mov');
  });

  it('decodes MOVK with shift', () => {
    // MOVK x0, #1, lsl #16
    const insn = 0xf2a00020;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('movk');
    expect(result).toContain('lsl');
  });

  // ─── Bitfield ────────────────────────────────────────────────────
  it('decodes LSR (UBFM alias)', () => {
    // LSR x0, x1, #4 → UBFM x0, x1, #4, #60
    const insn = 0xd340fc20;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('lsr');
  });

  it('decodes SXTB (SBFM alias)', () => {
    // SXTB x0, x1 → SBFM x0, x1, #0, #7
    // Encoding: 1 00 100110 1 000000 000111 00001 00000 = 0x93401C20
    const insn = 0x93401c20;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('sxtb');
  });

  // ─── Branches ────────────────────────────────────────────────────
  it('decodes B (unconditional branch)', () => {
    // B #+4 → imm26=1
    const insn = 0x14000001;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toMatch(/^b\s/);
  });

  it('decodes BL (branch with link)', () => {
    const insn = 0x94000001;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('bl');
  });

  it('decodes B.EQ', () => {
    // B.EQ #+8 → 0x54000100
    const insn = 0x54000100;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('b.eq');
  });

  it('decodes CBZ', () => {
    // CBZ x0, #+8 → 0x34000100
    const insn = 0x34000100;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('cbz');
  });

  it('decodes CBNZ', () => {
    // CBNZ x0, #+8 → 0x35000100
    const insn = 0x35000100;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('cbnz');
  });

  it('decodes BLR', () => {
    const result = disassembleArm64(0xd63f0020, 0x1000n);
    expect(result).toContain('blr');
  });

  it('decodes BR', () => {
    const result = disassembleArm64(0xd61f0060, 0x1000n);
    expect(result).toMatch(/^br\s/);
  });

  // ─── Loads & Stores ──────────────────────────────────────────────
  it('decodes LDR unsigned offset', () => {
    // LDR x0, [sp, #8]  → 0xf94007e0
    const result = disassembleArm64(0xf94007e0, 0x1000n);
    expect(result).toContain('ldr');
    expect(result).toContain('x0');
  });

  it('decodes STR unsigned offset', () => {
    // STR w0, [x1]  → 0xb9000020
    const result = disassembleArm64(0xb9000020, 0x1000n);
    expect(result).toContain('str');
  });

  it('decodes STP (store pair)', () => {
    // STP x29, x30, [sp, #-16]  → 0xa9be7bfd
    const result = disassembleArm64(0xa9be7bfd, 0x1000n);
    expect(result).toContain('stp');
  });

  it('decodes LDP (load pair)', () => {
    // LDP x29, x30, [sp], #16  → 0xa8c17bfd
    const result = disassembleArm64(0xa8c17bfd, 0x1000n);
    expect(result).toContain('ldp');
  });

  // ─── MOV (register) ──────────────────────────────────────────────
  it('decodes MOV (register alias)', () => {
    // ORR x0, xzr, x1 → MOV x0, x1
    // Encoding: sf=1, opc=01, 01010, shift=00, N=0, Rm=1, imm6=0, Rn=31(xzr), Rd=0
    // = 1010 1010 0000 0001 0000 0011 1110 0000 = 0xAA0103E0
    const insn = 0xaa0103e0;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('mov');
    expect(result).toContain('x0, x1');
  });

  // ─── Logical (shifted register) ──────────────────────────────────
  it('decodes AND/ORR/EOR/ANDS and inverted BIC/ORN/EON/BICS', () => {
    // w-register forms with Rd=w0, Rn=w1, Rm=w2, no shift.
    expect(disassembleArm64(0x0a020020, 0x1000n)).toContain('and ');
    expect(disassembleArm64(0x2a020020, 0x1000n)).toContain('orr ');
    expect(disassembleArm64(0x4a020020, 0x1000n)).toContain('eor ');
    expect(disassembleArm64(0x6a020020, 0x1000n)).toContain('ands');
    // N bit (21) set selects the inverted forms.
    expect(disassembleArm64(0x0a220020, 0x1000n)).toContain('bic ');
    expect(disassembleArm64(0x2a220020, 0x1000n)).toContain('orn ');
    expect(disassembleArm64(0x4a220020, 0x1000n)).toContain('eon ');
    expect(disassembleArm64(0x6a220020, 0x1000n)).toContain('bics');
  });

  // ─── CSEL ────────────────────────────────────────────────────────
  it('decodes CSEL', () => {
    // CSEL x0, x1, x2, eq → 0x9A820020
    const insn = 0x9a820020;
    const result = disassembleArm64(insn, 0x1000n);
    expect(result).toContain('csel');
    expect(result).toContain('eq');
  });

  // ─── MRS ─────────────────────────────────────────────────────────
  it('decodes MRS NZCV', () => {
    // MRS x0, NZCV → 0xd53b4200
    const result = disassembleArm64(0xd53b4200, 0x1000n);
    expect(result).toContain('mrs');
  });

  // ─── Unknown instructions ────────────────────────────────────────
  it('returns unknown for unrecognized opcodes', () => {
    const result = disassembleArm64(0xdeadbeef, 0x1000n);
    expect(result).toContain('<unknown>');
    expect(result).toContain('deadbeef');
  });

  // ─── Regression: real trace from 91porn APK ──────────────────────
  it('decodes all instructions from real trace', () => {
    const trace = [
      { op: 0xb00001e0, pc: 0x1c798n, expect: 'adrp' },
      { op: 0x91261c00, pc: 0x1c7a0n, expect: 'add' },
      { op: 0xd65f03c0, pc: 0x1c7a4n, expect: 'ret' },
    ];

    for (const { op, pc, expect: mnemonic } of trace) {
      const result = disassembleArm64(op, pc);
      expect(result).toContain(mnemonic);
    }
  });
});

describe('disassembleInstruction multi-architecture entrypoint', () => {
  it('exposes stable architecture aliases through the public facade', () => {
    expect(SUPPORTED_DISASSEMBLY_ARCHITECTURES).toEqual([
      'arm64',
      'aarch64',
      'x86',
      'x64',
      'riscv32',
      'riscv64',
      'mips',
      'mips32',
      'mipsel',
    ]);
    expect(normalizeDisasmArchitecture('aarch64')).toBe('arm64');
    expect(normalizeDisasmArchitecture('riscv64')).toBe('riscv');
    expect(normalizeDisasmArchitecture('mips32')).toBe('mips');
  });

  it('rejects too-short fixed-width byte input at the registry boundary', () => {
    expect(() => disassembleInstruction('riscv64', [0x13, 0x00, 0x00], 0x1000n)).toThrow(
      /at least 4 bytes/i,
    );
  });

  it('keeps ARM64 compatibility through the generic entrypoint', () => {
    const result = disassembleInstruction('arm64', 0xd65f03c0, 0x1000n);
    expect(result).toContain('ret');
  });

  it('decodes x64 common instructions', () => {
    expect(disassembleInstruction('x64', [0x90], 0x1000n)).toContain('nop');
    expect(disassembleInstruction('x64', [0xc3], 0x1000n)).toContain('ret');
    expect(disassembleInstruction('x64', [0xcc], 0x1000n)).toContain('int3');
    expect(disassembleInstruction('x64', [0x55], 0x1000n)).toContain('push');
    expect(disassembleInstruction('x64', [0x55], 0x1000n)).toContain('rbp');
    expect(disassembleInstruction('x64', [0x58], 0x1000n)).toContain('pop');
    expect(disassembleInstruction('x64', [0x41, 0x50], 0x1000n)).toContain('r8');
    expect(disassembleInstruction('x64', [0x41, 0x58], 0x1000n)).toContain('r8');
    expect(disassembleInstruction('x64', [0x48, 0x89, 0xe5], 0x1000n)).toContain('mov');
    expect(disassembleInstruction('x64', [0x48, 0x89, 0xe5], 0x1000n)).toContain('rbp, rsp');
    expect(disassembleInstruction('x64', [0x4c, 0x8b, 0xc3], 0x1000n)).toContain('r8, rbx');
    expect(disassembleInstruction('x64', [0x4d, 0x8b, 0x01], 0x1000n)).toContain('r8, [r9]');
    expect(
      disassembleInstruction(
        'x64',
        [0x48, 0xb8, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11],
        0x1000n,
      ),
    ).toContain('#0x1122334455667788');
  });

  it('decodes x86 relative and register instructions', () => {
    expect(disassembleInstruction('x86', [0xe8, 0x01, 0x00, 0x00, 0x00], 0x1000n)).toContain(
      '0x1006',
    );
    expect(disassembleInstruction('x86', [0xe9, 0x01, 0x00, 0x00, 0x00], 0x1000n)).toContain(
      '0x1006',
    );
    expect(disassembleInstruction('x86', [0xeb, 0xfe], 0x1000n)).toContain('0x1000');
    expect(disassembleInstruction('x86', [0x74, 0x02], 0x1000n)).toContain('je');
    expect(disassembleInstruction('x86', [0x0f, 0x85, 0x04, 0x00, 0x00, 0x00], 0x1000n)).toContain(
      'jne',
    );
    expect(disassembleInstruction('x86', [0xb8, 0x78, 0x56, 0x34, 0x12], 0x1000n)).toContain(
      '#0x12345678',
    );
    expect(disassembleInstruction('x86', [0x03, 0xc1], 0x1000n)).toContain('add');
    expect(disassembleInstruction('x86', [0x29, 0x08], 0x1000n)).toContain('[rax], ecx');
    expect(disassembleInstruction('x86', [0x2b, 0xc1], 0x1000n)).toContain('sub');
    expect(disassembleInstruction('x86', [0x39, 0xc1], 0x1000n)).toContain('cmp');
    expect(disassembleInstruction('x86', [0x3b, 0xc1], 0x1000n)).toContain('cmp');
    expect(disassembleInstruction('x86', [0x31, 0xc0], 0x1000n)).toContain('xor');
    expect(disassembleInstruction('x86', [0x31, 0xc0], 0x1000n)).toContain('eax, eax');
    expect(disassembleInstruction('x86', [0xff], 0x1000n)).toContain('<unknown>');
  });

  it('decodes modern x86/x64 SIMD and crypto prefixes', () => {
    expect(disassembleInstruction('x64', [0x0f, 0x58, 0xc1], 0x1000n)).toContain('addps');
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x58, 0xc1], 0x1000n)).toContain('addpd');
    expect(disassembleInstruction('x64', [0xf3, 0x0f, 0x58, 0xc1], 0x1000n)).toContain('addss');
    expect(disassembleInstruction('x64', [0xf2, 0x0f, 0x58, 0xc1], 0x1000n)).toContain('addsd');
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x6f, 0xc1], 0x1000n)).toContain('movdqa');
    expect(disassembleInstruction('x64', [0xf3, 0x0f, 0x6f, 0xc1], 0x1000n)).toContain('movdqu');
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x7f, 0xc1], 0x1000n)).toContain('movdqa');
    expect(disassembleInstruction('x64', [0xf3, 0x0f, 0x7f, 0xc1], 0x1000n)).toContain('movdqu');
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0xef, 0xc0], 0x1000n)).toContain('pxor');
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0xdb, 0xc1], 0x1000n)).toContain(
      'aesimc',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0xdc, 0xc1], 0x1000n)).toContain(
      'aesenc',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0xdd, 0xc1], 0x1000n)).toContain(
      'aesenclast',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0xde, 0xc1], 0x1000n)).toContain(
      'aesdec',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0xdf, 0xc1], 0x1000n)).toContain(
      'aesdeclast',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0x40, 0xc1], 0x1000n)).toContain(
      'pmulld',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x38, 0x41, 0xc1], 0x1000n)).toContain(
      'phminposuw',
    );
    expect(disassembleInstruction('x64', [0xf3, 0x0f, 0xb8, 0xc1], 0x1000n)).toContain('popcnt');
    expect(disassembleInstruction('x64', [0xf3, 0x0f, 0xbd, 0xc1], 0x1000n)).toContain('lzcnt');
    expect(disassembleInstruction('x64', [0xf3, 0x0f, 0x38, 0xf5, 0xc1], 0x1000n)).toContain(
      'bzhi',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x3a, 0x44, 0xc1, 0x00], 0x1000n)).toContain(
      'pclmulqdq',
    );
    expect(disassembleInstruction('x64', [0x66, 0x0f, 0x3a, 0xdf, 0xc1, 0x01], 0x1000n)).toContain(
      'aeskeygenassist',
    );
    expect(disassembleInstruction('x64', [0xf0, 0x90], 0x1000n)).toContain('nop');
  });

  it('decodes AVX and AVX2 VEX-prefixed instructions', () => {
    expect(disassembleInstruction('x64', [0xc5, 0xf8, 0x58, 0xc2], 0x1000n)).toContain('xmm');
    expect(disassembleInstruction('x64', [0xc5, 0x74, 0x58, 0xc2], 0x1000n)).toContain('ymm');
    expect(disassembleInstruction('x64', [0xc5, 0x78, 0x58, 0xc2], 0x1000n)).toContain('xmm8');
    expect(disassembleInstruction('x64', [0xc5, 0xf4, 0x58, 0xc2], 0x1000n)).toContain('vaddps');
    expect(disassembleInstruction('x64', [0xc5, 0xf5, 0x6f, 0xc2], 0x1000n)).toContain('vmovdqa');
    expect(disassembleInstruction('x64', [0xc5, 0xf6, 0x6f, 0xc2], 0x1000n)).toContain('vmovdqu');
    expect(disassembleInstruction('x64', [0xc5, 0xf5, 0x7f, 0xc2], 0x1000n)).toContain('vmovdqa');
    expect(disassembleInstruction('x64', [0xc5, 0xf6, 0x7f, 0xc2], 0x1000n)).toContain('vmovdqu');
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0x40, 0xc1], 0x1000n)).toContain(
      'vpmulld',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0xdc, 0xc1], 0x1000n)).toContain(
      'vaesenc',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0xdd, 0xc1], 0x1000n)).toContain(
      'vaesenclast',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0xde, 0xc1], 0x1000n)).toContain(
      'vaesdec',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0xdf, 0xc1], 0x1000n)).toContain(
      'vaesdeclast',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0xf6, 0xc1], 0x1000n)).toContain(
      'vpsadbw',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe2, 0x7d, 0x5a, 0xc1], 0x1000n)).toContain(
      'vbroadcasti128',
    );
    expect(disassembleInstruction('x64', [0xc4, 0xe3, 0x79, 0x44, 0xc1, 0x10], 0x1000n)).toContain(
      'vpclmulqdq',
    );
    expect(disassembleInstruction('x64', [0xc5, 0xf8, 0x99], 0x1000n)).toContain('vex');
    expect(disassembleInstruction('x64', [0xc5, 0xf8], 0x1000n)).toContain('<unknown>');
  });

  it('decodes common AVX-512 EVEX-prefixed instructions', () => {
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x74, 0x48, 0x58, 0xc2], 0x1000n)).toContain(
      'vaddps',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x74, 0x28, 0x58, 0xc2], 0x1000n)).toContain(
      'ymm',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x74, 0x08, 0x58, 0xc2], 0x1000n)).toContain(
      'xmm',
    );
    expect(disassembleInstruction('x64', [0x62, 0xe1, 0x74, 0x4f, 0x58, 0xc2], 0x1000n)).toContain(
      '{k7}',
    );
    expect(disassembleInstruction('x64', [0x62, 0xe1, 0x74, 0xcf, 0x58, 0xc2], 0x1000n)).toContain(
      '{z}',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x74, 0x58, 0x58, 0x02], 0x1000n)).toContain(
      '{evex-b}',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x75, 0x48, 0x6f, 0xc2], 0x1000n)).toContain(
      'vmovdqa64',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x76, 0x48, 0x6f, 0xc2], 0x1000n)).toContain(
      'vmovdqu64',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x75, 0x48, 0x7f, 0xc2], 0x1000n)).toContain(
      'vmovdqa64',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x76, 0x48, 0x7f, 0xc2], 0x1000n)).toContain(
      'vmovdqu64',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0x25, 0xc2], 0x1000n)).toContain(
      'vpternlogd',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0x40, 0xc2], 0x1000n)).toContain(
      'vpmulld',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0x58, 0xc2], 0x1000n)).toContain(
      'vpbroadcastd',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0x59, 0xc2], 0x1000n)).toContain(
      'vpbroadcastq',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x7d, 0x48, 0x7c, 0xc0], 0x1000n)).toContain(
      'vpbroadcastd',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x7d, 0x48, 0x7e, 0xc0], 0x1000n)).toContain(
      'vpbroadcastq',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0xdc, 0xc2], 0x1000n)).toContain(
      'vaesenc',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0xdd, 0xc2], 0x1000n)).toContain(
      'vaesenclast',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0xde, 0xc2], 0x1000n)).toContain(
      'vaesdec',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf2, 0x75, 0x48, 0xdf, 0xc2], 0x1000n)).toContain(
      'vaesdeclast',
    );
    expect(disassembleInstruction('x64', [0x62, 0x61, 0x74, 0x48, 0x58, 0xc2], 0x1000n)).toContain(
      'zmm24',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x74, 0x48, 0x99, 0xc2], 0x1000n)).toContain(
      '<unknown>',
    );
    expect(disassembleInstruction('x64', [0x62, 0xf1, 0x74, 0x48], 0x1000n)).toContain('<unknown>');
  });

  it('decodes RISC-V common instructions', () => {
    expect(disassembleInstruction('riscv64', 0x00000013, 0x1000n)).toContain('nop');
    expect(disassembleInstruction('riscv64', 0x00008067, 0x1000n)).toContain('ret');
    expect(disassembleInstruction('riscv64', 0x00100093, 0x1000n)).toContain('addi');
    expect(disassembleInstruction('riscv64', 0x002081b3, 0x1000n)).toContain('add');
  });

  it('decodes RISC-V immediate, memory, branch, and jump families', () => {
    for (const [funct3, mnemonic] of [
      [1, 'slli'],
      [2, 'slti'],
      [3, 'sltiu'],
      [4, 'xori'],
      [5, 'srli'],
      [6, 'ori'],
      [7, 'andi'],
    ] as const) {
      expect(disassembleInstruction('riscv64', rvI(funct3, 1, 2, 3), 0x1000n)).toContain(mnemonic);
    }
    expect(disassembleInstruction('riscv64', rvI(5, 1, 2, 0x403), 0x1000n)).toContain('srai');

    for (const [funct7, funct3, mnemonic] of [
      [32, 0, 'sub'],
      [0, 1, 'sll'],
      [0, 2, 'slt'],
      [0, 3, 'sltu'],
      [0, 4, 'xor'],
      [0, 5, 'srl'],
      [32, 5, 'sra'],
      [0, 6, 'or'],
      [0, 7, 'and'],
    ] as const) {
      expect(disassembleInstruction('riscv64', rvR(funct7, funct3, 1, 2, 3), 0x1000n)).toContain(
        mnemonic,
      );
    }

    for (const [funct3, mnemonic] of [
      [0, 'lb'],
      [1, 'lh'],
      [2, 'lw'],
      [3, 'ld'],
      [4, 'lbu'],
      [5, 'lhu'],
      [6, 'lwu'],
    ] as const) {
      expect(disassembleInstruction('riscv64', rvI(funct3, 1, 2, 8, 0x03), 0x1000n)).toContain(
        mnemonic,
      );
    }

    for (const [funct3, mnemonic] of [
      [0, 'sb'],
      [1, 'sh'],
      [2, 'sw'],
      [3, 'sd'],
    ] as const) {
      expect(disassembleInstruction('riscv64', rvS(funct3, 1, 2, 8), 0x1000n)).toContain(mnemonic);
    }

    for (const [funct3, mnemonic] of [
      [0, 'beq'],
      [1, 'bne'],
      [4, 'blt'],
      [5, 'bge'],
      [6, 'bltu'],
      [7, 'bgeu'],
    ] as const) {
      expect(disassembleInstruction('riscv64', rvB(funct3, 1, 2, 8), 0x1000n)).toContain(mnemonic);
    }

    expect(disassembleInstruction('riscv64', rvJ(1, 16), 0x1000n)).toContain('jal');
    expect(disassembleInstruction('riscv64', rvI(0, 1, 2, 12, 0x67), 0x1000n)).toContain('jalr');
    expect(disassembleInstruction('riscv64', 0x123450b7, 0x1000n)).toContain('lui');
    expect(disassembleInstruction('riscv64', 0x12345097, 0x1000n)).toContain('auipc');
    expect(disassembleInstruction('riscv64', 0xffffffff, 0x1000n)).toContain('<unknown>');
  });

  it('decodes MIPS common instructions', () => {
    expect(disassembleInstruction('mips', 0x00000000, 0x1000n)).toContain('nop');
    expect(disassembleInstruction('mips', 0x012a4020, 0x1000n)).toContain('add');
    expect(disassembleInstruction('mips', 0x8d080004, 0x1000n)).toContain('lw');
  });

  it('decodes MIPS R-type, immediate, memory, and control-transfer families', () => {
    for (const [funct, mnemonic] of [
      [0x08, 'jr'],
      [0x09, 'jalr'],
      [0x00, 'sll'],
      [0x02, 'srl'],
      [0x03, 'sra'],
      [0x21, 'addu'],
      [0x22, 'sub'],
      [0x23, 'subu'],
      [0x24, 'and'],
      [0x25, 'or'],
      [0x26, 'xor'],
      [0x27, 'nor'],
      [0x2a, 'slt'],
      [0x2b, 'sltu'],
    ] as const) {
      expect(disassembleInstruction('mips', mipsR(funct, 8, 9, 10, 3), 0x1000n)).toContain(
        mnemonic,
      );
    }

    for (const [opcode, mnemonic] of [
      [0x08, 'addi'],
      [0x09, 'addiu'],
      [0x0a, 'slti'],
      [0x0b, 'sltiu'],
      [0x0c, 'andi'],
      [0x0d, 'ori'],
      [0x0e, 'xori'],
    ] as const) {
      expect(disassembleInstruction('mips', mipsI(opcode, 8, 9, 0x10), 0x1000n)).toContain(
        mnemonic,
      );
    }

    for (const [opcode, mnemonic] of [
      [0x20, 'lb'],
      [0x21, 'lh'],
      [0x23, 'lw'],
      [0x24, 'lbu'],
      [0x25, 'lhu'],
      [0x28, 'sb'],
      [0x29, 'sh'],
      [0x2b, 'sw'],
    ] as const) {
      expect(disassembleInstruction('mips', mipsI(opcode, 8, 9, -4), 0x1000n)).toContain(mnemonic);
    }

    expect(disassembleInstruction('mips', mipsJ(0x02, 0x123), 0x1000n)).toContain('j');
    expect(disassembleInstruction('mips', mipsJ(0x03, 0x123), 0x1000n)).toContain('jal');
    expect(disassembleInstruction('mips', mipsI(0x04, 8, 9, 2), 0x1000n)).toContain('beq');
    expect(disassembleInstruction('mips', mipsI(0x05, 8, 9, 2), 0x1000n)).toContain('bne');
    expect(disassembleInstruction('mips', mipsI(0x0f, 8, 0, 0x1234), 0x1000n)).toContain('lui');
    expect(disassembleInstruction('mips', mipsR(0x3f, 8, 9, 10), 0x1000n)).toContain('<unknown>');
    expect(disassembleInstruction('mips', 0xffffffff, 0x1000n)).toContain('<unknown>');
  });

  it('decodes MIPSEL bytes using little-endian order', () => {
    const result = disassembleInstruction('mipsel', [0x04, 0x00, 0x08, 0x8d], 0x1000n);
    expect(result).toContain('lw');
    expect(result).toContain('$t0');
  });
});

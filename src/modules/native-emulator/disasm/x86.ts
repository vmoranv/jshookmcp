import type { DisasmResult, OpcodeInput } from './types';
import {
  byteAt,
  formatDisasm,
  normalizeBytes,
  readInt8,
  readInt32LE,
  readUInt32LE,
  readUInt64LE,
  relativeTarget,
} from './utils';

// --- x86 / x64 ---------------------------------------------------------------

const X86_CONDITIONS = [
  'o',
  'no',
  'b',
  'ae',
  'e',
  'ne',
  'be',
  'a',
  's',
  'ns',
  'p',
  'np',
  'l',
  'ge',
  'le',
  'g',
] as const;

const X86_REG32 = [
  'eax',
  'ecx',
  'edx',
  'ebx',
  'esp',
  'ebp',
  'esi',
  'edi',
  'r8d',
  'r9d',
  'r10d',
  'r11d',
  'r12d',
  'r13d',
  'r14d',
  'r15d',
] as const;

const X86_REG64 = [
  'rax',
  'rcx',
  'rdx',
  'rbx',
  'rsp',
  'rbp',
  'rsi',
  'rdi',
  'r8',
  'r9',
  'r10',
  'r11',
  'r12',
  'r13',
  'r14',
  'r15',
] as const;

type X86MandatoryPrefix = 'none' | '66' | 'f2' | 'f3';
type X86VectorRegClass = 'xmm' | 'ymm' | 'zmm';

interface X86VectorPrefix {
  evex: boolean;
  map: number;
  pp: X86MandatoryPrefix;
  w: number;
  vectorBits: 128 | 256 | 512;
  opIndex: number;
  regExt: number;
  rmExt: number;
  vvvv: number;
  opmask?: number;
  zeroing?: boolean;
  broadcastOrRounding?: boolean;
}

/** Shared decode state after prefix/REX parsing. */
interface X86DecodeState {
  bytes: readonly number[];
  index: number;
  rex: number;
  operand64: boolean;
  mode: 'x86' | 'x64';
  pc: bigint;
}

/** push/pop, short jcc, call/jmp, mov-imm (single-opcode forms). */
function decodeX86SimpleOpcodes(op: number, st: X86DecodeState): string | null {
  const { bytes, index, rex, operand64, mode, pc } = st;
  if (op === 0x90) return formatDisasm({ mnemonic: 'nop', operands: '' });
  if (op === 0xc3) return formatDisasm({ mnemonic: 'ret', operands: '' });
  if (op === 0xcc) return formatDisasm({ mnemonic: 'int3', operands: '' });

  if (op >= 0x50 && op <= 0x57) {
    const reg = x86Reg(op - 0x50 + (rex & 0x01 ? 8 : 0), mode === 'x64' ? '64' : '32');
    return formatDisasm({ mnemonic: 'push', operands: reg });
  }
  if (op >= 0x58 && op <= 0x5f) {
    const reg = x86Reg(op - 0x58 + (rex & 0x01 ? 8 : 0), mode === 'x64' ? '64' : '32');
    return formatDisasm({ mnemonic: 'pop', operands: reg });
  }

  if (op >= 0x70 && op <= 0x7f) {
    const cond = X86_CONDITIONS[op & 0xf];
    const target = relativeTarget(pc, index + 1, readInt8(bytes, index));
    return formatDisasm({ mnemonic: `j${cond}`, operands: target });
  }

  if (op === 0xe8) {
    return formatDisasm({
      mnemonic: 'call',
      operands: relativeTarget(pc, index + 4, readInt32LE(bytes, index)),
    });
  }
  if (op === 0xe9) {
    return formatDisasm({
      mnemonic: 'jmp',
      operands: relativeTarget(pc, index + 4, readInt32LE(bytes, index)),
    });
  }
  if (op === 0xeb) {
    return formatDisasm({
      mnemonic: 'jmp',
      operands: relativeTarget(pc, index + 1, readInt8(bytes, index)),
    });
  }

  if (op >= 0xb8 && op <= 0xbf) {
    const reg = x86Reg(op - 0xb8 + (rex & 0x01 ? 8 : 0), operand64 ? '64' : '32');
    if (operand64 && bytes.length >= index + 8) {
      return formatDisasm({
        mnemonic: 'mov',
        operands: `${reg}, #0x${readUInt64LE(bytes, index).toString(16)}`,
      });
    }
    return formatDisasm({
      mnemonic: 'mov',
      operands: `${reg}, #0x${readUInt32LE(bytes, index).toString(16)}`,
    });
  }

  return null;
}

/** Two-byte (0x0F) opcodes: jcc rel32, 0F38/0F3A maps, legacy SIMD. */
function decodeX86TwoByte(
  op2: number,
  st: X86DecodeState,
  mandatoryPrefix: X86MandatoryPrefix,
): string | null {
  const { bytes, rex, operand64, pc } = st;
  let index = st.index;
  if (op2 >= 0x80 && op2 <= 0x8f) {
    const cond = X86_CONDITIONS[op2 & 0xf];
    const target = relativeTarget(pc, index + 4, readInt32LE(bytes, index));
    return formatDisasm({ mnemonic: `j${cond}`, operands: target });
  }
  if (op2 === 0x38) {
    const op3 = byteAt(bytes, index++);
    const decoded = decodeX86LegacyExtendedMap(
      2,
      op3,
      mandatoryPrefix,
      bytes,
      index,
      rex,
      operand64,
    );
    if (decoded) return formatDisasm(decoded);
  }
  if (op2 === 0x3a) {
    const op3 = byteAt(bytes, index++);
    const decoded = decodeX86LegacyExtendedMap(
      3,
      op3,
      mandatoryPrefix,
      bytes,
      index,
      rex,
      operand64,
    );
    if (decoded) return formatDisasm(decoded);
  }

  const decoded = decodeX86LegacySimd(op2, mandatoryPrefix, bytes, index, rex, operand64);
  if (decoded) return formatDisasm(decoded);
  return null;
}

const X86_MODRM_OPS: Record<number, [string, boolean]> = {
  0x01: ['add', false],
  0x03: ['add', true],
  0x29: ['sub', false],
  0x2b: ['sub', true],
  0x31: ['xor', false],
  0x33: ['xor', true],
  0x39: ['cmp', false],
  0x3b: ['cmp', true],
  0x89: ['mov', false],
  0x8b: ['mov', true],
};

export function disassembleX86(input: OpcodeInput, pc: bigint, mode: 'x86' | 'x64'): string {
  const bytes = normalizeBytes(input);
  let index = 0;
  let rex = 0;
  let mandatoryPrefix: X86MandatoryPrefix = 'none';

  while (isX86LegacyPrefix(byteAt(bytes, index))) {
    mandatoryPrefix = legacyPrefixKind(byteAt(bytes, index)) ?? mandatoryPrefix;
    index++;
  }

  const vectorDecoded = decodeX86VectorInstruction(bytes, index, mode);
  if (vectorDecoded) return vectorDecoded;

  if (mode === 'x64' && byteAt(bytes, index) >= 0x40 && byteAt(bytes, index) <= 0x4f) {
    rex = byteAt(bytes, index);
    index++;
  }

  const op = byteAt(bytes, index++);
  const st: X86DecodeState = {
    bytes,
    index,
    rex,
    operand64: mode === 'x64' && (rex & 0x08) !== 0,
    mode,
    pc,
  };

  const simple = decodeX86SimpleOpcodes(op, st);
  if (simple) return simple;

  if (op === 0x0f) {
    const op2 = byteAt(bytes, st.index++);
    const twoByte = decodeX86TwoByte(op2, st, mandatoryPrefix);
    if (twoByte) return twoByte;
  }

  const modRmDecoded = X86_MODRM_OPS[op];
  if (modRmDecoded && bytes.length > st.index) {
    const [mnemonic, regFirst] = modRmDecoded;
    return formatDisasm(
      decodeX86ModRm(mnemonic, regFirst, byteAt(bytes, st.index), rex, st.operand64),
    );
  }

  return `<unknown>  ${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ')}`;
}

function decodeX86ModRm(
  mnemonic: string,
  regFirst: boolean,
  modrm: number,
  rex: number,
  operand64: boolean,
): DisasmResult {
  const mod = (modrm >> 6) & 0x3;
  const regIndex = ((modrm >> 3) & 0x7) + (rex & 0x04 ? 8 : 0);
  const rmIndex = (modrm & 0x7) + (rex & 0x01 ? 8 : 0);
  const width = operand64 ? '64' : '32';
  const reg = x86Reg(regIndex, width);
  const rm = mod === 0x3 ? x86Reg(rmIndex, width) : `[${x86Reg(rmIndex, '64')}]`;
  return {
    mnemonic,
    operands: regFirst ? `${reg}, ${rm}` : `${rm}, ${reg}`,
  };
}

function isX86LegacyPrefix(byte: number): boolean {
  return (
    byte === 0x66 ||
    byte === 0xf2 ||
    byte === 0xf3 ||
    byte === 0xf0 ||
    byte === 0x2e ||
    byte === 0x36 ||
    byte === 0x3e ||
    byte === 0x26 ||
    byte === 0x64 ||
    byte === 0x65 ||
    byte === 0x67
  );
}

function legacyPrefixKind(byte: number): X86MandatoryPrefix | null {
  if (byte === 0x66) return '66';
  if (byte === 0xf2) return 'f2';
  if (byte === 0xf3) return 'f3';
  return null;
}

function decodeX86VectorInstruction(
  bytes: readonly number[],
  index: number,
  mode: 'x86' | 'x64',
): string | null {
  const prefix = parseX86VectorPrefix(bytes, index, mode);
  if (!prefix) return null;

  const opcode = byteAt(bytes, prefix.opIndex);
  const modrmIndex = prefix.opIndex + 1;
  if (bytes.length <= modrmIndex) {
    return formatDisasm({
      mnemonic: prefix.evex ? 'evex' : 'vex',
      operands: `0x${opcode.toString(16)}`,
    });
  }

  if (prefix.map === 1) {
    const decoded = prefix.evex
      ? decodeX86Evex0f(opcode, prefix, bytes, modrmIndex)
      : decodeX86Vex0f(opcode, prefix, bytes, modrmIndex);
    if (decoded) return formatDisasm(decoded);
  }
  if (prefix.map === 2) {
    const decoded = prefix.evex
      ? decodeX86Evex0f38(opcode, prefix, bytes, modrmIndex)
      : decodeX86Vex0f38(opcode, prefix, bytes, modrmIndex);
    if (decoded) return formatDisasm(decoded);
  }
  if (prefix.map === 3) {
    const decoded = decodeX86Vex0f3a(opcode, prefix, bytes, modrmIndex);
    if (decoded) return formatDisasm(decoded);
  }

  return null;
}

function parseX86VectorPrefix(
  bytes: readonly number[],
  index: number,
  mode: 'x86' | 'x64',
): X86VectorPrefix | null {
  const first = byteAt(bytes, index);
  if (first === 0xc5 && bytes.length > index + 2) {
    const b1 = byteAt(bytes, index + 1);
    return {
      evex: false,
      map: 1,
      pp: vexPp(b1 & 0x3),
      w: 0,
      vectorBits: (b1 & 0x04) !== 0 ? 256 : 128,
      opIndex: index + 2,
      regExt: mode === 'x64' && (b1 & 0x80) === 0 ? 8 : 0,
      rmExt: 0,
      vvvv: ~(b1 >> 3) & 0xf,
    };
  }
  if (first === 0xc4 && bytes.length > index + 3) {
    const b1 = byteAt(bytes, index + 1);
    const b2 = byteAt(bytes, index + 2);
    return {
      evex: false,
      map: b1 & 0x1f,
      pp: vexPp(b2 & 0x3),
      w: (b2 >> 7) & 1,
      vectorBits: (b2 & 0x04) !== 0 ? 256 : 128,
      opIndex: index + 3,
      regExt: mode === 'x64' && (b1 & 0x80) === 0 ? 8 : 0,
      rmExt: mode === 'x64' && (b1 & 0x20) === 0 ? 8 : 0,
      vvvv: ~(b2 >> 3) & 0xf,
    };
  }
  if (first === 0x62 && bytes.length > index + 4) {
    const p0 = byteAt(bytes, index + 1);
    const p1 = byteAt(bytes, index + 2);
    const p2 = byteAt(bytes, index + 3);
    const vectorBits = p2 & 0x40 ? 512 : p2 & 0x20 ? 256 : 128;
    const r = (p0 & 0x80) === 0 ? 8 : 0;
    const rPrime = (p0 & 0x10) === 0 ? 16 : 0;
    const x = (p0 & 0x40) === 0 ? 8 : 0;
    const b = (p0 & 0x20) === 0 ? 8 : 0;
    return {
      evex: true,
      map: p0 & 0x3,
      pp: vexPp(p1 & 0x3),
      w: (p1 >> 7) & 1,
      vectorBits,
      opIndex: index + 4,
      regExt: r + rPrime,
      rmExt: b + x,
      vvvv: ~(p1 >> 3) & 0xf,
      opmask: p2 & 0x7,
      zeroing: (p2 & 0x80) !== 0,
      broadcastOrRounding: (p2 & 0x10) !== 0,
    };
  }
  return null;
}

function vexPp(pp: number): X86MandatoryPrefix {
  return pp === 1 ? '66' : pp === 2 ? 'f3' : pp === 3 ? 'f2' : 'none';
}

function decodeX86LegacySimd(
  opcode: number,
  prefix: X86MandatoryPrefix,
  bytes: readonly number[],
  modrmIndex: number,
  rex: number,
  operand64: boolean,
): DisasmResult | null {
  if (bytes.length <= modrmIndex) return null;
  const modrm = byteAt(bytes, modrmIndex);

  const sseMnemonic = X86_SSE_0F[legacySimdKey(prefix, opcode)];
  if (sseMnemonic)
    return x86VectorRegReg(sseMnemonic, 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex));

  if (prefix === '66' && opcode === 0x6f)
    return x86VectorRegReg('movdqa', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex));
  if (prefix === 'f3' && opcode === 0x6f)
    return x86VectorRegReg('movdqu', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex));
  if (prefix === '66' && opcode === 0x7f)
    return x86VectorRegReg('movdqa', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex), false);
  if (prefix === 'f3' && opcode === 0x7f)
    return x86VectorRegReg('movdqu', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex), false);

  if (prefix === '66' && opcode === 0x38) return null;
  if (prefix === 'f3' && opcode === 0xb8) {
    const width = operand64 ? '64' : '32';
    return decodeX86ModRm('popcnt', true, modrm, rex, width === '64');
  }
  if (prefix === 'f3' && opcode === 0xbd) {
    const width = operand64 ? '64' : '32';
    return decodeX86ModRm('lzcnt', true, modrm, rex, width === '64');
  }

  return null;
}

function decodeX86LegacyExtendedMap(
  map: 2 | 3,
  opcode: number,
  prefix: X86MandatoryPrefix,
  bytes: readonly number[],
  modrmIndex: number,
  rex: number,
  operand64: boolean,
): DisasmResult | null {
  if (bytes.length <= modrmIndex) return null;
  const modrm = byteAt(bytes, modrmIndex);

  if (map === 2) {
    if (prefix === '66' && opcode === 0xdb)
      return x86VectorRegReg('aesimc', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex));
    if (prefix === '66' && opcode >= 0xdc && opcode <= 0xdf) {
      const names = ['aesenc', 'aesenclast', 'aesdec', 'aesdeclast'] as const;
      return x86VectorRegReg(
        names[opcode - 0xdc]!,
        'xmm',
        modrm,
        rexToRegExt(rex),
        rexToRmExt(rex),
      );
    }
    if (prefix === '66' && opcode === 0x40)
      return x86VectorRegReg('pmulld', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex));
    if (prefix === '66' && opcode === 0x41)
      return x86VectorRegReg('phminposuw', 'xmm', modrm, rexToRegExt(rex), rexToRmExt(rex));
  }

  if (map === 3) {
    if (prefix === '66' && opcode === 0x44)
      return x86VectorRegRegImm(
        'pclmulqdq',
        'xmm',
        modrm,
        bytes,
        modrmIndex + 1,
        rexToRegExt(rex),
        rexToRmExt(rex),
      );
    if (prefix === '66' && opcode === 0xdf)
      return x86VectorRegRegImm(
        'aeskeygenassist',
        'xmm',
        modrm,
        bytes,
        modrmIndex + 1,
        rexToRegExt(rex),
        rexToRmExt(rex),
      );
  }

  if (prefix === 'f3' && map === 2 && opcode === 0xf5) {
    return decodeX86ModRm('bzhi', true, modrm, rex, operand64);
  }

  return null;
}

function decodeX86Vex0f(
  opcode: number,
  prefix: X86VectorPrefix,
  bytes: readonly number[],
  modrmIndex: number,
): DisasmResult | null {
  const modrm = byteAt(bytes, modrmIndex);
  const cls = prefix.vectorBits === 256 ? 'ymm' : 'xmm';
  const mnemonic = X86_VEX_0F[legacySimdKey(prefix.pp, opcode)];
  if (mnemonic)
    return x86VectorRegReg(mnemonic, cls, modrm, prefix.regExt, prefix.rmExt, true, prefix.vvvv);

  if (prefix.pp === '66' && opcode === 0x6f)
    return x86VectorRegReg('vmovdqa', cls, modrm, prefix.regExt, prefix.rmExt);
  if (prefix.pp === 'f3' && opcode === 0x6f)
    return x86VectorRegReg('vmovdqu', cls, modrm, prefix.regExt, prefix.rmExt);
  if (prefix.pp === '66' && opcode === 0x7f)
    return x86VectorRegReg('vmovdqa', cls, modrm, prefix.regExt, prefix.rmExt, false);
  if (prefix.pp === 'f3' && opcode === 0x7f)
    return x86VectorRegReg('vmovdqu', cls, modrm, prefix.regExt, prefix.rmExt, false);

  return null;
}

function decodeX86Vex0f38(
  opcode: number,
  prefix: X86VectorPrefix,
  bytes: readonly number[],
  modrmIndex: number,
): DisasmResult | null {
  const modrm = byteAt(bytes, modrmIndex);
  const cls = prefix.vectorBits === 256 ? 'ymm' : 'xmm';
  const mnemonic = X86_VEX_0F38[legacySimdKey(prefix.pp, opcode)];
  if (mnemonic)
    return x86VectorRegReg(mnemonic, cls, modrm, prefix.regExt, prefix.rmExt, true, prefix.vvvv);
  return null;
}

function decodeX86Vex0f3a(
  opcode: number,
  prefix: X86VectorPrefix,
  bytes: readonly number[],
  modrmIndex: number,
): DisasmResult | null {
  const modrm = byteAt(bytes, modrmIndex);
  const cls = prefix.vectorBits === 256 ? 'ymm' : 'xmm';
  if (prefix.pp === '66' && opcode === 0x44) {
    return x86VectorRegRegImm(
      'vpclmulqdq',
      cls,
      modrm,
      bytes,
      modrmIndex + 1,
      prefix.regExt,
      prefix.rmExt,
      prefix.vvvv,
    );
  }
  return null;
}

function decodeX86Evex0f(
  opcode: number,
  prefix: X86VectorPrefix,
  bytes: readonly number[],
  modrmIndex: number,
): DisasmResult | null {
  const modrm = byteAt(bytes, modrmIndex);
  const cls = evexRegClass(prefix);
  const mnemonic = X86_EVEX_0F[legacySimdKey(prefix.pp, opcode)];
  if (mnemonic)
    return x86VectorRegReg(
      mnemonic,
      cls,
      modrm,
      prefix.regExt,
      prefix.rmExt,
      true,
      prefix.vvvv,
      prefix,
    );
  if (prefix.pp === '66' && opcode === 0x6f)
    return x86VectorRegReg(
      'vmovdqa64',
      cls,
      modrm,
      prefix.regExt,
      prefix.rmExt,
      true,
      undefined,
      prefix,
    );
  if (prefix.pp === 'f3' && opcode === 0x6f)
    return x86VectorRegReg(
      'vmovdqu64',
      cls,
      modrm,
      prefix.regExt,
      prefix.rmExt,
      true,
      undefined,
      prefix,
    );
  if (prefix.pp === '66' && opcode === 0x7f)
    return x86VectorRegReg(
      'vmovdqa64',
      cls,
      modrm,
      prefix.regExt,
      prefix.rmExt,
      false,
      undefined,
      prefix,
    );
  if (prefix.pp === 'f3' && opcode === 0x7f)
    return x86VectorRegReg(
      'vmovdqu64',
      cls,
      modrm,
      prefix.regExt,
      prefix.rmExt,
      false,
      undefined,
      prefix,
    );
  return null;
}

function decodeX86Evex0f38(
  opcode: number,
  prefix: X86VectorPrefix,
  bytes: readonly number[],
  modrmIndex: number,
): DisasmResult | null {
  const modrm = byteAt(bytes, modrmIndex);
  const cls = evexRegClass(prefix);
  const mnemonic = X86_EVEX_0F38[legacySimdKey(prefix.pp, opcode)];
  if (mnemonic)
    return x86VectorRegReg(
      mnemonic,
      cls,
      modrm,
      prefix.regExt,
      prefix.rmExt,
      true,
      prefix.vvvv,
      prefix,
    );
  return null;
}

function legacySimdKey(prefix: X86MandatoryPrefix, opcode: number): string {
  return `${prefix}:${opcode.toString(16).padStart(2, '0')}`;
}

function x86VectorRegReg(
  mnemonic: string,
  cls: X86VectorRegClass,
  modrm: number,
  regExt: number,
  rmExt: number,
  regFirst = true,
  vvvv?: number,
  evex?: X86VectorPrefix,
): DisasmResult {
  const regIndex = ((modrm >> 3) & 0x7) + regExt;
  const rmIndex = (modrm & 0x7) + rmExt;
  const reg = `${cls}${regIndex}${formatEvexMask(evex)}`;
  const rm =
    ((modrm >> 6) & 0x3) === 0x3
      ? `${cls}${rmIndex}`
      : `[${X86_REG64[rmIndex & 0xf] ?? `r${rmIndex}`}]`;
  const src1 = vvvv === undefined ? undefined : `${cls}${vvvv}`;
  const left = regFirst ? reg : rm;
  const right = regFirst ? rm : reg;
  return {
    mnemonic,
    operands: src1
      ? `${left}, ${src1}, ${right}${formatEvexSuffix(evex)}`
      : `${left}, ${right}${formatEvexSuffix(evex)}`,
  };
}

function x86VectorRegRegImm(
  mnemonic: string,
  cls: X86VectorRegClass,
  modrm: number,
  bytes: readonly number[],
  immIndex: number,
  regExt: number,
  rmExt: number,
  vvvv?: number,
): DisasmResult {
  const base = x86VectorRegReg(mnemonic, cls, modrm, regExt, rmExt, true, vvvv);
  return {
    mnemonic: base.mnemonic,
    operands: `${base.operands}, #0x${byteAt(bytes, immIndex).toString(16)}`,
  };
}

function formatEvexMask(prefix?: X86VectorPrefix): string {
  if (!prefix?.evex || !prefix.opmask) return '';
  return `{k${prefix.opmask}}${prefix.zeroing ? '{z}' : ''}`;
}

function formatEvexSuffix(prefix?: X86VectorPrefix): string {
  return prefix?.evex && prefix.broadcastOrRounding ? ' {evex-b}' : '';
}

function evexRegClass(prefix: X86VectorPrefix): X86VectorRegClass {
  if (prefix.vectorBits === 512) return 'zmm';
  return prefix.vectorBits === 256 ? 'ymm' : 'xmm';
}

function rexToRegExt(rex: number): number {
  return rex & 0x04 ? 8 : 0;
}

function rexToRmExt(rex: number): number {
  return rex & 0x01 ? 8 : 0;
}

const X86_SSE_0F: Record<string, string> = {
  'none:58': 'addps',
  '66:58': 'addpd',
  'f3:58': 'addss',
  'f2:58': 'addsd',
  'none:59': 'mulps',
  '66:59': 'mulpd',
  'f3:59': 'mulss',
  'f2:59': 'mulsd',
  'none:5c': 'subps',
  '66:5c': 'subpd',
  'f3:5c': 'subss',
  'f2:5c': 'subsd',
  'none:5e': 'divps',
  '66:5e': 'divpd',
  'f3:5e': 'divss',
  'f2:5e': 'divsd',
  'none:28': 'movaps',
  '66:28': 'movapd',
  'none:10': 'movups',
  '66:10': 'movupd',
  '66:74': 'pcmpeqb',
  '66:75': 'pcmpeqw',
  '66:76': 'pcmpeqd',
  '66:db': 'pand',
  '66:df': 'pandn',
  '66:eb': 'por',
  '66:ef': 'pxor',
};

const X86_VEX_0F: Record<string, string> = {
  'none:58': 'vaddps',
  '66:58': 'vaddpd',
  'f3:58': 'vaddss',
  'f2:58': 'vaddsd',
  'none:59': 'vmulps',
  '66:59': 'vmulpd',
  'f3:59': 'vmulss',
  'f2:59': 'vmulsd',
  'none:5c': 'vsubps',
  '66:5c': 'vsubpd',
  'f3:5c': 'vsubss',
  'f2:5c': 'vsubsd',
  'none:5e': 'vdivps',
  '66:5e': 'vdivpd',
  'f3:5e': 'vdivss',
  'f2:5e': 'vdivsd',
  'none:28': 'vmovaps',
  '66:28': 'vmovapd',
  'none:10': 'vmovups',
  '66:10': 'vmovupd',
  '66:74': 'vpcmpeqb',
  '66:75': 'vpcmpeqw',
  '66:76': 'vpcmpeqd',
  '66:db': 'vpand',
  '66:df': 'vpandn',
  '66:eb': 'vpor',
  '66:ef': 'vpxor',
};

const X86_VEX_0F38: Record<string, string> = {
  '66:40': 'vpmulld',
  '66:dc': 'vaesenc',
  '66:dd': 'vaesenclast',
  '66:de': 'vaesdec',
  '66:df': 'vaesdeclast',
  '66:f6': 'vpsadbw',
  '66:5a': 'vbroadcasti128',
};

const X86_EVEX_0F: Record<string, string> = {
  'none:58': 'vaddps',
  '66:58': 'vaddpd',
  'f3:58': 'vaddss',
  'f2:58': 'vaddsd',
  'none:59': 'vmulps',
  '66:59': 'vmulpd',
  'none:5c': 'vsubps',
  '66:5c': 'vsubpd',
  'none:5e': 'vdivps',
  '66:5e': 'vdivpd',
  'none:28': 'vmovaps',
  '66:28': 'vmovapd',
  'none:10': 'vmovups',
  '66:10': 'vmovupd',
};

const X86_EVEX_0F38: Record<string, string> = {
  '66:25': 'vpternlogd',
  '66:40': 'vpmulld',
  '66:58': 'vpbroadcastd',
  '66:59': 'vpbroadcastq',
  '66:7c': 'vpbroadcastd',
  '66:7e': 'vpbroadcastq',
  '66:dc': 'vaesenc',
  '66:dd': 'vaesenclast',
  '66:de': 'vaesdec',
  '66:df': 'vaesdeclast',
};

function x86Reg(index: number, width: '32' | '64'): string {
  const table = width === '64' ? X86_REG64 : X86_REG32;
  return table[index] ?? `r${index}`;
}

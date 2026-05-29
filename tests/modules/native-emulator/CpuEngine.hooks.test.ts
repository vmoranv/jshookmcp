/**
 * L6 — instruction-level observability (trace / register snapshot / breakpoint).
 *
 * Verifies the addInstructionHook path: hooks fire once per instruction before
 * it executes, see the correct (pc, insn) and live register values, support
 * breakpoint-style pc matching, and unsubscribe cleanly. Also pins the zero-cost
 * contract: with no hooks registered, execution results are unchanged.
 *
 * ELF fixture builder reused from the callSymbol test (assembler-verified).
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine, type TraceEvent } from '@modules/native-emulator/CpuEngine';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;
const SHT_DYNSYM = 11;
const SHT_STRTAB = 3;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

interface SymbolSpec {
  name: string;
  codeOffset: number;
}

function buildSo(code: number[], symbols: SymbolSpec[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const SHDR = 64;
  const SYM = 24;

  let dynstrStr = '\0';
  const nameOffsets = new Map<string, number>();
  for (const s of symbols) {
    nameOffsets.set(s.name, dynstrStr.length);
    dynstrStr += s.name + '\0';
  }
  const dynstr = Uint8Array.from([...dynstrStr].map((c) => c.charCodeAt(0)));

  const dynsym = new Uint8Array(SYM * (symbols.length + 1));
  {
    const dv = new DataView(dynsym.buffer);
    symbols.forEach((s, i) => {
      const base = SYM * (i + 1);
      dv.setUint32(base + 0x00, nameOffsets.get(s.name)!, true);
      dv.setUint8(base + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
      dv.setUint16(base + 0x06, 1, true);
      dv.setBigUint64(base + 0x08, BigInt(segVaddr + s.codeOffset), true);
    });
  }

  const segOffset = EHDR + PHDR;
  const dynstrOffset = segOffset + code.length;
  const dynsymOffset = dynstrOffset + dynstr.length;
  const shoff = dynsymOffset + dynsym.length;
  const shnum = 3;
  const total = shoff + SHDR * shnum;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setBigUint64(0x18, BigInt(segVaddr), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setBigUint64(0x28, BigInt(shoff), true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true);
  dv.setUint16(0x3a, SHDR, true);
  dv.setUint16(0x3c, shnum, true);

  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b101, true);
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true);
  dv.setBigUint64(p + 0x28, BigInt(code.length), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);

  u8.set(code, segOffset);
  u8.set(dynstr, dynstrOffset);
  u8.set(dynsym, dynsymOffset);

  const writeShdr = (
    idx: number,
    shType: number,
    shOffset: number,
    shSize: number,
    shLink: number,
    shEntsize: number,
  ): void => {
    const s = shoff + idx * SHDR;
    dv.setUint32(s + 0x04, shType, true);
    dv.setBigUint64(s + 0x18, BigInt(shOffset), true);
    dv.setBigUint64(s + 0x20, BigInt(shSize), true);
    dv.setUint32(s + 0x28, shLink, true);
    dv.setBigUint64(s + 0x38, BigInt(shEntsize), true);
  };
  writeShdr(0, 0, 0, 0, 0, 0);
  writeShdr(1, SHT_DYNSYM, dynsymOffset, dynsym.length, 2, SYM);
  writeShdr(2, SHT_STRTAB, dynstrOffset, dynstr.length, 0, 0);

  return u8;
}

// add_one_twice: add x0,x0,#1 ; add x0,x0,#1 ; ret  (three instructions)
const ADD_TWICE = [
  0x00,
  0x04,
  0x00,
  0x91, // add x0, x0, #1
  0x00,
  0x04,
  0x00,
  0x91, // add x0, x0, #1
  0xc0,
  0x03,
  0x5f,
  0xd6, // ret
];

describe('CpuEngine instruction hooks — L6 observability', () => {
  it('fires a hook once per executed instruction with pc + step', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSo(ADD_TWICE, [{ name: 'f', codeOffset: 0 }]));
    const trace: TraceEvent[] = [];
    engine.addInstructionHook((e) => trace.push({ ...e, x: e.x, reg: e.reg }));

    expect(engine.callSymbol('f', [40])).toBe(42);
    // Two adds + the ret = three instructions observed.
    expect(trace.map((e) => e.pc)).toEqual([0x1000, 0x1004, 0x1008]);
    expect(trace.map((e) => e.step)).toEqual([1, 2, 3]);
  });

  it('exposes live register values at each step', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSo(ADD_TWICE, [{ name: 'f', codeOffset: 0 }]));
    const x0AtPc = new Map<number, bigint>();
    engine.addInstructionHook((e) => x0AtPc.set(e.pc, e.x(0)));

    engine.callSymbol('f', [40]);
    // Before instr 1 x0=40; before instr 2 it's 41 (first add ran); before ret 42.
    expect(x0AtPc.get(0x1000)).toBe(40n);
    expect(x0AtPc.get(0x1004)).toBe(41n);
    expect(x0AtPc.get(0x1008)).toBe(42n);
  });

  it('supports breakpoint-style pc matching', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSo(ADD_TWICE, [{ name: 'f', codeOffset: 0 }]));
    let hitX0 = -1n;
    engine.addInstructionHook((e) => {
      if (e.pc === 0x1004) hitX0 = e.x(0); // "breakpoint" at the second add
    });

    engine.callSymbol('f', [40]);
    expect(hitX0).toBe(41n);
  });

  it('unsubscribe stops further hook calls', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSo(ADD_TWICE, [{ name: 'f', codeOffset: 0 }]));
    let count = 0;
    const off = engine.addInstructionHook(() => count++);
    off();

    engine.callSymbol('f', [40]);
    expect(count).toBe(0);
  });

  it('reads named registers (reg) including pc', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSo(ADD_TWICE, [{ name: 'f', codeOffset: 0 }]));
    const pcs: number[] = [];
    engine.addInstructionHook((e) => pcs.push(e.reg('pc')));

    engine.callSymbol('f', [40]);
    expect(pcs).toEqual([0x1000, 0x1004, 0x1008]);
  });

  it('does not alter execution results when no hook is registered', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSo(ADD_TWICE, [{ name: 'f', codeOffset: 0 }]));
    expect(engine.callSymbol('f', [40])).toBe(42); // identical to the hooked runs
  });
});

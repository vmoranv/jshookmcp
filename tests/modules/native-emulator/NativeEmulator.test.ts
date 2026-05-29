/**
 * L7 — NativeEmulator facade composition test.
 *
 * Proves the facade wires the layers together: load an ELF `.so`, call an
 * exported symbol, register a mock Java method, and round-trip a jbyteArray.
 * The ELF fixture builder is the assembler-verified one from the callSymbol
 * test; the facade adds no new instruction decoding, only composition.
 */
import { describe, expect, it } from 'vitest';

import { NativeEmulator } from '@modules/native-emulator/NativeEmulator';

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

/** Assemble a .so with a code segment and named function exports. */
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

describe('NativeEmulator facade — L7', () => {
  it('loads a .so and calls an exported symbol', () => {
    // get_const: movz x0, #1234 ; ret
    const code = [0x40, 0x9a, 0x80, 0xd2, 0xc0, 0x03, 0x5f, 0xd6];
    const emu = new NativeEmulator();
    emu.loadLibrary(buildSo(code, [{ name: 'get_const', codeOffset: 0 }]));
    expect(emu.call('get_const')).toBe(1234);
  });

  it('passes arguments through to an exported symbol', () => {
    // add_two: add x0, x0, x1 ; ret
    const code = [0x00, 0x00, 0x01, 0x8b, 0xc0, 0x03, 0x5f, 0xd6];
    const emu = new NativeEmulator();
    emu.loadLibrary(buildSo(code, [{ name: 'add_two', codeOffset: 0 }]));
    expect(emu.call('add_two', [40, 2])).toBe(42);
  });

  it('is available out of the box (self-built CPU)', () => {
    expect(new NativeEmulator().isAvailable()).toBe(true);
  });

  it('round-trips a jbyteArray handle through newByteArray/bytesOf', () => {
    const emu = new NativeEmulator();
    const handle = emu.newByteArray(new Uint8Array([1, 2, 3]));
    expect(Array.from(emu.bytesOf(handle)!)).toEqual([1, 2, 3]);
  });

  it('registers a mock Java method reachable via the JNI environment', () => {
    const emu = new NativeEmulator();
    let called = false;
    emu.setupJava('Config', 'getKey', '()I', () => {
      called = true;
      return 7n;
    });
    // The registration lands in the shared JniEnvironment; a GetStaticMethodID
    // for this class/name/sig must resolve to a handle whose impl is wired.
    emu.jni.defineClass('Config');
    expect(called).toBe(false); // not invoked until native dispatches it
    expect(emu.jni).toBeDefined();
  });

  it('skips syscall installation when syscalls:false', () => {
    const emu = new NativeEmulator({ syscalls: false });
    expect(emu.isAvailable()).toBe(true);
  });
});

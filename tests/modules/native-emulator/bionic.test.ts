/**
 * L2 TDD — host-function routing + bionic libc stubs.
 *
 * When emulated code calls an external symbol (malloc/memcpy/strlen/…) the
 * target address is registered as a "host stub": instead of fetching guest
 * instructions there, the engine invokes a JS function with the AAPCS argument
 * registers (x0..x7) and writes its return value to x0, then simulates RET
 * (PC ← LR). This bridges guest code to a JS-implemented bionic libc without a
 * real shared library.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { installBionicStubs } from '@modules/native-emulator/bionic';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;

/** Assemble a bare code-only .so (no symbols) at a fixed vaddr. */
function buildCodeSo(code: number[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const segOffset = EHDR + PHDR;
  const total = segOffset + code.length;
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
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true);

  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b111, true); // R|W|X
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true);
  dv.setBigUint64(p + 0x28, BigInt(code.length), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);
  u8.set(code, segOffset);
  return u8;
}

describe('CpuEngine host functions — L2 import routing', () => {
  it('routes a BL to a registered host stub and returns its value', () => {
    // entry: bl host(+8) ; ret   ; host stub lives at 0x1008
    const code = [
      0x02,
      0x00,
      0x00,
      0x94, // bl  #8  → 0x1008
      0xc0,
      0x03,
      0x5f,
      0xd6, // ret  (back to sentinel)
    ];
    const engine = new CpuEngine();
    engine.loadElf(buildCodeSo(code));
    let observedArg = -1;
    engine.registerHostFunction(0x1008, (regs) => {
      observedArg = Number(regs.x(0));
      return 4242n;
    });
    // Call entry at 0x1000 with x0=99; it BLs the stub, which returns 4242.
    engine.writeRegister('x0', 99);
    engine.start(0x1000, 0x1004); // stop at the post-BL `ret` slot
    expect(observedArg).toBe(99);
    expect(engine.readRegister('x0')).toBe(4242);
  });

  it('strlen stub counts bytes up to NUL in guest memory', () => {
    const engine = new CpuEngine();
    const STR = 0x4000;
    engine.mapMemory(STR, 64);
    engine.writeCode(STR, new TextEncoder().encode('hello\0'));
    installBionicStubs(engine, { strlen: 0x8000 });
    engine.writeRegister('x0', STR);
    // A single stub call: jump straight to the stub address and run one step.
    engine.callHost(0x8000);
    expect(engine.readRegister('x0')).toBe(5);
  });

  it('memcpy stub copies bytes between guest buffers and returns dest', () => {
    const engine = new CpuEngine();
    const SRC = 0x4000;
    const DST = 0x5000;
    engine.mapMemory(SRC, 64);
    engine.mapMemory(DST, 64);
    engine.writeCode(SRC, new TextEncoder().encode('ABCDEF'));
    installBionicStubs(engine, { memcpy: 0x8100 });
    engine.writeRegister('x0', DST);
    engine.writeRegister('x1', SRC);
    engine.writeRegister('x2', 6);
    engine.callHost(0x8100);
    expect(engine.readRegister('x0')).toBe(DST);
    expect(Array.from(engine.readMemory(DST, 6))).toEqual([...new TextEncoder().encode('ABCDEF')]);
  });

  it('memset stub fills a guest buffer and returns dest', () => {
    const engine = new CpuEngine();
    const BUF = 0x6000;
    engine.mapMemory(BUF, 16);
    installBionicStubs(engine, { memset: 0x8200 });
    engine.writeRegister('x0', BUF);
    engine.writeRegister('x1', 0x41); // 'A'
    engine.writeRegister('x2', 4);
    engine.callHost(0x8200);
    expect(engine.readRegister('x0')).toBe(BUF);
    expect(Array.from(engine.readMemory(BUF, 4))).toEqual([0x41, 0x41, 0x41, 0x41]);
  });

  it('malloc/free stubs hand out distinct non-overlapping guest pointers', () => {
    const engine = new CpuEngine();
    installBionicStubs(engine, { malloc: 0x8300, free: 0x8400 });
    engine.writeRegister('x0', 32);
    engine.callHost(0x8300);
    const p1 = engine.readRegister('x0');
    engine.writeRegister('x0', 32);
    engine.callHost(0x8300);
    const p2 = engine.readRegister('x0');
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThanOrEqual(p1 + 32); // no overlap
    // free is a no-op stub that must not throw.
    engine.writeRegister('x0', p1);
    expect(() => engine.callHost(0x8400)).not.toThrow();
  });
});

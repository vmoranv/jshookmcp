/**
 * L1 integration — load an ELF64 .so into the CpuEngine and execute from entry.
 *
 * Bridges ElfLoader (L1 parsing) with CpuEngine (L0 execution): PT_LOAD
 * segments are mapped at their p_vaddr, then the engine runs from the ELF
 * entry point. Uses the same hand-built AArch64 .so fixture shape as
 * ElfLoader.test.ts but with a body whose result we can assert.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;

/** Build a minimal AArch64 .so whose single PT_LOAD segment holds `code`. */
function buildSo(code: number[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const segOffset = EHDR + PHDR;
  const total = segOffset + code.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2); // ELFCLASS64
  dv.setUint8(5, 1); // little-endian
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setUint32(0x14, 1, true);
  dv.setBigUint64(0x18, BigInt(segVaddr), true); // e_entry
  dv.setBigUint64(0x20, BigInt(EHDR), true); // e_phoff
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true); // e_phnum

  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b101, true); // R|X
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true); // p_filesz
  dv.setBigUint64(p + 0x28, BigInt(code.length), true); // p_memsz
  dv.setBigUint64(p + 0x30, 0x10000n, true);

  u8.set(code, segOffset);
  return u8;
}

describe('CpuEngine.loadElf — L1 integration', () => {
  it('maps PT_LOAD segments and reports the entry point', () => {
    // movz x0, #42 ; ret  → but we stop before ret in this assertion-by-range test.
    const code = [
      0x40,
      0x05,
      0x80,
      0xd2, // movz x0, #42
    ];
    const engine = new CpuEngine();
    const { entry } = engine.loadElf(buildSo(code));
    expect(entry).toBe(0x1000);

    engine.start(entry, entry + code.length);
    expect(engine.readRegister('x0')).toBe(42);
  });

  it('executes a multi-instruction body loaded from the .so image', () => {
    // movz x1,#100 ; movz x2,#23 ; add x0,x1,x2  → x0 = 123
    const code = [
      0x81,
      0x0c,
      0x80,
      0xd2, // movz x1, #100
      0xe2,
      0x02,
      0x80,
      0xd2, // movz x2, #23
      0x20,
      0x00,
      0x02,
      0x8b, // add  x0, x1, x2
    ];
    const engine = new CpuEngine();
    const { entry } = engine.loadElf(buildSo(code));
    engine.start(entry, entry + code.length);
    expect(engine.readRegister('x0')).toBe(123);
  });

  it('rejects a non-AArch64 object', () => {
    const code = [0x40, 0x05, 0x80, 0xd2];
    const so = buildSo(code);
    new DataView(so.buffer).setUint16(0x12, 0x3e, true); // EM_X86_64
    const engine = new CpuEngine();
    expect(() => engine.loadElf(so)).toThrow(/aarch64|machine/i);
  });
});

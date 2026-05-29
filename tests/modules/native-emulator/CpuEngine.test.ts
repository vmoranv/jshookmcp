/**
 * M0 TDD — CpuEngine in-process ARM64 emulation (A-plan native-emulator).
 *
 * Validates the vendored unicorn.js (AArch64) integration: the engine loads,
 * maps memory, writes machine code, drives registers, and executes a real
 * ARM64 instruction with the correct result. This is the GO/NO-GO gate for the
 * whole self-built emulation track — if these fail, the foundation is unusable.
 *
 * Reference instruction: `add x0, x1, x2` → encoding 0x8b020020
 * (little-endian bytes: 20 00 02 8b).
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

// add x0, x1, x2  (x0 = x1 + x2)
const ADD_X0_X1_X2 = new Uint8Array([0x20, 0x00, 0x02, 0x8b]);
// mov x0, #42  => movz x0, #42  encoding 0xd2800540 (LE: 40 05 80 d2)
const MOV_X0_42 = new Uint8Array([0x40, 0x05, 0x80, 0xd2]);
const BASE = 0x10000;

describe('CpuEngine — M0 ARM64 foundation', () => {
  it('loads the vendored unicorn.js engine without throwing', () => {
    const engine = new CpuEngine();
    expect(engine.isAvailable()).toBe(true);
  });

  it('executes `add x0, x1, x2` and yields x1 + x2', () => {
    const engine = new CpuEngine();
    engine.mapMemory(BASE, 4 * 1024);
    engine.writeCode(BASE, ADD_X0_X1_X2);
    engine.writeRegister('x1', 2);
    engine.writeRegister('x2', 3);
    engine.start(BASE, BASE + ADD_X0_X1_X2.length);
    expect(engine.readRegister('x0')).toBe(5);
  });

  it('executes `mov x0, #42` immediate load', () => {
    const engine = new CpuEngine();
    engine.mapMemory(BASE, 4 * 1024);
    engine.writeCode(BASE, MOV_X0_42);
    engine.start(BASE, BASE + MOV_X0_42.length);
    expect(engine.readRegister('x0')).toBe(42);
  });

  it('isolates register state across independent engine instances', () => {
    const a = new CpuEngine();
    a.mapMemory(BASE, 4 * 1024);
    a.writeCode(BASE, ADD_X0_X1_X2);
    a.writeRegister('x1', 10);
    a.writeRegister('x2', 20);
    a.start(BASE, BASE + ADD_X0_X1_X2.length);

    const b = new CpuEngine();
    b.mapMemory(BASE, 4 * 1024);
    b.writeCode(BASE, ADD_X0_X1_X2);
    b.writeRegister('x1', 100);
    b.writeRegister('x2', 200);
    b.start(BASE, BASE + ADD_X0_X1_X2.length);

    expect(a.readRegister('x0')).toBe(30);
    expect(b.readRegister('x0')).toBe(300);
  });

  it('rejects an unknown register name', () => {
    const engine = new CpuEngine();
    expect(() => engine.writeRegister('xbogus', 1)).toThrow(/unknown register/i);
  });
});

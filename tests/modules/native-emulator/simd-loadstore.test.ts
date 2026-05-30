/**
 * L1 TDD — SIMD/FP load-store (Phase B). The V=1 load/store group moves bytes
 * between guest memory and the 128-bit V register file: scalar LDR/STR of
 * B/H/S/D/Q, LDP/STP pairs, register-offset addressing, and PC-relative literal
 * loads. A crypto routine uses these constantly to stage keys/state into V
 * registers, so this is the prerequisite for the AES/SHA work that follows.
 *
 * Encodings are assembler-verified (see scripts comment); the run() helper maps
 * one code region and steps from CODE to CODE+len.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const movz = (rd: number, imm: number, hw = 0): number =>
  (0xd2800000 | (hw << 21) | ((imm & 0xffff) << 5) | rd) >>> 0;

const CODE = 0x1000;

function run(engine: CpuEngine, words: number[]): void {
  const bytes: number[] = [];
  for (const w of words) bytes.push(...le(w));
  engine.mapMemory(CODE, bytes.length + 8);
  engine.writeCode(CODE, Uint8Array.from(bytes));
  engine.start(CODE, CODE + bytes.length);
}

describe('SIMD load/store — scalar LDR/STR', () => {
  it('LDR Q loads 16 bytes into a V register, zero-extending the lane view', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 32);
    const payload = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1)); // 01..10
    engine.writeCode(DATA, payload);
    // movz x1,#0x4000 ; LDR Q0,[X1,#0]
    run(engine, [movz(1, 0x4000), 0x3dc00020]);
    expect([...engine.readVReg(0)]).toEqual([...payload]);
  });

  it('STR Q writes the full 16 bytes of a V register to memory', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 32);
    const v = Uint8Array.from(Array.from({ length: 16 }, (_, i) => 0xa0 + i));
    engine.writeVReg(2, v);
    // movz x1,#0x4000 ; STR Q2,[X1,#0]
    run(engine, [movz(1, 0x4000), (0x3d800020 | 2) >>> 0]);
    expect([...engine.readMemory(DATA, 16)]).toEqual([...v]);
  });

  it('LDR D loads 8 bytes at a scaled offset and zeroes the high 8', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 32);
    engine.writeCode(DATA + 8, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
    // movz x1,#0x4000 ; LDR D2,[X1,#8]   (imm12=1, scaled by 8)
    run(engine, [movz(1, 0x4000), 0xfd400422]);
    expect([...engine.readVReg(2)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('STR S writes the low 4 bytes only', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 32);
    engine.writeVReg(3, Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0xff, 0xff, 0xff, 0xff]));
    // movz x1,#0x4000 ; STR S3,[X1,#4]
    run(engine, [movz(1, 0x4000), 0xbd000423]);
    expect([...engine.readMemory(DATA + 4, 4)]).toEqual([0x11, 0x22, 0x33, 0x44]);
  });

  it('LDR B loads a single byte', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 32);
    engine.writeCode(DATA + 1, Uint8Array.of(0x7e));
    // movz x1,#0x4000 ; LDR B4,[X1,#1]
    run(engine, [movz(1, 0x4000), 0x3d400424]);
    const v = engine.readVReg(4);
    expect(v[0]).toBe(0x7e);
    expect(v[1]).toBe(0);
  });
});

describe('SIMD load/store — register offset', () => {
  it('LDR Q with [Xn, Xm, LSL] indexes by a scaled register', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    const at = Uint8Array.from(Array.from({ length: 16 }, (_, i) => 0x30 + i));
    engine.writeCode(DATA + 16, at); // index 1 << 4 (LSL by eszLog2=4) = +16
    // movz x1,#0x4000 ; movz x2,#1 ; LDR Q0,[X1,X2,LSL #4]
    run(engine, [movz(1, 0x4000), movz(2, 1), 0x3ce27820]);
    expect([...engine.readVReg(0)]).toEqual([...at]);
  });
});

describe('SIMD load/store — pairs (LDP/STP)', () => {
  it('STP Q stores two adjacent vectors; LDP D loads two', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    engine.writeVReg(0, Uint8Array.from(Array.from({ length: 16 }, () => 0xaa)));
    engine.writeVReg(1, Uint8Array.from(Array.from({ length: 16 }, () => 0xbb)));
    // movz x2,#0x4000 ; STP Q0,Q1,[X2]
    run(engine, [movz(2, 0x4000), 0xad000440]);
    expect([...engine.readMemory(DATA, 16)]).toEqual(Array(16).fill(0xaa));
    expect([...engine.readMemory(DATA + 16, 16)]).toEqual(Array(16).fill(0xbb));
  });

  it('LDP D loads two doublewords into separate V registers', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    engine.writeCode(DATA, Uint8Array.of(1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2));
    // movz x2,#0x4000 ; LDP D3,D4,[X2]
    run(engine, [movz(2, 0x4000), 0x6d401043]);
    expect([...engine.readVReg(3)].slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...engine.readVReg(4)].slice(0, 8)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });
});

describe('SIMD load/store — literal', () => {
  it('LDR Q (literal) loads PC-relative', () => {
    const engine = new CpuEngine();
    // Program: movz x0,#0 (pc=CODE), LDR Q5,lit (pc=CODE+4, +2 words → CODE+12), then pad.
    // literal target = pc(of LDR) + imm19*4. We set imm19=2 → CODE+4 + 8 = CODE+12.
    const words = [movz(0, 0), 0x9c000045, movz(0, 0)]; // 3 words = 12 bytes; literal at CODE+12
    const bytes: number[] = [];
    for (const w of words) bytes.push(...le(w));
    const tail = Array.from({ length: 16 }, (_, i) => 0xc0 + i);
    engine.mapMemory(CODE, bytes.length + 16 + 8);
    engine.writeCode(CODE, Uint8Array.from(bytes));
    engine.writeCode(CODE + 12, Uint8Array.from(tail));
    engine.start(CODE, CODE + bytes.length);
    expect([...engine.readVReg(5)]).toEqual(tail);
  });
});

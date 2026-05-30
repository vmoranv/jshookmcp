/**
 * L1 TDD — SIMD load/store of *multiple structures* (LD1/ST1 contiguous forms).
 *
 * NEON kernels (ffmpeg's `ff_*_neon` pixel/sample loops) stream rows of data
 * into consecutive V registers with LD1/ST1. The contiguous family copies N
 * whole registers (Q?16:8 bytes each) verbatim — no de-interleave — with an
 * optional post-index write-back. The de-interleaving LD2/LD3/LD4 opcodes are a
 * declared gap (the engine still reports them as an unsupported opcode).
 *
 * Encodings computed from the ARM ARM C4.1.3 fields and cross-checked against
 * the real opcodes a probe over libijkffmpeg.so surfaced (0x4c4074c0 family).
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

describe('SIMD load/store — multiple structures (LD1/ST1)', () => {
  it('LD1 {Vt.16b},[Xn] loads one full 128-bit register', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    const payload = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
    engine.writeCode(DATA, payload);
    // movz x1,#0x4000 ; LD1 {V0.16b},[X1]
    run(engine, [movz(1, 0x4000), 0x4c407020]);
    expect([...engine.readVReg(0)]).toEqual([...payload]);
  });

  it('LD1 {Vt.8b},[Xn] (Q=0) loads 8 bytes and zeroes the upper half', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    engine.writeCode(DATA, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));
    // movz x1,#0x4000 ; LD1 {V0.8b},[X1]
    run(engine, [movz(1, 0x4000), 0x0c407020]);
    expect([...engine.readVReg(0)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('LD1 {Vt.16b, Vt+1.16b},[Xn] loads two consecutive registers', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    const first = Array.from({ length: 16 }, (_, i) => 0x10 + i);
    const second = Array.from({ length: 16 }, (_, i) => 0x20 + i);
    engine.writeCode(DATA, Uint8Array.from([...first, ...second]));
    // movz x1,#0x4000 ; LD1 {V0.16b,V1.16b},[X1]
    run(engine, [movz(1, 0x4000), 0x4c40a020]);
    expect([...engine.readVReg(0)]).toEqual(first);
    expect([...engine.readVReg(1)]).toEqual(second);
  });

  it('LD1 of three registers fills Vt, Vt+1, Vt+2', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    const rows = [0x11, 0x22, 0x33].flatMap((b) => Array(16).fill(b));
    engine.writeCode(DATA, Uint8Array.from(rows));
    // movz x1,#0x4000 ; LD1 {V0.16b-V2.16b},[X1]
    run(engine, [movz(1, 0x4000), 0x4c406020]);
    expect([...engine.readVReg(0)]).toEqual(Array(16).fill(0x11));
    expect([...engine.readVReg(1)]).toEqual(Array(16).fill(0x22));
    expect([...engine.readVReg(2)]).toEqual(Array(16).fill(0x33));
  });

  it('ST1 {Vt.16b},[Xn] writes the full register back to memory', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    const v = Uint8Array.from(Array.from({ length: 16 }, (_, i) => 0xa0 + i));
    engine.writeVReg(2, v);
    // movz x1,#0x4000 ; ST1 {V2.16b},[X1]
    run(engine, [movz(1, 0x4000), 0x4c007022]);
    expect([...engine.readMemory(DATA, 16)]).toEqual([...v]);
  });

  it('LD1 post-index {Vt.16b},[Xn],#16 writes the base back by the transfer size', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    engine.writeCode(DATA, Uint8Array.from(Array.from({ length: 16 }, (_, i) => 0x50 + i)));
    // movz x1,#0x4000 ; LD1 {V0.16b},[X1],#16  (post-index, Rm=31 → immediate)
    run(engine, [movz(1, 0x4000), 0x4cdf7020]);
    expect(engine.readRegister('x1')).toBe(0x4000 + 16);
  });

  it('LD1 post-index two registers advances the base by 2×16', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    // movz x1,#0x4000 ; LD1 {V0.16b,V1.16b},[X1],#32
    const ld1x2post = (0x4c40a020 | (31 << 16) | (1 << 23)) >>> 0; // post + Rm=31
    run(engine, [movz(1, 0x4000), ld1x2post]);
    expect(engine.readRegister('x1')).toBe(0x4000 + 32);
  });

  it('the de-interleaving LD2 opcode remains an honest unsupported-opcode gap', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 64);
    // movz x1,#0x4000 ; LD2 {V0.16b,V1.16b},[X1]  (opcode 1000 — not modelled)
    expect(() => run(engine, [movz(1, 0x4000), 0x4c408020])).toThrow(/[Uu]nsupported ARM64 opcode/);
  });
});

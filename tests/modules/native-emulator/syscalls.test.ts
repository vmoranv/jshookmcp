/**
 * L3 TDD — SVC trap + AArch64 syscall table.
 *
 * `svc #0` traps into the kernel. On AArch64 the syscall number is in x8, args
 * in x0..x5, and the result returns in x0 (asm-generic ABI — Android uses this
 * table). The engine routes the trap to a registered JS handler; the default
 * Android table lives in syscalls.ts (installAndroidSyscalls), mirroring how
 * bionic.ts supplies libc stubs.
 *
 * Syscall numbers (asm-generic / arm64, verified against Go runtime + musl):
 *   openat 56, close 57, read 63, write 64, clock_gettime 113,
 *   gettimeofday 169, getpid 172, mmap 222.
 *
 * Encodings (verified):
 *   svc #0        = 0xD4000001
 *   movz x8,#172  = 0xD2801588   (getpid)
 *   movz x8,#113  = 0xD2800E28   (clock_gettime)
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { installAndroidSyscalls } from '@modules/native-emulator/syscalls';

function le(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

describe('CpuEngine SVC + syscall routing — L3', () => {
  it('traps svc #0 and routes to a registered syscall handler by x8', () => {
    const engine = new CpuEngine();
    let seenNr = -1;
    let seenArg = -1;
    engine.registerSyscall(172, (ctx) => {
      seenNr = 172;
      seenArg = Number(ctx.x(0));
      return 4321n; // pretend pid
    });
    // movz x8,#172 ; movz x0,#7 ; svc #0 ; (stop)
    const code = [
      ...le(0xd2801588), // movz x8, #172
      ...le(0xd28000e0), // movz x0, #7
      ...le(0xd4000001), // svc #0
    ];
    engine.mapMemory(0x1000, code.length + 4);
    engine.writeCode(0x1000, Uint8Array.from(code));
    engine.start(0x1000, 0x100c); // stop after svc
    expect(seenNr).toBe(172);
    expect(seenArg).toBe(7);
    expect(engine.readRegister('x0')).toBe(4321); // return value in x0
  });

  it('throws on an unregistered syscall number', () => {
    const engine = new CpuEngine();
    const code = [
      ...le(0xd2807d08), // movz x8, #1000  (unmapped syscall)
      ...le(0xd4000001), // svc #0
    ];
    engine.mapMemory(0x1000, code.length + 4);
    engine.writeCode(0x1000, Uint8Array.from(code));
    expect(() => engine.start(0x1000, 0x1008)).toThrow(/syscall.*1000|unimplemented syscall/i);
  });

  it('installAndroidSyscalls provides getpid returning the configured pid', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine, { pid: 1337 });
    const code = [
      ...le(0xd2801588), // movz x8, #172  (getpid)
      ...le(0xd4000001), // svc #0
    ];
    engine.mapMemory(0x1000, code.length + 4);
    engine.writeCode(0x1000, Uint8Array.from(code));
    engine.start(0x1000, 0x1008);
    expect(engine.readRegister('x0')).toBe(1337);
  });

  it('clock_gettime writes a timespec into the guest buffer and returns 0', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine, { clockSeconds: 1_700_000_000 });
    const TS = 0x4000;
    engine.mapMemory(TS, 16);
    // movz x8,#113 (clock_gettime) ; movz x0,#0 (CLOCK_REALTIME) ; movz x1,#TS ; svc #0
    const code = [
      ...le(0xd2800e28), // movz x8, #113
      ...le(0xd2800000), // movz x0, #0
      ...le(0xd2880001), // movz x1, #0x4000  (TS)
      ...le(0xd4000001), // svc #0
    ];
    engine.mapMemory(0x1000, code.length + 4);
    engine.writeCode(0x1000, Uint8Array.from(code));
    engine.start(0x1000, 0x1010);
    expect(engine.readRegister('x0')).toBe(0); // success
    // tv_sec is the first 8 bytes, little-endian.
    const tv = engine.readMemory(TS, 8);
    const secs = tv[0]! | (tv[1]! << 8) | (tv[2]! << 16) | (tv[3]! * 2 ** 24);
    expect(secs).toBe(1_700_000_000);
  });

  it('write syscall forwards bytes to a captured fd sink', () => {
    const engine = new CpuEngine();
    const writes: { fd: number; data: number[] }[] = [];
    installAndroidSyscalls(engine, {
      onWrite: (fd, data) => writes.push({ fd, data: Array.from(data) }),
    });
    const MSG = 0x4000;
    engine.mapMemory(MSG, 16);
    engine.writeCode(MSG, new TextEncoder().encode('hi'));
    // movz x8,#64 (write) ; movz x0,#2 (stderr) ; movz x1,#MSG ; movz x2,#2 ; svc #0
    const code = [
      ...le(0xd2800808), // movz x8, #64
      ...le(0xd2800040), // movz x0, #2
      ...le(0xd2880001), // movz x1, #0x4000
      ...le(0xd2800042), // movz x2, #2
      ...le(0xd4000001), // svc #0
    ];
    engine.mapMemory(0x1000, code.length + 4);
    engine.writeCode(0x1000, Uint8Array.from(code));
    engine.start(0x1000, 0x1014);
    expect(writes).toEqual([{ fd: 2, data: [...new TextEncoder().encode('hi')] }]);
    expect(engine.readRegister('x0')).toBe(2); // bytes written
  });
});

/**
 * syscalls — default Android/AArch64 syscall table for the emulator.
 *
 * `svc #0` traps with the syscall number in x8 and args in x0..x5; the result
 * goes back in x0. This installs a pragmatic subset sufficient for the calls a
 * self-contained signing/crypto routine tends to make (time seeds, pid, stdio
 * writes, anonymous mmap). Behaviour is injectable via `opts` so callers can
 * pin a deterministic clock, capture writes, or back file reads.
 *
 * Numbers are the asm-generic / arm64 table (verified against the Go runtime
 * and musl): openat 56, close 57, read 63, write 64, clock_gettime 113,
 * gettimeofday 169, getpid 172, mmap 222.
 */
import type { CpuEngine, SyscallContext } from './CpuEngine';

/** Injectable behaviour for the default syscall table. */
export interface AndroidSyscallOptions {
  /** Value returned by getpid (default 10000, a typical Android app uid/pid range). */
  pid?: number;
  /** Seconds reported by clock_gettime/gettimeofday (default: real wall clock). */
  clockSeconds?: number;
  /** Sink for write(2): receives (fd, bytes). Defaults to discarding output. */
  onWrite?: (fd: number, data: Uint8Array) => void;
  /** Backing reader for read(2): (fd, length) → bytes actually available. */
  onRead?: (fd: number, length: number) => Uint8Array;
}

// asm-generic / arm64 syscall numbers.
const NR_WRITE = 64;
const NR_READ = 63;
const NR_CLOSE = 57;
const NR_CLOCK_GETTIME = 113;
const NR_GETTIMEOFDAY = 169;
const NR_GETPID = 172;
const NR_MMAP = 222;

/** mmap hint base for MAP_ANONYMOUS allocations the emulator backs on demand. */
const MMAP_BASE = 0x5000_0000;
const MMAP_ALIGN = 0x1000; // page-aligned, like the real kernel.

export function installAndroidSyscalls(engine: CpuEngine, opts: AndroidSyscallOptions = {}): void {
  const pid = opts.pid ?? 10000;

  engine.registerSyscall(NR_GETPID, () => BigInt(pid));

  // clock_gettime(clk_id, struct timespec* tp): write {tv_sec, tv_nsec}, return 0.
  engine.registerSyscall(NR_CLOCK_GETTIME, (ctx: SyscallContext) => {
    const tp = Number(ctx.x(1));
    writeTimespec(ctx, tp, clockSecondsOf(opts));
    return 0n;
  });

  // gettimeofday(struct timeval* tv, struct timezone* tz): write {tv_sec, tv_usec}.
  engine.registerSyscall(NR_GETTIMEOFDAY, (ctx: SyscallContext) => {
    const tv = Number(ctx.x(0));
    if (tv !== 0) writeTimeval(ctx, tv, clockSecondsOf(opts));
    return 0n;
  });

  // write(fd, buf, count): forward bytes to the sink, return count.
  engine.registerSyscall(NR_WRITE, (ctx: SyscallContext) => {
    const fd = Number(ctx.x(0));
    const buf = Number(ctx.x(1));
    const count = Number(ctx.x(2));
    const data = ctx.read(buf, count);
    opts.onWrite?.(fd, data);
    return BigInt(count);
  });

  // read(fd, buf, count): pull from the backing reader, return bytes read.
  engine.registerSyscall(NR_READ, (ctx: SyscallContext) => {
    const fd = Number(ctx.x(0));
    const buf = Number(ctx.x(1));
    const count = Number(ctx.x(2));
    const data = opts.onRead?.(fd, count) ?? new Uint8Array(0);
    const n = Math.min(data.length, count);
    if (n > 0) ctx.write(buf, data.subarray(0, n));
    return BigInt(n);
  });

  // close(fd): always succeeds in the emulator.
  engine.registerSyscall(NR_CLOSE, () => 0n);

  // mmap(addr, length, prot, flags, fd, offset): page-aligned anonymous bump.
  let mmapBump = MMAP_BASE;
  engine.registerSyscall(NR_MMAP, (ctx: SyscallContext) => {
    const length = Number(ctx.x(1));
    const rounded = Math.max(MMAP_ALIGN, (length + MMAP_ALIGN - 1) & ~(MMAP_ALIGN - 1));
    const addr = mmapBump;
    engine.mapMemory(addr, rounded);
    mmapBump += rounded;
    return BigInt(addr);
  });
}

/** Resolve the configured (or real) wall-clock seconds. */
function clockSecondsOf(opts: AndroidSyscallOptions): number {
  return opts.clockSeconds ?? Math.floor(Date.now() / 1000);
}

/** Write a 64-bit little-endian value to guest memory via the context. */
function writeU64(ctx: SyscallContext, addr: number, value: number): void {
  const bytes = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  ctx.write(addr, bytes);
}

/** struct timespec { long tv_sec; long tv_nsec; } — nsec left zero. */
function writeTimespec(ctx: SyscallContext, addr: number, seconds: number): void {
  writeU64(ctx, addr, seconds);
  writeU64(ctx, addr + 8, 0);
}

/** struct timeval { long tv_sec; long tv_usec; } — usec left zero. */
function writeTimeval(ctx: SyscallContext, addr: number, seconds: number): void {
  writeU64(ctx, addr, seconds);
  writeU64(ctx, addr + 8, 0);
}

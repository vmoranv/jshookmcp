/**
 * syscalls — default Android/AArch64 syscall table for the emulator.
 *
 * `svc #0` traps with the syscall number in x8 and args in x0..x5; the result
 * goes back in x0. This installs a pragmatic subset sufficient for the calls a
 * self-contained signing/crypto routine tends to make (time seeds, randomness,
 * pid/tid, stdio writes, file reads, anonymous mmap, memory protection no-ops,
 * clean exit). Behaviour is injectable via `opts` so callers can pin a
 * deterministic clock, capture writes, back file reads, or seed getrandom.
 *
 * Numbers are the asm-generic / arm64 table (verified against the Go runtime
 * and musl): getrandom 278, openat 56, close 57, read 63, write 64, lseek 62,
 * fstat 80, ioctl 29, futex 98, set_tid_address 96, rt_sigprocmask 135,
 * gettid 178, mprotect 226, munmap 215, clock_gettime 113, gettimeofday 169,
 * getpid 172, mmap 222, exit 93, exit_group 94.
 */
import type { CpuEngine, SyscallContext } from './CpuEngine';
import { writeGuestU64 } from './guest-memory';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { readGuestCString } from './c-strings';

/** Injectable behaviour for the default syscall table. */
export interface AndroidSyscallOptions {
  /** Value returned by getpid (default 10000, a typical Android app uid/pid range). */
  pid?: number;
  /** Value returned by gettid (default: same as pid — single emulated thread). */
  tid?: number;
  /** Seconds reported by clock_gettime/gettimeofday (default: real wall clock). */
  clockSeconds?: number;
  /** Sink for write(2): receives (fd, bytes). Defaults to discarding output. */
  onWrite?: (fd: number, data: Uint8Array) => void;
  /** Backing reader for read(2): (fd, length) → bytes actually available. */
  onRead?: (fd: number, length: number) => Uint8Array;
  /**
   * Resolver for openat(2): (path, flags) → an fd ≥ 0 to grant, or undefined to
   * fail with -ENOENT. Lets a caller expose a virtual file (e.g. /dev/urandom
   * or an asset) the native code reads from. Default: every open fails.
   */
  onOpen?: (path: string, flags: number) => number | undefined;
  /**
   * Byte source for getrandom(2): (length) → bytes. Default: deterministic
   * pseudo-random fill (seeded constant) so crypto routines run reproducibly
   * rather than throwing on an unimplemented syscall.
   */
  onGetrandom?: (length: number) => Uint8Array;
}

// asm-generic / arm64 syscall numbers.
const NR_IOCTL = 29;
const NR_OPENAT = 56;
const NR_CLOSE = 57;
const NR_LSEEK = 62;
const NR_READ = 63;
const NR_WRITE = 64;
const NR_FSTAT = 80;
const NR_EXIT = 93;
const NR_EXIT_GROUP = 94;
const NR_SET_TID_ADDRESS = 96;
const NR_FUTEX = 98;
const NR_CLOCK_GETTIME = 113;
const NR_PRCTL = 167;
const NR_RT_SIGPROCMASK = 135;
const NR_GETTIMEOFDAY = 169;
const NR_GETPID = 172;
const NR_GETTID = 178;
const NR_MUNMAP = 215;
const NR_MMAP = 222;
const NR_MPROTECT = 226;
const NR_GETRANDOM = 278;

/**
 * Symbolic name + parameter register layout for each implemented syscall.
 *
 * Used by the trace layer to annotate `svc #0` traps with the syscall name and
 * argument values (e.g. `svc write(fd=1, buf=0x401000, count=12)`), mirroring
 * upstream unidbg's DefaultSyscallParser (commit b298d619). Only syscalls this
 * emulator actually handles are listed — this is our own handler table, not an
 * external signature database, so it stays in sync with the registrations in
 * `installAndroidSyscalls` below.
 *
 * `params` lists the AArch64 ABI argument registers (x0..x5) by name; the trace
 * formatter renders each as `name=0xVALUE` without dereferencing pointers
 * (pointer-bearing args stay as raw addresses — the formatter has no memory
 * read accessor on TraceEvent, and a failing dereference would corrupt trace).
 */
export interface SyscallMeta {
  name: string;
  /** Argument names in x0..x5 order; trailing unspecified args are omitted. */
  params: readonly string[];
}

export const SYSCALL_NAMES: Readonly<Record<number, SyscallMeta>> = {
  [NR_IOCTL]: { name: 'ioctl', params: ['fd', 'request', 'argp'] },
  [NR_OPENAT]: { name: 'openat', params: ['dirfd', 'pathname', 'flags', 'mode'] },
  [NR_CLOSE]: { name: 'close', params: ['fd'] },
  [NR_LSEEK]: { name: 'lseek', params: ['fd', 'offset', 'whence'] },
  [NR_READ]: { name: 'read', params: ['fd', 'buf', 'count'] },
  [NR_WRITE]: { name: 'write', params: ['fd', 'buf', 'count'] },
  [NR_FSTAT]: { name: 'fstat', params: ['fd', 'statbuf'] },
  [NR_EXIT]: { name: 'exit', params: ['code'] },
  [NR_EXIT_GROUP]: { name: 'exit_group', params: ['code'] },
  [NR_SET_TID_ADDRESS]: { name: 'set_tid_address', params: ['tidptr'] },
  [NR_FUTEX]: { name: 'futex', params: ['uaddr', 'op', 'val'] },
  [NR_CLOCK_GETTIME]: { name: 'clock_gettime', params: ['clk_id', 'tp'] },
  [NR_PRCTL]: { name: 'prctl', params: ['option', 'arg2', 'arg3', 'arg4', 'arg5'] },
  [NR_RT_SIGPROCMASK]: { name: 'rt_sigprocmask', params: ['how', 'set', 'oset', 'sigsetsize'] },
  [NR_GETTIMEOFDAY]: { name: 'gettimeofday', params: ['tv', 'tz'] },
  [NR_GETPID]: { name: 'getpid', params: [] },
  [NR_GETTID]: { name: 'gettid', params: [] },
  [NR_MUNMAP]: { name: 'munmap', params: ['addr', 'length'] },
  [NR_MMAP]: { name: 'mmap', params: ['addr', 'length', 'prot', 'flags', 'fd', 'offset'] },
  [NR_MPROTECT]: { name: 'mprotect', params: ['addr', 'len', 'prot'] },
  [NR_GETRANDOM]: { name: 'getrandom', params: ['buf', 'len', 'flags'] },
};

/** mmap hint base for MAP_ANONYMOUS allocations the emulator backs on demand. */
const MMAP_BASE = 0x5000_0000;
const MMAP_ALIGN = getReverseEngineeringConfig().nativeEmulator.guestPageSizeBytes;
/** First fd handed out by openat (0/1/2 reserved for stdio). */
const FD_BASE = 3;
const ENOENT = -2; // negative errno, as the raw kernel ABI returns.

export function installAndroidSyscalls(engine: CpuEngine, opts: AndroidSyscallOptions = {}): void {
  const pid = opts.pid ?? 10000;

  engine.registerSyscall(NR_GETPID, () => BigInt(pid));
  engine.registerSyscall(NR_GETTID, () => BigInt(opts.tid ?? pid));

  // clock_gettime(clk_id, struct timespec* tp): write {tv_sec, tv_nsec}, return 0.
  engine.registerSyscall(NR_CLOCK_GETTIME, (ctx: SyscallContext) => {
    const tp = Number(ctx.x(1));
    // A NULL timespec is legal for clock probing; only write when non-NULL.
    if (tp !== 0) writeTimespec(ctx, tp, clockSecondsOf(opts));
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
    return BigInt(data.length);
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
    // length == 0 (or garbage) is EINVAL, not a page-sized mapping.
    if (!Number.isFinite(length) || length <= 0) return -22n;
    const rounded = Math.max(MMAP_ALIGN, Math.ceil(length / MMAP_ALIGN) * MMAP_ALIGN);
    const addr = mmapBump;
    engine.mapMemory(addr, rounded);
    mmapBump += rounded;
    return BigInt(addr);
  });

  // munmap / mprotect / ioctl: accepted as no-ops (the bump allocator never
  // reclaims, all guest memory is RWX here, and ioctls a crypto routine issues
  // — e.g. terminal queries — don't affect the computation). Return success.
  engine.registerSyscall(NR_MUNMAP, () => 0n);
  engine.registerSyscall(NR_MPROTECT, () => 0n);
  engine.registerSyscall(NR_IOCTL, () => 0n);

  // futex / rt_sigprocmask / set_tid_address: threading & signal plumbing the
  // single-threaded emulator doesn't model. Return 0 (success / "no waiters").
  // prctl(option, ...): process attributes. Linkers issue PR_SET_NAME,
  // PR_SET_VMA_ANON_NAME, and similar benign calls; model them as accepted
  // no-ops so a real linker64 can get past its constructors.
  engine.registerSyscall(NR_PRCTL, () => 0n);
  engine.registerSyscall(NR_FUTEX, () => 0n);
  engine.registerSyscall(NR_RT_SIGPROCMASK, () => 0n);
  engine.registerSyscall(NR_SET_TID_ADDRESS, () => BigInt(opts.tid ?? pid));

  // getrandom(buf, buflen, flags): fill the guest buffer, return bytes written.
  // Defaults to a deterministic PRNG so emulated crypto is reproducible; a
  // caller can inject real entropy via onGetrandom.
  engine.registerSyscall(NR_GETRANDOM, (ctx: SyscallContext) => {
    const buf = Number(ctx.x(0));
    const len = Number(ctx.x(1));
    const bytes = opts.onGetrandom?.(len) ?? deterministicRandom(len);
    const n = Math.min(bytes.length, len);
    if (n > 0) ctx.write(buf, bytes.subarray(0, n));
    return BigInt(n);
  });

  // openat(dirfd, path, flags, mode): resolve via onOpen → a new fd, else -ENOENT.
  let nextFd = FD_BASE;
  engine.registerSyscall(NR_OPENAT, (ctx: SyscallContext) => {
    const path = readCString(ctx, Number(ctx.x(1)));
    const flags = Number(ctx.x(2));
    const granted = opts.onOpen?.(path, flags);
    if (granted === undefined) return BigInt(ENOENT);
    // A negative return from onOpen is an errno (EACCES/EISDIR/...): propagate
    // it instead of fabricating a success-looking fd.
    if (granted < 0) return BigInt(granted);
    return BigInt(granted > 0 ? granted : nextFd++);
  });

  // lseek(fd, offset, whence): the emulator has no seekable backing store, so
  // report the requested absolute offset for SEEK_SET and 0 otherwise.
  engine.registerSyscall(NR_LSEEK, (ctx: SyscallContext) => {
    const offset = Number(ctx.x(1));
    const whence = Number(ctx.x(2));
    return BigInt(whence === 0 ? offset : 0); // 0 = SEEK_SET
  });

  // fstat(fd, struct stat*): zero the buffer and return success. A crypto
  // routine that fstats /dev/urandom only checks the call succeeds.
  engine.registerSyscall(NR_FSTAT, (ctx: SyscallContext) => {
    const statBuf = Number(ctx.x(1));
    if (statBuf !== 0) ctx.write(statBuf, new Uint8Array(128)); // sizeof(struct stat64)
    return 0n;
  });

  // exit / exit_group(code): halt the program; control never returns to caller.
  engine.registerSyscall(NR_EXIT, () => {
    engine.requestStop();
  });
  engine.registerSyscall(NR_EXIT_GROUP, () => {
    engine.requestStop();
  });
}

/** Deterministic byte fill for getrandom — a seeded LCG, reproducible across runs. */
function deterministicRandom(length: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, length));
  let state = 0x2545f491 >>> 0; // fixed seed
  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
}

/** Read a NUL-terminated C string from guest memory (bounded to avoid runaway). */
function readCString(
  ctx: SyscallContext,
  addr: number,
  max = getReverseEngineeringConfig().nativeEmulator.syscallCStringLimitBytes,
): string {
  return readGuestCString(ctx, addr, max);
}

/** Resolve the configured (or real) wall-clock seconds. */
function clockSecondsOf(opts: AndroidSyscallOptions): number {
  return opts.clockSeconds ?? Math.floor(Date.now() / 1000);
}

/** Write a 64-bit little-endian value to guest memory via the context. */
function writeU64(ctx: SyscallContext, addr: number, value: number): void {
  writeGuestU64(ctx, addr, value);
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

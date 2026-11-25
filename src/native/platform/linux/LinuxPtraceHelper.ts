/**
 * Linux remote-syscall injection via ptrace + vDSO syscall gadget.
 *
 * Used by LinuxMemoryProvider to implement allocateMemory/changeProtection/
 * freeMemory on remote processes without requiring a preloaded helper library.
 * Requires CAP_SYS_PTRACE (same privilege level needed for /proc/pid/mem r/w).
 */
import fs from 'node:fs';
import { requireKoffi, type KoffiLibraryHandle, type KoffiCallable } from '../../koffi-loader';

// ── ptrace constants ────────────────────────────────────────────────────

const PTRACE_ATTACH = 16;
const PTRACE_DETACH = 17;
const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;
const PTRACE_SYSCALL = 24;

// ── x86-64 syscall numbers ──────────────────────────────────────────────

const SYS_MMAP = 9;
const SYS_MPROTECT = 10;
const SYS_MUNMAP = 11;

// ── register layout (x86-64 user_regs_struct, 216 bytes) ───────────────
//  r15(0) r14(8) r13(16) r12(24) rbp(32) rbx(40) r11(48) r10(56)
//  r9(64) r8(72) rax(80) rcx(88) rdx(96) rsi(104) rdi(112) orig_rax(120)
//  rip(128) cs(136) eflags(144) rsp(152) ss(160)
//  fs_base(168) gs_base(176) ds(184) es(192) fs(200) gs(208)

const OFF_R10 = 56;
const OFF_R9 = 64;
const OFF_R8 = 72;
const OFF_RAX = 80;
const OFF_RDX = 96;
const OFF_RSI = 104;
const OFF_RDI = 112;
const OFF_RIP = 128;
const REGS_SIZE = 216;

// ── caches ──────────────────────────────────────────────────────────────

let _libc: KoffiLibraryHandle | null = null;
const _vdsoGadgetCache = new Map<number, bigint>();

function libc() {
  if (!_libc) _libc = requireKoffi().load('libc.so.6');
  return _libc;
}

let _ptraceFn: KoffiCallable | null = null;
function ptraceFn() {
  if (!_ptraceFn) {
    _ptraceFn = libc().func('long ptrace(long, int, void *, void *)');
  }
  return _ptraceFn;
}

let _waitpidFn: KoffiCallable | null = null;
function waitpidFn() {
  if (!_waitpidFn) {
    _waitpidFn = libc().func('int waitpid(int, _Out_ int *, int)');
  }
  return _waitpidFn;
}

// ── helpers ─────────────────────────────────────────────────────────────

function ptrace(req: number, pid: number, addr: unknown, data: unknown): bigint {
  return ptraceFn()(BigInt(req), pid, addr as number, data as number) as bigint;
}

function waitStop(pid: number): void {
  const st = Buffer.alloc(4);
  const ret = waitpidFn()(pid, requireKoffi().address(st), 0) as number;
  if (ret <= 0) {
    throw new Error(`LinuxPtrace: waitpid failed for pid ${pid} (ret=${ret})`);
  }
}

/** Find a `syscall` (0F 05) instruction in the target's vDSO mapping. */
function resolveVdsoSyscall(pid: number): bigint {
  const cached = _vdsoGadgetCache.get(pid);
  if (cached) return cached;

  const maps = fs.readFileSync(`/proc/${pid}/maps`, 'utf8');
  for (const line of maps.split('\n')) {
    if (!line.includes('[vdso]')) continue;
    const [range] = line.split(/\s+/);
    if (!range) continue;
    const [s, e] = range.split('-').map((x) => BigInt('0x' + x));
    if (!s || !e) continue;
    const size = Number(e - s);
    if (size <= 0 || size > 0x100000) continue;

    const fd = fs.openSync(`/proc/${pid}/mem`, 'r');
    const buf = Buffer.alloc(size);
    try {
      fs.readSync(fd, buf, 0, size, Number(s));
    } finally {
      fs.closeSync(fd);
    }

    for (let i = 0; i < size - 1; i++) {
      if (buf[i] === 0x0f && buf[i + 1] === 0x05) {
        const addr = s + BigInt(i);
        _vdsoGadgetCache.set(pid, addr);
        return addr;
      }
    }
  }
  throw new Error(`LinuxPtrace: no syscall gadget in PID ${pid} vDSO`);
}

// ── public API ──────────────────────────────────────────────────────────

export interface PtraceResult {
  rax: bigint;
  error: boolean; // true when RAX is in the [-4095, -1] range (negated errno)
}

/**
 * Execute a syscall in the remote process via ptrace register injection.
 *
 * 1. PTRACE_ATTACH → wait for SIGSTOP
 * 2. PTRACE_GETREGS (save original)
 * 3. Set rax = syscallNr (the `syscall` instruction copies RAX into orig_rax
 *    at syscall entry), args in rdi/rsi/rdx/r10/r8/r9,
 *    rip = vDSO syscall gadget
 * 4. PTRACE_SETREGS → PTRACE_SYSCALL → wait
 * 5. PTRACE_GETREGS (read rax = result)
 * 6. Restore original registers, PTRACE_DETACH
 */
export function remoteSyscall(
  pid: number,
  syscallNr: number,
  a0 = 0n,
  a1 = 0n,
  a2 = 0n,
  a3 = 0n,
  a4 = 0n,
  a5 = 0n,
): PtraceResult {
  // Read original regs
  const saved = Buffer.alloc(REGS_SIZE);
  let attached = false;
  let regsSaved = false;

  try {
    // Attach — ptrace returns 0 on success and -1 on failure.
    const attachRet = ptrace(PTRACE_ATTACH, pid, null, null);
    if (attachRet !== 0n) {
      throw new Error(`LinuxPtrace: PTRACE_ATTACH failed for pid ${pid}`);
    }
    attached = true;
    waitStop(pid);

    // Read original regs; only a successful GETREGS yields restorable state.
    const getRegsRet = ptrace(PTRACE_GETREGS, pid, null, requireKoffi().address(saved));
    if (getRegsRet !== 0n) {
      throw new Error(`LinuxPtrace: PTRACE_GETREGS failed for pid ${pid}`);
    }
    regsSaved = true;

    // Clone for modification
    const regs = Buffer.from(saved);

    // Set args
    regs.writeBigUInt64LE(a0, OFF_RDI);
    regs.writeBigUInt64LE(a1, OFF_RSI);
    regs.writeBigUInt64LE(a2, OFF_RDX);
    regs.writeBigUInt64LE(a3, OFF_R10);
    regs.writeBigUInt64LE(a4, OFF_R8);
    regs.writeBigUInt64LE(a5, OFF_R9);
    // The tracee resumes at a vDSO `syscall` instruction, so the kernel takes
    // the number from RAX at entry (and overwrites orig_rax itself).
    regs.writeBigUInt64LE(BigInt(syscallNr), OFF_RAX);

    // Point RIP at vDSO syscall gadget
    const gadget = resolveVdsoSyscall(pid);
    regs.writeBigUInt64LE(gadget, OFF_RIP);

    const setRegsRet = ptrace(PTRACE_SETREGS, pid, null, requireKoffi().address(regs));
    if (setRegsRet !== 0n) {
      throw new Error(`LinuxPtrace: PTRACE_SETREGS failed for pid ${pid}`);
    }
    // PTRACE_SYSCALL stops the tracee TWICE: once at syscall-enter-stop
    // (before the kernel executes the syscall — orig_rax holds the number, rax
    // is still the pre-syscall value) and once at syscall-exit-stop (after
    // completion, when rax holds the return value). Stopping only once leaves
    // the tracee parked at enter-stop and reading rax yields the syscall
    // number (9 for mmap) instead of the result.
    ptrace(PTRACE_SYSCALL, pid, null, null);
    waitStop(pid); // syscall-enter-stop
    ptrace(PTRACE_SYSCALL, pid, null, null);
    waitStop(pid); // syscall-exit-stop — rax is now the syscall result

    // Read result
    ptrace(PTRACE_GETREGS, pid, null, requireKoffi().address(regs));
    const rax = regs.readBigUInt64LE(OFF_RAX);

    const isErr = rax >= 0xfffffffffffff000n; // -4095 .. -1 in unsigned
    return { rax, error: isErr };
  } finally {
    // Only touch the tracee when the attach actually succeeded; a failed
    // attach followed by SETREGS/DETACH would target an unrelated process.
    if (attached) {
      if (regsSaved) ptrace(PTRACE_SETREGS, pid, null, requireKoffi().address(saved));
      ptrace(PTRACE_DETACH, pid, null, null);
    }
  }
}

/**
 * Convert a negative syscall result (returned as an unsigned 64-bit rax) to a
 * positive errno. `-Number(rax)` alone overflows to a huge negative float
 * (e.g. -1.8e19 for -ENOMEM); BigInt.asIntN reinterprets the two's-complement
 * value so the sign is recovered first.
 */
function raxToErrno(rax: bigint): number {
  return -Number(BigInt.asIntN(64, rax));
}

/** mmap(0, size, prot, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) in remote. */
export function remoteMmap(pid: number, size: number, prot: number): bigint {
  const MAP_PRIVATE = 0x02;
  const MAP_ANONYMOUS = 0x20;
  const r = remoteSyscall(
    pid,
    SYS_MMAP,
    0n,
    BigInt(size),
    BigInt(prot),
    BigInt(MAP_PRIVATE | MAP_ANONYMOUS),
    0xffffffffffffffffn,
    0n,
  );
  if (r.error) throw new Error(`remote mmap failed: errno ${raxToErrno(r.rax)}`);
  return r.rax;
}

/** mprotect(addr, size, prot) in remote. */
export function remoteMprotect(pid: number, addr: bigint, size: number, prot: number): void {
  const r = remoteSyscall(pid, SYS_MPROTECT, addr, BigInt(size), BigInt(prot));
  if (r.error) throw new Error(`remote mprotect failed: errno ${raxToErrno(r.rax)}`);
}

/** munmap(addr, size) in remote. */
export function remoteMunmap(pid: number, addr: bigint, size: number): void {
  const r = remoteSyscall(pid, SYS_MUNMAP, addr, BigInt(size));
  if (r.error) throw new Error(`remote munmap failed: errno ${raxToErrno(r.rax)}`);
}

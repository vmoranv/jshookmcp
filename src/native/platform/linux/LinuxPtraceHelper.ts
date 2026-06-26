/**
 * Linux remote-syscall injection via ptrace + vDSO syscall gadget.
 *
 * Used by LinuxMemoryProvider to implement allocateMemory/changeProtection/
 * freeMemory on remote processes without requiring a preloaded helper library.
 * Requires CAP_SYS_PTRACE (same privilege level needed for /proc/pid/mem r/w).
 */
import fs from 'node:fs';
import koffi from 'koffi';

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
const OFF_ORIG_RAX = 120;
const OFF_RIP = 128;
const REGS_SIZE = 216;

// ── caches ──────────────────────────────────────────────────────────────

let _libc: ReturnType<typeof koffi.load> | null = null;
const _vdsoGadgetCache = new Map<number, bigint>();

function libc() {
  if (!_libc) _libc = koffi.load('libc.so.6');
  return _libc;
}

let _ptraceFn: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function ptraceFn() {
  if (!_ptraceFn) {
    _ptraceFn = libc().func('long ptrace(long, int, void *, void *)');
  }
  return _ptraceFn;
}

let _waitpidFn: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
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
  waitpidFn()(pid, koffi.address(st), 0);
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
 * 3. Set orig_rax = syscallNr, args in rdi/rsi/rdx/r10/r8/r9,
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
  // Attach
  ptrace(PTRACE_ATTACH, pid, null, null);
  waitStop(pid);

  // Read original regs
  const saved = Buffer.alloc(REGS_SIZE);
  ptrace(PTRACE_GETREGS, pid, null, koffi.address(saved));

  // Clone for modification
  const regs = Buffer.from(saved);

  // Set args
  regs.writeBigUInt64LE(a0, OFF_RDI);
  regs.writeBigUInt64LE(a1, OFF_RSI);
  regs.writeBigUInt64LE(a2, OFF_RDX);
  regs.writeBigUInt64LE(a3, OFF_R10);
  regs.writeBigUInt64LE(a4, OFF_R8);
  regs.writeBigUInt64LE(a5, OFF_R9);
  regs.writeBigUInt64LE(BigInt(syscallNr), OFF_ORIG_RAX);

  // Point RIP at vDSO syscall gadget
  const gadget = resolveVdsoSyscall(pid);
  regs.writeBigUInt64LE(gadget, OFF_RIP);

  ptrace(PTRACE_SETREGS, pid, null, koffi.address(regs));
  ptrace(PTRACE_SYSCALL, pid, null, null);
  waitStop(pid);

  // Read result
  ptrace(PTRACE_GETREGS, pid, null, koffi.address(regs));
  const rax = regs.readBigUInt64LE(OFF_RAX);

  // Restore original regs
  ptrace(PTRACE_SETREGS, pid, null, koffi.address(saved));
  ptrace(PTRACE_DETACH, pid, null, null);

  const isErr = rax >= 0xfffffffffffff000n; // -4095 .. -1 in unsigned
  return { rax, error: isErr };
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
  if (r.error) throw new Error(`remote mmap failed: errno ${-Number(r.rax)}`);
  return r.rax;
}

/** mprotect(addr, size, prot) in remote. */
export function remoteMprotect(pid: number, addr: bigint, size: number, prot: number): void {
  const r = remoteSyscall(pid, SYS_MPROTECT, addr, BigInt(size), BigInt(prot));
  if (r.error) throw new Error(`remote mprotect failed: errno ${-Number(r.rax)}`);
}

/** munmap(addr, size) in remote. */
export function remoteMunmap(pid: number, addr: bigint, size: number): void {
  const r = remoteSyscall(pid, SYS_MUNMAP, addr, BigInt(size));
  if (r.error) throw new Error(`remote munmap failed: errno ${-Number(r.rax)}`);
}

/**
 * Linux software-breakpoint execute engine — INT3 (x86-64) + BRK (aarch64).
 *
 * Implements AccessBreakpointEngine via ptrace software-breakpoint patching:
 *   1. PTRACE_ATTACH + waitpid for SIGSTOP
 *   2. PTRACE_PEEKTEXT the 8-byte word at `address`, save the original low
 *      bytes (1 on x86-64, 4 on aarch64)
 *   3. PTRACE_POKETEXT the word with the breakpoint instruction in the low
 *      bytes: INT3 (0xCC, 1 byte) on x86-64, BRK #0 (0xD4200000, 4 bytes LE)
 *      on aarch64
 *   4. PTRACE_CONT
 *   5. waitpid for SIGTRAP → PTRACE_GETREGS; faulting instruction = rip-1 on
 *      x86-64 (rip points past INT3), = pc on aarch64 (points at BRK)
 *   6. rearm/single-step (rearmBreakpoint): restore the original bytes,
 *      rewind rip on x86-64 only, PTRACE_SINGLESTEP, wait, re-patch, PTRACE_CONT
 *   7. teardown: restore original bytes, PTRACE_DETACH
 *
 * Arch is taken from process.arch (the tracer runs same-arch as the tracee on
 * Linux): 'x64' → INT3/user_regs_struct (216 B); 'arm64' → BRK/user_pt_regs
 * (272 B: x0–x30 @0–240, sp@248, pc@256, pstate@264). On aarch64 the x86-named
 * BreakpointHit.register slots hold x0–x15 positionally, rsp←sp, rbp←x29 (FP),
 * rip←pc, rflags←pstate.
 *
 * Runtime prerequisite: CAP_SYS_PTRACE (or same-uid target with Yama
 * ptrace_scope permitting). Cannot be runtime-verified on the macOS host —
 * stub unit tests validate the FFI declarations + control flow only (koffi
 * mocked).
 *
 * @module platform/linux/LinuxInt3AccessBreakpoint
 */

import { randomUUID } from 'node:crypto';
import koffi from 'koffi';
import { BREAKPOINT_HIT_TIMEOUT_MS } from '@src/constants';
import type { AccessBreakpointEngine } from '@native/platform/AccessBreakpointEngine';
import type {
  BreakpointAccess,
  BreakpointHit,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';

// ── ptrace constants (extends LinuxPtraceHelper) ────────────────────────

const PTRACE_PEEKTEXT = 3;
const PTRACE_POKETEXT = 4;
const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;
const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;
const PTRACE_ATTACH = 16;
const PTRACE_DETACH = 17;

// ── waitpid / signal constants ──────────────────────────────────────────

const WNOHANG = 1;
const SIGSTOP = 19;
const SIGTRAP = 5;

// ── arch config ─────────────────────────────────────────────────────────
//
// aarch64 BRK #0 = 0xD4200000 (LE: 00 00 00 D4), 4 bytes; trap leaves pc at
// the BRK. x86-64 INT3 = 0xCC, 1 byte; trap leaves rip one past the byte.

const IS_AARCH64 = process.arch === 'arm64';
const WORD_MASK = 0xffffffffffffffffn;

const ARCH = {
  insnWord: IS_AARCH64 ? 0xd4200000n : 0xccn,
  lowMask: IS_AARCH64 ? 0xffffffffn : 0xffn,
  regsSize: IS_AARCH64 ? 272 : 216,
  // x86-64 rip sits past INT3 (fault = rip-1); aarch64 pc sits at the BRK.
  pcOffset: IS_AARCH64 ? 256 : 128,
  faultDelta: IS_AARCH64 ? 0n : 1n,
} as const;

// ── x86-64 user_regs_struct offsets (216 B; mirrors LinuxPtraceHelper) ────
//   r15(0) r14(8) r13(16) r12(24) rbp(32) rbx(40) r11(48) r10(56)
//   r9(64) r8(72) rax(80) rcx(88) rdx(96) rsi(104) rdi(112) orig_rax(120)
//   rip(128) cs(136) eflags(144) rsp(152) ss(160)
const OFF_R15 = 0;
const OFF_R14 = 8;
const OFF_R13 = 16;
const OFF_R12 = 24;
const OFF_RBP = 32;
const OFF_RBX = 40;
const OFF_R11 = 48;
const OFF_R10 = 56;
const OFF_R9 = 64;
const OFF_R8 = 72;
const OFF_RAX = 80;
const OFF_RCX = 88;
const OFF_RDX = 96;
const OFF_RSI = 104;
const OFF_RDI = 112;
const OFF_EFLAGS = 144;
const OFF_RSP = 152;

// ── aarch64 user_pt_regs offsets (272 B) ─────────────────────────────────
//   x0(0)..x30(240), sp(248), pc(256), pstate(264)
const OFF_A64_SP = 248;
const OFF_A64_PSTATE = 264;
const a64Reg = (idx: number): number => idx * 8; // x0..x30

// ── caches (mirror LinuxPtraceHelper: lazy libc(), cached func) ──────────

let _libc: ReturnType<typeof koffi.load> | null = null;

function libc(): ReturnType<typeof koffi.load> {
  if (!_libc) _libc = koffi.load('libc.so.6');
  return _libc;
}

type KoffiFunc = (...args: unknown[]) => unknown;

let _ptraceFn: KoffiFunc | null = null;
function ptraceFn(): KoffiFunc {
  if (!_ptraceFn) {
    _ptraceFn = libc().func('long ptrace(long, int, void *, void *)') as KoffiFunc;
  }
  return _ptraceFn;
}

let _waitpidFn: KoffiFunc | null = null;
function waitpidFn(): KoffiFunc {
  if (!_waitpidFn) {
    _waitpidFn = libc().func('int waitpid(int, _Out_ int *, int)') as KoffiFunc;
  }
  return _waitpidFn;
}

// ── ptrace helpers ──────────────────────────────────────────────────────

function ptrace(req: number, pid: number, addr: bigint, data: bigint): bigint {
  return ptraceFn()(BigInt(req), pid, addr, data) as bigint;
}

/** PTRACE_PEEKTEXT: read one 8-byte word at `addr`. */
function peekWord(pid: number, addr: bigint): bigint {
  const word = ptrace(PTRACE_PEEKTEXT, pid, addr, 0n);
  return word & WORD_MASK; // normalize signed `long` to unsigned 64-bit
}

/** PTRACE_POKETEXT: write one 8-byte word at `addr`. */
function pokeWord(pid: number, addr: bigint, word: bigint): void {
  ptrace(PTRACE_POKETEXT, pid, addr, word & WORD_MASK);
}

/** PTRACE_GETREGS: read the arch's register set into a fresh buffer. */
function getRegs(pid: number): Buffer {
  const buf = Buffer.alloc(ARCH.regsSize);
  ptrace(PTRACE_GETREGS, pid, 0n, koffi.address(buf) as bigint);
  return buf;
}

/** PTRACE_SETREGS: write a register-set buffer back to the tracee. */
function setRegs(pid: number, buf: Buffer): void {
  ptrace(PTRACE_SETREGS, pid, 0n, koffi.address(buf) as bigint);
}

// ── waitpid helpers ─────────────────────────────────────────────────────

/** Blocking waitpid for `pid`; returns the status word (0 if waitpid failed). */
function waitpidBlocking(pid: number): number {
  const st = Buffer.alloc(4);
  const ret = waitpidFn()(pid, koffi.address(st), 0) as number;
  return ret > 0 ? st.readInt32LE(0) : 0;
}

/** Non-blocking (WNOHANG) waitpid for any child (-1). Returns pid + status. */
function waitpidNoHang(): { pid: number; status: number } {
  const st = Buffer.alloc(4);
  const ret = waitpidFn()(-1, koffi.address(st), WNOHANG) as number;
  return { pid: ret, status: st.readInt32LE(0) };
}

function wifStopped(status: number): boolean {
  return (status & 0xff) === 0x7f;
}

function wstopSig(status: number): number {
  return (status >>> 8) & 0xff;
}

// ── armed breakpoint record ─────────────────────────────────────────────

interface ArmedBreakpoint {
  id: string;
  pid: number;
  address: bigint;
  origLowBytes: bigint; // saved low N bytes at `address` (1 on x86-64, 4 on aarch64)
}

function restoreBytes(bp: ArmedBreakpoint): void {
  const word = peekWord(bp.pid, bp.address);
  const restored = (word & ~ARCH.lowMask) | bp.origLowBytes;
  pokeWord(bp.pid, bp.address, restored);
}

function toHex(v: bigint): string {
  return `0x${v.toString(16).toUpperCase()}`;
}

function buildHit(bp: ArmedBreakpoint, pid: number, regs: Buffer): BreakpointHit {
  const pc = regs.readBigUInt64LE(ARCH.pcOffset);
  const faultingAddr = pc - ARCH.faultDelta;

  if (IS_AARCH64) {
    // aarch64: map user_pt_regs into the x86-shaped BreakpointHit slots
    // (rax..r15 ← x0..x15, rsp←sp, rbp←x29/FP, rip←pc, rflags←pstate).
    return {
      breakpointId: bp.id,
      address: toHex(bp.address),
      accessAddress: toHex(bp.address),
      instructionAddress: toHex(pc), // BRK trap leaves pc at the breakpoint
      threadId: pid,
      accessType: 'execute',
      timestamp: Date.now(),
      registers: {
        rax: toHex(regs.readBigUInt64LE(a64Reg(0))),
        rbx: toHex(regs.readBigUInt64LE(a64Reg(1))),
        rcx: toHex(regs.readBigUInt64LE(a64Reg(2))),
        rdx: toHex(regs.readBigUInt64LE(a64Reg(3))),
        rsi: toHex(regs.readBigUInt64LE(a64Reg(4))),
        rdi: toHex(regs.readBigUInt64LE(a64Reg(5))),
        rbp: toHex(regs.readBigUInt64LE(a64Reg(29))),
        rsp: toHex(regs.readBigUInt64LE(OFF_A64_SP)),
        r8: toHex(regs.readBigUInt64LE(a64Reg(6))),
        r9: toHex(regs.readBigUInt64LE(a64Reg(7))),
        r10: toHex(regs.readBigUInt64LE(a64Reg(8))),
        r11: toHex(regs.readBigUInt64LE(a64Reg(9))),
        r12: toHex(regs.readBigUInt64LE(a64Reg(10))),
        r13: toHex(regs.readBigUInt64LE(a64Reg(11))),
        r14: toHex(regs.readBigUInt64LE(a64Reg(12))),
        r15: toHex(regs.readBigUInt64LE(a64Reg(13))),
        rip: toHex(pc),
        rflags: toHex(regs.readBigUInt64LE(OFF_A64_PSTATE)),
      },
    };
  }

  return {
    breakpointId: bp.id,
    address: toHex(bp.address),
    accessAddress: toHex(bp.address),
    // INT3 advances rip one past the 0xCC byte; the faulting instruction
    // is the byte we patched, i.e. rip - 1.
    instructionAddress: toHex(faultingAddr),
    threadId: pid,
    accessType: 'execute',
    timestamp: Date.now(),
    registers: {
      rax: toHex(regs.readBigUInt64LE(OFF_RAX)),
      rbx: toHex(regs.readBigUInt64LE(OFF_RBX)),
      rcx: toHex(regs.readBigUInt64LE(OFF_RCX)),
      rdx: toHex(regs.readBigUInt64LE(OFF_RDX)),
      rsi: toHex(regs.readBigUInt64LE(OFF_RSI)),
      rdi: toHex(regs.readBigUInt64LE(OFF_RDI)),
      rsp: toHex(regs.readBigUInt64LE(OFF_RSP)),
      rbp: toHex(regs.readBigUInt64LE(OFF_RBP)),
      r8: toHex(regs.readBigUInt64LE(OFF_R8)),
      r9: toHex(regs.readBigUInt64LE(OFF_R9)),
      r10: toHex(regs.readBigUInt64LE(OFF_R10)),
      r11: toHex(regs.readBigUInt64LE(OFF_R11)),
      r12: toHex(regs.readBigUInt64LE(OFF_R12)),
      r13: toHex(regs.readBigUInt64LE(OFF_R13)),
      r14: toHex(regs.readBigUInt64LE(OFF_R14)),
      r15: toHex(regs.readBigUInt64LE(OFF_R15)),
      rip: toHex(regs.readBigUInt64LE(ARCH.pcOffset)),
      rflags: toHex(regs.readBigUInt64LE(OFF_EFLAGS)),
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── engine ──────────────────────────────────────────────────────────────

export class LinuxInt3AccessBreakpoint implements AccessBreakpointEngine {
  readonly platform = 'linux' as const;

  private breakpoints = new Map<string, ArmedBreakpoint>();
  private attachedPids = new Set<number>();

  async attach(pid: number): Promise<void> {
    this.guardPlatform();
    if (this.attachedPids.has(pid)) return;

    ptrace(PTRACE_ATTACH, pid, 0n, 0n);
    const status = waitpidBlocking(pid);
    if (!wifStopped(status) || wstopSig(status) !== SIGSTOP) {
      throw new Error(
        `LinuxInt3: PTRACE_ATTACH did not deliver SIGSTOP for pid ${pid} (status=0x${status.toString(16)})`,
      );
    }
    this.attachedPids.add(pid);
  }

  async detach(pid: number): Promise<void> {
    this.guardPlatform();

    // Restore every breakpoint armed for this pid.
    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) {
        try {
          restoreBytes(bp);
        } catch {
          // best-effort: tracee may already be gone
        }
        this.breakpoints.delete(id);
      }
    }

    if (this.attachedPids.has(pid)) {
      try {
        ptrace(PTRACE_DETACH, pid, 0n, 0n);
      } catch {
        // best-effort
      }
      this.attachedPids.delete(pid);
    }
  }

  async setBreakpoint(
    pid: number,
    address: bigint,
    _access: BreakpointAccess,
    _size: BreakpointSize,
  ): Promise<{ id: string }> {
    this.guardPlatform();
    if (!this.attachedPids.has(pid)) {
      await this.attach(pid);
    }

    // PEEKTEXT the 8-byte word starting at `address`; save the original low
    // bytes (1 on x86-64, 4 on aarch64) then POKE the breakpoint instruction
    // into those low bytes, preserving the upper bytes.
    const word = peekWord(pid, address);
    const origLowBytes = word & ARCH.lowMask;
    const patched = (word & ~ARCH.lowMask) | ARCH.insnWord;
    pokeWord(pid, address, patched);

    // Let the tracee resume so it can run into the breakpoint.
    ptrace(PTRACE_CONT, pid, 0n, 0n);

    const id = randomUUID();
    this.breakpoints.set(id, { id, pid, address, origLowBytes });
    return { id };
  }

  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;
    try {
      restoreBytes(bp);
    } finally {
      this.breakpoints.delete(id);
    }
    return true;
  }

  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    this.guardPlatform();
    const deadline = Date.now() + (timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS);

    while (Date.now() < deadline) {
      const { pid, status } = waitpidNoHang();

      if (pid === 0) {
        // No child state change ready — brief yield, then retry.
        await sleep(2);
        continue;
      }
      if (pid < 0) {
        // waitpid returned an error — bail out of the wait loop.
        break;
      }

      if (wifStopped(status) && wstopSig(status) === SIGTRAP) {
        const regs = getRegs(pid);
        const pc = regs.readBigUInt64LE(ARCH.pcOffset);
        const faultingAddr = pc - ARCH.faultDelta;
        const bp = this.findByAddress(faultingAddr);
        if (bp) {
          return buildHit(bp, pid, regs);
        }
        // Trap from an unknown source — re-continue without a signal.
        ptrace(PTRACE_CONT, pid, 0n, 0n);
      } else if (wifStopped(status)) {
        // Non-trap signal — deliver it and continue.
        ptrace(PTRACE_CONT, pid, 0n, BigInt(wstopSig(status)));
      }
    }

    return null;
  }

  /**
   * Single-step the tracee past a hit and re-arm the breakpoint (step 6 of the
   * module doc). After a hit the caller must step the original instruction
   * before re-patching, otherwise the target re-traps forever.
   *
   *   1. restore the original bytes (POKETEXT)
   *   2. x86-64 only: rewind rip to the breakpoint address (SETREGS)
   *      [aarch64 pc already points at the BRK — no rewind]
   *   3. PTRACE_SINGLESTEP + waitpid for the SIGTRAP
   *   4. re-write the breakpoint instruction (POKETEXT)
   *   5. PTRACE_CONT
   *
   * Not invoked automatically by waitForHit (which returns immediately on a
   * hit); callers orchestrate rearm explicitly so they can inspect state first.
   */
  async rearmBreakpoint(id: string): Promise<boolean> {
    this.guardPlatform();
    const bp = this.breakpoints.get(id);
    if (!bp) return false;

    // 1. Restore original bytes.
    restoreBytes(bp);
    // 2. Rewind the program counter to the bp address (x86-64 only — on
    // aarch64 the BRK trap leaves pc at the breakpoint, no rewind needed).
    if (!IS_AARCH64) {
      const regs = getRegs(bp.pid);
      regs.writeBigUInt64LE(bp.address, ARCH.pcOffset);
      setRegs(bp.pid, regs);
    }
    // 3. Single-step the original instruction.
    ptrace(PTRACE_SINGLESTEP, bp.pid, 0n, 0n);
    waitpidBlocking(bp.pid);
    // 4. Re-patch the breakpoint instruction.
    const word = peekWord(bp.pid, bp.address);
    pokeWord(bp.pid, bp.address, (word & ~ARCH.lowMask) | ARCH.insnWord);
    // 5. Continue the tracee.
    ptrace(PTRACE_CONT, bp.pid, 0n, 0n);
    return true;
  }

  // ── private ──

  private guardPlatform(): void {
    if (process.platform !== 'linux') {
      throw new Error(
        `LinuxInt3AccessBreakpoint requires process.platform === 'linux' (got '${process.platform}')`,
      );
    }
  }

  private findByAddress(addr: bigint): ArmedBreakpoint | undefined {
    for (const bp of this.breakpoints.values()) {
      if (bp.address === addr) return bp;
    }
    return undefined;
  }
}

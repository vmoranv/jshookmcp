/**
 * Darwin (macOS) Mach exception-based access-breakpoint engine.
 *
 * Implements AccessBreakpointEngine using Mach exception ports + page-level
 * VM_PROT_NONE guarding:
 *   1. attach: task_for_pid(self, pid) → task port
 *   2. setBreakpoint: mach_vm_protect(pageAddr, pageSize, VM_PROT_NONE) to make
 *      the page inaccessible; allocate a Mach receive right and arm it for
 *      EXC_MASK_BAD_ACCESS via task_set_exception_ports (EXCEPTION_DEFAULT |
 *      MACH_EXCEPTION_CODES, so the fault address arrives as a full 64-bit code)
 *   3. waitForHit: mach_msg-receive mach_exception_raise on the receive right,
 *      decode the fault address + thread, thread_get_state(x86_THREAD_STATE64),
 *      then reply RetCode=KERN_SUCCESS so the kernel resumes the target
 *   4. teardown: restore original VM protection, deallocate the receive right +
 *      the task port
 *
 * Runtime verification status (host=macOS — see DarwinAPI.runtime.test.ts):
 *  - VM FFI layer REAL-VERIFIED on this host against libSystem.B.dylib:
 *    hostPageSize, machTaskSelf, machVmAllocate, machVmRegion, machVmProtect
 *    round-trip, machVmDeallocate, taskForPid(self) all execute for real.
 *  - Still genuinely gated (cannot push on this host): the mach_msg exception
 *    RECEIVE loop on a target process (needs a faulting target + debugger
 *    entitlement; mach_port_allocate returns KERN_INVALID_VALUE under the
 *    hardened runtime), and cross-process task_for_pid for other PIDs.
 * The Mach exception message layout offsets are derived from xnu osfmk/mach/exc.defs.
 *
 * @module platform/darwin/DarwinMachAccessBreakpoint
 */

import { randomUUID } from 'node:crypto';
import type { AccessBreakpointEngine } from '@native/platform/AccessBreakpointEngine';
import type {
  BreakpointAccess,
  BreakpointHit,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';
import {
  EXCEPTION_BEHAVIOR,
  EXC_MASK,
  KERN,
  VM_PROT,
  hostPageSize,
  machPortAllocateReceive,
  machPortDeallocate,
  machPortInsertSendRight,
  machPortReleaseReceive,
  machTaskSelf,
  machVmProtect,
  machVmRegion,
  receiveException,
  sendExceptionReply,
  taskForPid,
  taskSetExceptionPorts,
  threadGetState,
  threadStateFlavor,
} from '@src/native/platform/darwin/DarwinAPI';

/**
 * Host VM page size (4096 on Intel macOS, 16384 on Apple Silicon), resolved once
 * via sysctlbyname("hw.pagesize"). Replaces a former hardcoded 4096 constant
 * that would mis-guard pages on Apple Silicon.
 */
let resolvedPageSize: bigint | null = null;
function darwinPageSize(): bigint {
  if (resolvedPageSize === null) resolvedPageSize = BigInt(hostPageSize());
  return resolvedPageSize;
}

// ── armed breakpoint record ─────────────────────────────────────────────

interface ArmedPage {
  id: string;
  pid: number;
  address: bigint; // original (possibly unaligned) watched address
  pageAddr: bigint; // page-aligned start
  pageSize: bigint;
  origProtection: number; // saved VM_PROT_* to restore on teardown
  receivePort: number; // Mach receive right handed to task_set_exception_ports
}

function toHex(v: bigint): string {
  return `0x${v.toString(16).toUpperCase()}`;
}

// x86_THREAD_STATE64 GP-register offsets within thread_get_state's output
// (osfmk/mach/i386/thread_status.h _STRUCT_X86_THREAD_STATE64). NOTE: this
// layout differs from Linux's user_regs_struct despite sharing the rip@128 spot.
const X64_OFF = {
  RAX: 0,
  RBX: 8,
  RCX: 16,
  RDX: 24,
  RDI: 32,
  RSI: 40,
  RBP: 48,
  RSP: 56,
  R8: 64,
  R9: 72,
  R10: 80,
  R11: 88,
  R12: 96,
  R13: 104,
  R14: 112,
  R15: 120,
  RIP: 128,
  RFLAGS: 136,
} as const;

function extractX64Registers(state: Buffer): BreakpointHit['registers'] {
  return {
    rax: toHex(state.readBigUInt64LE(X64_OFF.RAX)),
    rbx: toHex(state.readBigUInt64LE(X64_OFF.RBX)),
    rcx: toHex(state.readBigUInt64LE(X64_OFF.RCX)),
    rdx: toHex(state.readBigUInt64LE(X64_OFF.RDX)),
    rsi: toHex(state.readBigUInt64LE(X64_OFF.RSI)),
    rdi: toHex(state.readBigUInt64LE(X64_OFF.RDI)),
    rsp: toHex(state.readBigUInt64LE(X64_OFF.RSP)),
    rbp: toHex(state.readBigUInt64LE(X64_OFF.RBP)),
    r8: toHex(state.readBigUInt64LE(X64_OFF.R8)),
    r9: toHex(state.readBigUInt64LE(X64_OFF.R9)),
    r10: toHex(state.readBigUInt64LE(X64_OFF.R10)),
    r11: toHex(state.readBigUInt64LE(X64_OFF.R11)),
    r12: toHex(state.readBigUInt64LE(X64_OFF.R12)),
    r13: toHex(state.readBigUInt64LE(X64_OFF.R13)),
    r14: toHex(state.readBigUInt64LE(X64_OFF.R14)),
    r15: toHex(state.readBigUInt64LE(X64_OFF.R15)),
    rip: toHex(state.readBigUInt64LE(X64_OFF.RIP)),
    rflags: toHex(state.readBigUInt64LE(X64_OFF.RFLAGS)),
  };
}

// ── engine ──────────────────────────────────────────────────────────────

export class DarwinMachAccessBreakpoint implements AccessBreakpointEngine {
  readonly platform = 'darwin' as const;

  private breakpoints = new Map<string, ArmedPage>();
  private taskPorts = new Map<number, number>();

  async attach(pid: number): Promise<void> {
    this.guardPlatform();
    if (this.taskPorts.has(pid)) return;

    const self = machTaskSelf();
    const { kr, task } = taskForPid(self, pid);
    if (kr !== KERN.SUCCESS || task === 0) {
      throw new Error(
        `DarwinMach: task_for_pid(pid=${pid}) failed: kern_return_t=${kr} ` +
          '(needs debugger entitlement com.apple.security.cs.debugger or root under SIP)',
      );
    }
    this.taskPorts.set(pid, task);
  }

  async detach(pid: number): Promise<void> {
    this.guardPlatform();

    // Restore every page guarded for this pid + release its receive right.
    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) {
        try {
          this.restoreProtection(bp);
        } catch {
          // best-effort
        }
        try {
          machPortReleaseReceive(bp.receivePort);
        } catch {
          // best-effort
        }
        this.breakpoints.delete(id);
      }
    }

    const task = this.taskPorts.get(pid);
    if (task !== undefined) {
      try {
        machPortDeallocate(machTaskSelf(), task);
      } catch {
        // best-effort
      }
      this.taskPorts.delete(pid);
    }
  }

  async setBreakpoint(
    pid: number,
    address: bigint,
    _access: BreakpointAccess,
    _size: BreakpointSize,
  ): Promise<{ id: string }> {
    this.guardPlatform();

    let task = this.taskPorts.get(pid);
    if (task === undefined) {
      await this.attach(pid);
      task = this.taskPorts.get(pid);
      if (task === undefined) {
        throw new Error(`DarwinMach: attach did not yield a task port for pid ${pid}`);
      }
    }

    // Page-align down using the host's real page size (4096 Intel / 16384 ASi).
    const pageSize = darwinPageSize();
    const pageAddr = address & ~(pageSize - 1n);

    // Save the region's current protection so teardown can restore it.
    const region = machVmRegion(task, pageAddr);
    const origProtection =
      region.kr === KERN.SUCCESS ? region.info.protection : VM_PROT.READ | VM_PROT.WRITE;

    // Arm the guard: make the page completely inaccessible. Any code touching
    // any byte in [pageAddr, pageAddr+pageSize) raises EXC_BAD_ACCESS.
    const kr = machVmProtect(task, pageAddr, pageSize, false, VM_PROT.NONE);
    if (kr !== KERN.SUCCESS) {
      throw new Error(
        `DarwinMach: mach_vm_protect(VM_PROT_NONE) at ${toHex(pageAddr)} failed: kern_return_t=${kr}`,
      );
    }

    // Allocate a Mach receive right and route EXC_BAD_ACCESS raises to it.
    // Runtime-verified (host=macOS): the kernel needs a SEND right to deliver
    // exceptions, so we make one from the receive right via insert_right(MAKE_SEND)
    // — without it, task_set_exception_ports returns MACH_SEND_INVALID_NOTIFY.
    // MACH_EXCEPTION_CODES (64-bit fault address) is preferred; some hosts reject
    // it (KERN_INVALID_ARGUMENT) and fall back to DEFAULT (32-bit codes). The
    // flavor must be arch-correct (THREAD_STATE_NONE is rejected on Apple Silicon).
    const receivePort = machPortAllocateReceive();
    const irKr = machPortInsertSendRight(receivePort);
    if (irKr !== KERN.SUCCESS) {
      machVmProtect(task, pageAddr, pageSize, false, origProtection);
      try {
        machPortReleaseReceive(receivePort);
      } catch {
        // best-effort
      }
      throw new Error(
        `DarwinMach: mach_port_insert_right(MAKE_SEND) failed: kern_return_t=${irKr}`,
      );
    }
    const flavor = threadStateFlavor();
    const behavior64 = EXCEPTION_BEHAVIOR.DEFAULT | EXCEPTION_BEHAVIOR.MACH_CODES;
    let setKr = taskSetExceptionPorts(task, EXC_MASK.BAD_ACCESS, receivePort, behavior64, flavor);
    if (setKr === KERN.INVALID_ARGUMENT) {
      // MACH_EXCEPTION_CODES not honored on this host (observed on Apple Silicon
      // hardened runtime) → fall back to DEFAULT (32-bit exception_raise).
      setKr = taskSetExceptionPorts(
        task,
        EXC_MASK.BAD_ACCESS,
        receivePort,
        EXCEPTION_BEHAVIOR.DEFAULT,
        flavor,
      );
    }
    if (setKr !== KERN.SUCCESS) {
      // Roll back the guard + port so we don't leave the page inaccessible.
      machVmProtect(task, pageAddr, pageSize, false, origProtection);
      try {
        machPortReleaseReceive(receivePort);
      } catch {
        // best-effort
      }
      throw new Error(`DarwinMach: task_set_exception_ports failed: kern_return_t=${setKr}`);
    }

    const id = randomUUID();
    this.breakpoints.set(id, {
      id,
      pid,
      address,
      pageAddr,
      pageSize,
      origProtection,
      receivePort,
    });
    return { id };
  }

  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;
    try {
      this.restoreProtection(bp);
      machPortReleaseReceive(bp.receivePort);
    } finally {
      this.breakpoints.delete(id);
    }
    return true;
  }

  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    this.guardPlatform();
    const deadline = Date.now() + (timeoutMs ?? 10000);
    const armed = [...this.breakpoints.values()];
    const flavor = threadStateFlavor();
    const isArm64 = process.arch === 'arm64';
    // arm_thread_state64.pc @ 256 (after x[31]@0–240, sp@248); x64 rip @ 128.
    const pcOffset = isArm64 ? 256 : X64_OFF.RIP;
    const stateSize = isArm64 ? 272 : 216;

    while (Date.now() < deadline && armed.length > 0) {
      // Slice the remaining budget across armed receive ports so each gets a
      // fair poll within the window.
      const slice = Math.max(5, Math.floor((deadline - Date.now()) / armed.length));
      for (const bp of armed) {
        const exc = receiveException(bp.receivePort, slice);
        if (!exc) continue;

        // Read the faulting thread's GP registers, then reply so the kernel
        // resumes the target (RetCode=KERN_SUCCESS ⇒ handled). replyId follows
        // the received msgId (64-bit 2505 / 32-bit 2501).
        const state = Buffer.alloc(stateSize);
        const stateKr = threadGetState(exc.thread, flavor, state);
        sendExceptionReply(exc.localPort, KERN.SUCCESS, exc.msgId);

        if (exc.exception !== 1 /* EXC_BAD_ACCESS */ || stateKr !== KERN.SUCCESS) {
          // Non-access exception or unreadable state — keep polling.
          continue;
        }

        const pc = state.readBigUInt64LE(pcOffset);
        return {
          breakpointId: bp.id,
          address: toHex(bp.address),
          accessAddress: toHex(exc.code1), // the byte that faulted
          instructionAddress: toHex(pc), // the instruction that touched it
          threadId: exc.thread,
          accessType: 'execute',
          timestamp: Date.now(),
          // Full register dump is x86-64 only (extractX64Registers reads the
          // x86_THREAD_STATE64 layout). arm64's arm_thread_state64 layout isn't
          // decoded here — the hit still carries fault address + pc, which is
          // the access-breakpoint contract.
          registers: isArm64 ? undefined : extractX64Registers(state),
        };
      }
    }

    return null;
  }

  // ── private ──

  private guardPlatform(): void {
    if (process.platform !== 'darwin') {
      throw new Error(
        `DarwinMachAccessBreakpoint requires process.platform === 'darwin' (got '${process.platform}')`,
      );
    }
  }

  private restoreProtection(bp: ArmedPage): void {
    const task = this.taskPorts.get(bp.pid);
    if (task === undefined) return;
    machVmProtect(task, bp.pageAddr, bp.pageSize, false, bp.origProtection);
  }
}

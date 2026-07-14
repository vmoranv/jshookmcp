/**
 * Cross-platform "access breakpoint" engine — the non-Win32 analogue of
 * HardwareBreakpointEngine. Stops a target process when it touches a given
 * address (execute breakpoint) so the caller can capture the faulting
 * instruction's address + register context.
 *
 * Implementations:
 *  - LinuxInt3AccessBreakpoint: ptrace INT3 byte patch + SIGTRAP (x86-64).
 *  - DarwinMachAccessBreakpoint: Mach exception ports + page protect (EXC_BAD_ACCESS).
 *
 * Runtime verification requires the target OS + privileges:
 *  - Linux: CAP_SYS_PTRACE (or same-uid target with Yama ptrace_scope permitting).
 *  - macOS: debugger entitlement (com.apple.security.cs.debugger) or root under SIP.
 *
 * Host is macOS; stub unit tests validate FFI declarations + control flow only
 * (koffi is mocked — no real ptrace / Mach calls are issued).
 *
 * BreakpointHit field-mapping (filled by the engine on a hit):
 *  - breakpointId:       id returned by setBreakpoint for the matching bp.
 *  - address:            the watched address (bp.address), uppercase hex string.
 *  - accessAddress:      the watched address (same as `address` for execute bp).
 *  - instructionAddress: the faulting instruction's address. For Linux INT3 this
 *                        is `rip - 1` (rip points one past the 0xCC byte); for
 *                        Darwin EXC_BAD_ACCESS it is the faulting PC.
 *  - threadId:           OS tid that triggered the trap.
 *  - accessType:         echo of the bp's BreakpointAccess (typically 'execute').
 *  - timestamp:          Date.now() at hit capture.
 *  - registers:          full GP register dump read from the stopped thread
 *                        (PTRACE_GETREGS on Linux, thread_get_state on Darwin).
 *
 * @module platform/AccessBreakpointEngine
 */

import type {
  BreakpointAccess,
  BreakpointHit,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';

export interface AccessBreakpointEngine {
  readonly platform: 'linux' | 'darwin';

  /** Attach to the target pid (PTRACE_ATTACH / task_for_pid). */
  attach(pid: number): Promise<void>;

  /** Detach, restoring all patched state for the pid. */
  detach(pid: number): Promise<void>;

  /**
   * Arm an EXECUTE breakpoint at `address`. Returns a breakpoint id.
   *
   * Note: both implementations are execute-breakpoint primitives — Linux INT3
   * patches an opcode and Darwin VM_PROT_NONE guards a page. Read/write/access
   * breakpoints at byte granularity require hardware debug registers, which are
   * not portable across these two kernels; callers should pass `access: 'execute'`.
   */
  setBreakpoint(
    pid: number,
    address: bigint,
    access: BreakpointAccess,
    size: BreakpointSize,
  ): Promise<{ id: string }>;

  /** Disarm a breakpoint by id. Returns false if the id was not found. */
  removeBreakpoint(id: string): Promise<boolean>;

  /** Block until the next hit or timeout (ms). Returns null on timeout. */
  waitForHit(timeoutMs?: number): Promise<BreakpointHit | null>;
}

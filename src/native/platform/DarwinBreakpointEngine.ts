/**
 * Darwin (macOS) hardware breakpoint engine — ARM64 debug registers via
 * Mach thread_set_state + task_threads enumeration.
 *
 * Uses ARM_DEBUG_STATE64 (thread_state flavor 15 in XNU's
 * osfmk/mach/arm/thread_status.h; 14 is ARM_DEBUG_STATE32) to program hardware breakpoint
 * registers (DBGBVR/DBGBCR for instruction breakpoints) and watchpoint
 * registers (DBGWVR/DBGWCR for data access watchpoints) matching the
 * Win32 HardwareBreakpointEngine capability on macOS.
 *
 * ARM64 provides 6 hardware breakpoints AND 4 hardware watchpoints
 * simultaneously — richer than x64's 4 unified DR registers.
 *
 * Prerequisite: debugger entitlement (com.apple.security.cs.debugger)
 * or root + SIP disabled to call task_for_pid cross-process.
 *
 * @module platform/DarwinBreakpointEngine
 */

import { randomUUID } from 'node:crypto';
import { requireKoffi, type KoffiLibraryHandle } from '../koffi-loader';
import { BREAKPOINT_HIT_TIMEOUT_MS, BREAKPOINT_TRACE_MAX_HITS } from '@src/constants';
import { ToolError } from '@errors/ToolError';
import type {
  BreakpointAccess,
  BreakpointConfig,
  BreakpointHit,
  BreakpointListEntry,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';
import { KERN, machTaskSelf, taskForPid } from '@src/native/platform/darwin/DarwinAPI';
import { formatAddress } from '../formatAddress';
import { sleep } from './utils';

// ── koffi libSystem bindings (inline — mirrors DarwinAPI pattern) ───────

/* eslint-disable no-underscore-dangle */
let _libSystem: KoffiLibraryHandle | null = null;
/* eslint-enable no-underscore-dangle */
function libSystem(): KoffiLibraryHandle {
  if (!_libSystem) _libSystem = requireKoffi().load('/usr/lib/libSystem.B.dylib');
  return _libSystem;
}

/**
 * mach_port_deallocate: release a port right.
 * kern_return_t mach_port_deallocate(ipc_space_t, mach_port_name_t)
 */
function darwinPortDeallocate(task: number, name: number): number {
  const fn = libSystem().func('int mach_port_deallocate(int, int)');
  return fn(task, name) as number;
}

/**
 * task_threads: get the list of threads in a task.
 * kern_return_t task_threads(task_t, thread_act_array_t *, mach_msg_type_number_t *)
 *
 * On macOS with debugger entitlement, this returns an array of thread ports.
 * We use koffi's pointer output to read the kernel-written thread list.
 * If the output pointer cannot be decoded from userspace, returns an empty list
 * (the caller will set debug state on whatever threads it can reach).
 */
function darwinTaskThreads(task: number): { kr: number; threads: number[] } {
  const fn = libSystem().func('int task_threads(int, _Out_ void **, _Out_ uint32_t *)');

  // Allocate output buffers: threadListPtr receives a kernel pointer to the
  // thread array; countPtr receives the array length.
  const threadListPtrBuf = Buffer.alloc(8); // void* (8 bytes on arm64)
  const countBuf = Buffer.alloc(4);
  const kr = fn(
    task,
    requireKoffi().address(threadListPtrBuf),
    requireKoffi().address(countBuf),
  ) as number;
  if (kr !== KERN.SUCCESS) return { kr, threads: [] };

  const count = countBuf.readUInt32LE(0);
  if (count === 0) return { kr: KERN.SUCCESS, threads: [] };

  // The kernel wrote an array address into threadListPtrBuf.
  // Under the debugger entitlement we can read this kernel buffer.
  const arrAddr = Number(threadListPtrBuf.readBigUInt64LE(0));
  if (arrAddr === 0) return { kr: KERN.SUCCESS, threads: [] };

  // Read each thread_t (mach_port_t = uint32 = 4 bytes) from the array.
  // On macOS with debugger entitlement, user-space read of the kernel buffer
  // succeeds via mach_vm_read_overwrite.
  const threads: number[] = [];
  for (let i = 0; i < count; i++) {
    const portBuf = Buffer.alloc(4);
    // Use mach_vm_read_overwrite to safely read the kernel array.
    // If this fails for any entry, we skip it.
    const readKr = (() => {
      try {
        const readFn = libSystem().func(
          'int mach_vm_read_overwrite(int, uint64_t, uint64_t, void *, _Out_ uint64_t *)',
        );
        const bytesReadBuf = Buffer.alloc(8);
        const entryKr = readFn(
          task,
          BigInt(arrAddr + i * 4),
          4n,
          requireKoffi().address(portBuf),
          requireKoffi().address(bytesReadBuf),
        ) as number;
        return entryKr;
      } catch {
        return -1;
      }
    })();

    if (readKr === KERN.SUCCESS) {
      threads.push(portBuf.readUInt32LE(0));
    }
  }

  // Deallocate the kernel thread list.
  try {
    const selfPort = machTaskSelf();
    const vmDeallocFn = libSystem().func('int vm_deallocate(int, void *, size_t)');
    vmDeallocFn(selfPort, arrAddr, count * 4);
  } catch {
    /* best-effort cleanup */
  }

  return { kr: KERN.SUCCESS, threads };
}

/**
 * thread_get_state: read thread execution state.
 * kern_return_t thread_get_state(thread_t, thread_state_flavor_t,
 *     thread_state_t, mach_msg_type_number_t *)
 */
function darwinThreadGetState(thread: number, flavor: number, state: Buffer): number {
  const fn = libSystem().func('int thread_get_state(int, int, _Out_ void *, _Inout_ uint32_t *)');
  const countPtr = Buffer.alloc(4);
  countPtr.writeUInt32LE(state.length / 4, 0); // count in uint32 units
  const kr = fn(
    thread,
    flavor,
    requireKoffi().address(state),
    requireKoffi().address(countPtr),
  ) as number;
  return kr;
}

/**
 * thread_set_state: write thread execution state (including debug registers).
 * kern_return_t thread_set_state(thread_t, thread_state_flavor_t,
 *     thread_state_t, mach_msg_type_number_t)
 */
function darwinThreadSetState(thread: number, flavor: number, state: Buffer): number {
  const fn = libSystem().func('int thread_set_state(int, int, void *, uint32_t)');
  return fn(thread, flavor, requireKoffi().address(state), state.length / 4) as number;
}

// ── Flavor constants (from osfmk/mach/arm/thread_status.h) ──────────────

export const ARM_DEBUG_STATE64_FLAVOR = 15;
const ARM_THREAD_STATE64_FLAVOR = 6;

// ── ARM64 debug state layout ────────────────────────────────────────────
//
// struct arm_debug_state64 {
//     __uint64_t __bvr[16];   // +0   breakpoint value regs  (16x8=128)
//     __uint32_t __bcr[16];   // +128  breakpoint control regs (16x4=64)
//     __uint64_t __wvr[16];   // +192  watchpoint value regs  (16x8=128)
//     __uint32_t __wcr[16];   // +320  watchpoint control regs (16x4=64)
//     __uint64_t __mdscr_el1; // +384  monitor debug system ctrl (8)
// };  // total = 392 bytes = 98 x uint32

const BVR_BASE = 0;
const BCR_BASE = 128;
const WVR_BASE = 192;
const WCR_BASE = 320;
const DEBUG_STATE_SIZE = 392;

// arm_thread_state64_t: x[0..29] = +0, fp(x29)=232, lr(x30)=240,
// sp=248, pc=256, cpsr=264. Total = 272 bytes.
const THREAD_STATE64_SIZE = 272;
const A64_PC = 256;
const A64_CPSR = 264;
const A64_SP = 248;

// ── DBGBCR / DBGWCR bitfields ───────────────────────────────────────────

const DBGBCR_E = 1 << 0;
const DBGBCR_PMC = 3 << 1; // EL0 + EL1
const DBGBCR_BAS_FULL = 0xf << 5; // all 4 bytes

const DBGWCR_E = 1 << 0;
const DBGWCR_PAC = 3 << 1; // EL0 + EL1
const DBGWCR_LSC_LOAD = 1 << 3;
const DBGWCR_LSC_STORE = 2 << 3;
const DBGWCR_LSC_BOTH = 3 << 3;

// ── helpers ─────────────────────────────────────────────────────────────

interface ActiveBreakpoint extends BreakpointConfig {
  slotIndex: number;
  slotType: 'bvr' | 'wvr';
  hitCount: number;
  lastHit?: number;
}

// ── engine ──────────────────────────────────────────────────────────────

export class DarwinBreakpointEngine {
  private breakpoints = new Map<string, ActiveBreakpoint>();
  private taskPorts = new Map<number, number>();
  private watchpointSlots = new Map<number, number>(); // bitmask
  private breakpointSlots = new Map<number, number>(); // bitmask

  async attach(pid: number): Promise<void> {
    this.guardPlatform();
    if (this.taskPorts.has(pid)) return;

    const selfPort = machTaskSelf();
    const { kr, task } = taskForPid(selfPort, pid);
    if (kr !== KERN.SUCCESS || task === 0) {
      throw new Error(
        `DarwinBP: task_for_pid(pid=${pid}) failed: kern_return_t=${kr} ` +
          '(needs debugger entitlement or root + SIP disabled)',
      );
    }
    this.taskPorts.set(pid, task);
    this.watchpointSlots.set(pid, 0);
    this.breakpointSlots.set(pid, 0);
  }

  async detach(pid: number): Promise<void> {
    this.guardPlatform();

    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) this.breakpoints.delete(id);
    }

    const task = this.taskPorts.get(pid);
    if (task !== undefined) {
      const { threads } = darwinTaskThreads(task);
      const emptyState = Buffer.alloc(DEBUG_STATE_SIZE);
      for (const th of threads) {
        try {
          darwinThreadSetState(th, ARM_DEBUG_STATE64_FLAVOR, emptyState);
        } catch {
          /* best-effort */
        }
      }
      try {
        darwinPortDeallocate(machTaskSelf(), task);
      } catch {
        /* best-effort */
      }
      this.taskPorts.delete(pid);
    }
    this.watchpointSlots.delete(pid);
    this.breakpointSlots.delete(pid);
  }

  async setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size: BreakpointSize = 4,
  ): Promise<BreakpointConfig> {
    this.guardPlatform();

    let task = this.taskPorts.get(pid);
    if (task === undefined) {
      await this.attach(pid);
      task = this.taskPorts.get(pid);
      if (task === undefined) {
        throw new Error(`DarwinBP: attach did not yield a task port for pid ${pid}`);
      }
    }

    const targetAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const slotType = access === 'execute' ? 'bvr' : 'wvr';
    const maxSlots = slotType === 'bvr' ? 6 : 4;
    const slotSlots = slotType === 'bvr' ? this.breakpointSlots : this.watchpointSlots;

    let slotMask = slotSlots.get(pid) ?? 0;
    let slotIndex = -1;
    for (let i = 0; i < maxSlots; i++) {
      if (!(slotMask & (1 << i))) {
        slotIndex = i;
        slotMask |= 1 << i;
        break;
      }
    }
    if (slotIndex === -1) {
      throw new ToolError(
        'PREREQUISITE',
        `All ${maxSlots} ${slotType} slots in use for pid ${pid}`,
      );
    }
    slotSlots.set(pid, slotMask);

    // Build the per-thread debug state delta.
    const dbg = Buffer.alloc(DEBUG_STATE_SIZE);

    if (slotType === 'bvr') {
      dbg.writeBigUInt64LE(targetAddr, BVR_BASE + slotIndex * 8);
      dbg.writeUInt32LE(DBGBCR_E | DBGBCR_PMC | DBGBCR_BAS_FULL, BCR_BASE + slotIndex * 4);
    } else {
      dbg.writeBigUInt64LE(targetAddr, WVR_BASE + slotIndex * 8);
      let lsc: number;
      switch (access) {
        case 'read':
          lsc = DBGWCR_LSC_LOAD;
          break;
        case 'write':
          lsc = DBGWCR_LSC_STORE;
          break;
        case 'readwrite':
        default:
          lsc = DBGWCR_LSC_BOTH;
          break;
      }
      const basField = adjustWcrBas(size) << 5;
      const wcr = DBGWCR_E | DBGWCR_PAC | lsc | basField;
      dbg.writeUInt32LE(wcr, WCR_BASE + slotIndex * 4);
    }

    // Write debug state to ALL threads in the task.
    const { threads } = darwinTaskThreads(task);
    for (const th of threads) {
      darwinThreadSetState(th, ARM_DEBUG_STATE64_FLAVOR, dbg);
    }

    const config: ActiveBreakpoint = {
      id: randomUUID(),
      pid,
      address: `0x${targetAddr.toString(16).toUpperCase()}`,
      access,
      size,
      enabled: true,
      slotIndex,
      slotType,
      hitCount: 0,
    };
    this.breakpoints.set(config.id, config);
    return config;
  }

  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;

    const task = this.taskPorts.get(bp.pid);
    if (task !== undefined) {
      const { threads } = darwinTaskThreads(task);
      for (const th of threads) {
        try {
          // Read current debug state, then zero only the target slot so other
          // active breakpoints/watchpoints are left intact.
          const dbg = Buffer.alloc(DEBUG_STATE_SIZE);
          if (darwinThreadGetState(th, ARM_DEBUG_STATE64_FLAVOR, dbg) !== KERN.SUCCESS) continue;

          if (bp.slotType === 'bvr') {
            dbg.writeBigUInt64LE(0n, BVR_BASE + bp.slotIndex * 8);
            dbg.writeUInt32LE(0, BCR_BASE + bp.slotIndex * 4);
          } else {
            dbg.writeBigUInt64LE(0n, WVR_BASE + bp.slotIndex * 8);
            dbg.writeUInt32LE(0, WCR_BASE + bp.slotIndex * 4);
          }

          darwinThreadSetState(th, ARM_DEBUG_STATE64_FLAVOR, dbg);
        } catch {
          /* best-effort */
        }
      }
    }

    const slotSlots = bp.slotType === 'bvr' ? this.breakpointSlots : this.watchpointSlots;
    slotSlots.set(bp.pid, (slotSlots.get(bp.pid) ?? 0) & ~(1 << bp.slotIndex));
    this.breakpoints.delete(id);
    return true;
  }

  listBreakpoints(): BreakpointListEntry[] {
    return Array.from(this.breakpoints.values()).map((bp) => ({
      id: bp.id,
      address: bp.address,
      access: bp.access,
      size: bp.size,
      enabled: bp.enabled,
      hitCount: bp.hitCount,
      lastHit: bp.lastHit,
    }));
  }

  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    this.guardPlatform();
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const armed = [...this.breakpoints.values()];
      if (armed.length === 0) return null;

      for (const bp of armed) {
        const task = this.taskPorts.get(bp.pid);
        if (task === undefined) continue;

        const { threads } = darwinTaskThreads(task);
        for (const th of threads) {
          // Read thread GP + debug state.
          const gpState = Buffer.alloc(THREAD_STATE64_SIZE);
          if (darwinThreadGetState(th, ARM_THREAD_STATE64_FLAVOR, gpState) !== KERN.SUCCESS)
            continue;

          const dbg = Buffer.alloc(DEBUG_STATE_SIZE);
          if (darwinThreadGetState(th, ARM_DEBUG_STATE64_FLAVOR, dbg) !== KERN.SUCCESS) continue;

          // Check: does our slot's address register still hold the target?
          // (in hardware-trap-and-restart mode, the kernel may clear or keep it)
          const slotAddr =
            bp.slotType === 'bvr'
              ? dbg.readBigUInt64LE(BVR_BASE + bp.slotIndex * 8)
              : dbg.readBigUInt64LE(WVR_BASE + bp.slotIndex * 8);

          if (slotAddr !== 0n) {
            bp.hitCount++;
            bp.lastHit = Date.now();
            const pc = gpState.readBigUInt64LE(A64_PC);
            return {
              breakpointId: bp.id,
              address: bp.address,
              accessAddress: bp.address,
              instructionAddress: formatAddress(pc),
              threadId: th,
              accessType: bp.access,
              timestamp: Date.now(),
              registers: {
                rax: formatAddress(gpState.readBigUInt64LE(0)),
                rbx: formatAddress(gpState.readBigUInt64LE(8)),
                rcx: formatAddress(gpState.readBigUInt64LE(16)),
                rdx: formatAddress(gpState.readBigUInt64LE(24)),
                rsi: formatAddress(gpState.readBigUInt64LE(32)),
                rdi: formatAddress(gpState.readBigUInt64LE(40)),
                rsp: formatAddress(gpState.readBigUInt64LE(A64_SP)),
                rbp: formatAddress(gpState.readBigUInt64LE(232)),
                r8: formatAddress(gpState.readBigUInt64LE(48)),
                r9: formatAddress(gpState.readBigUInt64LE(56)),
                r10: formatAddress(gpState.readBigUInt64LE(64)),
                r11: formatAddress(gpState.readBigUInt64LE(72)),
                r12: formatAddress(gpState.readBigUInt64LE(80)),
                r13: formatAddress(gpState.readBigUInt64LE(88)),
                r14: formatAddress(gpState.readBigUInt64LE(96)),
                r15: formatAddress(gpState.readBigUInt64LE(104)),
                rip: formatAddress(pc),
                rflags: formatAddress(gpState.readBigUInt64LE(A64_CPSR)),
              },
            };
          }
        }
      }

      await sleep(Math.max(5, Math.min(100, deadline - Date.now())));
    }

    return null;
  }

  async traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number,
  ): Promise<BreakpointHit[]> {
    const max = maxHits ?? BREAKPOINT_TRACE_MAX_HITS;
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const bp = await this.setBreakpoint(pid, address, access);
    const hits: BreakpointHit[] = [];
    const deadline = Date.now() + timeout;
    while (hits.length < max && Date.now() < deadline) {
      const hit = await this.waitForHit(Math.min(1000, deadline - Date.now()));
      if (hit?.breakpointId === bp.id) hits.push(hit);
    }
    await this.removeBreakpoint(bp.id);
    return hits;
  }

  private guardPlatform(): void {
    if (process.platform !== 'darwin') {
      throw new Error(
        `DarwinBreakpointEngine requires process.platform === 'darwin' (got '${process.platform}')`,
      );
    }
  }
}

function adjustWcrBas(size: BreakpointSize): number {
  switch (size) {
    case 1:
      return 0x1;
    case 2:
      return 0x3;
    case 8:
    case 4:
    default:
      return 0xf;
  }
}

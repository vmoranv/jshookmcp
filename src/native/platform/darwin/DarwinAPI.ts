/**
 * Darwin (macOS) API Bindings using koffi FFI
 * Direct native calls to libSystem.B.dylib Mach kernel APIs
 *
 * This is the macOS counterpart to Win32API.ts — provides raw Mach API
 * function wrappers that DarwinMemoryProvider consumes.
 *
 * Pattern: lazy library loading, inline koffi function signatures,
 * Buffer-based struct parsing (no koffi struct registration to avoid
 * "Duplicate type name" errors in test environments).
 *
 * @module platform/darwin/DarwinAPI
 */

import koffi, { type LibraryHandle } from 'koffi';
import { logger } from '@utils/logger';

// ── Mach Kernel Constants ──

/** Mach kernel return codes */
export const KERN = {
  SUCCESS: 0,
  INVALID_ADDRESS: 1,
  PROTECTION_FAILURE: 2,
  NO_SPACE: 3,
  INVALID_ARGUMENT: 4,
  FAILURE: 5,
  RESOURCE_SHORTAGE: 6,
  NOT_RECEIVER: 7,
  NO_ACCESS: 8,
  MEMORY_FAILURE: 9,
  MEMORY_ERROR: 10,
  ALREADY_IN_SET: 11,
  NOT_IN_SET: 12,
  NAME_EXISTS: 13,
  ABORTED: 14,
  INVALID_NAME: 15,
  INVALID_TASK: 16,
  INVALID_RIGHT: 17,
  INVALID_VALUE: 18,
  UREFS_OVERFLOW: 19,
  INVALID_CAPABILITY: 20,
  RIGHT_EXISTS: 21,
  INVALID_HOST: 22,
  MEMORY_PRESENT: 23,
  MEMORY_DATA_MOVED: 24,
  MEMORY_RESTART_COPY: 25,
  INVALID_PROCESSOR_SET: 26,
  POLICY_LIMIT: 27,
  INVALID_POLICY: 28,
  INVALID_OBJECT: 29,
  ALREADY_WAITING: 30,
  DEFAULT_SET: 31,
  EXCEPTION_PROTECTED: 32,
  INVALID_LEDGER: 33,
  INVALID_MEMORY_CONTROL: 34,
  INVALID_SECURITY: 35,
  NOT_DEPRESSED: 36,
  TERMINATED: 37,
  LOCK_SET_DESTROYED: 38,
  LOCK_UNSTABLE: 39,
  LOCK_OWNED: 40,
  LOCK_OWNED_SELF: 41,
  SEMAPHORE_DESTROYED: 42,
  RPC_SERVER_TERMINATED: 43,
  RPC_TERMINATE_ORPHAN: 44,
  RPC_CONTINUE_ORPHAN: 45,
  NOT_SUPPORTED: 46,
  NODE_DOWN: 47,
  NOT_WAITING: 48,
  OPERATION_TIMED_OUT: 49,
  CODESIGN_ERROR: 50,
  POLICY_STATIC: 51,
} as const;

/** Human-readable kernel return code names */
const KERN_NAMES: Record<number, string> = {
  [KERN.SUCCESS]: 'KERN_SUCCESS',
  [KERN.INVALID_ADDRESS]: 'KERN_INVALID_ADDRESS',
  [KERN.PROTECTION_FAILURE]: 'KERN_PROTECTION_FAILURE',
  [KERN.NO_SPACE]: 'KERN_NO_SPACE',
  [KERN.INVALID_ARGUMENT]: 'KERN_INVALID_ARGUMENT',
  [KERN.FAILURE]: 'KERN_FAILURE',
  [KERN.NO_ACCESS]: 'KERN_NO_ACCESS',
  [KERN.INVALID_TASK]: 'KERN_INVALID_TASK',
  [KERN.INVALID_RIGHT]: 'KERN_INVALID_RIGHT',
  [KERN.CODESIGN_ERROR]: 'KERN_CODESIGN_ERROR',
};

/** Get human-readable name for a kern_return_t value */
export function kernReturnName(kr: number): string {
  return KERN_NAMES[kr] ?? `KERN_UNKNOWN(${kr})`;
}

/** VM protection flags */
export const VM_PROT = {
  NONE: 0x00,
  READ: 0x01,
  WRITE: 0x02,
  EXECUTE: 0x04,
  ALL: 0x07, // READ | WRITE | EXECUTE
} as const;

/** VM region flavor constants */
export const VM_REGION_BASIC_INFO_64 = 9;
export const VM_REGION_BASIC_INFO_COUNT_64 = 9;

/** VM allocation flags */
export const VM_FLAGS = {
  FIXED: 0x0000,
  ANYWHERE: 0x0001,
  PURGABLE: 0x0002,
  RANDOM_ADDR: 0x0008,
  OVERWRITE: 0x4000,
} as const;

/** VM region share modes */
export const SM = {
  COW: 1,
  PRIVATE: 2,
  EMPTY: 3,
  SHARED: 4,
  TRUESHARED: 5,
  PRIVATE_ALIASED: 6,
  SHARED_ALIASED: 7,
  LARGE_PAGE: 8,
} as const;

// ── Type Definitions ──

/**
 * Parsed vm_region_basic_info_data_64_t struct.
 *
 * Layout (each field is natural_t/uint32 except offset which is uint64):
 *   protection(4) + max_protection(4) + inheritance(4) + shared(4) +
 *   reserved(4) + offset(8) + behavior(4) + user_wired_count(4) = 36 bytes
 */
export type DarwinRegionInfo = {
  protection: number;
  max_protection: number;
  inheritance: number;
  shared: boolean;
  reserved: boolean;
  offset: bigint;
  behavior: number;
  user_wired_count: number;
};

// ── Library Loading ──

let libSystem: LibraryHandle | null = null;
let koffiAvailableDarwin: boolean | null = null;

/**
 * Check if running on macOS
 */
export function isDarwin(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if koffi can load libSystem.B.dylib on macOS
 */
export function isKoffiAvailableOnDarwin(): boolean {
  if (koffiAvailableDarwin !== null) return koffiAvailableDarwin;

  try {
    const testLib = koffi.load('/usr/lib/libSystem.B.dylib');
    testLib.unload();
    koffiAvailableDarwin = true;
    return true;
  } catch {
    koffiAvailableDarwin = false;
    return false;
  }
}

/**
 * Get or load libSystem.B.dylib (lazy)
 */
function getLibSystem(): LibraryHandle {
  if (!libSystem) {
    libSystem = koffi.load('/usr/lib/libSystem.B.dylib');
    logger.debug('Loaded libSystem.B.dylib via koffi');
  }
  return libSystem;
}

// ── Mach Task APIs ──

/**
 * Get the current task's Mach port (mach_task_self_)
 * On macOS, mach_task_self() is actually a macro accessing the global mach_task_self_ variable.
 * For koffi, we call mach_task_self_ which is the actual symbol.
 */
export function machTaskSelf(): number {
  const fn = getLibSystem().func('uint32 mach_task_self()');
  return fn();
}

/**
 * Get a Mach task port for a target process
 *
 * Requires root privileges or debugger entitlement (com.apple.security.cs.debugger)
 *
 * @param targetTask - The task port of the caller (use machTaskSelf())
 * @param pid - Target process PID
 * @returns { kr, task } where kr is kern_return_t and task is the Mach task port
 */
export function taskForPid(targetTask: number, pid: number): { kr: number; task: number } {
  const fn = getLibSystem().func('int32 task_for_pid(uint32, int32, _Out_ uint32 *)');
  const taskBuf = Buffer.alloc(4);

  const kr = fn(targetTask, pid, taskBuf);
  return {
    kr,
    task: taskBuf.readUInt32LE(0),
  };
}

/**
 * Deallocate a Mach port right
 *
 * @param task - The task owning the port
 * @param name - The port name to deallocate
 * @returns kern_return_t
 */
export function machPortDeallocate(task: number, name: number): number {
  const fn = getLibSystem().func('int32 mach_port_deallocate(uint32, uint32)');
  return fn(task, name);
}

// ── Mach VM Memory Operations ──

/**
 * Read memory from a remote process using mach_vm_read_overwrite.
 *
 * We use _overwrite variant because it writes directly into our pre-allocated
 * buffer, avoiding kernel-allocated memory and the need for mach_vm_deallocate.
 *
 * @param task - Target task port
 * @param address - Source address in target process
 * @param size - Number of bytes to read
 * @returns { kr, data, outsize }
 */
export function machVmReadOverwrite(
  task: number,
  address: bigint,
  size: number,
): { kr: number; data: Buffer; outsize: bigint } {
  const fn = getLibSystem().func(
    'int32 mach_vm_read_overwrite(uint32, uint64, uint64, _Out_ uint8_t *, uint64, _Out_ uint64 *)',
  );

  const data = Buffer.alloc(size);
  const outsizeBuf = Buffer.alloc(8);

  const kr = fn(task, address, BigInt(size), data, BigInt(size), outsizeBuf);

  return {
    kr,
    data,
    outsize: outsizeBuf.readBigUInt64LE(0),
  };
}

/**
 * Write memory to a remote process using mach_vm_write.
 *
 * @param task - Target task port
 * @param address - Destination address in target process
 * @param data - Data to write
 * @returns kern_return_t
 */
export function machVmWrite(task: number, address: bigint, data: Buffer): number {
  const fn = getLibSystem().func('int32 mach_vm_write(uint32, uint64, uint8_t *, uint32)');

  return fn(task, address, data, data.length);
}

/**
 * Query a memory region in a remote process using mach_vm_region.
 *
 * Returns vm_region_basic_info_data_64_t which is 36 bytes:
 *   protection(4) + max_protection(4) + inheritance(4) + shared(4) +
 *   reserved(4) + offset(8) + behavior(4) + user_wired_count(4)
 *
 * @param task - Target task port
 * @param address - Address to query (will be rounded down to region start)
 * @returns { kr, address, size, info, objectName }
 */
export function machVmRegion(
  task: number,
  address: bigint,
): { kr: number; address: bigint; size: bigint; info: DarwinRegionInfo } {
  // mach_vm_region(task, &address, &size, flavor, info, &infoCnt, &objectName)
  // address and size are in/out uint64 pointers
  const fn = getLibSystem().func(
    'int32 mach_vm_region(uint32, _Inout_ uint64 *, _Out_ uint64 *, int32, _Out_ uint8_t *, _Inout_ uint32 *, ' +
      '_Out_ uint32 *)',
  );

  const addressBuf = Buffer.alloc(8);
  addressBuf.writeBigUInt64LE(address);

  const sizeBuf = Buffer.alloc(8);
  const infoBuf = Buffer.alloc(36);

  const infoCntBuf = Buffer.alloc(4);
  infoCntBuf.writeUInt32LE(VM_REGION_BASIC_INFO_COUNT_64);

  const objectNameBuf = Buffer.alloc(4);

  const kr = fn(
    task,
    addressBuf,
    sizeBuf,
    VM_REGION_BASIC_INFO_64,
    infoBuf,
    infoCntBuf,
    objectNameBuf,
  );

  // Parse vm_region_basic_info_data_64_t
  const info: DarwinRegionInfo = {
    protection: infoBuf.readUInt32LE(0),
    max_protection: infoBuf.readUInt32LE(4),
    inheritance: infoBuf.readUInt32LE(8),
    shared: infoBuf.readUInt32LE(12) !== 0,
    reserved: infoBuf.readUInt32LE(16) !== 0,
    offset: infoBuf.readBigUInt64LE(20),
    behavior: infoBuf.readUInt32LE(28),
    user_wired_count: infoBuf.readUInt32LE(32),
  };

  return {
    kr,
    address: addressBuf.readBigUInt64LE(0),
    size: sizeBuf.readBigUInt64LE(0),
    info,
  };
}

/**
 * Change memory protection for a region in a remote process.
 *
 * @param task - Target task port
 * @param address - Start address of the region
 * @param size - Size of the region
 * @param setMaximum - If true, sets maximum protection (needed for W^X workarounds)
 * @param newProtection - New VM_PROT_* flags
 * @returns kern_return_t
 */
export function machVmProtect(
  task: number,
  address: bigint,
  size: bigint,
  setMaximum: boolean,
  newProtection: number,
): number {
  const fn = getLibSystem().func('int32 mach_vm_protect(uint32, uint64, uint64, int32, int32)');

  return fn(task, address, size, setMaximum ? 1 : 0, newProtection);
}

/**
 * Allocate memory in a remote process.
 *
 * @param task - Target task port
 * @param size - Number of bytes to allocate
 * @param flags - VM_FLAGS_* (typically VM_FLAGS_ANYWHERE)
 * @returns { kr, address }
 */
export function machVmAllocate(
  task: number,
  size: bigint,
  flags: number,
): { kr: number; address: bigint } {
  const fn = getLibSystem().func('int32 mach_vm_allocate(uint32, _Inout_ uint64 *, uint64, int32)');

  const addressBuf = Buffer.alloc(8);
  addressBuf.writeBigUInt64LE(0n); // Let kernel choose address

  const kr = fn(task, addressBuf, size, flags);

  return {
    kr,
    address: addressBuf.readBigUInt64LE(0),
  };
}

/**
 * Deallocate (free) memory in a remote process.
 *
 * @param task - Target task port
 * @param address - Start address of the region to free
 * @param size - Size of the region to free
 * @returns kern_return_t
 */
export function machVmDeallocate(task: number, address: bigint, size: bigint): number {
  const fn = getLibSystem().func('int32 mach_vm_deallocate(uint32, uint64, uint64)');

  return fn(task, address, size);
}

// ── Task Suspend / Resume ──

/**
 * Suspend all threads in a task (freeze target process).
 *
 * This pauses the entire process — useful for consistent memory snapshots.
 * Must be paired with `taskResume()` to avoid leaving the target frozen.
 *
 * @param task - Target task port (from taskForPid)
 * @returns kern_return_t
 */
export function taskSuspend(task: number): number {
  const fn = getLibSystem().func('int32 task_suspend(uint32)');
  return fn(task);
}

/**
 * Resume all threads in a previously-suspended task.
 *
 * @param task - Target task port (from taskForPid)
 * @returns kern_return_t
 */
export function taskResume(task: number): number {
  const fn = getLibSystem().func('int32 task_resume(uint32)');
  return fn(task);
}

// ── Mach Exception Ports ──
//
// Exception-port primitives used by DarwinMachAccessBreakpoint to receive
// EXC_BAD_ACCESS traps when a VM_PROT_NONE page is touched. The kernel RPCs
// here are real FFI, including the mach_msg receive + decode + reply loop
// below that dequeues EXC_BAD_ACCESS raise messages and tells the kernel to
// resume the target. See receiveException() / decodeExceptionRaiseMsg() /
// sendExceptionReply().

/**
 * Exception mask bits for `task_set_exception_ports`.
 *
 * EXC_MASK_BAD_ACCESS (bit 1) is the one DarwinMachAccessBreakpoint arms: it
 * fires on access to an unmapped / protected page (our VM_PROT_NONE guard).
 */
export const EXC_MASK = {
  BAD_ACCESS: 1 << 1, // 0x02 — SIGSEGV / SIGBUS source
  BAD_INSTRUCTION: 1 << 2,
  ARITHMETIC: 1 << 3,
  EMULATION: 1 << 4,
  SOFTWARE: 1 << 5,
  BREAKPOINT: 1 << 6, // 0x40 — SIGTRAP source
  SYSCALL: 1 << 7,
  MACH_SYSCALL: 1 << 8,
  RPC_ALERT: 1 << 9,
  CRASH: 1 << 10,
  CORPSE_NOTIFY: 1 << 6, // overlaps BREAKPOINT per xnu headers (documented)
  ALL: 0x7ffe, // standard EXC_MASK_ALL
} as const;

/**
 * Exception behaviors for `task_set_exception_ports`.
 * EXCEPTION_DEFAULT delivers { code, codeCnt } to the exception port.
 */
export const EXCEPTION_BEHAVIOR = {
  DEFAULT: 1,
  STATE: 2,
  STATE_IDENTITY: 3,
  /** MACH_EXCEPTION_CODES OR'd into a behavior => 64-bit code payloads. */
  MACH_CODES: 0x20000000,
} as const;

/**
 * Thread-state flavors for the `new_flavor` arg of `task_set_exception_ports`
 * (and for `thread_get_state`).
 *
 * x86_THREAD_STATE64 (4) is the x86-64 full GP register set used to read rip
 * and friends on a hit. THREAD_STATE_NONE (13) tells the kernel not to embed
 * thread state in the exception message (caller must then thread_get_state
 * explicitly). We export x86_THREAD_STATE64 as the default for DarwinMach.
 */
export const THREAD_FLAVOR = {
  NONE: 13,
  x86_THREAD_STATE32: 1,
  x86_THREAD_STATE64: 4,
  x86_FLOAT_STATE64: 8,
  x86_THREAD_STATE: 7, // generic x86 thread state
  ARM_THREAD_STATE64: 6, // Apple Silicon GP register set (arm_thread_state64)
} as const;

/**
 * mach_msg_type_name_t dispostions (mach/message.h) — used by mach_port_insert_right.
 */
export const MACH_MSG_DISPOSITION = {
  MOVE_RECEIVE: 16,
  MOVE_SEND: 17,
  MOVE_SEND_ONCE: 18,
  COPY_SEND: 19,
  MAKE_SEND: 20, // create a send right from a receive right you hold
  MAKE_SEND_ONCE: 21,
  COPY_RECEIVE: 22,
} as const;

/**
 * mach_msg ids for the exception subsystem (mig subsystem 24xx).
 * mach_exception_raise (64-bit code, requires MACH_EXCEPTION_CODES) = 2405;
 * exception_raise (32-bit code, DEFAULT behavior) = 2401. The reply ids are +100.
 */
export const EXC_RAISE_MSG_IDS = {
  RAISE_32: 2401, // exception_raise
  RAISE_64: 2405, // mach_exception_raise
  REPLY_32: 2501,
  REPLY_64: 2505,
} as const;

/**
 * The GP thread-state flavor for the running host arch. task_set_exception_ports
 * rejects THREAD_STATE_NONE (13) on Apple Silicon, and thread_get_state needs the
 * arch-correct flavor to read registers.
 */
export function threadStateFlavor(): number {
  return process.arch === 'arm64'
    ? THREAD_FLAVOR.ARM_THREAD_STATE64
    : THREAD_FLAVOR.x86_THREAD_STATE64;
}

/**
 * Arm a Mach exception handler on `task`.
 *
 * Wraps the xnu RPC `task_set_exception_ports(task, exception_mask,
 * exception_port, behavior, new_flavor)`. All Mach ports / masks / flavors are
 * uint32 on the libSystem ABI, so the koffi signature is five uint32 args.
 *
 * To capture EXC_BAD_ACCESS from a VM_PROT_NONE guard page:
 *   taskSetExceptionPorts(task, EXC_MASK.BAD_ACCESS, exceptionPort,
 *                         EXCEPTION_BEHAVIOR.DEFAULT, THREAD_FLAVOR.x86_THREAD_STATE64)
 *
 * The caller must have previously allocated `exceptionPort` as a Mach receive
 * right (mach_port_allocate) — that receive right is where the kernel will
 * enqueue `mach_exception_raise` messages. The mach_msg receive + decode loop
 * for dequeuing those messages is provided below (receiveException /
 * decodeExceptionRaiseMsg); DarwinMachAccessBreakpoint.waitForHit uses them.
 *
 * @returns kern_return_t (0 = KERN_SUCCESS)
 */
export function taskSetExceptionPorts(
  task: number,
  exceptionMask: number,
  exceptionPort: number,
  behavior: number,
  flavor: number,
): number {
  const fn = getLibSystem().func(
    'int32 task_set_exception_ports(uint32, uint32, uint32, uint32, uint32)',
  );
  return fn(task, exceptionMask, exceptionPort, behavior, flavor);
}

/**
 * Host VM page size in bytes, via sysctlbyname("hw.pagesize"). Returns 4096 on
 * Intel macOS, 16384 on Apple Silicon. DarwinMachAccessBreakpoint uses this to
 * page-align VM_PROT_NONE guards for the running host (replaces the former
 * hardcoded 4096). Falls back to 4096 if the sysctl call fails.
 */
export function hostPageSize(): number {
  const nameBuf = Buffer.from('hw.pagesize\0', 'ascii');
  const valBuf = Buffer.alloc(4);
  const lenBuf = Buffer.alloc(8); // size_t
  lenBuf.writeBigUInt64LE(4n, 0);
  const fn = getLibSystem().func(
    'int32 sysctlbyname(_In_ const char *, _Out_ void *, _Inout_ size_t *, _In_ const void *, size_t)',
  );
  const kr = fn(
    koffi.address(nameBuf),
    koffi.address(valBuf),
    koffi.address(lenBuf),
    0,
    0,
  ) as number;
  if (kr !== 0) return 4096;
  return valBuf.readUInt32LE(0);
}

// ── mach_msg exception receive loop ──
//
// Primitives for the EXC_BAD_ACCESS capture path. A Darwin access-breakpoint
// allocates a Mach receive right, hands it to task_set_exception_ports, then
// mach_msg-receives mach_exception_raise messages on it, decodes the fault
// address + thread, reads GP registers via thread_get_state, and replies with
// RetCode=KERN_SUCCESS so the kernel resumes the target.

export const MACH_MSG_OPTION = {
  SEND_MSG: 0x00000001,
  RCV_MSG: 0x00000004,
  RCV_INTERRUPT: 0x00000040,
  SEND_INTERRUPT: 0x00000040,
  RCV_TIMEOUT: 0x00000100,
} as const;

/** mach_msg_return_t success. */
export const MACH_MSG_SUCCESS = 0;
/** RCV-side error codes occupy the 0x10004xxx range (osfmk/mach/message.h):
 *  MACH_RCV_INVALID_NAME=0x10004001, MACH_RCV_IN_SET=0x10004002,
 *  MACH_RCV_TIMED_OUT=0x10004003, MACH_RCV_INTERRUPTED=0x10004004, ... */
export const MACH_RCV_ERROR_BASE = 0x10004000;

/** Reply sends back the MOVE_SEND_ONCE right the kernel carried in the raise. */
export const MACH_MSG_TYPE_MOVE_SEND_ONCE = 5;

/** mach_exception_raise_reply mig message id (raise=2405 → reply=2505). */
export const EXC_RAISE_REPLY_ID = 2505;

export interface DecodedException {
  thread: number; // faulting thread port
  task: number;
  exception: number; // exception_type_t (1 = EXC_BAD_ACCESS)
  code0: bigint; // mach_exception_data_type_t[0] (kern return for BAD_ACCESS)
  code1: bigint; // [1] = faulting virtual address for EXC_BAD_ACCESS
  remotePort: number; // Head.msgh_remote_port
  localPort: number; // Head.msgh_local_port (send-once right for our reply)
  msgId: number;
}

/**
 * mach_msg — the kernel RPC primitive.
 *   mach_msg_return_t mach_msg(mach_msg_header_t *msg, option_t option,
 *       mach_msg_size_t send_size, mach_msg_size_t rcv_size,
 *       mach_port_t rcv_name, timeout_t timeout, mach_port_t notify)
 * All args are uint32 on the libSystem ABI.
 */
export function machMsg(
  msg: Buffer,
  option: number,
  sendSize: number,
  rcvSize: number,
  rcvName: number,
  timeout: number,
  notify: number,
): number {
  const fn = getLibSystem().func(
    'int32 mach_msg(void *, uint32, uint32, uint32, uint32, uint32, uint32)',
  );
  return fn(koffi.address(msg), option, sendSize, rcvSize, rcvName, timeout, notify) as number;
}

/** mach_port_allocate(self, MACH_PORT_RIGHT_RECEIVE, &name) → receive right name.
 *  MACH_PORT_RIGHT_RECEIVE = 1 (mach/port.h: SEND=0, RECEIVE=1, SEND_ONCE=2,
 *  PORT_SET=3, DEAD_NAME=4). Passing 0 (SEND) returns KERN_INVALID_VALUE because
 *  a bare send right cannot be allocated without an existing receive right. */
export function machPortAllocateReceive(): number {
  const MACH_PORT_RIGHT_RECEIVE = 1;
  const nameBuf = Buffer.alloc(4);
  const fn = getLibSystem().func('int32 mach_port_allocate(uint32, uint32, _Out_ uint32 *)');
  const kr = fn(machTaskSelf(), MACH_PORT_RIGHT_RECEIVE, koffi.address(nameBuf)) as number;
  if (kr !== KERN.SUCCESS) {
    throw new Error(`mach_port_allocate(MACH_PORT_RIGHT_RECEIVE) failed: kern_return_t=${kr}`);
  }
  return nameBuf.readUInt32LE(0);
}

/**
 * mach_port_insert_right(self, name, name, MAKE_SEND) — create a send right for
 * a receive right you own. REQUIRED before passing the port to
 * task_set_exception_ports: the kernel must hold a send right to deliver
 * exceptions, and without one task_set_exception_ports returns
 * MACH_SEND_INVALID_NOTIFY (0x1000000a). Returns kern_return_t.
 */
export function machPortInsertSendRight(name: number): number {
  const fn = getLibSystem().func('int32 mach_port_insert_right(uint32, uint32, uint32, uint32)');
  return fn(machTaskSelf(), name, name, MACH_MSG_DISPOSITION.MAKE_SEND) as number;
}

/**
 * mach_port_mod_refs(self, name, MACH_PORT_RIGHT_RECEIVE, -1) — the correct way
 * to release a receive right. mach_port_deallocate is for SEND rights and returns
 * KERN_INVALID_RIGHT (17) on a receive right. Returns kern_return_t.
 */
export function machPortReleaseReceive(name: number): number {
  const MACH_PORT_RIGHT_RECEIVE = 1;
  const fn = getLibSystem().func('int32 mach_port_mod_refs(uint32, uint32, uint32, int32)');
  return fn(machTaskSelf(), name, MACH_PORT_RIGHT_RECEIVE, -1) as number;
}

/** mach_port_deallocate(self, name) — release a port right. */
export function machPortDeallocateRecv(name: number): number {
  return machPortDeallocate(machTaskSelf(), name);
}

/**
 * thread_get_state(thread, flavor, old_state, *count) — read GP registers.
 * For x86-64 use flavor x86_THREAD_STATE64 (4); `state` is 168 bytes but we pass
 * a 216-byte buffer for headroom (count in uint32 words). Returns kern_return_t.
 */
export function threadGetState(thread: number, flavor: number, state: Buffer): number {
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(state.length / 4, 0);
  const fn = getLibSystem().func(
    'int32 thread_get_state(uint32, uint32, _Out_ uint8_t *, _Inout_ uint32 *)',
  );
  return fn(thread, flavor, koffi.address(state), koffi.address(countBuf)) as number;
}

/**
 * Decode a mach_exception_raise message (behavior EXCEPTION_DEFAULT |
 * MACH_EXCEPTION_CODES) into the fields the engine needs.
 *
 * On-wire layout (MIG, offsets from xnu osfmk/mach/exc.defs):
 *   +0  mach_msg_header_t Head (24)
 *   +24 NDR_record_t NDR (8)
 *   +32 mach_port_t thread (4)
 *   +36 mach_port_t task (4)
 *   +40 exception_type_t exception (4)
 *   +44 mach_msg_type_number_t codeCnt (4)
 *   +48 mach_exception_data_type_t code[0] (8, int64 LE)
 *   +56 mach_exception_data_type_t code[1] (8) ← faulting vaddr for EXC_BAD_ACCESS
 * (no flavor/old_state embedded for EXCEPTION_DEFAULT.)
 *
 * Runtime-unverified on this host (needs macOS debugger entitlement + a faulting
 * target); offsets derived from the xnu mig layout.
 */
export function decodeExceptionRaiseMsg(msg: Buffer): DecodedException {
  if (msg.length < 64) {
    throw new Error(`mach_exception_raise message truncated (${msg.length} < 64 bytes)`);
  }
  const msgId = msg.readUInt32LE(20);
  // msgId distinguishes the two layouts: mach_exception_raise (2405, 64-bit
  // mach_exception_data_type_t code[] at @48/@56) vs exception_raise (2401,
  // 32-bit exception_data_type_t code[] at @48/@52). The latter is what hosts
  // that reject MACH_EXCEPTION_CODES deliver — its code[1] is only the low 32
  // bits of the fault address.
  const is64 = msgId === EXC_RAISE_MSG_IDS.RAISE_64;
  return {
    remotePort: msg.readUInt32LE(8),
    localPort: msg.readUInt32LE(12),
    msgId,
    thread: msg.readUInt32LE(32),
    task: msg.readUInt32LE(36),
    exception: msg.readInt32LE(40),
    code0: is64 ? msg.readBigInt64LE(48) : BigInt(msg.readInt32LE(48)),
    code1: is64 ? msg.readBigInt64LE(56) : BigInt(msg.readUInt32LE(52)),
  };
}

/**
 * Build the mach_exception_raise_reply carrying RetCode, addressed to the
 * send-once right carried in the raise's msgh_local_port. RetCode=KERN_SUCCESS
 * tells the kernel the exception was handled and the target may resume.
 */
export function buildExceptionReply(localPort: number, retCode: number, replyId: number): Buffer {
  // Head(24) + NDR(8) + RetCode(4) = 36 bytes
  const reply = Buffer.alloc(36);
  // msgh_bits = remote_type | (local_type<<8); reply remote = MOVE_SEND_ONCE.
  reply.writeUInt32LE(MACH_MSG_TYPE_MOVE_SEND_ONCE, 0);
  reply.writeUInt32LE(36, 4); // msgh_size
  reply.writeUInt32LE(localPort, 8); // msgh_remote_port = raise's local (send-once)
  reply.writeUInt32LE(0, 12); // msgh_local_port = null
  reply.writeUInt32LE(0, 16); // msgh_voucher_port
  reply.writeUInt32LE(replyId, 20); // msgh_id (2505 64-bit / 2501 32-bit)
  reply.writeBigInt64LE(0n, 24); // NDR (zeros ok on LE/IEEE host)
  reply.writeInt32LE(retCode, 32); // RetCode (KERN_SUCCESS = 0)
  return reply;
}

/**
 * Receive one mach_exception_raise on `receivePort`, decoding fault address +
 * thread. Returns null on timeout/interrupt (no hit in the window). Throws on
 * fatal mach_msg errors. Does NOT send the reply — the caller does after
 * reading thread state, via sendExceptionReply().
 */
export function receiveException(receivePort: number, timeoutMs: number): DecodedException | null {
  const rcvBuf = Buffer.alloc(256);
  const kr = machMsg(
    rcvBuf,
    MACH_MSG_OPTION.RCV_MSG | MACH_MSG_OPTION.RCV_TIMEOUT | MACH_MSG_OPTION.RCV_INTERRUPT,
    0,
    rcvBuf.length,
    receivePort,
    timeoutMs,
    0,
  );
  if (kr === MACH_MSG_SUCCESS) return decodeExceptionRaiseMsg(rcvBuf);
  if (kr >= MACH_RCV_ERROR_BASE) return null; // timeout / interrupt / transient
  throw new Error(`mach_msg(MACH_RCV_MSG) failed: mach_msg_return_t=0x${(kr >>> 0).toString(16)}`);
}

/** Send the mach_exception_raise_reply so the kernel resumes the target.
 *  replyId follows the received msgId: 2505 for 64-bit, 2501 for 32-bit. */
export function sendExceptionReply(localPort: number, retCode: number, msgId?: number): void {
  const replyId =
    msgId === EXC_RAISE_MSG_IDS.RAISE_64 ? EXC_RAISE_MSG_IDS.REPLY_64 : EXC_RAISE_MSG_IDS.REPLY_32;
  const reply = buildExceptionReply(localPort, retCode, replyId);
  const kr = machMsg(
    reply,
    MACH_MSG_OPTION.SEND_MSG | MACH_MSG_OPTION.SEND_INTERRUPT,
    reply.length,
    0,
    0,
    0,
    0,
  );
  if (kr !== MACH_MSG_SUCCESS) {
    // Non-fatal: failing to reply leaves the target stopped; caller decides.
    logger.debug(`sendExceptionReply: mach_msg(SEND) = 0x${(kr >>> 0).toString(16)}`);
  }
}

// ── dyld Image Enumeration ──

/**
 * Get the number of loaded images in the current process.
 * Note: For remote process module enumeration, we need to read
 * dyld_all_image_infos from the target process memory instead.
 */
export function dyldImageCount(): number {
  const fn = getLibSystem().func('uint32 _dyld_image_count()');
  return fn();
}

/**
 * Get the name of a loaded image by index (current process only).
 */
export function dyldGetImageName(index: number): string {
  const fn = getLibSystem().func('const char * _dyld_get_image_name(uint32)');
  const ptr = fn(index);
  return ptr ? String(ptr) : '';
}

/**
 * Get the slide (ASLR offset) of a loaded image by index (current process only).
 */
export function dyldGetImageVmaddrSlide(index: number): bigint {
  const fn = getLibSystem().func('int64 _dyld_get_image_vmaddr_slide(uint32)');
  return BigInt(fn(index));
}

/**
 * Get the Mach header pointer of a loaded image by index (current process only).
 */
export function dyldGetImageHeader(index: number): bigint {
  const fn = getLibSystem().func('void * _dyld_get_image_header(uint32)');
  return BigInt(fn(index));
}

// ── Cleanup ──

/**
 * Unload the libSystem library and reset cached state.
 */
export function unloadLibraries(): void {
  if (libSystem) {
    libSystem.unload();
    libSystem = null;
  }
  koffiAvailableDarwin = null;
  logger.debug('Unloaded macOS native libraries');
}

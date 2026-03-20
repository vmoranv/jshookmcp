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

import koffi from 'koffi';
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

let libSystem: koffi.IKoffiLib | null = null;
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
function getLibSystem(): koffi.IKoffiLib {
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
  const fn = getLibSystem().func('uint32 mach_task_self_()');
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
  size: number
): { kr: number; data: Buffer; outsize: bigint } {
  const fn = getLibSystem().func(
    'int32 mach_vm_read_overwrite(uint32, uint64, uint64, _Out_ uint8_t[len], uint64 len, _Out_ uint64 *)'
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
export function machVmWrite(
  task: number,
  address: bigint,
  data: Buffer
): number {
  const fn = getLibSystem().func(
    'int32 mach_vm_write(uint32, uint64, uint8_t *, uint32)'
  );

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
  address: bigint
): { kr: number; address: bigint; size: bigint; info: DarwinRegionInfo } {
  // mach_vm_region(task, &address, &size, flavor, info, &infoCnt, &objectName)
  // address and size are in/out uint64 pointers
  const fn = getLibSystem().func(
    'int32 mach_vm_region(uint32, _Inout_ uint64 *, _Out_ uint64 *, int32, _Out_ uint8_t[36], _Inout_ uint32 *, _Out_ uint32 *)'
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
    objectNameBuf
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
  newProtection: number
): number {
  const fn = getLibSystem().func(
    'int32 mach_vm_protect(uint32, uint64, uint64, int32, int32)'
  );

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
  flags: number
): { kr: number; address: bigint } {
  const fn = getLibSystem().func(
    'int32 mach_vm_allocate(uint32, _Inout_ uint64 *, uint64, int32)'
  );

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
export function machVmDeallocate(
  task: number,
  address: bigint,
  size: bigint
): number {
  const fn = getLibSystem().func(
    'int32 mach_vm_deallocate(uint32, uint64, uint64)'
  );

  return fn(task, address, size);
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

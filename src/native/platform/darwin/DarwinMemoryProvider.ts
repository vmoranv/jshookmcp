/**
 * DarwinMemoryProvider — macOS PlatformMemoryAPI implementation.
 *
 * Adapts raw Mach kernel API bindings from DarwinAPI.ts into the
 * PlatformMemoryAPI interface. Follows the exact same adapter pattern
 * as Win32MemoryProvider: WeakMap-based handle storage, protection
 * flag mapping, region state/type mapping.
 *
 * Requires: macOS + root privileges (or debugger entitlement) for
 * task_for_pid to succeed on foreign processes.
 *
 * @module platform/darwin/DarwinMemoryProvider
 */

import type { PlatformMemoryAPI } from '../PlatformMemoryAPI.js';
import {
  MemoryProtection,
  type ProcessHandle,
  type MemoryRegionInfo,
  type MemoryReadResult,
  type MemoryWriteResult,
  type ProtectionChangeResult,
  type AllocationResult,
  type ModuleInfo,
  type PlatformAvailability,
  type MemoryRegionType,
} from '../types.js';
import {
  isDarwin,
  isKoffiAvailableOnDarwin,
  machTaskSelf,
  taskForPid,
  machPortDeallocate,
  machVmReadOverwrite,
  machVmWrite,
  machVmRegion,
  machVmProtect,
  machVmAllocate,
  machVmDeallocate,
  dyldImageCount,
  dyldGetImageName,
  dyldGetImageHeader,
  kernReturnName,
  KERN,
  VM_PROT,
  VM_FLAGS,
  SM,
} from './DarwinAPI.js';

// ── Internal handle storage ──

/** Mach task port stored alongside ProcessHandle */
interface DarwinHandle {
  task: number;
}

const handleMap = new WeakMap<ProcessHandle, DarwinHandle>();

function getDarwinHandle(handle: ProcessHandle): DarwinHandle {
  const h = handleMap.get(handle);
  if (h === undefined) throw new Error('Invalid ProcessHandle — not a Darwin handle');
  return h;
}

// ── Protection mapping ──

/**
 * Map Mach VM_PROT_* flags → platform-agnostic MemoryProtection
 */
function machProtToMemoryProtection(prot: number): MemoryProtection {
  let flags = MemoryProtection.NoAccess;
  if (prot & VM_PROT.READ) flags |= MemoryProtection.Read;
  if (prot & VM_PROT.WRITE) flags |= MemoryProtection.Write;
  if (prot & VM_PROT.EXECUTE) flags |= MemoryProtection.Execute;
  return flags;
}

/**
 * Map platform-agnostic MemoryProtection → Mach VM_PROT_* flags
 */
function memoryProtectionToMachProt(prot: MemoryProtection): number {
  let machProt = VM_PROT.NONE;
  if (prot & MemoryProtection.Read) machProt |= VM_PROT.READ;
  if (prot & MemoryProtection.Write) machProt |= VM_PROT.WRITE;
  if (prot & MemoryProtection.Execute) machProt |= VM_PROT.EXECUTE;
  return machProt;
}

// ── Region mapping ──

/**
 * Map Mach share mode → platform-agnostic MemoryRegionType.
 * macOS doesn't distinguish "image" from "mapped" at the vm_region level,
 * so we use share mode as the best approximation.
 */
function darwinShareModeToType(shareMode: number): MemoryRegionType {
  switch (shareMode) {
    case SM.PRIVATE:
    case SM.PRIVATE_ALIASED:
    case SM.COW:
      return 'private';
    case SM.SHARED:
    case SM.TRUESHARED:
    case SM.SHARED_ALIASED:
      return 'mapped';
    case SM.EMPTY:
      return 'unknown';
    default:
      return 'unknown';
  }
}

// ── DarwinMemoryProvider ──

export class DarwinMemoryProvider implements PlatformMemoryAPI {
  readonly platform = 'darwin' as const;

  async checkAvailability(): Promise<PlatformAvailability> {
    if (!isDarwin()) {
      return { available: false, reason: 'Not running on macOS', platform: 'darwin' };
    }

    if (!isKoffiAvailableOnDarwin()) {
      return {
        available: false,
        reason: 'koffi FFI library cannot load libSystem.B.dylib',
        platform: 'darwin',
      };
    }

    // Test task_for_pid on our own process to verify permissions
    try {
      const selfTask = machTaskSelf();
      const { kr } = taskForPid(selfTask, process.pid);
      if (kr !== KERN.SUCCESS) {
        return {
          available: false,
          reason: `task_for_pid failed (${kernReturnName(kr)}). Run with sudo or add debugger entitlement.`,
          platform: 'darwin',
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isCrash = /signal|bus error|segfault|abort/i.test(message);
      return {
        available: false,
        reason: isCrash
          ? `Mach API call crashed (${message}). This may be caused by SIP (System Integrity Protection) on ARM64 macOS. ` +
            'Disable SIP or use a code-signed binary with com.apple.security.cs.debugger entitlement.'
          : `task_for_pid permission check failed: ${message}. Run with sudo or add debugger entitlement.`,
        platform: 'darwin',
      };
    }

    return { available: true, platform: 'darwin' };
  }

  openProcess(pid: number, _writeAccess: boolean): ProcessHandle {
    const selfTask = machTaskSelf();
    const { kr, task } = taskForPid(selfTask, pid);

    if (kr !== KERN.SUCCESS) {
      throw new Error(
        `Failed to open process ${pid}: ${kernReturnName(kr)} (${kr}). ` +
          (kr === KERN.FAILURE
            ? 'Run with sudo or sign with com.apple.security.cs.debugger entitlement.'
            : kr === KERN.INVALID_ARGUMENT
              ? 'Invalid PID — process may not exist.'
              : 'Check macOS permissions.'),
      );
    }

    const handle: ProcessHandle = { pid, writeAccess: _writeAccess };
    handleMap.set(handle, { task });
    return handle;
  }

  closeProcess(handle: ProcessHandle): void {
    const h = getDarwinHandle(handle);
    machPortDeallocate(machTaskSelf(), h.task);
    // WeakMap will auto-clean once ProcessHandle is GC'd
  }

  readMemory(handle: ProcessHandle, address: bigint, size: number): MemoryReadResult {
    const h = getDarwinHandle(handle);
    const { kr, data, outsize } = machVmReadOverwrite(h.task, address, size);

    if (kr !== KERN.SUCCESS) {
      throw new Error(
        `mach_vm_read_overwrite failed at 0x${address.toString(16)}: ${kernReturnName(kr)} (${kr})`,
      );
    }

    return { data, bytesRead: Number(outsize) };
  }

  writeMemory(handle: ProcessHandle, address: bigint, data: Buffer): MemoryWriteResult {
    const h = getDarwinHandle(handle);
    const kr = machVmWrite(h.task, address, data);

    if (kr !== KERN.SUCCESS) {
      throw new Error(
        `mach_vm_write failed at 0x${address.toString(16)}: ${kernReturnName(kr)} (${kr})`,
      );
    }

    return { bytesWritten: data.length };
  }

  queryRegion(handle: ProcessHandle, address: bigint): MemoryRegionInfo | null {
    const h = getDarwinHandle(handle);
    const { kr, address: regionBase, size: regionSize, info } = machVmRegion(h.task, address);

    if (kr !== KERN.SUCCESS) {
      // KERN_INVALID_ADDRESS means we've gone past the valid address space
      return null;
    }

    const protection = machProtToMemoryProtection(info.protection);

    return {
      baseAddress: regionBase,
      size: Number(regionSize),
      protection,
      // macOS doesn't have reserved vs committed distinction like Win32.
      // All vm_region-returned regions are committed; free regions aren't returned.
      state: 'committed',
      type: darwinShareModeToType(info.behavior),
      isReadable: (protection & MemoryProtection.Read) !== 0,
      isWritable: (protection & MemoryProtection.Write) !== 0,
      isExecutable: (protection & MemoryProtection.Execute) !== 0,
    };
  }

  changeProtection(
    handle: ProcessHandle,
    address: bigint,
    size: number,
    newProtection: MemoryProtection,
  ): ProtectionChangeResult {
    const h = getDarwinHandle(handle);
    const machProt = memoryProtectionToMachProt(newProtection);

    // Query current protection before changing (to return oldProtection)
    const { kr: queryKr, info } = machVmRegion(h.task, address);
    const oldProtection =
      queryKr === KERN.SUCCESS
        ? machProtToMemoryProtection(info.protection)
        : MemoryProtection.NoAccess;

    // On macOS with W^X enforcement, if we need both WRITE and EXECUTE,
    // we must first set the maximum protection to allow it
    const needsMaxProtAdjust =
      (machProt & VM_PROT.WRITE) !== 0 && (machProt & VM_PROT.EXECUTE) !== 0;

    if (needsMaxProtAdjust) {
      const maxKr = machVmProtect(h.task, address, BigInt(size), true, VM_PROT.ALL);
      if (maxKr !== KERN.SUCCESS) {
        throw new Error(
          `mach_vm_protect (set_maximum) failed at 0x${address.toString(16)}: ${kernReturnName(maxKr)} (${maxKr})`,
        );
      }
    }

    const kr = machVmProtect(h.task, address, BigInt(size), false, machProt);
    if (kr !== KERN.SUCCESS) {
      throw new Error(
        `mach_vm_protect failed at 0x${address.toString(16)}: ${kernReturnName(kr)} (${kr})`,
      );
    }

    return { oldProtection };
  }

  allocateMemory(
    handle: ProcessHandle,
    size: number,
    protection: MemoryProtection,
  ): AllocationResult {
    const h = getDarwinHandle(handle);

    // Allocate with VM_FLAGS_ANYWHERE — let kernel choose address
    const { kr, address } = machVmAllocate(h.task, BigInt(size), VM_FLAGS.ANYWHERE);
    if (kr !== KERN.SUCCESS) {
      throw new Error(`mach_vm_allocate failed: ${kernReturnName(kr)} (${kr})`);
    }

    // Set requested protection (allocate gives RW by default)
    const machProt = memoryProtectionToMachProt(protection);
    if (machProt !== (VM_PROT.READ | VM_PROT.WRITE)) {
      const protKr = machVmProtect(h.task, address, BigInt(size), false, machProt);
      if (protKr !== KERN.SUCCESS) {
        // Clean up allocated memory on protection failure
        machVmDeallocate(h.task, address, BigInt(size));
        throw new Error(
          `mach_vm_protect after allocate failed: ${kernReturnName(protKr)} (${protKr})`,
        );
      }
    }

    return { address };
  }

  freeMemory(handle: ProcessHandle, address: bigint, size: number): void {
    const h = getDarwinHandle(handle);
    const kr = machVmDeallocate(h.task, address, BigInt(size));
    if (kr !== KERN.SUCCESS) {
      throw new Error(
        `mach_vm_deallocate failed at 0x${address.toString(16)}: ${kernReturnName(kr)} (${kr})`,
      );
    }
  }

  enumerateModules(handle: ProcessHandle): ModuleInfo[] {
    const h = getDarwinHandle(handle);
    const isSelf = handle.pid === process.pid;

    if (isSelf) {
      return this._enumerateModulesSelf();
    }
    return this._enumerateModulesRemote(h.task);
  }

  /**
   * Enumerate modules for the current process using dyld APIs (fast path).
   */
  private _enumerateModulesSelf(): ModuleInfo[] {
    const count = dyldImageCount();
    const modules: ModuleInfo[] = [];

    for (let i = 0; i < count; i++) {
      const name = dyldGetImageName(i);
      const header = dyldGetImageHeader(i);

      if (!name || header === 0n) continue;

      // Extract just the filename from the full path
      const basename = name.split('/').pop() ?? name;

      modules.push({
        name: basename,
        baseAddress: header,
        size: 0, // dyld API doesn't provide size directly; would need Mach-O header parsing
      });
    }

    return modules;
  }

  /**
   * Enumerate modules for a remote process by reading dyld_all_image_infos.
   *
   * This reads the target process's dyld info structures from memory.
   * Falls back to an empty list if the info struct cannot be located.
   */
  private _enumerateModulesRemote(task: number): ModuleInfo[] {
    // Remote module enumeration requires reading the dyld_all_image_infos
    // structure from the target process. The address is obtained via
    // task_info(TASK_DYLD_INFO), but koffi doesn't give us easy access.
    //
    // For now, we use a simplified approach:
    // Walk memory regions and identify image-backed ones by their text segment pattern.
    // This is less precise but works without special entitlements beyond task_for_pid.
    const modules: ModuleInfo[] = [];
    let address = 0n;

    // Safety limit: don't scan more than 10000 regions
    for (let i = 0; i < 10000; i++) {
      const { kr, address: regionBase, size: regionSize, info } = machVmRegion(task, address);

      if (kr !== KERN.SUCCESS) break;

      // Look for readable+executable regions (code segments)
      const isReadable = (info.protection & VM_PROT.READ) !== 0;
      const isExecutable = (info.protection & VM_PROT.EXECUTE) !== 0;

      if (isReadable && isExecutable && regionSize > 0n) {
        // Try to read the first 4 bytes to check for Mach-O magic
        try {
          const { kr: readKr, data } = machVmReadOverwrite(task, regionBase, 4);
          if (readKr === KERN.SUCCESS && data.length >= 4) {
            const magic = data.readUInt32LE(0);
            // MH_MAGIC_64 = 0xfeedfacf, MH_MAGIC = 0xfeedface
            if (magic === 0xfeedfacf || magic === 0xfeedface) {
              modules.push({
                name: `module_0x${regionBase.toString(16)}`,
                baseAddress: regionBase,
                size: Number(regionSize),
              });
            }
          }
        } catch {
          // Skip unreadable regions
        }
      }

      // Advance past this region
      address = regionBase + regionSize;
    }

    return modules;
  }
}

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
  type MemoryRegionState,
  type MemoryRegionType,
} from '../types.js';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualQueryEx,
  VirtualProtectEx,
  VirtualAllocEx,
  VirtualFreeEx,
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleInformation,
  isWindows,
  isKoffiAvailable,
  PAGE,
  MEM,
} from '../../Win32API.js';

// ── Internal handle storage ──

const handleMap = new WeakMap<ProcessHandle, bigint>();

function getWin32Handle(handle: ProcessHandle): bigint {
  const h = handleMap.get(handle);
  if (h === undefined) throw new Error('Invalid ProcessHandle — not a Win32 handle');
  return h;
}

// ── Protection mapping ──

function win32ProtToMemoryProtection(prot: number): MemoryProtection {
  // Map Win32 PAGE_* constants to MemoryProtection flags
  let flags = MemoryProtection.NoAccess;
  if (prot & PAGE.READONLY) flags |= MemoryProtection.Read;
  if (prot & PAGE.READWRITE) flags |= MemoryProtection.ReadWrite;
  if (prot & PAGE.WRITECOPY) flags |= MemoryProtection.Read | MemoryProtection.WriteCopy;
  if (prot & PAGE.EXECUTE) flags |= MemoryProtection.Execute;
  if (prot & PAGE.EXECUTE_READ) flags |= MemoryProtection.ReadExecute;
  if (prot & PAGE.EXECUTE_READWRITE) flags |= MemoryProtection.ReadWriteExecute;
  if (prot & PAGE.EXECUTE_WRITECOPY) flags |= MemoryProtection.Execute | MemoryProtection.Read | MemoryProtection.WriteCopy;
  if (prot & PAGE.GUARD) flags |= MemoryProtection.Guard;
  return flags;
}

function memoryProtectionToWin32Prot(prot: MemoryProtection): number {
  const hasRead = (prot & MemoryProtection.Read) !== 0;
  const hasWrite = (prot & MemoryProtection.Write) !== 0;
  const hasExec = (prot & MemoryProtection.Execute) !== 0;

  let page: number = PAGE.NOACCESS;
  if (hasRead && hasWrite && hasExec) page = PAGE.EXECUTE_READWRITE;
  else if (hasRead && hasExec) page = PAGE.EXECUTE_READ;
  else if (hasRead && hasWrite) page = PAGE.READWRITE;
  else if (hasExec) page = PAGE.EXECUTE;
  else if (hasRead) page = PAGE.READONLY;

  if ((prot & MemoryProtection.Guard) !== 0) page |= PAGE.GUARD;
  return page;
}

function win32StateToState(state: number): MemoryRegionState {
  if (state === MEM.COMMIT) return 'committed';
  if (state === MEM.RESERVE) return 'reserved';
  return 'free';
}

function win32TypeToType(type: number): MemoryRegionType {
  if (type === 0x1000000) return 'image';    // MEM_IMAGE
  if (type === 0x40000) return 'mapped';      // MEM_MAPPED
  if (type === 0x20000) return 'private';     // MEM_PRIVATE
  return 'unknown';
}

// ── Win32MemoryProvider ──

export class Win32MemoryProvider implements PlatformMemoryAPI {
  readonly platform = 'win32' as const;

  async checkAvailability(): Promise<PlatformAvailability> {
    if (!isWindows()) {
      return { available: false, reason: 'Not running on Windows', platform: 'win32' };
    }
    if (!isKoffiAvailable()) {
      return { available: false, reason: 'koffi FFI library not available', platform: 'win32' };
    }
    return { available: true, platform: 'win32' };
  }

  openProcess(pid: number, writeAccess: boolean): ProcessHandle {
    const nativeHandle = openProcessForMemory(pid, writeAccess);
    const handle: ProcessHandle = { pid, writeAccess };
    handleMap.set(handle, nativeHandle);
    return handle;
  }

  closeProcess(handle: ProcessHandle): void {
    const h = getWin32Handle(handle);
    CloseHandle(h);
    // WeakMap will auto-clean once ProcessHandle is GC'd
  }

  readMemory(handle: ProcessHandle, address: bigint, size: number): MemoryReadResult {
    const h = getWin32Handle(handle);
    const buffer = ReadProcessMemory(h, address, size);
    return { data: buffer, bytesRead: buffer.length };
  }

  writeMemory(handle: ProcessHandle, address: bigint, data: Buffer): MemoryWriteResult {
    const h = getWin32Handle(handle);
    const bytesWritten = WriteProcessMemory(h, address, data);
    return { bytesWritten };
  }

  queryRegion(handle: ProcessHandle, address: bigint): MemoryRegionInfo | null {
    const h = getWin32Handle(handle);
    const { success, info } = VirtualQueryEx(h, address);
    if (!success || info.RegionSize === 0n) return null;

    const protection = win32ProtToMemoryProtection(info.Protect);
    return {
      baseAddress: info.BaseAddress,
      size: Number(info.RegionSize),
      protection,
      state: win32StateToState(info.State),
      type: win32TypeToType(info.Type),
      isReadable: (protection & MemoryProtection.Read) !== 0,
      isWritable: (protection & MemoryProtection.Write) !== 0,
      isExecutable: (protection & MemoryProtection.Execute) !== 0,
    };
  }

  changeProtection(
    handle: ProcessHandle,
    address: bigint,
    size: number,
    newProtection: MemoryProtection
  ): ProtectionChangeResult {
    const h = getWin32Handle(handle);
    const win32Prot = memoryProtectionToWin32Prot(newProtection);
    const { success, oldProtect } = VirtualProtectEx(h, address, size, win32Prot);
    if (!success) throw new Error('VirtualProtectEx failed');
    return { oldProtection: win32ProtToMemoryProtection(oldProtect) };
  }

  allocateMemory(
    handle: ProcessHandle,
    size: number,
    protection: MemoryProtection
  ): AllocationResult {
    const h = getWin32Handle(handle);
    const win32Prot = memoryProtectionToWin32Prot(protection);
    const address = VirtualAllocEx(h, 0n, size, MEM.COMMIT | MEM.RESERVE, win32Prot);
    if (!address) throw new Error('VirtualAllocEx failed');
    return { address };
  }

  freeMemory(handle: ProcessHandle, address: bigint, _size: number): void {
    const h = getWin32Handle(handle);
    VirtualFreeEx(h, address, 0, MEM.RELEASE);
  }

  enumerateModules(handle: ProcessHandle): ModuleInfo[] {
    const h = getWin32Handle(handle);
    const { success, modules: handles, count } = EnumProcessModules(h);
    if (!success) throw new Error('EnumProcessModules failed');

    const modules: ModuleInfo[] = [];
    for (let i = 0; i < count; i++) {
      const hModule = handles[i];
      if (!hModule) continue;
      const name = GetModuleBaseName(h, hModule);
      const { success: infoSuccess, info } = GetModuleInformation(h, hModule);
      if (infoSuccess && info) {
        modules.push({
          name,
          baseAddress: BigInt(info.lpBaseOfDll),
          size: info.SizeOfImage,
        });
      }
    }
    return modules;
  }
}

/**
 * Win32 API Bindings using koffi FFI
 * Direct native calls to Windows kernel32.dll, ntdll.dll, psapi.dll
 *
 * This replaces PowerShell-based P/Invoke with direct FFI calls,
 * providing 10-100x performance improvement for memory operations.
 *
 * Note: We use inline types in function signatures to avoid
 * "Duplicate type name" errors in test environments where modules
 * may be loaded multiple times.
 *
 * @module Win32API
 */

import koffi from 'koffi';
import { logger } from '../utils/logger.js';

// ==================== Type Definitions ====================

// Struct type for TypeScript (parsed from Buffer)
export type MemoryBasicInfo = {
  BaseAddress: bigint;
  AllocationBase: bigint;
  AllocationProtect: number;
  RegionSize: bigint;
  State: number;
  Protect: number;
  Type: number;
};

export type ModuleInfoType = {
  lpBaseOfDll: bigint;
  SizeOfImage: number;
  EntryPoint: bigint;
};

// ==================== Constants ====================

// Process access rights
export const PROCESS_ACCESS = {
  TERMINATE: 0x0001,
  CREATE_THREAD: 0x0002,
  SET_SESSIONID: 0x0004,
  VM_OPERATION: 0x0008,
  VM_READ: 0x0010,
  VM_WRITE: 0x0020,
  DUP_HANDLE: 0x0040,
  CREATE_PROCESS: 0x0080,
  SET_QUOTA: 0x0100,
  SET_INFORMATION: 0x0200,
  QUERY_INFORMATION: 0x0400,
  SUSPEND_RESUME: 0x0800,
  QUERY_LIMITED_INFORMATION: 0x1000,
  ALL_ACCESS: 0x1F0FFF,
} as const;

// Memory states
export const MEM = {
  COMMIT: 0x1000,
  RESERVE: 0x2000,
  DECOMMIT: 0x4000,
  RELEASE: 0x8000,
  FREE: 0x10000,
  PRIVATE: 0x20000,
  MAPPED: 0x40000,
  RESET: 0x80000,
  TOP_DOWN: 0x100000,
  WRITE_WATCH: 0x200000,
  PHYSICAL: 0x400000,
  LARGE_PAGES: 0x20000000,
} as const;

// Memory protection constants
export const PAGE = {
  NOACCESS: 0x01,
  READONLY: 0x02,
  READWRITE: 0x04,
  WRITECOPY: 0x08,
  EXECUTE: 0x10,
  EXECUTE_READ: 0x20,
  EXECUTE_READWRITE: 0x40,
  EXECUTE_WRITECOPY: 0x80,
  GUARD: 0x100,
  NOCACHE: 0x200,
  WRITECOMBINE: 0x400,
} as const;

// Memory types
export const MEM_TYPE = {
  IMAGE: 0x1000000,
  MAPPED: 0x40000,
  PRIVATE: 0x20000,
} as const;

// ==================== Library Loading ====================

let kernel32: koffi.IKoffiLib | null = null;
let ntdll: koffi.IKoffiLib | null = null;
let psapi: koffi.IKoffiLib | null = null;
let koffiAvailable: boolean | null = null;

/**
 * Check if koffi is available
 */
export function isKoffiAvailable(): boolean {
  if (koffiAvailable !== null) {
    return koffiAvailable;
  }

  try {
    // Try to load kernel32 to verify koffi works
    const testLib = koffi.load('kernel32.dll');
    testLib.unload();
    koffiAvailable = true;
    return true;
  } catch {
    koffiAvailable = false;
    return false;
  }
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Get or load kernel32.dll
 */
function getKernel32(): koffi.IKoffiLib {
  if (!kernel32) {
    kernel32 = koffi.load('kernel32.dll');
    logger.debug('Loaded kernel32.dll via koffi');
  }
  return kernel32;
}

/**
 * Get or load ntdll.dll
 */
function getNtdll(): koffi.IKoffiLib {
  if (!ntdll) {
    ntdll = koffi.load('ntdll.dll');
    logger.debug('Loaded ntdll.dll via koffi');
  }
  return ntdll;
}

/**
 * Get or load psapi.dll
 */
function getPsapi(): koffi.IKoffiLib {
  if (!psapi) {
    psapi = koffi.load('psapi.dll');
    logger.debug('Loaded psapi.dll via koffi');
  }
  return psapi;
}

// ==================== kernel32.dll Functions ====================

/**
 * Open a process handle
 */
export function OpenProcess(
  dwDesiredAccess: number,
  bInheritHandle: boolean,
  dwProcessId: number
): bigint {
  const fn = getKernel32().func('void * OpenProcess(uint32, int, uint32)');
  return fn(dwDesiredAccess, bInheritHandle ? 1 : 0, dwProcessId);
}

/**
 * Close a handle
 */
export function CloseHandle(hObject: bigint): boolean {
  const fn = getKernel32().func('int CloseHandle(void *)');
  return fn(hObject) !== 0;
}

/**
 * Read process memory - returns buffer directly
 */
export function ReadProcessMemory(
  hProcess: bigint,
  lpBaseAddress: bigint,
  size: number
): Buffer {
  const fn = getKernel32().func('int ReadProcessMemory(void *, void *, _Out_ uint8_t[len], size_t len, _Out_ size_t *bytesRead)');
  const buffer = Buffer.alloc(size);
  const bytesReadBuf = Buffer.alloc(8); // size_t on x64

  const result = fn(hProcess, lpBaseAddress, buffer, BigInt(size), bytesReadBuf);

  if (result === 0) {
    const error = GetLastError();
    throw new Error(`ReadProcessMemory failed. Error: 0x${error.toString(16)}`);
  }

  return buffer;
}

/**
 * Write process memory
 */
export function WriteProcessMemory(
  hProcess: bigint,
  lpBaseAddress: bigint,
  data: Buffer
): number {
  const fn = getKernel32().func('int WriteProcessMemory(void *, void *, uint8_t[len], size_t len, _Out_ size_t *bytesWritten)');
  const bytesWrittenBuf = Buffer.alloc(8);

  const result = fn(hProcess, lpBaseAddress, data, BigInt(data.length), bytesWrittenBuf);

  if (result === 0) {
    const error = GetLastError();
    throw new Error(`WriteProcessMemory failed. Error: 0x${error.toString(16)}`);
  }

  return Number(bytesWrittenBuf.readBigUInt64LE());
}

/**
 * Query memory region information
 * Uses Buffer parsing to avoid koffi struct registration issues
 */
export function VirtualQueryEx(
  hProcess: bigint,
  lpAddress: bigint
): { success: boolean; info: MemoryBasicInfo } {
  // Define struct inline in the function signature
  // MEMORY_BASIC_INFORMATION on x64: 48 bytes
  // void* BaseAddress (8) + void* AllocationBase (8) + uint32 AllocationProtect (4) + padding (4)
  // + size_t RegionSize (8) + uint32 State (4) + uint32 Protect (4) + uint32 Type (4) + padding (4)
  const fn = getKernel32().func('size_t VirtualQueryEx(void *, void *, _Out_ uint8_t[48], size_t)');

  const structSize = 48;
  const buffer = Buffer.alloc(structSize);

  const result = fn(hProcess, lpAddress, buffer, BigInt(structSize));

  if (Number(result) !== structSize) {
    return { success: false, info: {} as MemoryBasicInfo };
  }

  // Parse the struct manually from buffer
  // Layout: BaseAddress(8), AllocationBase(8), AllocationProtect(4), padding(4), RegionSize(8), State(4), Protect(4), Type(4), padding(4)
  const info: MemoryBasicInfo = {
    BaseAddress: buffer.readBigUInt64LE(0),
    AllocationBase: buffer.readBigUInt64LE(8),
    AllocationProtect: buffer.readUInt32LE(16),
    RegionSize: buffer.readBigUInt64LE(24),
    State: buffer.readUInt32LE(32),
    Protect: buffer.readUInt32LE(36),
    Type: buffer.readUInt32LE(40),
  };

  return { success: true, info };
}

/**
 * Change memory protection
 */
export function VirtualProtectEx(
  hProcess: bigint,
  lpAddress: bigint,
  dwSize: number,
  flNewProtect: number
): { success: boolean; oldProtect: number } {
  const fn = getKernel32().func('int VirtualProtectEx(void *, void *, size_t, uint32, _Out_ uint32 *)');
  const oldProtectBuf = Buffer.alloc(4);

  const result = fn(hProcess, lpAddress, BigInt(dwSize), flNewProtect, oldProtectBuf);

  return {
    success: result !== 0,
    oldProtect: oldProtectBuf.readUInt32LE(0),
  };
}

/**
 * Allocate memory in another process
 */
export function VirtualAllocEx(
  hProcess: bigint,
  lpAddress: bigint,
  dwSize: number,
  flAllocationType: number,
  flProtect: number
): bigint {
  const fn = getKernel32().func('void * VirtualAllocEx(void *, void *, size_t, uint32, uint32)');
  return fn(hProcess, lpAddress, BigInt(dwSize), flAllocationType, flProtect);
}

/**
 * Free memory in another process
 */
export function VirtualFreeEx(
  hProcess: bigint,
  lpAddress: bigint,
  dwSize: number,
  dwFreeType: number
): boolean {
  const fn = getKernel32().func('int VirtualFreeEx(void *, void *, size_t, uint32)');
  return fn(hProcess, lpAddress, BigInt(dwSize), dwFreeType) !== 0;
}

/**
 * Create a remote thread in another process
 */
export function CreateRemoteThread(
  hProcess: bigint,
  lpStartAddress: bigint,
  lpParameter: bigint
): { handle: bigint; threadId: number } {
  const fn = getKernel32().func('void * CreateRemoteThread(void *, void *, size_t, void *, void *, uint32, _Out_ uint32 *)');
  const threadIdBuf = Buffer.alloc(4);

  const handle = fn(hProcess, null, 0n, lpStartAddress, lpParameter, 0, threadIdBuf);

  return {
    handle,
    threadId: threadIdBuf.readUInt32LE(0),
  };
}

/**
 * Get module handle by name
 */
export function GetModuleHandle(lpModuleName: string | null): bigint {
  const fn = getKernel32().func('void * GetModuleHandleA(char *)');
  return fn(lpModuleName);
}

/**
 * Get function address from module
 */
export function GetProcAddress(hModule: bigint, lpProcName: string): bigint {
  const fn = getKernel32().func('void * GetProcAddress(void *, char *)');
  return fn(hModule, lpProcName);
}

/**
 * Get last error code
 */
export function GetLastError(): number {
  const fn = getKernel32().func('uint32 GetLastError()');
  return fn();
}

// ==================== ntdll.dll Functions ====================

/**
 * NtQueryInformationProcess for anti-debug detection
 */
export function NtQueryInformationProcess(
  hProcess: bigint,
  processInformationClass: number
): { status: number; debugPort: number } {
  const fn = getNtdll().func('int32 NtQueryInformationProcess(void *, uint32, _Out_ void *, uint32, void *)');
  const debugPortBuf = Buffer.alloc(8);

  const status = fn(hProcess, processInformationClass, debugPortBuf, 8, null);

  return {
    status,
    debugPort: Number(debugPortBuf.readBigUInt64LE()),
  };
}

// ==================== psapi.dll Functions ====================

/**
 * Enumerate process modules
 */
export function EnumProcessModules(
  hProcess: bigint,
  maxModules: number = 1024
): { success: boolean; modules: bigint[]; count: number } {
  const fn = getPsapi().func('int EnumProcessModules(void *, _Out_ void *[], uint32, _Out_ uint32 *)');
  const moduleBuf = Buffer.alloc(maxModules * 8);
  const neededBuf = Buffer.alloc(4);

  const result = fn(hProcess, moduleBuf, maxModules * 8, neededBuf);

  const needed = neededBuf.readUInt32LE(0);
  const count = Math.floor(needed / 8);

  const modules: bigint[] = [];
  for (let i = 0; i < count; i++) {
    modules.push(moduleBuf.readBigUInt64LE(i * 8));
  }

  return {
    success: result !== 0,
    modules,
    count,
  };
}

/**
 * Get module base name
 */
export function GetModuleBaseName(
  hProcess: bigint,
  hModule: bigint,
  maxSize: number = 260
): string {
  const fn = getPsapi().func('uint32 GetModuleBaseNameA(void *, void *, _Out_ char[], uint32)');
  const buffer = Buffer.alloc(maxSize);

  fn(hProcess, hModule, buffer, maxSize);

  // Find null terminator
  let len = 0;
  while (len < maxSize && buffer[len] !== 0) {
    len++;
  }

  return buffer.toString('utf8', 0, len);
}

/**
 * Get module information
 * Uses Buffer parsing to avoid koffi struct registration issues
 */
export function GetModuleInformation(
  hProcess: bigint,
  hModule: bigint
): { success: boolean; info: ModuleInfoType } {
  // MODULEINFO on x64: 24 bytes
  // void* lpBaseOfDll (8) + uint32 SizeOfImage (4) + padding (4) + void* EntryPoint (8)
  const fn = getPsapi().func('int GetModuleInformation(void *, void *, _Out_ uint8_t[24], uint32)');

  const buffer = Buffer.alloc(24);
  const result = fn(hProcess, hModule, buffer, 24);

  const info: ModuleInfoType = {
    lpBaseOfDll: buffer.readBigUInt64LE(0),
    SizeOfImage: buffer.readUInt32LE(8),
    EntryPoint: buffer.readBigUInt64LE(16),
  };

  return {
    success: result !== 0,
    info,
  };
}

// ==================== Helper Functions ====================

/**
 * Open a process with standard memory access rights
 */
export function openProcessForMemory(pid: number, writeAccess: boolean = false): bigint {
  const access = writeAccess
    ? PROCESS_ACCESS.VM_READ | PROCESS_ACCESS.VM_WRITE | PROCESS_ACCESS.VM_OPERATION | PROCESS_ACCESS.QUERY_INFORMATION
    : PROCESS_ACCESS.VM_READ | PROCESS_ACCESS.QUERY_INFORMATION;

  const handle = OpenProcess(access, false, pid);

  if (handle === 0n) {
    const error = GetLastError();
    throw new Error(`Failed to open process ${pid}. Error: 0x${error.toString(16)}. Run as Administrator.`);
  }

  return handle;
}

// ==================== Cleanup ====================

/**
 * Unload all loaded libraries
 */
export function unloadLibraries(): void {
  if (kernel32) {
    kernel32.unload();
    kernel32 = null;
  }
  if (ntdll) {
    ntdll.unload();
    ntdll = null;
  }
  if (psapi) {
    psapi.unload();
    psapi = null;
  }
  logger.debug('Unloaded all native libraries');
}

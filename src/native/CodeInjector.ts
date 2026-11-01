/**
 * Code Injector — runtime code patching, NOP, code cave discovery.
 *
 * @module CodeInjector
 */

import { randomUUID } from 'node:crypto';
import {
  CODE_CAVE_MIN_SIZE,
  CODE_CAVE_SECTION_LABEL,
  INJECT_CHUNK_SIZE,
  NOP_OPCODE,
} from '@src/constants';
import { ToolError } from '@errors/ToolError';
import type {
  PatchOperation,
  CodeCave,
  DllInjectionResult,
  ShellcodeInjectionResult,
} from './CodeInjector.types';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualProtectEx,
  VirtualAllocEx,
  VirtualFreeEx,
  VirtualQueryEx,
  PAGE,
  MEM,
} from './Win32API';
import { FlushInstructionCache } from './Win32Debug';
import { ntCreateThreadExSafe } from './syscall/NtInjection';
import { nativeMemoryManager } from './NativeMemoryManager.impl';
import { isExecutable } from './NativeMemoryManager.utils';

export class CodeInjector {
  private patches = new Map<string, PatchOperation>();

  /** Write bytes to target process at address (runtime patch) */
  async patchBytes(pid: number, address: string, bytes: number[]): Promise<PatchOperation> {
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const patchBuf = Buffer.from(bytes);

    const handle = openProcessForMemory(pid, true);
    try {
      // Save original bytes
      const originalBuf = ReadProcessMemory(handle, addr, patchBuf.length);

      // Make writable
      const { success: protOk, oldProtect } = VirtualProtectEx(
        handle,
        addr,
        patchBuf.length,
        PAGE.EXECUTE_READWRITE,
      );

      try {
        // Write patch
        WriteProcessMemory(handle, addr, patchBuf);

        // Flush instruction cache
        FlushInstructionCache(handle, addr, patchBuf.length);
      } finally {
        // Always restore the old protection — a leaked
        // PAGE_EXECUTE_READWRITE page in the target process is worse than the
        // original write error. Skipped only when VirtualProtectEx itself
        // failed (nothing changed, nothing to restore).
        if (protOk) {
          VirtualProtectEx(handle, addr, patchBuf.length, oldProtect);
        }
      }

      const op: PatchOperation = {
        id: randomUUID(),
        pid,
        address: `0x${addr.toString(16).toUpperCase()}`,
        originalBytes: Array.from(originalBuf),
        patchBytes: bytes,
        isApplied: true,
        timestamp: Date.now(),
      };

      this.patches.set(op.id, op);
      return op;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Restore original bytes from a previous patch */
  async unpatch(patchId: string): Promise<boolean> {
    const patch = this.patches.get(patchId);
    if (!patch?.isApplied) return false;

    const addr = BigInt(patch.address);
    const originalBuf = Buffer.from(patch.originalBytes);

    const handle = openProcessForMemory(patch.pid, true);
    try {
      const { success: protOk, oldProtect } = VirtualProtectEx(
        handle,
        addr,
        originalBuf.length,
        PAGE.EXECUTE_READWRITE,
      );
      if (!protOk) {
        // Writing into an unwritable page would fail anyway — abort loudly
        // instead of leaving the patch half-restored.
        throw new Error(`unpatch: VirtualProtectEx failed for ${patch.address}`);
      }

      try {
        WriteProcessMemory(handle, addr, originalBuf);
        FlushInstructionCache(handle, addr, originalBuf.length);
      } finally {
        // Restore protection even when the write/flush fails so the target
        // process never retains PAGE_EXECUTE_READWRITE.
        VirtualProtectEx(handle, addr, originalBuf.length, oldProtect);
      }

      patch.isApplied = false;
      return true;
    } finally {
      CloseHandle(handle);
    }
  }

  /** NOP out instructions at address (replace with NOP_OPCODE) */
  async nopBytes(pid: number, address: string, count: number): Promise<PatchOperation> {
    const nops: number[] = Array.from({ length: count }, () => NOP_OPCODE);
    return this.patchBytes(pid, address, nops);
  }

  /** Find code caves (runs of 0x00 or 0xCC in executable sections) */
  async findCodeCaves(pid: number, minSize?: number): Promise<CodeCave[]> {
    const min = minSize ?? CODE_CAVE_MIN_SIZE;
    const caves: CodeCave[] = [];

    const handle = openProcessForMemory(pid, false);
    try {
      const modules = await nativeMemoryManager.enumerateModules(pid);
      if (!modules.success || !modules.modules) return caves;

      for (const mod of modules.modules) {
        const modBase = BigInt(
          mod.baseAddress.startsWith('0x') ? mod.baseAddress : `0x${mod.baseAddress}`,
        );
        scanModuleForCaves(handle, mod, modBase, min, caves);
      }
    } finally {
      CloseHandle(handle);
    }

    return caves.toSorted((a, b) => b.size - a.size); // Largest first
  }

  /** Allocate executable memory in target process */
  async allocateRemote(pid: number, size: number): Promise<string> {
    const handle = openProcessForMemory(pid, true);
    try {
      const addr = VirtualAllocEx(
        handle,
        0n,
        size,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.EXECUTE_READWRITE,
      );
      if (addr === 0n) {
        throw new ToolError('RUNTIME', 'VirtualAllocEx failed');
      }
      return `0x${addr.toString(16).toUpperCase()}`;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Free remote memory */
  async freeRemote(pid: number, address: string, _size: number): Promise<boolean> {
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const handle = openProcessForMemory(pid, true);
    try {
      return VirtualFreeEx(handle, addr, 0, MEM.RELEASE);
    } finally {
      CloseHandle(handle);
    }
  }

  /** Allocate, write, and execute raw shellcode with the requested thread API. */
  async injectShellcode(
    pid: number,
    shellcode: Buffer,
    method: 'createremote' | 'ntcreatethread' = 'createremote',
  ): Promise<ShellcodeInjectionResult> {
    if (shellcode.length === 0) {
      throw new ToolError('VALIDATION', 'Shellcode must be non-empty');
    }

    const handle = openProcessForMemory(pid, true);
    let remoteMem = 0n;
    let threadHandle = 0n;
    try {
      remoteMem = VirtualAllocEx(
        handle,
        0n,
        shellcode.length,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.READWRITE,
      );
      if (remoteMem === 0n) {
        throw new ToolError('RUNTIME', 'VirtualAllocEx failed for shellcode');
      }

      WriteProcessMemory(handle, remoteMem, shellcode);
      const protection = VirtualProtectEx(handle, remoteMem, shellcode.length, PAGE.EXECUTE_READ);
      if (!protection.success) {
        throw new ToolError('RUNTIME', 'VirtualProtectEx failed for shellcode');
      }
      FlushInstructionCache(handle, remoteMem, shellcode.length);

      let threadId = 0;
      if (method === 'ntcreatethread') {
        const result = ntCreateThreadExSafe(handle, remoteMem, 0n);
        if (result.status < 0 || result.handle === 0n) {
          throw new ToolError(
            'RUNTIME',
            `NtCreateThreadEx failed with status 0x${(result.status >>> 0).toString(16)}`,
          );
        }
        threadHandle = result.handle;
      } else {
        const result = (await import('./Win32API')).CreateRemoteThread(handle, remoteMem, 0n);
        if (result.handle === 0n) {
          throw new ToolError('RUNTIME', 'CreateRemoteThread failed for shellcode');
        }
        threadHandle = result.handle;
        threadId = result.threadId;
      }

      CloseHandle(threadHandle);
      threadHandle = 0n;
      return {
        address: `0x${remoteMem.toString(16).toUpperCase()}`,
        threadId,
        method,
      };
    } catch (error) {
      if (threadHandle === 0n && remoteMem !== 0n) {
        VirtualFreeEx(handle, remoteMem, 0, MEM.RELEASE);
      }
      throw error;
    } finally {
      if (threadHandle !== 0n) CloseHandle(threadHandle);
      CloseHandle(handle);
    }
  }

  /**
   * Inject a DLL into a target process.
   *
   * - `mode: 'loadlibrary'` — classic LoadLibraryW injection via CreateRemoteThread.
   * - `mode: 'manualmap'` — stealthy manual map injection (bypasses LdrLoadDll).
   *
   * Both modes require Windows and admin-elevated access to the target process.
   */
  async injectDll(
    pid: number,
    dllPath: string,
    mode: 'loadlibrary' | 'manualmap' = 'loadlibrary',
  ): Promise<DllInjectionResult> {
    if (process.platform !== 'win32') {
      throw new ToolError('PREREQUISITE', 'DLL injection is only supported on Windows');
    }

    if (mode === 'manualmap') {
      const { manualMapInjector } = await import('./ManualMapInjector');
      const result = await manualMapInjector.inject({ pid, dllPath });
      return {
        method: 'manualmap',
        mode: 'manualmap',
        dllPath,
        imageBase: result.imageBase,
        imageSize: result.imageSize,
        entryPoint: result.entryPoint,
        threadId: result.threadId,
        injectionMethod: result.injectionMethod,
      };
    }

    // LoadLibrary mode
    const {
      openProcessForMemory: openProcForMemory,
      CloseHandle: closeHandle,
      WriteProcessMemory: writeProcMem,
      VirtualAllocEx: virtualAllocEx,
      CreateRemoteThread: createRemoteThread,
      WaitForSingleObject: waitForSingleObject,
      GetExitCodeThread: getExitCodeThread,
      VirtualFreeEx: virtualFreeEx,
      GetModuleHandle: getModuleHandle,
      GetProcAddress: getProcAddress,
      PAGE: page,
      MEM: mem,
    } = await import('./Win32API');

    const handle = openProcForMemory(pid, true);
    try {
      const kernel32Handle = getModuleHandle('kernel32.dll');
      const loadLibraryAddr = getProcAddress(kernel32Handle, 'LoadLibraryW');
      if (!loadLibraryAddr) {
        throw new ToolError('RUNTIME', 'Failed to resolve LoadLibraryW address in kernel32.dll');
      }

      const pathBuffer = Buffer.from(`${dllPath}\0`, 'utf16le');
      let remoteMem = virtualAllocEx(
        handle,
        0n,
        pathBuffer.length,
        mem.COMMIT | mem.RESERVE,
        page.READWRITE,
      );
      if (!remoteMem) {
        throw new ToolError(
          'RUNTIME',
          'VirtualAllocEx failed to allocate remote memory for DLL path',
        );
      }

      writeProcMem(handle, remoteMem, pathBuffer);

      let threadHandle = 0n;
      let remoteMemSafeToFree = true;
      try {
        const thread = createRemoteThread(handle, loadLibraryAddr, remoteMem);
        threadHandle = thread.handle;
        if (threadHandle === 0n) {
          throw new ToolError('RUNTIME', 'CreateRemoteThread failed');
        }

        remoteMemSafeToFree = false;
        const waitResult = waitForSingleObject(threadHandle, 10_000);
        if (waitResult !== 0) {
          const reason =
            waitResult === 0x102 ? 'timed out' : `failed with code 0x${waitResult.toString(16)}`;
          throw new ToolError('RUNTIME', `Waiting for LoadLibraryW remote thread ${reason}`);
        }
        remoteMemSafeToFree = true;

        const exit = getExitCodeThread(threadHandle);
        if (!exit.success) {
          throw new ToolError('RUNTIME', 'GetExitCodeThread failed for LoadLibraryW remote thread');
        }
        if (exit.exitCode === 0) {
          throw new ToolError(
            'RUNTIME',
            'LoadLibraryW returned NULL; verify the DLL path, dependencies, and architecture',
          );
        }

        return {
          method: 'loadlibrary',
          mode: 'loadlibrary',
          dllPath,
          threadId: thread.threadId,
          allocatedAddress: `0x${remoteMem.toString(16).toUpperCase()}`,
        };
      } finally {
        if (threadHandle !== 0n) closeHandle(threadHandle);
        if (remoteMemSafeToFree && remoteMem !== 0n) {
          virtualFreeEx(handle, remoteMem, 0, mem.RELEASE);
          remoteMem = 0n;
        }
      }
    } finally {
      closeHandle(handle);
    }
  }

  /** List all active patches */
  listPatches(): PatchOperation[] {
    return Array.from(this.patches.values());
  }
}

export const codeInjector = new CodeInjector();

/** Scan a single module's executable regions for cave byte runs, appending
 * hits to `caves`. A cave is a run of 0x00 / 0xCC at least `min` bytes long. */
function scanModuleForCaves(
  handle: bigint,
  mod: { name: string; size: number },
  modBase: bigint,
  min: number,
  caves: CodeCave[],
): void {
  let addr = modBase;
  const modEnd = modBase + BigInt(mod.size);

  while (addr < modEnd) {
    const { success, info } = VirtualQueryEx(handle, addr);
    if (!success || info.RegionSize === 0n) break;

    const regionSize = Number(info.RegionSize);
    if (isExecutable(info.Protect) && regionSize > 0) {
      try {
        const chunk = ReadProcessMemory(
          handle,
          info.BaseAddress,
          Math.min(regionSize, INJECT_CHUNK_SIZE),
        );
        collectCaveRuns(chunk, info.BaseAddress, mod.name, min, caves);
      } catch {
        // Unreadable region
      }
    }

    addr = info.BaseAddress + info.RegionSize;
  }
}

/** Walk a memory chunk, recording every qualifying cave run (including one
 * that runs to the end of the chunk). */
function collectCaveRuns(
  chunk: Buffer,
  baseAddress: bigint,
  moduleName: string,
  min: number,
  caves: CodeCave[],
): void {
  let caveStart = -1;

  for (let i = 0; i < chunk.length; i++) {
    const b = chunk[i]!;
    if (b === 0x00 || b === 0xcc) {
      if (caveStart === -1) caveStart = i;
      continue;
    }
    if (caveStart === -1) continue;

    pushCaveIfLargeEnough(caves, baseAddress, moduleName, caveStart, i - caveStart, min);
    caveStart = -1;
  }

  // Check trailing cave
  if (caveStart !== -1) {
    pushCaveIfLargeEnough(caves, baseAddress, moduleName, caveStart, chunk.length - caveStart, min);
  }
}

function pushCaveIfLargeEnough(
  caves: CodeCave[],
  baseAddress: bigint,
  moduleName: string,
  caveStart: number,
  caveSize: number,
  min: number,
): void {
  if (caveSize < min) return;
  caves.push({
    address: `0x${(baseAddress + BigInt(caveStart)).toString(16).toUpperCase()}`,
    size: caveSize,
    module: moduleName,
    // VirtualQueryEx does not return the section name — the label is a
    // placeholder, not a real PE section name.
    section: CODE_CAVE_SECTION_LABEL,
  });
}

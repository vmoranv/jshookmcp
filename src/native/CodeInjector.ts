/**
 * Code Injector — runtime code patching, NOP, code cave discovery.
 *
 * @module CodeInjector
 */

import { randomUUID } from 'node:crypto';
import { CODE_CAVE_MIN_SIZE } from '@src/constants';
import type { PatchOperation, CodeCave } from './CodeInjector.types';
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

      // Write patch
      WriteProcessMemory(handle, addr, patchBuf);

      // Flush instruction cache
      FlushInstructionCache(handle, addr, patchBuf.length);

      // Restore protection
      if (protOk) {
        VirtualProtectEx(handle, addr, patchBuf.length, oldProtect);
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
      const { oldProtect } = VirtualProtectEx(
        handle,
        addr,
        originalBuf.length,
        PAGE.EXECUTE_READWRITE,
      );

      WriteProcessMemory(handle, addr, originalBuf);
      FlushInstructionCache(handle, addr, originalBuf.length);

      VirtualProtectEx(handle, addr, originalBuf.length, oldProtect);

      patch.isApplied = false;
      return true;
    } finally {
      CloseHandle(handle);
    }
  }

  /** NOP out instructions at address (replace with 0x90) */
  async nopBytes(pid: number, address: string, count: number): Promise<PatchOperation> {
    const nops = new Array(count).fill(0x90);
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

        // Scan module memory for executable regions with cave bytes
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
                Math.min(regionSize, 4 * 1024 * 1024),
              );
              let caveStart = -1;

              for (let i = 0; i < chunk.length; i++) {
                const b = chunk[i]!;
                if (b === 0x00 || b === 0xcc) {
                  if (caveStart === -1) caveStart = i;
                } else {
                  if (caveStart !== -1) {
                    const caveSize = i - caveStart;
                    if (caveSize >= min) {
                      const caveAddr = info.BaseAddress + BigInt(caveStart);
                      caves.push({
                        address: `0x${caveAddr.toString(16).toUpperCase()}`,
                        size: caveSize,
                        module: mod.name,
                        section: '.text',
                      });
                    }
                    caveStart = -1;
                  }
                }
              }

              // Check trailing cave
              if (caveStart !== -1) {
                const caveSize = chunk.length - caveStart;
                if (caveSize >= min) {
                  const caveAddr = info.BaseAddress + BigInt(caveStart);
                  caves.push({
                    address: `0x${caveAddr.toString(16).toUpperCase()}`,
                    size: caveSize,
                    module: mod.name,
                    section: '.text',
                  });
                }
              }
            } catch {
              // Unreadable region
            }
          }

          addr = info.BaseAddress + info.RegionSize;
        }
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
        throw new Error('VirtualAllocEx failed');
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

  /** List all active patches */
  listPatches(): PatchOperation[] {
    return Array.from(this.patches.values());
  }
}

export const codeInjector = new CodeInjector();

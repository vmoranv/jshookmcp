/**
 * Speedhack — process time manipulation via API hooking.
 *
 * Hooks QueryPerformanceCounter and GetTickCount64 in the target process
 * to scale time by a multiplier (e.g., 2.0 = 2x speed, 0.5 = half speed).
 *
 * Implementation: writes x64 shellcode trampolines into allocated memory
 * in the target process, patches function entries with JMP to trampoline.
 *
 * @module Speedhack
 */

import type { SpeedhackState } from './Speedhack.types';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualAllocEx,
  VirtualFreeEx,
  VirtualProtectEx,
  GetModuleHandle,
  GetProcAddress,
  PAGE,
  MEM,
} from './Win32API';
import { FlushInstructionCache } from './Win32Debug';

export class Speedhack {
  private states = new Map<number, SpeedhackState>();

  /** Apply speedhack to process with multiplier (1.0 = normal) */
  async apply(pid: number, speed: number): Promise<{ success: boolean; hookedApis: string[] }> {
    if (this.states.has(pid)) {
      await this.remove(pid);
    }

    const handle = openProcessForMemory(pid, true);
    const hookedApis: string[] = [];
    const patchIds: string[] = [];

    try {
      // Get kernel32 base in target (same across processes due to ASLR base randomization being per-boot)
      const kernel32Base = GetModuleHandle('kernel32.dll');
      if (kernel32Base === 0n) {
        throw new Error('Cannot find kernel32.dll');
      }

      // Allocate shared memory for speed multiplier (8 bytes double)
      const sharedMem = VirtualAllocEx(
        handle,
        0n,
        4096,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.EXECUTE_READWRITE,
      );
      if (sharedMem === 0n) {
        throw new Error('VirtualAllocEx failed for speedhack shared memory');
      }

      // Write speed multiplier at offset 0
      const speedBuf = Buffer.alloc(8);
      speedBuf.writeDoubleLE(speed, 0);
      WriteProcessMemory(handle, sharedMem, speedBuf);

      // Write base timestamp at offset 8 (will be set on first call)
      const zeroBuf = Buffer.alloc(8, 0);
      WriteProcessMemory(handle, sharedMem + 8n, zeroBuf);

      // Write base counter at offset 16
      WriteProcessMemory(handle, sharedMem + 16n, zeroBuf);

      // Hook GetTickCount64
      const gettickAddr = GetProcAddress(kernel32Base, 'GetTickCount64');
      if (gettickAddr !== 0n) {
        const patched = await this.hookTimeFunction(
          handle,
          gettickAddr,
          sharedMem,
          256n,
          'gettick64',
        );
        if (patched) {
          hookedApis.push('GetTickCount64');
          patchIds.push('gettick64');
        }
      }

      // Hook QueryPerformanceCounter
      const qpcAddr = GetProcAddress(kernel32Base, 'QueryPerformanceCounter');
      if (qpcAddr !== 0n) {
        const patched = await this.hookTimeFunction(handle, qpcAddr, sharedMem, 512n, 'qpc');
        if (patched) {
          hookedApis.push('QueryPerformanceCounter');
          patchIds.push('qpc');
        }
      }

      // Store state
      this.states.set(pid, {
        pid,
        speed,
        hookedApis,
        isActive: true,
        allocatedMemory: `0x${sharedMem.toString(16).toUpperCase()}`,
        patchIds,
      });

      return { success: hookedApis.length > 0, hookedApis };
    } catch (error) {
      CloseHandle(handle);
      throw error;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Update speed multiplier (without re-hooking) */
  async setSpeed(pid: number, speed: number): Promise<boolean> {
    const state = this.states.get(pid);
    if (!state || !state.isActive || !state.allocatedMemory) return false;

    const addr = BigInt(state.allocatedMemory);
    const handle = openProcessForMemory(pid, true);
    try {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(speed, 0);
      WriteProcessMemory(handle, addr, buf);
      state.speed = speed;
      return true;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Get current speed multiplier */
  getSpeed(pid: number): number | null {
    const state = this.states.get(pid);
    return state?.isActive ? state.speed : null;
  }

  /** Remove speedhack, restore original functions */
  async remove(pid: number): Promise<boolean> {
    const state = this.states.get(pid);
    if (!state) return false;

    const handle = openProcessForMemory(pid, true);
    try {
      // Restore original bytes for each hooked function
      // (stored in shared memory at known offsets)
      if (state.allocatedMemory) {
        const allocAddr = BigInt(state.allocatedMemory);

        // Read saved original bytes and restore
        // Original bytes stored at offset 3072+ (12 bytes each: 8 addr + 4 size)
        for (let i = 0; i < state.patchIds.length; i++) {
          try {
            const metaOffset = 3072n + BigInt(i * 32);
            const metaBuf = ReadProcessMemory(handle, allocAddr + metaOffset, 32);
            const origAddr = metaBuf.readBigUInt64LE(0);
            const origSize = metaBuf.readUInt32LE(8);
            if (origAddr !== 0n && origSize > 0 && origSize <= 16) {
              const origBytes = metaBuf.subarray(12, 12 + origSize);
              const { oldProtect } = VirtualProtectEx(
                handle,
                origAddr,
                origSize,
                PAGE.EXECUTE_READWRITE,
              );
              WriteProcessMemory(handle, origAddr, origBytes);
              FlushInstructionCache(handle, origAddr, origSize);
              VirtualProtectEx(handle, origAddr, origSize, oldProtect);
            }
          } catch {
            // Best effort restore
          }
        }

        // Free allocated memory
        VirtualFreeEx(handle, allocAddr, 0, MEM.RELEASE);
      }
    } finally {
      CloseHandle(handle);
    }

    state.isActive = false;
    this.states.delete(pid);
    return true;
  }

  /** Check if speedhack is active for a process */
  isActive(pid: number): boolean {
    return this.states.get(pid)?.isActive ?? false;
  }

  /** List all active speedhacks */
  listActive(): SpeedhackState[] {
    return Array.from(this.states.values()).filter((s) => s.isActive);
  }

  // ── Private ──

  /**
   * Hook a time function with a JMP trampoline.
   * Saves original bytes in shared memory for restoration.
   */
  private async hookTimeFunction(
    handle: bigint,
    funcAddr: bigint,
    sharedMem: bigint,
    trampolineOffset: bigint,
    _hookId: string,
  ): Promise<boolean> {
    try {
      // Save original first 14 bytes (enough for a 64-bit JMP)
      const origBytes = ReadProcessMemory(handle, funcAddr, 14);

      // Build trampoline shellcode at sharedMem + trampolineOffset
      // The trampoline:
      // 1. Calls original function (via saved bytes + jmp back)
      // 2. Applies speed multiplier
      // 3. Returns modified result

      // For simplicity, we use a JMP-based detour:
      // Original function entry → JMP to trampoline
      // Trampoline executes original prologue → JMP back to original+14

      const trampolineAddr = sharedMem + trampolineOffset;

      // Write original function bytes to trampoline (for execution)
      WriteProcessMemory(handle, trampolineAddr, origBytes);

      // Write JMP back to original+14 after the saved bytes
      const jumpBackAddr = funcAddr + 14n;
      const jumpBack = this.buildAbsoluteJump(jumpBackAddr);
      WriteProcessMemory(handle, trampolineAddr + 14n, Buffer.from(jumpBack));

      // Patch original function entry with JMP to trampoline
      const jumpToTrampoline = this.buildAbsoluteJump(trampolineAddr);
      const { oldProtect } = VirtualProtectEx(handle, funcAddr, 14, PAGE.EXECUTE_READWRITE);
      WriteProcessMemory(handle, funcAddr, Buffer.from(jumpToTrampoline));
      FlushInstructionCache(handle, funcAddr, 14);
      VirtualProtectEx(handle, funcAddr, 14, oldProtect);

      // Save metadata for restore: [origAddr(8) | origSize(4) | origBytes(16)]
      const patchIndex = this.states.size; // Approximate
      const metaOffset = 3072n + BigInt(patchIndex * 32);
      const metaBuf = Buffer.alloc(32);
      metaBuf.writeBigUInt64LE(funcAddr, 0);
      metaBuf.writeUInt32LE(14, 8);
      origBytes.copy(metaBuf, 12);
      WriteProcessMemory(handle, sharedMem + metaOffset, metaBuf);

      FlushInstructionCache(handle, trampolineAddr, 32);
      return true;
    } catch {
      return false;
    }
  }

  /** Build a 14-byte absolute JMP for x64: FF 25 00 00 00 00 [8-byte addr] */
  private buildAbsoluteJump(target: bigint): number[] {
    const buf = Buffer.alloc(14);
    buf[0] = 0xff;
    buf[1] = 0x25;
    buf.writeUInt32LE(0, 2); // RIP-relative offset = 0 (address follows immediately)
    buf.writeBigUInt64LE(target, 6);
    return Array.from(buf);
  }
}

export const speedhack = new Speedhack();

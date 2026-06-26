/**
 * Speedhack — process time manipulation via API hooking.
 *
 * Hooks QueryPerformanceCounter, GetTickCount64 and GetTickCount in the target
 * process to scale time by a multiplier (e.g., 2.0 = 2x speed, 0.5 = half speed).
 *
 * ## Architecture (military-grade trampoline)
 *
 * For each hooked API the target process receives a **two-layer detour**:
 *
 *   1. `orig_trampoline` (at sharedMem + trampOffset):
 *        [14 bytes of original prologue][JMP funcAddr+14]
 *      Executes the saved original bytes then jumps back to the function body,
 *      effectively reconstructing the original call. (Saved bytes are captured
 *      *before* the entry patch, so this is the genuine original code.)
 *
 *   2. `scale_handler` (at sharedMem + scaleOffset):
 *        CALL orig_trampoline          ; obtain real time value
 *        scale: scaled = base + (real - base) * speed   (SSE2)
 *        RET
 *
 *   The function entry is patched with `JMP scale_handler` (14-byte abs JMP).
 *
 * On the first call after hook install, `base` (stored in sharedMem) is 0, so
 * the handler initialises `base = real` and returns the unmodified value — this
 * avoids a time discontinuity at hook activation. Subsequent calls apply the
 * multiplier relative to that base, matching Cheat Engine's semantics.
 *
 * ## GetTickCount64 / GetTickCount / QueryPerformanceCounter
 *
 *  - GetTickCount64(): no args, returns ULONGLONG in RAX → scale RAX directly.
 *  - GetTickCount():   no args, returns DWORD in EAX      → scale RAX (low 32).
 *  - QueryPerformanceCounter(LARGE_INTEGER*): writes the counter to [RCX] and
 *    returns BOOL in RAX → scale the value at [RCX], preserve RAX (BOOL).
 *
 * ## Known limitation (documented)
 *
 * The detour copies the first 14 bytes of the target function verbatim. This is
 * safe only when those 14 bytes fall on an instruction boundary and contain no
 * RIP-relative addressing. For the Windows kernel32 time APIs this holds on
 * stock Windows 10/11/Server (they read KUSER_SHARED_DATA via absolute 64-bit
 * loads). If a future Windows revision changes the prologue, re-validation is
 * required. There is no in-process x86 disassembler available to compute the
 * exact prologue length, so 14 bytes (the abs-JMP detour size) is used.
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

// ── sharedMem layout (4096-byte allocation) ──
//   +0      speed            (double, 8)   — current multiplier
//   +8      baseTick64       (double, 8)   — GetTickCount64 anchor (lazy)
//   +16     baseQPC          (double, 8)   — QueryPerformanceCounter anchor
//   +24     baseTick32       (double, 8)   — GetTickCount anchor
//   +32..   reserved
//   +256    scale_handler_gtc64   (≤128B slot)
//   +384    orig_trampoline_gtc64 (28B)
//   +448    scale_handler_qpc     (≤128B slot)
//   +576    orig_trampoline_qpc   (28B)
//   +640    scale_handler_gtc32   (≤128B slot)
//   +768    orig_trampoline_gtc32 (28B)
//   +3072   restore metadata (3 × 32B: [origAddr(8)|origSize(4)|origBytes(12+pad)])
const OFF_SPEED = 0;
const OFF_BASE_TICK64 = 8;
const OFF_BASE_QPC = 16;
const OFF_BASE_TICK32 = 24;

const SCALE_OFF_GTC64 = 256;
const TRAMP_OFF_GTC64 = 384;
const SCALE_OFF_QPC = 448;
const TRAMP_OFF_QPC = 576;
const SCALE_OFF_GTC32 = 640;
const TRAMP_OFF_GTC32 = 768;

const RESTORE_META_OFF = 3072;
const RESTORE_META_SLOT = 32;
const DETOUR_BYTES = 14; // abs JMP size + bytes saved for orig trampoline

type ScaleKind = 'gtc64' | 'qpc' | 'gtc32';

interface HookTarget {
  kind: ScaleKind;
  apiName: string;
  scaleOff: number;
  trampOff: number;
  baseOff: number;
}

const HOOK_TARGETS: HookTarget[] = [
  {
    kind: 'gtc64',
    apiName: 'GetTickCount64',
    scaleOff: SCALE_OFF_GTC64,
    trampOff: TRAMP_OFF_GTC64,
    baseOff: OFF_BASE_TICK64,
  },
  {
    kind: 'qpc',
    apiName: 'QueryPerformanceCounter',
    scaleOff: SCALE_OFF_QPC,
    trampOff: TRAMP_OFF_QPC,
    baseOff: OFF_BASE_QPC,
  },
  {
    kind: 'gtc32',
    apiName: 'GetTickCount',
    scaleOff: SCALE_OFF_GTC32,
    trampOff: TRAMP_OFF_GTC32,
    baseOff: OFF_BASE_TICK32,
  },
];

export class Speedhack {
  private states = new Map<number, SpeedhackState>();

  /** Apply speedhack to process with multiplier (1.0 = normal). */
  async apply(pid: number, speed: number): Promise<{ success: boolean; hookedApis: string[] }> {
    // Re-apply on an already-hooked process: tear down first to avoid double hooks.
    if (this.states.has(pid)) {
      await this.remove(pid);
    }

    const handle = openProcessForMemory(pid, true);
    const hookedApis: string[] = [];
    const patchIds: string[] = [];

    try {
      const kernel32Base = GetModuleHandle('kernel32.dll');
      if (kernel32Base === 0n) {
        throw new Error('Cannot find kernel32.dll');
      }

      // Allocate shared memory (RWX) for state + trampolines.
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

      // Initialise speed multiplier and zero the base anchors (lazy init in-shellcode).
      const speedBuf = Buffer.alloc(8);
      speedBuf.writeDoubleLE(speed, 0);
      WriteProcessMemory(handle, sharedMem + BigInt(OFF_SPEED), speedBuf);
      WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_TICK64), Buffer.alloc(8, 0));
      WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_QPC), Buffer.alloc(8, 0));
      WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_TICK32), Buffer.alloc(8, 0));

      let metaIdx = 0;
      for (const target of HOOK_TARGETS) {
        const funcAddr = GetProcAddress(kernel32Base, target.apiName);
        if (funcAddr === 0n) continue; // API not available — skip cleanly.

        try {
          const installed = this.installHook(handle, funcAddr, sharedMem, target, metaIdx);
          if (installed) {
            hookedApis.push(target.apiName);
            patchIds.push(target.kind);
            metaIdx += 1;
          }
        } catch {
          // Best-effort: a single hook failure should not abort the others.
        }
      }

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

  /** Update speed multiplier (without re-hooking). */
  async setSpeed(pid: number, speed: number): Promise<boolean> {
    const state = this.states.get(pid);
    if (!state || !state.isActive || !state.allocatedMemory) return false;

    const addr = BigInt(state.allocatedMemory);
    const handle = openProcessForMemory(pid, true);
    try {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(speed, 0);
      WriteProcessMemory(handle, addr + BigInt(OFF_SPEED), buf);
      state.speed = speed;
      return true;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Get current speed multiplier. */
  getSpeed(pid: number): number | null {
    const state = this.states.get(pid);
    return state?.isActive ? state.speed : null;
  }

  /** Remove speedhack, restore original functions. Alias of {@link remove}. */
  async restore(pid: number): Promise<boolean> {
    return await this.remove(pid);
  }

  /** Remove speedhack, restore original functions. */
  async remove(pid: number): Promise<boolean> {
    const state = this.states.get(pid);
    if (!state) return false;

    const handle = openProcessForMemory(pid, true);
    try {
      if (state.allocatedMemory) {
        const allocAddr = BigInt(state.allocatedMemory);

        // Restore original bytes for each hooked function from saved metadata.
        for (let i = 0; i < state.patchIds.length; i++) {
          try {
            const metaOffset = BigInt(RESTORE_META_OFF + i * RESTORE_META_SLOT);
            const metaBuf = ReadProcessMemory(handle, allocAddr + metaOffset, RESTORE_META_SLOT);
            const origAddr = metaBuf.readBigUInt64LE(0);
            const origSize = metaBuf.readUInt32LE(8);
            if (origAddr !== 0n && origSize > 0 && origSize <= DETOUR_BYTES) {
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
            // Best-effort restore — continue with remaining hooks.
          }
        }

        VirtualFreeEx(handle, allocAddr, 0, MEM.RELEASE);
      }
    } finally {
      CloseHandle(handle);
    }

    state.isActive = false;
    this.states.delete(pid);
    return true;
  }

  /** Check if speedhack is active for a process. */
  isActive(pid: number): boolean {
    return this.states.get(pid)?.isActive ?? false;
  }

  /** List all active speedhacks. */
  listActive(): SpeedhackState[] {
    return Array.from(this.states.values()).filter((s) => s.isActive);
  }

  // ── Private ──

  /**
   * Install the two-layer detour for one time API.
   * Returns true on success, false if the prologue could not be read.
   */
  private installHook(
    handle: bigint,
    funcAddr: bigint,
    sharedMem: bigint,
    target: HookTarget,
    metaIdx: number,
  ): boolean {
    // 1. Capture original prologue BEFORE patching (entry will become JMP).
    const origBytes = ReadProcessMemory(handle, funcAddr, DETOUR_BYTES);

    // 2. Build orig_trampoline: [orig 14 bytes][JMP funcAddr+14]
    const trampolineAddr = sharedMem + BigInt(target.trampOff);
    WriteProcessMemory(handle, trampolineAddr, origBytes);
    const jumpBack = this.buildAbsoluteJump(funcAddr + BigInt(DETOUR_BYTES));
    WriteProcessMemory(handle, trampolineAddr + BigInt(DETOUR_BYTES), Buffer.from(jumpBack));

    // 3. Build scale_handler (calls orig_trampoline, scales result, returns).
    const scaleHandler = this.buildScaleHandler(
      target.kind,
      sharedMem,
      target.scaleOff,
      target.trampOff,
    );
    WriteProcessMemory(handle, sharedMem + BigInt(target.scaleOff), scaleHandler);

    // 4. Patch function entry: JMP scale_handler (14-byte abs JMP).
    const scaleHandlerAddr = sharedMem + BigInt(target.scaleOff);
    const jumpToScale = this.buildAbsoluteJump(scaleHandlerAddr);
    const { oldProtect } = VirtualProtectEx(handle, funcAddr, DETOUR_BYTES, PAGE.EXECUTE_READWRITE);
    WriteProcessMemory(handle, funcAddr, Buffer.from(jumpToScale));
    FlushInstructionCache(handle, funcAddr, DETOUR_BYTES);
    VirtualProtectEx(handle, funcAddr, DETOUR_BYTES, oldProtect);

    // 5. Save restore metadata: [origAddr(8) | origSize(4) | origBytes(14) | pad(2)]
    const metaBuf = Buffer.alloc(RESTORE_META_SLOT, 0);
    metaBuf.writeBigUInt64LE(funcAddr, 0);
    metaBuf.writeUInt32LE(DETOUR_BYTES, 8);
    origBytes.copy(metaBuf, 12);
    WriteProcessMemory(
      handle,
      sharedMem + BigInt(RESTORE_META_OFF + metaIdx * RESTORE_META_SLOT),
      metaBuf,
    );

    FlushInstructionCache(handle, scaleHandlerAddr, scaleHandler.length);
    return true;
  }

  /**
   * Assemble the scale_handler shellcode for one time API kind.
   *
   * Layout ( offsets documented per kind; see class header for full design ):
   *   push <saved regs> ; sub rsp, shadow
   *   call orig_trampoline          ; E8 rel32  → real value
   *   mov r8, <sharedMem imm64>     ; absolute base for speed/base anchors
   *   cvtsi2sd xmm0, real           ; (double)real
   *   movsd xmm1, [r8+baseOff]      ; base (0 on first call)
   *   movsd xmm2, [r8]              ; speed
   *   pxor xmm3,xmm3 ; ucomisd xmm1,xmm3 ; jne scale
   *   first-call: store base=real ; return real unmodified
   *   scale: xmm0 = base + (real-base)*speed ; cvttsd2si rax
   *   restore regs ; ret
   *
   * QPC additionally preserves the BOOL return in RSI and writes the scaled
   * counter back through the caller's [RCX] pointer.
   */
  private buildScaleHandler(
    kind: ScaleKind,
    sharedMem: bigint,
    scaleOff: number,
    origTrampOff: number,
  ): Buffer {
    const isQpc = kind === 'qpc';
    const baseOff =
      kind === 'gtc64' ? OFF_BASE_TICK64 : kind === 'qpc' ? OFF_BASE_QPC : OFF_BASE_TICK32;
    const b: number[] = [];

    // push rbx (all kinds); push rsi (qpc only — preserves BOOL)
    b.push(0x53);
    if (isQpc) b.push(0x56);
    // sub rsp, 0x20 (gtc) / 0x28 (qpc — extra 8 for rsi push alignment)
    b.push(0x48, 0x83, 0xec, isQpc ? 0x28 : 0x20);
    if (isQpc) {
      b.push(0x48, 0x89, 0xcb); // mov rbx, rcx  (save LARGE_INTEGER* out)
    }
    // call orig_trampoline (E8 rel32) — placeholder, backfilled below
    const callIdx = b.length;
    b.push(0xe8, 0, 0, 0, 0);
    if (isQpc) {
      b.push(0x48, 0x89, 0xc6); // mov rsi, rax  (save BOOL)
      b.push(0x48, 0x8b, 0x03); // mov rax, [rbx] (real counter)
    } else {
      b.push(0x48, 0x89, 0xc3); // mov rbx, rax  (save real tick)
    }
    // mov r8, <sharedMem>  (49 B8 imm64)
    b.push(0x49, 0xb8);
    for (let i = 0; i < 8; i += 1) b.push(Number((sharedMem >> BigInt(i * 8)) & 0xffn));
    // cvtsi2sd xmm0, rax(qpc) / rbx(gtc)
    b.push(0xf2, 0x48, 0x0f, 0x2a, isQpc ? 0xc0 : 0xc3);
    // movsd xmm1, [r8+baseOff]   (F2 41 0F 10 48 disp8)
    b.push(0xf2, 0x41, 0x0f, 0x10, 0x48, baseOff);
    // movsd xmm2, [r8]           (F2 41 0F 10 10)
    b.push(0xf2, 0x41, 0x0f, 0x10, 0x10);
    // pxor xmm3, xmm3            (66 0F EF DB)
    b.push(0x66, 0x0f, 0xef, 0xdb);
    // ucomisd xmm1, xmm3         (66 0F 2E CB)
    b.push(0x66, 0x0f, 0x2e, 0xcb);
    // jne scale (rel8) — placeholder
    const jneIdx = b.length;
    b.push(0x75, 0);
    // — first-call path: base==0 → init base=real, return real —
    // movsd [r8+baseOff], xmm0   (F2 41 0F 11 40 disp8)
    b.push(0xf2, 0x41, 0x0f, 0x11, 0x40, baseOff);
    if (isQpc) {
      b.push(0x48, 0x89, 0x03); // mov [rbx], rax  (write real unchanged)
    } else {
      b.push(0x48, 0x89, 0xd8); // mov rax, rbx    (return real)
    }
    // jmp done (rel8) — placeholder
    const jmpDoneIdx = b.length;
    b.push(0xeb, 0);
    // — scale path —
    const scaleStart = b.length;
    b.push(0xf2, 0x0f, 0x5c, 0xc1); // subsd xmm0, xmm1
    b.push(0xf2, 0x0f, 0x59, 0xc2); // mulsd xmm0, xmm2
    b.push(0xf2, 0x0f, 0x58, 0xc1); // addsd xmm0, xmm1
    b.push(0xf2, 0x48, 0x0f, 0x2c, 0xc0); // cvttsd2si rax, xmm0
    if (isQpc) {
      b.push(0x48, 0x89, 0x03); // mov [rbx], rax  (write scaled counter)
    }
    // — done —
    const doneStart = b.length;
    if (isQpc) {
      b.push(0x48, 0x89, 0xf0); // mov rax, rsi  (restore BOOL)
    }
    b.push(0x48, 0x83, 0xc4, isQpc ? 0x28 : 0x20); // add rsp, ...
    if (isQpc) b.push(0x5e); // pop rsi
    b.push(0x5b); // pop rbx
    b.push(0xc3); // ret

    // Backfill call rel32: target = origTrampOff (absolute within sharedMem)
    const rel32 = origTrampOff - (scaleOff + callIdx + 5);
    b[callIdx + 1] = rel32 & 0xff;
    b[callIdx + 2] = (rel32 >> 8) & 0xff;
    b[callIdx + 3] = (rel32 >> 16) & 0xff;
    b[callIdx + 4] = (rel32 >> 24) & 0xff;
    // Backfill jne rel8: target = scaleStart
    b[jneIdx + 1] = scaleStart - (jneIdx + 2);
    // Backfill jmp done rel8: target = doneStart
    b[jmpDoneIdx + 1] = doneStart - (jmpDoneIdx + 2);

    return Buffer.from(b);
  }

  /** Build a 14-byte absolute JMP for x64: FF 25 00 00 00 00 [8-byte addr]. */
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

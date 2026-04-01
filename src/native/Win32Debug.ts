/**
 * Win32 Debug API Bindings using koffi FFI.
 *
 * Thread management, debug registers, debug events, and instruction cache.
 * These extend Win32API.ts with debug-specific functionality needed for
 * hardware breakpoints and code injection.
 *
 * @module Win32Debug
 */

import koffi from 'koffi';
import { logger } from '@utils/logger';
import { GetLastError, CloseHandle } from './Win32API';

// ── Constants ──

export const THREAD_ACCESS = {
  TERMINATE: 0x0001,
  SUSPEND_RESUME: 0x0002,
  GET_CONTEXT: 0x0008,
  SET_CONTEXT: 0x0010,
  SET_INFORMATION: 0x0020,
  QUERY_INFORMATION: 0x0040,
  SET_THREAD_TOKEN: 0x0080,
  IMPERSONATE: 0x0100,
  DIRECT_IMPERSONATION: 0x0200,
  ALL_ACCESS: 0x1f03ff,
} as const;

/** CONTEXT flags for GetThreadContext / SetThreadContext */
export const CONTEXT_FLAGS = {
  AMD64: 0x00100000,
  CONTROL: 0x00100001,
  INTEGER: 0x00100002,
  SEGMENTS: 0x00100004,
  FLOATING_POINT: 0x00100008,
  DEBUG_REGISTERS: 0x00100010,
  FULL: 0x0010000b, // CONTROL | INTEGER | FLOATING_POINT
  ALL: 0x0010001f, // FULL | SEGMENTS | DEBUG_REGISTERS
} as const;

/** Debug event codes */
export const DEBUG_EVENT_CODE = {
  EXCEPTION_DEBUG_EVENT: 1,
  CREATE_THREAD_DEBUG_EVENT: 2,
  CREATE_PROCESS_DEBUG_EVENT: 3,
  EXIT_THREAD_DEBUG_EVENT: 4,
  EXIT_PROCESS_DEBUG_EVENT: 5,
  LOAD_DLL_DEBUG_EVENT: 6,
  UNLOAD_DLL_DEBUG_EVENT: 7,
  OUTPUT_DEBUG_STRING_EVENT: 8,
  RIP_EVENT: 9,
} as const;

/** Exception codes */
export const EXCEPTION_CODE = {
  SINGLE_STEP: 0x80000004,
  BREAKPOINT: 0x80000003,
  ACCESS_VIOLATION: 0xc0000005,
} as const;

/** Continue status for ContinueDebugEvent */
export const DBG = {
  CONTINUE: 0x00010002,
  EXCEPTION_NOT_HANDLED: 0x80010001,
  REPLY_LATER: 0x40010001,
} as const;

/** DR7 bit layout helpers */
export const DR7 = {
  /** Local enable for DR0-DR3 (bits 0, 2, 4, 6) */
  localEnable: (drIndex: number): bigint => 1n << BigInt(drIndex * 2),
  /** Condition bits for DRn: 00=execute, 01=write, 11=readwrite */
  conditionShift: (drIndex: number): number => 16 + drIndex * 4,
  /** Size bits for DRn: 00=1byte, 01=2byte, 11=4byte, 10=8byte */
  sizeShift: (drIndex: number): number => 18 + drIndex * 4,
} as const;

/** TH32CS flags for CreateToolhelp32Snapshot */
export const TH32CS = {
  SNAPHEAPLIST: 0x00000001,
  SNAPTHREAD: 0x00000004,
  SNAPMODULE: 0x00000008,
} as const;

// ── x64 CONTEXT struct layout ──
// Full CONTEXT is 1232 bytes on x64. We only need the relevant fields.
// Layout (key offsets):
//   +0x00: P1Home..P6Home (48 bytes)
//   +0x30: ContextFlags (4 bytes)
//   +0x34: MxCsr (4 bytes)
//   +0x38: SegCs..SegSs (12 bytes short regs = 6*2 = 12 padded to 16)
//   +0x44: EFlags (4 bytes)
//   +0x48: Dr0 (8 bytes)
//   +0x50: Dr1 (8 bytes)
//   +0x58: Dr2 (8 bytes)
//   +0x60: Dr3 (8 bytes)
//   +0x68: Dr6 (8 bytes)
//   +0x70: Dr7 (8 bytes)
//   +0x78: Rax (8), Rcx, Rdx, Rbx, Rsp, Rbp, Rsi, Rdi (64 bytes total)
//   +0xB8: R8..R15 (64 bytes)
//   +0xF8: Rip (8 bytes)
//   ... FPU/SSE state follows

export const CONTEXT_SIZE = 1232;

export interface X64Context {
  contextFlags: number;
  dr0: bigint;
  dr1: bigint;
  dr2: bigint;
  dr3: bigint;
  dr6: bigint;
  dr7: bigint;
  rax: bigint;
  rcx: bigint;
  rdx: bigint;
  rbx: bigint;
  rsp: bigint;
  rbp: bigint;
  rsi: bigint;
  rdi: bigint;
  r8: bigint;
  r9: bigint;
  r10: bigint;
  r11: bigint;
  r12: bigint;
  r13: bigint;
  r14: bigint;
  r15: bigint;
  rip: bigint;
  eflags: number;
}

/** Parse x64 CONTEXT from raw buffer */
export function parseContext(buf: Buffer): X64Context {
  return {
    contextFlags: buf.readUInt32LE(0x30),
    eflags: buf.readUInt32LE(0x44),
    dr0: buf.readBigUInt64LE(0x48),
    dr1: buf.readBigUInt64LE(0x50),
    dr2: buf.readBigUInt64LE(0x58),
    dr3: buf.readBigUInt64LE(0x60),
    dr6: buf.readBigUInt64LE(0x68),
    dr7: buf.readBigUInt64LE(0x70),
    rax: buf.readBigUInt64LE(0x78),
    rcx: buf.readBigUInt64LE(0x80),
    rdx: buf.readBigUInt64LE(0x88),
    rbx: buf.readBigUInt64LE(0x90),
    rsp: buf.readBigUInt64LE(0x98),
    rbp: buf.readBigUInt64LE(0xa0),
    rsi: buf.readBigUInt64LE(0xa8),
    rdi: buf.readBigUInt64LE(0xb0),
    r8: buf.readBigUInt64LE(0xb8),
    r9: buf.readBigUInt64LE(0xc0),
    r10: buf.readBigUInt64LE(0xc8),
    r11: buf.readBigUInt64LE(0xd0),
    r12: buf.readBigUInt64LE(0xd8),
    r13: buf.readBigUInt64LE(0xe0),
    r14: buf.readBigUInt64LE(0xe8),
    r15: buf.readBigUInt64LE(0xf0),
    rip: buf.readBigUInt64LE(0xf8),
  };
}

/** Write x64 CONTEXT fields into a raw buffer */
export function writeContext(buf: Buffer, ctx: Partial<X64Context>): void {
  if (ctx.contextFlags !== undefined) buf.writeUInt32LE(ctx.contextFlags, 0x30);
  if (ctx.eflags !== undefined) buf.writeUInt32LE(ctx.eflags, 0x44);
  if (ctx.dr0 !== undefined) buf.writeBigUInt64LE(ctx.dr0, 0x48);
  if (ctx.dr1 !== undefined) buf.writeBigUInt64LE(ctx.dr1, 0x50);
  if (ctx.dr2 !== undefined) buf.writeBigUInt64LE(ctx.dr2, 0x58);
  if (ctx.dr3 !== undefined) buf.writeBigUInt64LE(ctx.dr3, 0x60);
  if (ctx.dr6 !== undefined) buf.writeBigUInt64LE(ctx.dr6, 0x68);
  if (ctx.dr7 !== undefined) buf.writeBigUInt64LE(ctx.dr7, 0x70);
  if (ctx.rip !== undefined) buf.writeBigUInt64LE(ctx.rip, 0xf8);
}

// ── Library Loading ──

let kernel32Debug: koffi.IKoffiLib | null = null;

function getKernel32(): koffi.IKoffiLib {
  if (!kernel32Debug) {
    kernel32Debug = koffi.load('kernel32.dll');
    logger.debug('Loaded kernel32.dll for debug APIs');
  }
  return kernel32Debug;
}

// ── Thread Management ──

/** Open a thread handle */
export function OpenThread(
  dwDesiredAccess: number,
  bInheritHandle: boolean,
  dwThreadId: number,
): bigint {
  const fn = getKernel32().func('void * OpenThread(uint32, int, uint32)');
  return fn(dwDesiredAccess, bInheritHandle ? 1 : 0, dwThreadId);
}

/** Suspend a thread, returns previous suspend count */
export function SuspendThread(hThread: bigint): number {
  const fn = getKernel32().func('uint32 SuspendThread(void *)');
  const result = fn(hThread);
  if (result === 0xffffffff) {
    throw new Error(`SuspendThread failed. Error: 0x${GetLastError().toString(16)}`);
  }
  return result;
}

/** Resume a thread, returns previous suspend count */
export function ResumeThread(hThread: bigint): number {
  const fn = getKernel32().func('uint32 ResumeThread(void *)');
  const result = fn(hThread);
  if (result === 0xffffffff) {
    throw new Error(`ResumeThread failed. Error: 0x${GetLastError().toString(16)}`);
  }
  return result;
}

/** Get thread context (CPU registers including debug registers) */
export function GetThreadContext(hThread: bigint, contextFlags: number): Buffer {
  const fn = getKernel32().func('int GetThreadContext(void *, _Inout_ uint8_t[1232])');
  const buf = Buffer.alloc(CONTEXT_SIZE);
  // Must set ContextFlags before calling
  buf.writeUInt32LE(contextFlags, 0x30);

  const result = fn(hThread, buf);
  if (result === 0) {
    throw new Error(`GetThreadContext failed. Error: 0x${GetLastError().toString(16)}`);
  }
  return buf;
}

/** Set thread context (CPU registers including debug registers) */
export function SetThreadContext(hThread: bigint, contextBuf: Buffer): void {
  const fn = getKernel32().func('int SetThreadContext(void *, uint8_t[1232])');
  const result = fn(hThread, contextBuf);
  if (result === 0) {
    throw new Error(`SetThreadContext failed. Error: 0x${GetLastError().toString(16)}`);
  }
}

// ── Debug Events ──

/** Attach as debugger to a process */
export function DebugActiveProcess(dwProcessId: number): void {
  const fn = getKernel32().func('int DebugActiveProcess(uint32)');
  const result = fn(dwProcessId);
  if (result === 0) {
    throw new Error(
      `DebugActiveProcess failed for pid ${dwProcessId}. Error: 0x${GetLastError().toString(16)}`,
    );
  }
}

/** Detach debugger from process */
export function DebugActiveProcessStop(dwProcessId: number): void {
  const fn = getKernel32().func('int DebugActiveProcessStop(uint32)');
  const result = fn(dwProcessId);
  if (result === 0) {
    throw new Error(`DebugActiveProcessStop failed. Error: 0x${GetLastError().toString(16)}`);
  }
}

/** Don't kill the process when debugger detaches */
export function DebugSetProcessKillOnExit(killOnExit: boolean): void {
  const fn = getKernel32().func('int DebugSetProcessKillOnExit(int)');
  fn(killOnExit ? 1 : 0);
}

/**
 * Wait for a debug event.
 * DEBUG_EVENT on x64 = 176 bytes:
 *   +0x00: dwDebugEventCode (uint32)
 *   +0x04: dwProcessId (uint32)
 *   +0x08: dwThreadId (uint32)
 *   +0x0C: padding (4 bytes)
 *   +0x10: union u (160 bytes) — EXCEPTION_DEBUG_INFO at start:
 *     +0x10: ExceptionCode (uint32)
 *     +0x14: ExceptionFlags (uint32)
 *     +0x18: ExceptionRecord (pointer, 8 bytes)
 *     +0x20: ExceptionAddress (pointer, 8 bytes)
 *     +0x28: NumberParameters (uint32)
 */
export const DEBUG_EVENT_SIZE = 176;

export interface DebugEventInfo {
  debugEventCode: number;
  processId: number;
  threadId: number;
  // For EXCEPTION_DEBUG_EVENT:
  exceptionCode?: number;
  exceptionAddress?: bigint;
  firstChance?: boolean;
}

export function WaitForDebugEvent(timeoutMs: number): DebugEventInfo | null {
  const fn = getKernel32().func('int WaitForDebugEvent(_Out_ uint8_t[176], uint32)');
  const buf = Buffer.alloc(DEBUG_EVENT_SIZE);

  const result = fn(buf, timeoutMs);
  if (result === 0) return null;

  const info: DebugEventInfo = {
    debugEventCode: buf.readUInt32LE(0x00),
    processId: buf.readUInt32LE(0x04),
    threadId: buf.readUInt32LE(0x08),
  };

  if (info.debugEventCode === DEBUG_EVENT_CODE.EXCEPTION_DEBUG_EVENT) {
    info.exceptionCode = buf.readUInt32LE(0x10);
    info.exceptionAddress = buf.readBigUInt64LE(0x20);
    info.firstChance = buf.readUInt32LE(0x14) === 0;
  }

  return info;
}

/** Continue after handling a debug event */
export function ContinueDebugEvent(
  dwProcessId: number,
  dwThreadId: number,
  dwContinueStatus: number,
): void {
  const fn = getKernel32().func('int ContinueDebugEvent(uint32, uint32, uint32)');
  const result = fn(dwProcessId, dwThreadId, dwContinueStatus);
  if (result === 0) {
    throw new Error(`ContinueDebugEvent failed. Error: 0x${GetLastError().toString(16)}`);
  }
}

// ── Instruction Cache ──

/** Flush instruction cache after writing code */
export function FlushInstructionCache(
  hProcess: bigint,
  lpBaseAddress: bigint,
  dwSize: number,
): void {
  const fn = getKernel32().func('int FlushInstructionCache(void *, void *, size_t)');
  fn(hProcess, lpBaseAddress, BigInt(dwSize));
}

// ── Thread Enumeration ──

/**
 * Enumerate all thread IDs of a process using CreateToolhelp32Snapshot.
 *
 * THREADENTRY32 layout (28 bytes):
 *   +0x00: dwSize (uint32)
 *   +0x04: cntUsage (uint32)
 *   +0x08: th32ThreadID (uint32)
 *   +0x0C: th32OwnerProcessID (uint32)
 *   +0x10: tpBasePri (int32)
 *   +0x14: tpDeltaPri (int32)
 *   +0x18: dwFlags (uint32)
 */
export function EnumerateProcessThreads(pid: number): number[] {
  const fnSnapshot = getKernel32().func('void * CreateToolhelp32Snapshot(uint32, uint32)');
  const fnFirst = getKernel32().func('int Thread32First(void *, _Inout_ uint8_t[28])');
  const fnNext = getKernel32().func('int Thread32Next(void *, _Inout_ uint8_t[28])');

  const snapshot = fnSnapshot(TH32CS.SNAPTHREAD, 0);
  if (snapshot === 0n || snapshot === BigInt('0xFFFFFFFFFFFFFFFF')) {
    throw new Error(`CreateToolhelp32Snapshot failed. Error: 0x${GetLastError().toString(16)}`);
  }

  const threads: number[] = [];
  const entry = Buffer.alloc(28);
  entry.writeUInt32LE(28, 0); // dwSize

  try {
    if (fnFirst(snapshot, entry) !== 0) {
      do {
        const ownerPid = entry.readUInt32LE(0x0c);
        if (ownerPid === pid) {
          threads.push(entry.readUInt32LE(0x08));
        }
        entry.writeUInt32LE(28, 0); // Reset dwSize
      } while (fnNext(snapshot, entry) !== 0);
    }

    CloseHandle(snapshot);
  } catch (e) {
    // Best effort cleanup
    console.error('[EnumerateProcessThreads] cleanup error:', e);
  }

  return threads;
}

// ── Helpers ──

/** Open a thread with debug-appropriate access rights */
export function openThreadForDebug(threadId: number): bigint {
  const access =
    THREAD_ACCESS.SUSPEND_RESUME |
    THREAD_ACCESS.GET_CONTEXT |
    THREAD_ACCESS.SET_CONTEXT |
    THREAD_ACCESS.QUERY_INFORMATION;

  const handle = OpenThread(access, false, threadId);
  if (handle === 0n) {
    throw new Error(`Failed to open thread ${threadId}. Error: 0x${GetLastError().toString(16)}`);
  }
  return handle;
}

/**
 * Encode DR7 breakpoint configuration.
 *
 * DR7 layout (x64):
 * Bits 0-7: Local/Global enable for DR0-DR3 (L0, G0, L1, G1, ...)
 * Bits 16-17: DR0 condition (00=exec, 01=write, 11=readwrite)
 * Bits 18-19: DR0 size (00=1byte, 01=2byte, 11=4byte, 10=8byte)
 * Bits 20-21: DR1 condition
 * Bits 22-23: DR1 size
 * Bits 24-25: DR2 condition
 * Bits 26-27: DR2 size
 * Bits 28-29: DR3 condition
 * Bits 30-31: DR3 size
 */
export function encodeDR7(
  entries: Array<{
    drIndex: number;
    enabled: boolean;
    access: 'execute' | 'write' | 'readwrite' | 'read';
    size: 1 | 2 | 4 | 8;
  }>,
): bigint {
  let dr7 = 0n;

  for (const entry of entries) {
    if (!entry.enabled) continue;

    const { drIndex, access, size } = entry;

    // Local enable bit
    dr7 |= 1n << BigInt(drIndex * 2);

    // Condition: 00=exec, 01=write, 11=readwrite (read = readwrite on x86)
    let condition = 0;
    switch (access) {
      case 'execute':
        condition = 0b00;
        break;
      case 'write':
        condition = 0b01;
        break;
      case 'readwrite':
      case 'read':
        condition = 0b11;
        break;
    }
    dr7 |= BigInt(condition) << BigInt(16 + drIndex * 4);

    // Size: 00=1byte, 01=2byte, 11=4byte, 10=8byte
    let sizeCode = 0;
    switch (size) {
      case 1:
        sizeCode = 0b00;
        break;
      case 2:
        sizeCode = 0b01;
        break;
      case 4:
        sizeCode = 0b11;
        break;
      case 8:
        sizeCode = 0b10;
        break;
    }
    dr7 |= BigInt(sizeCode) << BigInt(18 + drIndex * 4);
  }

  return dr7;
}

// ── Cleanup ──

export function unloadDebugLibraries(): void {
  if (kernel32Debug) {
    kernel32Debug.unload();
    kernel32Debug = null;
  }
}

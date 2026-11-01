/**
 * Win32 Debug API Bindings using koffi FFI.
 *
 * Thread management, debug registers, debug events, and instruction cache.
 * These extend Win32API.ts with debug-specific functionality needed for
 * hardware breakpoints and code injection.
 *
 * @module Win32Debug
 */

import type { LibraryHandle } from 'koffi';
import { requireKoffi } from './koffi-loader';
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

/**
 * True when the current process is a native ARM64 build running on Windows
 * (Windows-on-ARM64), where the kernel uses the ARM64_NT_CONTEXT layout
 * instead of the x64 (AMD64) one. Mirrors the `IS_AARCH64` arch-gating
 * precedent in platform/linux/LinuxInt3AccessBreakpoint.ts.
 *
 * The platform check is required: `process.arch === 'arm64'` alone also
 * matches Apple Silicon (darwin) and Linux aarch64 hosts, where this
 * Win32 module never runs real FFI and the AMD64 layout must stay the
 * default (tests exercise it via mocks on those hosts).
 *
 * Note: under x64 emulation (WOW64) on a Windows-on-ARM64 machine the Node
 * process itself is x64, so `process.arch` is `'x64'` and we correctly take
 * the AMD64 path (GetThreadContext kernel32 marshals compatibility).
 */
export const IS_ARM64_WINDOWS = process.platform === 'win32' && process.arch === 'arm64';

/** CONTEXT flags for GetThreadContext / SetThreadContext */
export const CONTEXT_FLAGS = IS_ARM64_WINDOWS
  ? {
      // CONTEXT_ARM64 = 0x00400000; the CONTROL|INTEGER|FP our engines touch.
      ARM64: 0x00400000,
      CONTROL: 0x00400001,
      INTEGER: 0x00400002,
      SEGMENTS: 0x00400000,
      FLOATING_POINT: 0x00400004,
      DEBUG_REGISTERS: 0x00400008,
      FULL: 0x00400007, // CONTROL | INTEGER | FLOATING_POINT
      ALL: 0x0040000f, // FULL | DEBUG_REGISTERS
    }
  : {
      AMD64: 0x00100000,
      CONTROL: 0x00100001,
      INTEGER: 0x00100002,
      SEGMENTS: 0x00100004,
      FLOATING_POINT: 0x00100008,
      DEBUG_REGISTERS: 0x00100010,
      FULL: 0x0010000b, // CONTROL | INTEGER | FLOATING_POINT
      ALL: 0x0010001f, // FULL | SEGMENTS | DEBUG_REGISTERS
    };

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

// ── CONTEXT struct layouts ──
// Full AMD64 CONTEXT is 1232 bytes; ARM64_NT_CONTEXT is 912 bytes. We only
// need the relevant fields. The `X64Context` fields double as an arch-agnostic
// register view (riporting the Linux precedent
// platform/linux/LinuxInt3AccessBreakpoint.ts which maps rip←pc, rflags←pstate
// so x86-named fields stay meaningful on aarch64).
//   AMD64 offsets:
//   +0x30: ContextFlags (4)   +0x44: EFlags (4)
//   +0x48..0x70: Dr0 Dr1 Dr2 Dr3 Dr6 Dr7 (8 each)
//   +0x78..0xF8: Rax..R15 (8)  Rip@0xF8 (8)
//   ARM64_NT_CONTEXT offsets:
//   +0x00: ContextFlags (4)   +0x04: Cpsr (4) = PSTATE (x86 "eflags" view)
//   +0x08..0xF8: X0..X28 (8 each), Fp@0xF0 (=x29→rbp), Lr@0xF8 (=x30)
//   +0x100: Sp   +0x108: Pc (→rip)
//   +0x318: Bcr[8] (4 each)   +0x338: Bvr[8] (8 each)  — breakpoints
//   +0x378: Wcr[2] (4 each)   +0x380: Wvr[2] (8 each)  — watchpoints

export const CONTEXT_SIZE = IS_ARM64_WINDOWS ? 912 : 1232;

export interface X64Context {
  contextFlags: number;
  /** ARM64: PSTATE/Cpsr (kept in the x86 "eflags" slot for callers). */
  eflags: number;
  /** Debug registers. AMD64: Dr0-3, Dr6-7. ARM64: no Dr regs — 0n; use wvr/wcr. */
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
  /** ARM64 only: x30 (link register). AMD64: 0n. */
  lr: bigint;
  /** ARM64 only: breakpoint regs (Bvr/Bcr). AMD64: empty. */
  bvr: bigint[];
  bcr: number[];
  /** ARM64 only: watchpoint regs (Wvr/Wcr). AMD64: empty. */
  wvr: bigint[];
  wcr: number[];
}

const ARM64_X0 = 0x08;
const ARM64_SP = 0x100;
const ARM64_PC = 0x108;
const ARM64_LR = 0x0f8;
const ARM64_FP = 0x0f0;
const ARM64_BVR = 0x338;
const ARM64_BCR = 0x318;
const ARM64_WVR = 0x380;
const ARM64_WCR = 0x378;

/**
 * Parse a CONTEXT buffer into the shared register view. Pass `isArm64` to
 * force the ARM64_NT_CONTEXT layout (used by tests / when the arch const is
 * not authoritative); defaults to the runtime arch.
 */
export function parseContext(buf: Buffer, isArm64 = IS_ARM64_WINDOWS): X64Context {
  if (isArm64) {
    return {
      contextFlags: buf.readUInt32LE(0x00),
      eflags: buf.readUInt32LE(0x04),
      dr0: 0n,
      dr1: 0n,
      dr2: 0n,
      dr3: 0n,
      dr6: 0n,
      dr7: 0n,
      rax: buf.readBigUInt64LE(ARM64_X0 + 0 * 8),
      rcx: buf.readBigUInt64LE(ARM64_X0 + 1 * 8),
      rdx: buf.readBigUInt64LE(ARM64_X0 + 2 * 8),
      rbx: buf.readBigUInt64LE(ARM64_X0 + 3 * 8),
      rsp: buf.readBigUInt64LE(ARM64_SP),
      rbp: buf.readBigUInt64LE(ARM64_FP),
      rsi: buf.readBigUInt64LE(ARM64_X0 + 4 * 8),
      rdi: buf.readBigUInt64LE(ARM64_X0 + 5 * 8),
      r8: buf.readBigUInt64LE(ARM64_X0 + 8 * 8),
      r9: buf.readBigUInt64LE(ARM64_X0 + 9 * 8),
      r10: buf.readBigUInt64LE(ARM64_X0 + 10 * 8),
      r11: buf.readBigUInt64LE(ARM64_X0 + 11 * 8),
      r12: buf.readBigUInt64LE(ARM64_X0 + 12 * 8),
      r13: buf.readBigUInt64LE(ARM64_X0 + 13 * 8),
      r14: buf.readBigUInt64LE(ARM64_X0 + 14 * 8),
      r15: buf.readBigUInt64LE(ARM64_X0 + 15 * 8),
      rip: buf.readBigUInt64LE(ARM64_PC),
      lr: buf.readBigUInt64LE(ARM64_LR),
      bvr: Array.from({ length: 8 }, (_, i) => buf.readBigUInt64LE(ARM64_BVR + i * 8)),
      bcr: Array.from({ length: 8 }, (_, i) => buf.readUInt32LE(ARM64_BCR + i * 4)),
      wvr: Array.from({ length: 2 }, (_, i) => buf.readBigUInt64LE(ARM64_WVR + i * 8)),
      wcr: Array.from({ length: 2 }, (_, i) => buf.readUInt32LE(ARM64_WCR + i * 4)),
    };
  }
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
    lr: 0n,
    bvr: [],
    bcr: [],
    wvr: [],
    wcr: [],
  };
}

/** A context field written as a 64-bit value at a fixed offset. */
type QwordField =
  | 'rax'
  | 'rcx'
  | 'rdx'
  | 'rbx'
  | 'rsi'
  | 'rdi'
  | 'rsp'
  | 'rbp'
  | 'r8'
  | 'r9'
  | 'r10'
  | 'r11'
  | 'r12'
  | 'r13'
  | 'r14'
  | 'r15'
  | 'rip'
  | 'lr'
  | 'dr0'
  | 'dr1'
  | 'dr2'
  | 'dr3'
  | 'dr6'
  | 'dr7';

/** A context field written as a 32-bit value at a fixed offset. */
type DwordField = 'contextFlags' | 'eflags';

/**
 * ARM64 CONTEXT general-register layout: X0-X15 occupy consecutive slots,
 * SP/FP/PC/LR have their own offsets, and the debug registers follow.
 * Encoded as a const table so the offsets stay a single source of truth.
 */
const ARM64_QWORD_OFFSETS: ReadonlyArray<readonly [QwordField, number]> = [
  ['rax', ARM64_X0 + 0 * 8],
  ['rcx', ARM64_X0 + 1 * 8],
  ['rdx', ARM64_X0 + 2 * 8],
  ['rbx', ARM64_X0 + 3 * 8],
  ['rsi', ARM64_X0 + 4 * 8],
  ['rdi', ARM64_X0 + 5 * 8],
  ['rsp', ARM64_SP],
  ['rbp', ARM64_FP],
  ['r8', ARM64_X0 + 8 * 8],
  ['r9', ARM64_X0 + 9 * 8],
  ['r10', ARM64_X0 + 10 * 8],
  ['r11', ARM64_X0 + 11 * 8],
  ['r12', ARM64_X0 + 12 * 8],
  ['r13', ARM64_X0 + 13 * 8],
  ['r14', ARM64_X0 + 14 * 8],
  ['r15', ARM64_X0 + 15 * 8],
  ['rip', ARM64_PC],
  ['lr', ARM64_LR],
];

const ARM64_DWORD_OFFSETS: ReadonlyArray<readonly [DwordField, number]> = [
  ['contextFlags', 0x00],
  ['eflags', 0x04],
];

/** AMD64 CONTEXT layout: debug registers and RIP, plus the two dwords. */
const X64_QWORD_OFFSETS: ReadonlyArray<readonly [QwordField, number]> = [
  ['dr0', 0x48],
  ['dr1', 0x50],
  ['dr2', 0x58],
  ['dr3', 0x60],
  ['dr6', 0x68],
  ['dr7', 0x70],
  ['rip', 0xf8],
];

const X64_DWORD_OFFSETS: ReadonlyArray<readonly [DwordField, number]> = [
  ['contextFlags', 0x30],
  ['eflags', 0x44],
];

/** Write CONTEXT fields into a raw buffer (arch-aware offsets). */
export function writeContext(
  buf: Buffer,
  ctx: Partial<X64Context>,
  isArm64 = IS_ARM64_WINDOWS,
): void {
  if (isArm64) {
    writeContextDwords(buf, ctx, ARM64_DWORD_OFFSETS);
    writeContextQwords(buf, ctx, ARM64_QWORD_OFFSETS);
    writeArm64DebugRegisters(buf, ctx);
    return;
  }
  writeContextDwords(buf, ctx, X64_DWORD_OFFSETS);
  writeContextQwords(buf, ctx, X64_QWORD_OFFSETS);
}

/** Write the 32-bit fields listed in `table`, skipping absent ones. */
function writeContextDwords(
  buf: Buffer,
  ctx: Partial<X64Context>,
  table: ReadonlyArray<readonly [DwordField, number]>,
): void {
  for (const [field, offset] of table) {
    const value = ctx[field];
    if (value !== undefined) buf.writeUInt32LE(value, offset);
  }
}

/** Write the 64-bit fields listed in `table`, skipping absent ones. */
function writeContextQwords(
  buf: Buffer,
  ctx: Partial<X64Context>,
  table: ReadonlyArray<readonly [QwordField, number]>,
): void {
  for (const [field, offset] of table) {
    const value = ctx[field];
    if (value !== undefined) buf.writeBigUInt64LE(value, offset);
  }
}

/** ARM64 debug registers: up to 8 Bvr/Bcr and 2 Wvr/Wcr entries. */
function writeArm64DebugRegisters(buf: Buffer, ctx: Partial<X64Context>): void {
  ctx.bvr?.forEach((v, i) => {
    if (i < 8) buf.writeBigUInt64LE(v, ARM64_BVR + i * 8);
  });
  ctx.bcr?.forEach((v, i) => {
    if (i < 8) buf.writeUInt32LE(v, ARM64_BCR + i * 4);
  });
  ctx.wvr?.forEach((v, i) => {
    if (i < 2) buf.writeBigUInt64LE(v, ARM64_WVR + i * 8);
  });
  ctx.wcr?.forEach((v, i) => {
    if (i < 2) buf.writeUInt32LE(v, ARM64_WCR + i * 4);
  });
}

/**
 * Encode a single ARM64 watchpoint into its Wcr bitfield.
 *
 * ARM64 watchpoint control register (DBGWCR, mirrored in CONTEXT.Wcr) layout:
 *   bits 0-1  : BAS (byte address select) — 0b1111 = 4-byte granule selected
 *   bit  2    : LSC[0]
 *   bit  3    : LSC[1]  (00=reserved, 01=load, 11=store, so catches both on WOA)
 *   bit  5    : PAC (privileged access control) — 0 = EL0 (user) watchpoint
 *   bit  13   : E / enable
 * The Wvr holds the watchpoint address (masked to the granule).
 * Structure verified against the Windows SDK winnt.h ARM64_NT_CONTEXT Wcr/Wvr
 * field ordering; runtime semantics are not exercisable on an x64 host.
 */
function encodeArm64Wcr(
  _enabled: boolean,
  access: 'execute' | 'write' | 'readwrite' | 'read',
): number {
  let wcr = 0b1111; // BAS: all 4 bytes of the granule
  wcr |= access === 'read' || access === 'readwrite' ? 0b01 : 0b00; // LSC: load
  wcr |= access === 'write' || access === 'readwrite' ? 0b10 : 0b00; // LSC: store → 0b11
  // PAC (bit 5) stays 0 → EL0 watchpoint. E (bit 13) set below by caller.
  return wcr;
}

/**
 * Write a hardware watchpoint/breakpoint into an architecture-appropriate
 * register set. AMD64: Dr0-3 + Dr7. ARM64: Wvr/Wcr or Bvr/Bcr.
 * Exposed so engine callers (HardwareBreakpoint / VehDebugger) stop hardcoding
 * the AMD64 Dr offsets and instead delegate to the arch-aware writer.
 */
export function writeBreakpointRegisters(
  buf: Buffer,
  index: number,
  address: bigint | null,
  enabled: boolean,
  access: 'execute' | 'write' | 'readwrite' | 'read',
  arm64Kind: 'watch' | 'break' = 'watch',
  isArm64 = IS_ARM64_WINDOWS,
): void {
  if (isArm64) {
    if (arm64Kind === 'watch') {
      // Wvr[0..1] / Wcr[0..1]
      if (index < 0 || index > 1) return;
      buf.writeBigUInt64LE(address ?? 0n, ARM64_WVR + index * 8);
      const base = encodeArm64Wcr(enabled, access);
      const wcr = (base | (enabled ? 0x2000 /* E */ : 0)) & 0xffffffff;
      buf.writeUInt32LE(wcr, ARM64_WCR + index * 4);
    } else {
      // Bvr[0..7] / Bcr[0..7] — execute-only breakpoint.
      if (index < 0 || index > 7) return;
      buf.writeBigUInt64LE(address ?? 0n, ARM64_BVR + index * 8);
      const bcr = (encodeArm64Wcr(enabled, 'execute') | (enabled ? 0x2000 : 0)) & 0xffffffff;
      buf.writeUInt32LE(bcr, ARM64_BCR + index * 4);
    }
    return;
  }
  // AMD64: DR0-3 hold addresses; DR7 enables + configures them.
  const drOffsets = [0x48, 0x50, 0x58, 0x60]; // Dr0-Dr3
  buf.writeBigUInt64LE(address ?? 0n, drOffsets[index]!);
  if (enabled) {
    const dr7 = encodeDR7([
      { drIndex: index, enabled: true, access, size: address !== null ? 8 : 1 },
    ]);
    // Merge into existing DR7 (preserve other breakpoints).
    const existing = buf.readBigUInt64LE(0x70);
    buf.writeBigUInt64LE(existing | (dr7 & 0xffffffffn), 0x70);
  } else {
    // Clear local/global enable bits for this index (bits 2*i, 2*i+1).
    const clearMask = ~(3n << BigInt(index * 2));
    buf.writeBigUInt64LE(buf.readBigUInt64LE(0x70) & clearMask, 0x70);
  }
}

/** Read the debug-register address currently held for an index (arch-aware). */
export function readBreakpointRegisterAddress(
  buf: Buffer,
  index: number,
  isArm64 = IS_ARM64_WINDOWS,
): bigint {
  if (isArm64) {
    if (index < 0 || index > 1) return 0n;
    return buf.readBigUInt64LE(ARM64_WVR + index * 8);
  }
  const drOffsets = [0x48, 0x50, 0x58, 0x60];
  return buf.readBigUInt64LE(drOffsets[index]!);
}

/**
 * Set (or clear) the single-step trap bit in an arch-aware way.
 *
 * AMD64: sets EFLAGS.TF (bit 8). ARM64: sets PSTATE.SS (Software Step, bit 21)
 * in the Cpsr slot — the ARM64 single-step control, mirroring how the tracer
 * switches arch on Linux. Both feed the same `eflags` field of the shared view.
 */
export function setSingleStepFlag(buf: Buffer, enabled: boolean, isArm64 = IS_ARM64_WINDOWS): void {
  if (isArm64) {
    const ssMask = 0x1 << 21; // PSTATE.SS
    const cpsr = buf.readUInt32LE(0x04);
    buf.writeUInt32LE(enabled ? cpsr | ssMask : cpsr & ~ssMask, 0x04);
    return;
  }
  const tfMask = 0x100; // EFLAGS/RFLAGS.TF
  const eflags = buf.readUInt32LE(0x44);
  buf.writeUInt32LE(enabled ? eflags | tfMask : eflags & ~tfMask, 0x44);
}

// ── Library Loading ──

let kernel32Debug: LibraryHandle | null = null;

function getKernel32(): LibraryHandle {
  if (!kernel32Debug) {
    kernel32Debug = requireKoffi().load('kernel32.dll');
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
  const fn = getKernel32().func(`int GetThreadContext(void *, _Inout_ uint8_t[${CONTEXT_SIZE}])`);
  const buf = Buffer.alloc(CONTEXT_SIZE);
  // Must set ContextFlags before calling
  buf.writeUInt32LE(contextFlags, IS_ARM64_WINDOWS ? 0x00 : 0x30);

  const result = fn(hThread, buf);
  if (result === 0) {
    throw new Error(`GetThreadContext failed. Error: 0x${GetLastError().toString(16)}`);
  }
  return buf;
}

/** Set thread context (CPU registers including debug registers) */
export function SetThreadContext(hThread: bigint, contextBuf: Buffer): void {
  const fn = getKernel32().func(`int SetThreadContext(void *, uint8_t[${CONTEXT_SIZE}])`);
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
  const fn = getKernel32().func('int WaitForDebugEvent(_Out_ uint8_t *, uint32)');
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
  const fnFirst = getKernel32().func('int Thread32First(void *, _Out_ uint8_t[28])');
  const fnNext = getKernel32().func('int Thread32Next(void *, _Out_ uint8_t[28])');

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

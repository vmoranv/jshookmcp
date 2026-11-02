/**
 * Shared Win32 debug-register plumbing for HardwareBreakpointEngine /
 * VehDebugger.
 *
 * The two engines carried near-identical bodies for: breakpoint
 * registration bookkeeping (setBreakpoint/removeBreakpoint/listBreakpoints),
 * the applyDRToAllThreads suspend-context-write-resume loop, and the
 * traceAccess polling loop (fallow clone family, 4 groups / 180 lines).
 * Arch-aware register writes (AMD64 DR0-3+DR7 vs ARM64 Wvr/Wcr) stay inside
 * writeBreakpointRegisters; the DR7 rebuild is the only engine-specific part
 * and is injected via `buildDr7Entries`.
 */
import { randomUUID } from 'node:crypto';
import { BREAKPOINT_HIT_TIMEOUT_MS } from '@src/constants';
import type { BreakpointAccess, BreakpointHit, BreakpointSize } from './HardwareBreakpoint.types';
import {
  encodeDR7,
  EnumerateProcessThreads,
  openThreadForDebug,
  SuspendThread,
  ResumeThread,
  GetThreadContext,
  SetThreadContext,
  writeContext,
  writeBreakpointRegisters,
  CONTEXT_FLAGS,
  IS_ARM64_WINDOWS,
} from './Win32Debug';
import { CloseHandle } from './Win32API';

export interface Dr7Entry {
  drIndex: number;
  enabled: boolean;
  access: 'execute' | 'write' | 'readwrite' | 'read';
  size: BreakpointSize;
}

export const DR_ACCESS_MAP: Record<BreakpointAccess, Dr7Entry['access']> = {
  execute: 'execute',
  write: 'write',
  readwrite: 'readwrite',
  read: 'read',
};

/**
 * Apply debug-register changes to every thread of `pid`.
 *
 * `writeRegisters` performs the arch-aware ctxBuf mutation; `buildDr7Entries`
 * (AMD64 only) rebuilds the DR7 enable mask from the engine's active
 * breakpoint set. Suspend/write/SetThreadContext/Resume/CloseHandle and the
 * per-thread error isolation are shared.
 */
function applyDRToAllThreadsShared(opts: {
  pid: number;
  drIndex: number;
  address: bigint;
  access: BreakpointAccess;
  size: BreakpointSize;
  enable: boolean;
  enumerateThreads: (pid: number) => number[];
  openThread: (tid: number) => bigint;
  suspendThread: (h: bigint) => unknown;
  getThreadContext: (h: bigint, flags: number) => Buffer;
  setThreadContext: (h: bigint, ctx: Buffer) => unknown;
  resumeThread: (h: bigint) => unknown;
  closeHandle: (h: bigint) => unknown;
  contextFlagsAll: number;
  writeContext: (ctx: Buffer, opts: { contextFlags: number }) => unknown;
  writeRegisters: (
    ctxBuf: Buffer,
    drIndex: number,
    address: bigint | null,
    enable: boolean,
    access: BreakpointAccess,
  ) => void;
  isArm64Windows: boolean;
  buildDr7Entries?: (
    drIndex: number,
    access: BreakpointAccess,
    size: BreakpointSize,
    enable: boolean,
  ) => Dr7Entry[];
  dr7Offset?: number;
}): void {
  const threads = opts.enumerateThreads(opts.pid);

  for (const tid of threads) {
    let hThread: bigint;
    try {
      hThread = opts.openThread(tid);
    } catch {
      continue;
    }

    try {
      opts.suspendThread(hThread);
      const ctxBuf = opts.getThreadContext(hThread, opts.contextFlagsAll);

      // Arch-aware debug-register write. On AMD64 this sets DR0-3 + merges DR7;
      // on ARM64 it programs the Wvr/Wcr watchpoint pair.
      opts.writeRegisters(
        ctxBuf,
        opts.drIndex,
        opts.enable ? opts.address : null,
        opts.enable,
        opts.access,
      );

      if (!opts.isArm64Windows && opts.buildDr7Entries) {
        const entries = opts.buildDr7Entries(opts.drIndex, opts.access, opts.size, opts.enable);
        const dr7 = encodeDR7(entries);
        ctxBuf.writeBigUInt64LE(dr7, opts.dr7Offset ?? 0x70);
      }

      opts.writeContext(ctxBuf, { contextFlags: opts.contextFlagsAll });
      opts.setThreadContext(hThread, ctxBuf);
      opts.resumeThread(hThread);
    } catch {
      try {
        opts.resumeThread(hThread);
      } catch {
        /* ignore */
      }
    } finally {
      opts.closeHandle(hThread);
    }
  }
}

/** Shared traceAccess polling loop (identical across engines). */
export async function traceAccessShared(opts: {
  address: string;
  access: BreakpointAccess;
  maxHits?: number;
  timeoutMs?: number;
  constants: { BREAKPOINT_TRACE_MAX_HITS: number; BREAKPOINT_HIT_TIMEOUT_MS: number };
  setBreakpoint: (
    pid: number,
    address: string,
    access: BreakpointAccess,
  ) => Promise<{ id: string }>;
  waitForHit: (timeoutMs: number) => Promise<BreakpointHit | null>;
  removeBreakpoint: (id: string) => Promise<boolean>;
  pid: number;
}): Promise<BreakpointHit[]> {
  const max = opts.maxHits ?? opts.constants.BREAKPOINT_TRACE_MAX_HITS;
  const timeout = opts.timeoutMs ?? opts.constants.BREAKPOINT_HIT_TIMEOUT_MS;
  const bp = await opts.setBreakpoint(opts.pid, opts.address, opts.access);
  const hits: BreakpointHit[] = [];

  const deadline = Date.now() + timeout;
  while (hits.length < max && Date.now() < deadline) {
    const hit = await opts.waitForHit(Math.min(1000, deadline - Date.now()));
    if (hit?.breakpointId === bp.id) {
      hits.push(hit);
    }
  }

  await opts.removeBreakpoint(bp.id);
  return hits;
}

/**
 * Shared setBreakpoint core: attach guard (injected per engine), DR
 * allocation, register application, and config registration.
 */
export async function setBreakpointShared(opts: {
  pid: number;
  address: string;
  access: BreakpointAccess;
  size: BreakpointSize;
  ensureAttached: (pid: number) => Promise<void>;
  allocateDR: () => number;
  applyToAllThreads: (
    pid: number,
    drIndex: number,
    address: bigint,
    access: BreakpointAccess,
    size: BreakpointSize,
    enable: boolean,
  ) => void;
  register: (config: ActiveBreakpointLike) => void;
}): Promise<ActiveBreakpointLike> {
  await opts.ensureAttached(opts.pid);

  const drIndex = opts.allocateDR();
  const targetAddr = BigInt(opts.address.startsWith('0x') ? opts.address : `0x${opts.address}`);

  opts.applyToAllThreads(opts.pid, drIndex, targetAddr, opts.access, opts.size, true);

  const config: ActiveBreakpointLike = {
    id: randomUUID(),
    pid: opts.pid,
    address: `0x${targetAddr.toString(16).toUpperCase()}`,
    access: opts.access,
    size: opts.size,
    enabled: true,
    drIndex,
    hitCount: 0,
  };

  opts.register(config);
  return config;
}

export interface ActiveBreakpointLike {
  id: string;
  pid: number;
  address: string;
  access: BreakpointAccess;
  size: BreakpointSize;
  enabled: boolean;
  drIndex: number;
  hitCount: number;
}

/** Shared listBreakpoints projection. */
export function listBreakpointsShared(
  values: Iterable<ActiveBreakpointLike & { lastHit?: number }>,
): Array<{
  id: string;
  address: string;
  access: BreakpointAccess;
  size: BreakpointSize;
  enabled: boolean;
  hitCount: number;
  lastHit?: number;
}> {
  return Array.from(values).map((bp) => ({
    id: bp.id,
    address: bp.address,
    access: bp.access,
    size: bp.size,
    enabled: bp.enabled,
    hitCount: bp.hitCount,
    lastHit: bp.lastHit,
  }));
}

/**
 * Engine-agnostic applyDRToAllThreads adapter: binds the shared loop to one
 * engine's DR7 rebuild callback. Both Win32 engines delegate through this so
 * their wrapper bodies stay identical.
 */
export function makeApplyDRAdapter(
  buildDr7Entries: (
    pid: number,
    drIndex: number,
    access: BreakpointAccess,
    size: BreakpointSize,
    enable: boolean,
  ) => Dr7Entry[],
): (
  pid: number,
  drIndex: number,
  address: bigint,
  access: BreakpointAccess,
  size: BreakpointSize,
  enable: boolean,
) => void {
  return (pid, drIndex, address, access, size, enable) => {
    applyDRToAllThreadsShared({
      pid,
      drIndex,
      address,
      access,
      size,
      enable,
      enumerateThreads: EnumerateProcessThreads,
      openThread: openThreadForDebug,
      suspendThread: SuspendThread,
      getThreadContext: (h, flags) => GetThreadContext(h, flags),
      setThreadContext: SetThreadContext,
      resumeThread: ResumeThread,
      closeHandle: CloseHandle,
      contextFlagsAll: CONTEXT_FLAGS.ALL,
      writeContext,
      writeRegisters: writeBreakpointRegisters,
      isArm64Windows: IS_ARM64_WINDOWS,
      buildDr7Entries: (idx, acc, sz, en) => buildDr7Entries(pid, idx, acc, sz, en),
    });
  };
}

/** Shared poll-window computation for waitForHit loops. */
export function hitPollWindow(timeoutMs?: number): { timeout: number; deadline: number } {
  const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
  return { timeout, deadline: Date.now() + timeout };
}

/** Shared removeBreakpoint bookkeeping (delete → clearDR → free DR slot). */
export function removeBreakpointShared(opts: {
  id: string;
  breakpoints: Map<string, ActiveBreakpointLike & { lastHit?: number }>;
  clearDR: (pid: number, drIndex: number) => void;
  drAllocation: boolean[];
}): boolean {
  const bp = opts.breakpoints.get(opts.id);
  if (!bp) return false;

  // Delete before clearDR so the DR7 rebuild in applyDRToAllThreads
  // excludes this breakpoint — otherwise its DR bit stays enabled with
  // a zeroed address, leaving a ghost breakpoint at 0.
  opts.breakpoints.delete(opts.id);
  opts.clearDR(bp.pid, bp.drIndex);
  opts.drAllocation[bp.drIndex] = false;
  return true;
}

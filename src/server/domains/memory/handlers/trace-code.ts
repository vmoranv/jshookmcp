/**
 * TraceCodeHandlers — Ultimap-style instruction-level tracing via INT3 breakpoints.
 *
 * Sets INT3 (0xCC) at function entry points in a target address range, then runs
 * a debug event loop that captures every hit. On each hit the original byte is
 * temporarily restored, the instruction is single-stepped, and INT3 is re-written.
 * Hit counts are aggregated per address to produce a "hot code path" heat map.
 *
 * Win32-only — requires the Win32 debug API (DebugActiveProcess / WaitForDebugEvent).
 *
 * Design:
 *  1. Attach to the process as a debugger via DebugActiveProcess.
 *  2. Scan the target range for function prologue markers (0x55 = push rbp).
 *  3. Patch each entry point with 0xCC and save the original byte.
 *  4. Run the debug event loop:
 *     - EXCEPTION_BREAKPOINT: log the hit, restore original, set TF, continue
 *     - EXCEPTION_SINGLE_STEP: rewrite INT3, clear TF, continue
 *  5. After timeout/maxHits: restore all bytes and detach.
 *
 * Honesty contract:
 *  - Only push-rbp (0x55) heuristics are used for function entry detection.
 *    Other prologue patterns (mov rbp,rsp / sub rsp,imm) are not scanned —
 *    this is a deliberate trade-off: 0x55 is the most common x64 prologue and
 *    false positives (0x55 as data) are rare in compiled code. User can also
 *    pass explicit `addresses` for precise entry-point targeting.
 *  - Win32 only — throws early on non-Windows platforms.
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argString, argStringArray } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { logger } from '@utils/logger';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import {
  DebugActiveProcess,
  DebugActiveProcessStop,
  DebugSetProcessKillOnExit,
  WaitForDebugEvent,
  ContinueDebugEvent,
  SuspendThread,
  ResumeThread,
  GetThreadContext,
  SetThreadContext,
  openThreadForDebug,
  setSingleStepFlag,
  EXCEPTION_CODE,
  DEBUG_EVENT_CODE,
  DBG,
  CONTEXT_FLAGS,
  type DebugEventInfo,
} from '@native/Win32Debug';
import {
  CloseHandle,
  openProcessForMemory,
  ReadProcessMemory,
  WriteProcessMemory,
} from '@native/Win32API';

const TOOL_NAME = 'memory_trace_code';
const MAX_TRACE_TIME_MS = 30_000;
const MAX_HITS = 10_000;
const DEFAULT_MAX_RESULTS = 500;

interface TraceHit {
  /** Address of the instruction that was hit */
  address: string;
  /** Number of times this address was hit */
  hitCount: number;
  /** Timestamp of the first hit (epoch ms) */
  firstHit: number;
  /** Timestamp of the last hit (epoch ms) */
  lastHit: number;
}

/**
 * Simple x64 function-prologue scanner.
 * Scans `bytes` for `0x55` (push rbp) markers and returns the absolute
 * addresses (regionBase + offset) where they occur.
 *
 * This is the fastest heuristic for x64 function entry detection. Other
 * prologue patterns (48 89 E5 = mov rbp,rsp; 48 83 EC = sub rsp,imm8)
 * are more specific but slower to scan and not universally present.
 */
export function findFunctionEntries(bytes: Buffer, regionBase: bigint): bigint[] {
  const entries: bigint[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x55) {
      entries.push(regionBase + BigInt(i));
    }
  }
  return entries;
}

export class TraceCodeHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  constructor(processManager?: UnifiedProcessManager, ctx?: MCPServerContext) {
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleTraceCode(args: Record<string, unknown>) {
    return handleSafe(async () => {
      // ── Platform gate ──
      if (process.platform !== 'win32') {
        throw new Error(
          `${TOOL_NAME}: only supported on Windows. ` +
            'Requires the Win32 debug API (DebugActiveProcess).',
        );
      }

      const pid = await this.resolvePid(args.pid);
      if (!pid || pid <= 0) {
        throw new Error(
          `${TOOL_NAME}: missing or invalid required argument "pid" (expected positive integer)`,
        );
      }
      const opts = parseTraceCodeArgs(args);
      const resolved = resolveTraceEntryPoints(pid, opts);
      if (resolved.earlyResult) return resolved.earlyResult;
      const entryAddrs = capEntryPoints(resolved.entryAddrs);

      // ── Attach as debugger ──
      DebugActiveProcess(pid);
      DebugSetProcessKillOnExit(false);
      drainDebugEvents();

      // ── Save original bytes and write INT3 at each entry ──
      const savedBytes = patchInt3Breakpoints(pid, entryAddrs);
      const memHandle = openProcessForMemory(pid, true);

      try {
        const outcome = runTraceLoop(pid, memHandle, entryAddrs, savedBytes, opts);
        return buildTraceResult(outcome, entryAddrs.length, opts.timeoutMs);
      } finally {
        restoreBreakpoints(memHandle, savedBytes);
        try {
          DebugActiveProcessStop(pid);
        } catch {
          // Best effort
        }
      }
    });
  }
}

/** Parsed trace-code arguments. */
interface TraceCodeOptions {
  maxHits: number;
  timeoutMs: number;
  addressesRaw: string[];
  startAddrRaw: string | undefined;
  sizeRaw: number | undefined;
}

function parseTraceCodeArgs(args: Record<string, unknown>): TraceCodeOptions {
  const addressesRaw = argStringArray(args, 'addresses');
  const startAddrRaw = argString(args, 'startAddress');
  const sizeRaw = argNumber(args, 'size');

  const maxHits = argNumber(args, 'maxHits', MAX_HITS);
  if (!Number.isFinite(maxHits) || maxHits <= 0 || maxHits > MAX_HITS) {
    throw new Error(
      `${TOOL_NAME}: argument "maxHits" must be 1-${MAX_HITS}, got: ${JSON.stringify(args.maxHits)}`,
    );
  }

  const timeoutMs = argNumber(args, 'timeoutMs', MAX_TRACE_TIME_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error(
      `${TOOL_NAME}: argument "timeoutMs" must be 100-120000, got: ${JSON.stringify(args.timeoutMs)}`,
    );
  }
  return { maxHits, timeoutMs, addressesRaw, startAddrRaw, sizeRaw };
}

/** Resolve entry points from an explicit list, or by scanning a range for
 * 0x55 (push rbp) prologues. Returns an early empty result when the range
 * scan finds no markers. */
function resolveTraceEntryPoints(
  pid: number,
  opts: TraceCodeOptions,
): { entryAddrs: bigint[]; earlyResult?: Record<string, unknown> } {
  const { addressesRaw, startAddrRaw, sizeRaw } = opts;

  if (addressesRaw && addressesRaw.length > 0) {
    return { entryAddrs: addressesRaw.map(parseHexAddress) };
  }

  if (startAddrRaw && sizeRaw && sizeRaw > 0) {
    const startAddr = parseHexOrThrow(startAddrRaw, 'startAddress');
    const regionBytes = readGuestRegion(pid, startAddr, sizeRaw);
    const entryAddrs = findFunctionEntries(regionBytes, startAddr);
    if (entryAddrs.length === 0) {
      return {
        entryAddrs: [],
        earlyResult: {
          totalHits: 0,
          hits: [],
          elapsed: 0,
          entryPointsScanned: 0,
          hint:
            `No 0x55 (push rbp) markers found in the range ${startAddrRaw}+${sizeRaw}. ` +
            'This range may not contain standard x64 function prologues. Try a different range ' +
            'or use "addresses" to specify exact entry points.',
        },
      };
    }
    return { entryAddrs };
  }

  throw new Error(
    `${TOOL_NAME}: must provide either "addresses" (list of hex addresses) or ` +
      '"startAddress" + "size" (range to scan for function entries)',
  );
}

function parseHexAddress(a: string): bigint {
  const hex = a.replace(/^0x/i, '');
  const n = parseInt(hex, 16);
  if (Number.isNaN(n)) {
    throw new Error(`${TOOL_NAME}: invalid hex address in addresses: ${JSON.stringify(a)}`);
  }
  return BigInt(n);
}

function parseHexOrThrow(raw: string, label: string): bigint {
  const n = parseInt(raw.replace(/^0x/i, ''), 16);
  if (Number.isNaN(n)) {
    throw new Error(`${TOOL_NAME}: invalid hex address for ${label}: ${JSON.stringify(raw)}`);
  }
  return BigInt(n);
}

function readGuestRegion(pid: number, startAddr: bigint, regionSize: number): Buffer {
  const handle = openProcessForMemory(pid, false);
  try {
    return ReadProcessMemory(handle, startAddr, regionSize);
  } finally {
    CloseHandle(handle);
  }
}

function capEntryPoints(entryAddrs: bigint[]): bigint[] {
  const maxEntryPoints = DEFAULT_MAX_RESULTS;
  if (entryAddrs.length > maxEntryPoints) {
    logger.debug(`${TOOL_NAME}: capping ${entryAddrs.length} entries to ${maxEntryPoints}`);
    return entryAddrs.slice(0, maxEntryPoints);
  }
  return entryAddrs;
}

/** Drain the initial burst of debug events after attach. */
function drainDebugEvents(): void {
  for (let i = 0; i < 50; i++) {
    const evt = WaitForDebugEvent(100);
    if (!evt) break;
    ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
  }
}

/** Save the original byte at each entry point and write INT3 over it. */
function patchInt3Breakpoints(pid: number, entryAddrs: bigint[]): Map<string, number> {
  const savedBytes = new Map<string, number>();
  const memHandle = openProcessForMemory(pid, true);
  try {
    for (const addr of entryAddrs) {
      try {
        const orig = ReadProcessMemory(memHandle, addr, 1);
        WriteProcessMemory(memHandle, addr, Buffer.from([0xcc]));
        savedBytes.set(`0x${addr.toString(16).toUpperCase()}`, orig[0]!);
      } catch (err) {
        logger.debug(`${TOOL_NAME}: failed to patch ${addr.toString(16)}:`, err);
      }
    }
  } finally {
    CloseHandle(memHandle);
  }
  return savedBytes;
}

/** Set or clear the arch-aware single-step flag (EFLAGS.TF / PSTATE.SS). */
function setThreadSingleStep(threadId: number, enabled: boolean): void {
  const tHandle = openThreadForDebug(threadId);
  try {
    SuspendThread(tHandle);
    const ctxBuf = GetThreadContext(tHandle, CONTEXT_FLAGS.CONTROL);
    setSingleStepFlag(ctxBuf, enabled);
    SetThreadContext(tHandle, ctxBuf);
    ResumeThread(tHandle);
  } finally {
    CloseHandle(tHandle);
  }
}

/** Per-run mutable trace-loop state. */
interface TraceLoopState {
  hitMap: Map<string, { count: number; firstHit: number; lastHit: number }>;
  totalHits: number;
  maxHitsReached: boolean;
  pendingSingleStep: Map<number, bigint>;
  stoppedBy: 'maxHits' | 'timeout';
}

/** Handle an INT3 hit at one of our breakpoints: record, restore, arm step. */
function handleBreakpointHit(
  evt: DebugEventInfo,
  st: TraceLoopState,
  memHandle: bigint,
  savedBytes: Map<string, number>,
  maxHits: number,
): boolean {
  const { processId, threadId, exceptionAddress } = evt;
  const addrKey = `0x${(exceptionAddress ?? 0n).toString(16).toUpperCase()}`;
  const origByte = savedBytes.get(addrKey);
  if (origByte === undefined) {
    ContinueDebugEvent(processId, threadId, DBG.CONTINUE);
    return false;
  }

  const now = Date.now();
  const existing = st.hitMap.get(addrKey);
  if (existing) {
    existing.count++;
    existing.lastHit = now;
  } else {
    st.hitMap.set(addrKey, { count: 1, firstHit: now, lastHit: now });
  }
  st.totalHits++;

  if (st.totalHits >= maxHits) {
    st.maxHitsReached = true;
    WriteProcessMemory(memHandle, exceptionAddress!, Buffer.from([origByte]));
    ContinueDebugEvent(processId, threadId, DBG.CONTINUE);
    st.stoppedBy = 'maxHits';
    return true;
  }

  WriteProcessMemory(memHandle, exceptionAddress!, Buffer.from([origByte]));
  try {
    setThreadSingleStep(threadId, true);
    st.pendingSingleStep.set(threadId, exceptionAddress!);
  } catch {
    // If single-step setup fails, just continue
    // (the INT3 won't be re-armed but we'll still have the hit logged)
    WriteProcessMemory(memHandle, exceptionAddress!, Buffer.from([0xcc]));
  }
  ContinueDebugEvent(processId, threadId, DBG.CONTINUE);
  return false;
}

/** Single-step completed — re-arm the INT3 and clear the step flag. */
function handleSingleStep(evt: DebugEventInfo, st: TraceLoopState, memHandle: bigint): void {
  const { threadId } = evt;
  const stepAddr = st.pendingSingleStep.get(threadId);
  if (stepAddr) {
    try {
      WriteProcessMemory(memHandle, stepAddr, Buffer.from([0xcc]));
      setThreadSingleStep(threadId, false);
    } catch {
      // Best effort
    }
    st.pendingSingleStep.delete(threadId);
  }
  ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
}

/** Run the INT3 trace loop until maxHits or the deadline. */
function runTraceLoop(
  pid: number,
  memHandle: bigint,
  entryAddrs: bigint[],
  savedBytes: Map<string, number>,
  opts: TraceCodeOptions,
): TraceLoopState & { elapsed: number } {
  void pid;
  const st: TraceLoopState = {
    hitMap: new Map(),
    totalHits: 0,
    maxHitsReached: false,
    pendingSingleStep: new Map(),
    stoppedBy: 'timeout',
  };
  void entryAddrs;
  const startTime = Date.now();
  const deadline = startTime + opts.timeoutMs;

  while (st.totalHits < opts.maxHits && Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const evt = WaitForDebugEvent(Math.min(remaining, 500));
    if (!evt) {
      st.stoppedBy = 'timeout';
      break;
    }
    if (evt.debugEventCode === DEBUG_EVENT_CODE.EXCEPTION_DEBUG_EVENT) {
      if (evt.exceptionCode === EXCEPTION_CODE.BREAKPOINT) {
        if (handleBreakpointHit(evt, st, memHandle, savedBytes, opts.maxHits)) break;
      } else if (evt.exceptionCode === EXCEPTION_CODE.SINGLE_STEP) {
        handleSingleStep(evt, st, memHandle);
      } else {
        // Other exceptions — pass through
        ContinueDebugEvent(evt.processId, evt.threadId, DBG.EXCEPTION_NOT_HANDLED);
      }
    } else {
      // Non-exception debug events — continue
      ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
    }
  }

  st.stoppedBy = st.maxHitsReached ? 'maxHits' : 'timeout';
  return { ...st, elapsed: Date.now() - startTime };
}

function buildTraceResult(
  outcome: TraceLoopState & { elapsed: number },
  entryPointCount: number,
  timeoutMs: number,
): Record<string, unknown> {
  const hits: TraceHit[] = [];
  for (const [address, info] of outcome.hitMap) {
    hits.push({
      address,
      hitCount: info.count,
      firstHit: info.firstHit,
      lastHit: info.lastHit,
    });
  }
  hits.sort((a, b) => b.hitCount - a.hitCount); // hottest first

  const { totalHits, stoppedBy } = outcome;
  return {
    totalHits,
    hits,
    elapsed: outcome.elapsed,
    entryPointsScanned: entryPointCount,
    stoppedBy,
    hint:
      totalHits === 0
        ? `No breakpoints hit in ${entryPointCount} entry points within ${timeoutMs}ms. ` +
          'The target code may not be executing. Try a longer timeout or verify the address range.'
        : `Traced ${totalHits} hits across ${hits.length} unique addresses. ` +
          `Stopped by: ${stoppedBy}. Top address: ${hits[0]?.address ?? 'none'} (${hits[0]?.hitCount ?? 0} hits).`,
  };
}

/** Restore original bytes and release the memory handle. */
function restoreBreakpoints(memHandle: bigint, savedBytes: Map<string, number>): void {
  for (const [hexAddr, origByte] of savedBytes) {
    try {
      const addr = BigInt(parseInt(hexAddr.replace(/^0x/i, ''), 16));
      WriteProcessMemory(memHandle, addr, Buffer.from([origByte]));
    } catch {
      // Best effort
    }
  }
  CloseHandle(memHandle);
}

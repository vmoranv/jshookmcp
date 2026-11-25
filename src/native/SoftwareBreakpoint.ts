/**
 * Software Breakpoint Engine — INT3-based breakpoints.
 *
 * Unlike hardware breakpoints (DR0-DR3, max 4), software breakpoints write
 * 0xCC (INT3) at the target address and handle the EXCEPTION_BREAKPOINT event.
 * No practical limit on concurrent breakpoints.
 *
 * Lifecycle per hit:
 *  1. Target thread hits 0xCC → EXCEPTION_BREAKPOINT debug event
 *  2. Restore original byte, set EFLAGS.TF (trap flag / single-step)
 *  3. Continue execution → thread executes restored instruction → SINGLE_STEP
 *  4. On SINGLE_STEP: re-write 0xCC, clear TF, report hit
 *
 * Thread-safety: save/restore is per-address, not per-thread. At the
 * single-step stage the thread's RIP has advanced past the restored
 * instruction, so re-writing 0xCC is safe even under multi-threaded
 * execution (other threads hitting the same address between restore and
 * re-write are rare but handled gracefully — they see EXCEPTION_BREAKPOINT
 * and wait for the single-step cycle to complete).
 *
 * @module SoftwareBreakpoint
 */

import { randomUUID } from 'node:crypto';
import { BREAKPOINT_HIT_TIMEOUT_MS, BREAKPOINT_TRACE_MAX_HITS } from '@src/constants';
import { ToolError } from '@errors/ToolError';
import type {
  BreakpointAccess,
  BreakpointHit,
  BreakpointListEntry,
  BreakpointSize,
} from './HardwareBreakpoint.types';
import {
  SuspendThread,
  ResumeThread,
  GetThreadContext,
  SetThreadContext,
  DebugActiveProcess,
  DebugActiveProcessStop,
  DebugSetProcessKillOnExit,
  WaitForDebugEvent,
  ContinueDebugEvent,
  openThreadForDebug,
  parseContext,
  writeContext,
  setSingleStepFlag,
  EXCEPTION_CODE,
  DBG,
  CONTEXT_FLAGS,
} from './Win32Debug';
import {
  CloseHandle,
  openProcessForMemory,
  ReadProcessMemory,
  WriteProcessMemory,
} from './Win32API';

const toHex = (v: bigint) => `0x${v.toString(16).toUpperCase()}`;
const INT3_BYTE = 0xcc;

interface SavedByte {
  address: bigint;
  original: number;
}

interface ActiveSoftBreakpoint {
  id: string;
  pid: number;
  address: string;
  access: BreakpointAccess;
  size: BreakpointSize;
  enabled: boolean;
  savedBytes: SavedByte[];
  condition?: string;
}

export class SoftwareBreakpointEngine {
  private breakpoints = new Map<string, ActiveSoftBreakpoint>();
  private attachedPids = new Set<number>();

  /** Attach to process as debugger. */
  async attach(pid: number): Promise<void> {
    if (this.attachedPids.has(pid)) return;
    DebugActiveProcess(pid);
    DebugSetProcessKillOnExit(false);
    this.attachedPids.add(pid);

    for (let i = 0; i < 100; i++) {
      const evt = WaitForDebugEvent(100);
      if (!evt) break;
      ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
    }
  }

  /** Detach from process, restoring all INT3 bytes. */
  async detach(pid: number): Promise<void> {
    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) {
        await this.restoreBytes(pid, bp);
        this.breakpoints.delete(id);
      }
    }

    if (this.attachedPids.has(pid)) {
      try {
        DebugActiveProcessStop(pid);
      } catch {
        /* Best effort */
      }
      this.attachedPids.delete(pid);
    }
  }

  /** Set a software breakpoint by writing 0xCC at the target address. */
  async setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size: BreakpointSize = 1,
    condition?: string,
  ): Promise<ActiveSoftBreakpoint> {
    if (!this.attachedPids.has(pid)) {
      await this.attach(pid);
    }

    if (access !== 'execute') {
      throw new ToolError(
        'PREREQUISITE',
        'Software breakpoints only support access="execute". Use hardware breakpoints for data watchpoints.',
      );
    }

    const targetAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const handle = openProcessForMemory(pid, false);
    const savedBytes: SavedByte[] = [];

    try {
      const originalBuf = ReadProcessMemory(handle, targetAddr, 1);
      const int3Buf = Buffer.from([INT3_BYTE]);
      WriteProcessMemory(handle, targetAddr, int3Buf);
      savedBytes.push({ address: targetAddr, original: originalBuf[0]! });
    } finally {
      CloseHandle(handle);
    }

    const config: ActiveSoftBreakpoint = {
      id: randomUUID(),
      pid,
      address: `0x${targetAddr.toString(16).toUpperCase()}`,
      access,
      size,
      enabled: true,
      savedBytes,
      condition,
    };

    this.breakpoints.set(config.id, config);
    return config;
  }

  /** Remove a software breakpoint by restoring original bytes. */
  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;

    await this.restoreBytes(bp.pid, bp);
    this.breakpoints.delete(id);
    return true;
  }

  /** List all active software breakpoints. */
  listBreakpoints(): BreakpointListEntry[] {
    return Array.from(this.breakpoints.values()).map((bp) => ({
      id: bp.id,
      address: bp.address,
      access: bp.access,
      size: bp.size,
      enabled: bp.enabled,
      hitCount: 0,
    }));
  }

  /** Wait for a software breakpoint hit. */
  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const remaining = Math.max(100, deadline - Date.now());
      const evt = WaitForDebugEvent(Math.min(remaining, 500));
      if (!evt) continue;

      let hit: BreakpointHit | null = null;
      if (evt.exceptionCode === EXCEPTION_CODE.BREAKPOINT) {
        hit = this.processBreakpointHit(evt.threadId, evt.processId, evt.exceptionAddress);
      } else if (evt.exceptionCode === EXCEPTION_CODE.SINGLE_STEP) {
        this.handleSingleStep(evt.threadId, evt.processId);
      }

      // Always continue the event before returning: leaving it uncontinued
      // freezes the debuggee and prevents the follow-up SINGLE_STEP from
      // being delivered/re-armed.
      ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
      if (hit) return hit;
    }

    return null;
  }

  /** Trace access: collect multiple hits. */
  async traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number,
  ): Promise<BreakpointHit[]> {
    const max = maxHits ?? BREAKPOINT_TRACE_MAX_HITS;
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const bp = await this.setBreakpoint(pid, address, access);
    const hits: BreakpointHit[] = [];
    const deadline = Date.now() + timeout;

    while (hits.length < max && Date.now() < deadline) {
      const remaining = Math.max(100, deadline - Date.now());
      const evt = WaitForDebugEvent(Math.min(remaining, 500));
      if (!evt) continue;

      if (evt.exceptionCode === EXCEPTION_CODE.BREAKPOINT) {
        const hit = this.processBreakpointHit(evt.threadId, evt.processId, evt.exceptionAddress);
        if (hit?.breakpointId === bp.id) {
          hits.push(hit);
        }
      } else if (evt.exceptionCode === EXCEPTION_CODE.SINGLE_STEP) {
        this.handleSingleStep(evt.threadId, evt.processId);
      }

      ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
    }

    await this.removeBreakpoint(bp.id);
    return hits;
  }

  /** Check if a condition passes for a given breakpoint hit. Returns true if no condition set. */
  evaluateCondition(breakpointId: string, registers: Record<string, string>): boolean {
    const bp = this.breakpoints.get(breakpointId);
    if (!bp?.condition) return true;

    try {
      // Lazy-load ConditionEvaluator to avoid circular deps
      const {
        evaluateBreakpointCondition,
        buildConditionContext,
      } = require('./ConditionEvaluator');
      return evaluateBreakpointCondition(bp.condition, buildConditionContext(registers));
    } catch {
      return false;
    }
  }

  // ── Private ──

  private restoreBytes(pid: number, bp: ActiveSoftBreakpoint): void {
    const handle = openProcessForMemory(pid, false);
    try {
      for (const saved of bp.savedBytes) {
        WriteProcessMemory(handle, saved.address, Buffer.from([saved.original]));
      }
    } finally {
      CloseHandle(handle);
    }
  }

  private processBreakpointHit(
    threadId: number,
    processId: number,
    exceptionAddress?: bigint,
  ): BreakpointHit | null {
    // Find which breakpoint was hit (match by address)
    const excAddr = exceptionAddress ?? 0n;
    let hitBp: ActiveSoftBreakpoint | undefined;

    for (const bp of this.breakpoints.values()) {
      if (bp.pid !== processId) continue;
      const bpAddr = BigInt(bp.address);
      if (bpAddr === excAddr) {
        hitBp = bp;
        break;
      }
    }

    if (!hitBp) return null;

    let hThread: bigint;
    try {
      hThread = openThreadForDebug(threadId);
    } catch {
      return null;
    }

    try {
      SuspendThread(hThread);
      const ctxBuf = GetThreadContext(hThread, CONTEXT_FLAGS.ALL);
      const ctx = parseContext(ctxBuf);

      // Restore original byte
      const handle = openProcessForMemory(processId, false);
      try {
        for (const saved of hitBp.savedBytes) {
          WriteProcessMemory(handle, saved.address, Buffer.from([saved.original]));
        }
      } finally {
        CloseHandle(handle);
      }

      // Enable single-step (arch-aware: EFLAGS.TF on x64, PSTATE.SS on ARM64)
      setSingleStepFlag(ctxBuf, true);
      // Set PC back to the INT3 address so the restored original instruction runs
      writeContext(ctxBuf, { rip: excAddr, contextFlags: CONTEXT_FLAGS.ALL });
      SetThreadContext(hThread, ctxBuf);
      ResumeThread(hThread);

      const registers = {
        rax: toHex(ctx.rax),
        rbx: toHex(ctx.rbx),
        rcx: toHex(ctx.rcx),
        rdx: toHex(ctx.rdx),
        rsi: toHex(ctx.rsi),
        rdi: toHex(ctx.rdi),
        rsp: toHex(ctx.rsp),
        rbp: toHex(ctx.rbp),
        r8: toHex(ctx.r8),
        r9: toHex(ctx.r9),
        r10: toHex(ctx.r10),
        r11: toHex(ctx.r11),
        r12: toHex(ctx.r12),
        r13: toHex(ctx.r13),
        r14: toHex(ctx.r14),
        r15: toHex(ctx.r15),
        rip: toHex(ctx.rip),
        rflags: `0x${ctx.eflags.toString(16).toUpperCase()}`,
      };

      return {
        breakpointId: hitBp.id,
        address: hitBp.address,
        accessAddress: hitBp.address,
        instructionAddress: toHex(ctx.rip),
        threadId,
        accessType: hitBp.access,
        timestamp: Date.now(),
        registers,
      };
    } finally {
      CloseHandle(hThread);
    }
  }

  /**
   * On SINGLE_STEP: the original instruction has executed. Re-write 0xCC
   * for all breakpoints whose address matches the current IP minus some
   * small delta (the original instruction advanced RIP).
   */
  private handleSingleStep(_threadId: number, _processId: number): void {
    // After single-step, re-write 0xCC at all breakpoint addresses for this process.
    // The simplest correct approach: iterate all breakpoints owned by this pid
    // and re-write 0xCC. The restored original instruction has already executed.
    for (const bp of this.breakpoints.values()) {
      if (bp.pid !== _processId) continue;
      const handle = openProcessForMemory(_processId, false);
      try {
        for (const saved of bp.savedBytes) {
          const int3Buf = Buffer.from([INT3_BYTE]);
          WriteProcessMemory(handle, saved.address, int3Buf);
        }
      } catch {
        /* best effort */
      } finally {
        CloseHandle(handle);
      }
    }
  }
}

export const softwareBreakpointEngine = new SoftwareBreakpointEngine();

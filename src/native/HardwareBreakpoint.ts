/**
 * Hardware Breakpoint Engine — x64 debug register management.
 *
 * Sets/clears hardware breakpoints using DR0–DR3, monitors for hits,
 * and returns access context (instruction address, thread, register state).
 *
 * @module HardwareBreakpoint
 */

import { randomUUID } from 'node:crypto';
import {
  BREAKPOINT_HIT_TIMEOUT_MS,
  BREAKPOINT_TRACE_MAX_HITS,
} from '@src/constants';
import type {
  BreakpointAccess,
  BreakpointConfig,
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
  EnumerateProcessThreads,
  openThreadForDebug,
  parseContext,
  writeContext,
  encodeDR7,
  CONTEXT_FLAGS,
  EXCEPTION_CODE,
  DBG,
} from './Win32Debug';
import { CloseHandle } from './Win32API';

interface ActiveBreakpoint extends BreakpointConfig {
  drIndex: number;
  hitCount: number;
  lastHit?: number;
}

export class HardwareBreakpointEngine {
  private breakpoints = new Map<string, ActiveBreakpoint>();
  private attachedPids = new Set<number>();
  private drAllocation = [false, false, false, false]; // DR0–DR3

  /** Attach to process as debugger (required before setting breakpoints) */
  async attach(pid: number): Promise<void> {
    if (this.attachedPids.has(pid)) return;
    DebugActiveProcess(pid);
    DebugSetProcessKillOnExit(false);
    this.attachedPids.add(pid);

    // Consume initial debug events (CREATE_PROCESS, LOAD_DLL, etc.)
    for (let i = 0; i < 100; i++) {
      const evt = WaitForDebugEvent(100);
      if (!evt) break;
      ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
    }
  }

  /** Detach from process */
  async detach(pid: number): Promise<void> {
    // Remove all breakpoints for this pid
    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) {
        this.clearDR(pid, bp.drIndex);
        this.drAllocation[bp.drIndex] = false;
        this.breakpoints.delete(id);
      }
    }

    if (this.attachedPids.has(pid)) {
      try {
        DebugActiveProcessStop(pid);
      } catch {
        // Best effort
      }
      this.attachedPids.delete(pid);
    }
  }

  /** Set a hardware breakpoint using an available DR register */
  async setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size: BreakpointSize = 4
  ): Promise<BreakpointConfig> {
    // Ensure attached
    if (!this.attachedPids.has(pid)) {
      await this.attach(pid);
    }

    // Allocate DR register
    const drIndex = this.allocateDR();
    const targetAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);

    // Apply to all threads
    this.applyDRToAllThreads(pid, drIndex, targetAddr, access, size, true);

    const config: ActiveBreakpoint = {
      id: randomUUID(),
      pid,
      address: `0x${targetAddr.toString(16).toUpperCase()}`,
      access,
      size,
      enabled: true,
      drIndex,
      hitCount: 0,
    };

    this.breakpoints.set(config.id, config);
    return config;
  }

  /** Remove a hardware breakpoint */
  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;

    this.clearDR(bp.pid, bp.drIndex);
    this.drAllocation[bp.drIndex] = false;
    this.breakpoints.delete(id);
    return true;
  }

  /** List all active breakpoints */
  listBreakpoints(): BreakpointListEntry[] {
    return Array.from(this.breakpoints.values()).map((bp) => ({
      id: bp.id,
      address: bp.address,
      access: bp.access,
      size: bp.size,
      enabled: bp.enabled,
      hitCount: bp.hitCount,
      lastHit: bp.lastHit,
    }));
  }

  /** Wait for a breakpoint hit */
  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const remaining = Math.max(100, deadline - Date.now());
      const evt = WaitForDebugEvent(Math.min(remaining, 500));

      if (!evt) continue;

      // Check for single-step exception (hardware breakpoint hit)
      if (evt.exceptionCode === EXCEPTION_CODE.SINGLE_STEP) {
        const hit = this.processHit(evt.threadId, evt.processId, evt.exceptionAddress);
        ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
        if (hit) return hit;
      } else {
        // Continue other events
        ContinueDebugEvent(evt.processId, evt.threadId, DBG.CONTINUE);
      }
    }

    return null;
  }

  /** Trace access: collect multiple hits, answers "who reads/writes this address?" */
  async traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number
  ): Promise<BreakpointHit[]> {
    const max = maxHits ?? BREAKPOINT_TRACE_MAX_HITS;
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const bp = await this.setBreakpoint(pid, address, access);
    const hits: BreakpointHit[] = [];

    const deadline = Date.now() + timeout;
    while (hits.length < max && Date.now() < deadline) {
      const hit = await this.waitForHit(Math.min(1000, deadline - Date.now()));
      if (hit?.breakpointId === bp.id) {
        hits.push(hit);
      }
    }

    await this.removeBreakpoint(bp.id);
    return hits;
  }

  // ── Private ──

  private allocateDR(): number {
    for (let i = 0; i < 4; i++) {
      if (!this.drAllocation[i]) {
        this.drAllocation[i] = true;
        return i;
      }
    }
    throw new Error('All 4 hardware breakpoint registers (DR0-DR3) are in use');
  }

  private applyDRToAllThreads(
    pid: number,
    drIndex: number,
    address: bigint,
    access: BreakpointAccess,
    size: BreakpointSize,
    enable: boolean
  ): void {
    const threads = EnumerateProcessThreads(pid);
    const drAccessMap: Record<BreakpointAccess, 'execute' | 'write' | 'readwrite' | 'read'> = {
      'execute': 'execute',
      'write': 'write',
      'readwrite': 'readwrite',
      'read': 'read',
    };

    for (const tid of threads) {
      let hThread: bigint;
      try {
        hThread = openThreadForDebug(tid);
      } catch {
        continue;
      }

      try {
        SuspendThread(hThread);

        const ctxBuf = GetThreadContext(hThread, CONTEXT_FLAGS.ALL);

        // Set/clear DR address
        const drOffsets = [0x48, 0x50, 0x58, 0x60]; // DR0-DR3 offsets
        if (enable) {
          ctxBuf.writeBigUInt64LE(address, drOffsets[drIndex]!);
        } else {
          ctxBuf.writeBigUInt64LE(0n, drOffsets[drIndex]!);
        }

        // Build DR7 from all active breakpoints
        const entries = Array.from(this.breakpoints.values())
          .filter((bp) => bp.enabled)
          .map((bp) => ({
            drIndex: bp.drIndex,
            enabled: true,
            access: drAccessMap[bp.access],
            size: bp.size,
          }));

        // Add current one if enabling
        if (enable) {
          entries.push({
            drIndex,
            enabled: true,
            access: drAccessMap[access],
            size,
          });
        }

        const dr7 = encodeDR7(entries);
        ctxBuf.writeBigUInt64LE(dr7, 0x70); // DR7 offset

        writeContext(ctxBuf, { contextFlags: CONTEXT_FLAGS.ALL });
        SetThreadContext(hThread, ctxBuf);

        ResumeThread(hThread);
      } catch {
        try { ResumeThread(hThread); } catch { /* ignore */ }
      } finally {
        CloseHandle(hThread);
      }
    }
  }

  private clearDR(pid: number, drIndex: number): void {
    const dummyAccess: BreakpointAccess = 'write';
    this.applyDRToAllThreads(pid, drIndex, 0n, dummyAccess, 1, false);
  }

  private processHit(
    threadId: number,
    processId: number,
    _exceptionAddress?: bigint
  ): BreakpointHit | null {
    // Find which breakpoint was hit by checking DR6
    let hThread: bigint;
    try {
      hThread = openThreadForDebug(threadId);
    } catch {
      return null;
    }

    try {
      const ctxBuf = GetThreadContext(hThread, CONTEXT_FLAGS.ALL);
      const ctx = parseContext(ctxBuf);

      // DR6 bits 0-3 indicate which breakpoint was hit
      for (const [id, bp] of this.breakpoints) {
        if (bp.pid !== processId) continue;
        const drBit = 1n << BigInt(bp.drIndex);
        if (ctx.dr6 & drBit) {
          bp.hitCount++;
          bp.lastHit = Date.now();

          // Clear DR6
          ctxBuf.writeBigUInt64LE(0n, 0x68);
          SetThreadContext(hThread, ctxBuf);

          const toHex = (v: bigint) => `0x${v.toString(16).toUpperCase()}`;

          return {
            breakpointId: id,
            address: bp.address,
            accessAddress: bp.address,
            instructionAddress: toHex(ctx.rip),
            threadId,
            accessType: bp.access,
            timestamp: Date.now(),
            registers: {
              rax: toHex(ctx.rax), rbx: toHex(ctx.rbx),
              rcx: toHex(ctx.rcx), rdx: toHex(ctx.rdx),
              rsi: toHex(ctx.rsi), rdi: toHex(ctx.rdi),
              rsp: toHex(ctx.rsp), rbp: toHex(ctx.rbp),
              r8: toHex(ctx.r8), r9: toHex(ctx.r9),
              r10: toHex(ctx.r10), r11: toHex(ctx.r11),
              r12: toHex(ctx.r12), r13: toHex(ctx.r13),
              r14: toHex(ctx.r14), r15: toHex(ctx.r15),
              rip: toHex(ctx.rip),
              rflags: `0x${ctx.eflags.toString(16).toUpperCase()}`,
            },
          };
        }
      }

      return null;
    } finally {
      CloseHandle(hThread);
    }
  }
}

export const hardwareBreakpointEngine = new HardwareBreakpointEngine();

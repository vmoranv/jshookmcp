/**
 * SoftwareBreakpointEngine — unit tests.
 *
 * Tests INT3-based breakpoint lifecycle in isolation (mock Win32 APIs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftwareBreakpointEngine } from '@native/SoftwareBreakpoint';

// Mock all Win32 dependencies
vi.mock('@native/Win32Debug', () => ({
  OpenThread: vi.fn(() => 1n),
  SuspendThread: vi.fn(() => 0),
  ResumeThread: vi.fn(() => 1),
  GetThreadContext: vi.fn(() => Buffer.alloc(1232)),
  SetThreadContext: vi.fn(),
  DebugActiveProcess: vi.fn(),
  DebugActiveProcessStop: vi.fn(),
  DebugSetProcessKillOnExit: vi.fn(),
  WaitForDebugEvent: vi.fn(() => null),
  ContinueDebugEvent: vi.fn(),
  openThreadForDebug: vi.fn(() => 1n),
  parseContext: vi.fn(() => ({
    contextFlags: 0,
    eflags: 0,
    dr0: 0n,
    dr1: 0n,
    dr2: 0n,
    dr3: 0n,
    dr6: 0n,
    dr7: 0n,
    rax: 0n,
    rcx: 0n,
    rdx: 0n,
    rbx: 0n,
    rsp: 0n,
    rbp: 0n,
    rsi: 0n,
    rdi: 0n,
    r8: 0n,
    r9: 0n,
    r10: 0n,
    r11: 0n,
    r12: 0n,
    r13: 0n,
    r14: 0n,
    r15: 0n,
    rip: 0n,
  })),
  writeContext: vi.fn(),
  setSingleStepFlag: vi.fn(),
  encodeDR7: vi.fn(() => 0n),
  CONTEXT_FLAGS: { ALL: 0x0010001f },
  EXCEPTION_CODE: { SINGLE_STEP: 0x80000004, BREAKPOINT: 0x80000003, ACCESS_VIOLATION: 0xc0000005 },
  DBG: { CONTINUE: 0x00010002, EXCEPTION_NOT_HANDLED: 0x80010001, REPLY_LATER: 0x40010001 },
  DEBUG_EVENT_CODE: { EXCEPTION_DEBUG_EVENT: 1 },
  DEBUG_EVENT_SIZE: 176,
  THREAD_ACCESS: { ALL_ACCESS: 0x1f03ff },
  TH32CS: {},
  DR7: {
    localEnable: vi.fn(() => 1n),
    conditionShift: vi.fn(() => 16),
    sizeShift: vi.fn(() => 18),
  },
  EnumerateProcessThreads: vi.fn(() => []),
  FlushInstructionCache: vi.fn(),
}));

vi.mock('@native/Win32API', () => ({
  CloseHandle: vi.fn(),
  openProcessForMemory: vi.fn(() => 1n),
  ReadProcessMemory: vi.fn(() => Buffer.from([0x90])),
  WriteProcessMemory: vi.fn(),
  GetLastError: vi.fn(() => 0),
  FlushInstructionCache: vi.fn(),
  VirtualProtectEx: vi.fn(() => ({ success: true, oldProtect: 0x40 })),
  VirtualAllocEx: vi.fn(),
  VirtualFreeEx: vi.fn(),
  VirtualQueryEx: vi.fn(),
  PAGE: { EXECUTE_READWRITE: 0x40 },
  MEM: {},
  PROCESS_ACCESS: {},
}));

describe('SoftwareBreakpointEngine', () => {
  let engine: SoftwareBreakpointEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SoftwareBreakpointEngine();
  });

  describe('setBreakpoint (INT3 write)', () => {
    it('writes 0xCC at the target address and returns a config with saved original byte', async () => {
      const config = await engine.setBreakpoint(1234, '0x401000', 'execute', 1);

      expect(config).toBeDefined();
      expect(config.id).toBeDefined();
      expect(config.address).toBe('0x401000');
      expect(config.access).toBe('execute');
      expect(config.enabled).toBe(true);

      // Verify WriteProcessMemory was called with INT3
      const win32 = await import('@native/Win32API');
      expect(vi.mocked(win32.WriteProcessMemory)).toHaveBeenCalled();
    });

    it('rejects non-execute access for software breakpoints', async () => {
      await expect(engine.setBreakpoint(1234, '0x401000', 'write', 1)).rejects.toThrow(
        'Software breakpoints only support access="execute"',
      );
    });

    it('has no DR-limit — multiple breakpoints are supported', async () => {
      await engine.setBreakpoint(1234, '0x401000', 'execute');
      await engine.setBreakpoint(1234, '0x402000', 'execute');
      await engine.setBreakpoint(1234, '0x403000', 'execute');
      await engine.setBreakpoint(1234, '0x404000', 'execute');
      await engine.setBreakpoint(1234, '0x405000', 'execute');

      const list = engine.listBreakpoints();
      expect(list).toHaveLength(5);
      expect(list.map((b) => b.address)).toContain('0x401000');
      expect(list.map((b) => b.address)).toContain('0x405000');
    });
  });

  describe('removeBreakpoint (restore original byte)', () => {
    it('restores the original byte and removes the breakpoint', async () => {
      const config = await engine.setBreakpoint(1234, '0x401000', 'execute');
      const removed = await engine.removeBreakpoint(config.id);

      expect(removed).toBe(true);
      expect(engine.listBreakpoints()).toHaveLength(0);
    });

    it('returns false for unknown breakpoint id', async () => {
      const removed = await engine.removeBreakpoint('nonexistent');
      expect(removed).toBe(false);
    });
  });
});

describe('SoftwareBreakpointEngine waitForHit', () => {
  it('continues the breakpoint debug event before returning the hit', async () => {
    vi.clearAllMocks();
    const engine = new SoftwareBreakpointEngine();
    const win32debug = await import('@native/Win32Debug');
    const bp = await engine.setBreakpoint(1234, '0x401000', 'execute', 1);

    vi.mocked(win32debug.WaitForDebugEvent).mockReturnValueOnce({
      debugEventCode: 1,
      processId: 1234,
      threadId: 77,
      exceptionCode: 0x80000003,
      exceptionAddress: 0x401000n,
    });

    const hit = await engine.waitForHit(100);

    expect(hit?.breakpointId).toBe(bp.id);
    // The debug event must be released, otherwise the debuggee stays frozen
    // and no follow-up SINGLE_STEP can arrive.
    expect(win32debug.ContinueDebugEvent).toHaveBeenCalledWith(1234, 77, 0x00010002);
  });
});

/**
 * HardwareBreakpointEngine — unit tests.
 *
 * Tests the engine logic in isolation (mock Win32 APIs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import * as Win32Debug from '@native/Win32Debug';

// Mock Win32Debug and Win32API modules
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
  EnumerateProcessThreads: vi.fn(() => [1001, 1002]),
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
  encodeDR7: vi.fn(() => 0n),
  CONTEXT_FLAGS: { ALL: 0x0010001f },
  CONTEXT_SIZE: 1232,
  EXCEPTION_CODE: { SINGLE_STEP: 0x80000004 },
  DBG: { CONTINUE: 0x00010002 },
}));

vi.mock('@native/Win32API', () => ({
  CloseHandle: vi.fn(() => true),
}));

vi.mock('@src/constants', () => ({
  BREAKPOINT_HIT_TIMEOUT_MS: 5000,
  BREAKPOINT_TRACE_MAX_HITS: 10,
}));

describe('HardwareBreakpointEngine', () => {
  let engine: HardwareBreakpointEngine;

  beforeEach(() => {
    engine = new HardwareBreakpointEngine();
    vi.clearAllMocks();
  });

  describe('setBreakpoint', () => {
    it('should allocate first available DR register', async () => {
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      expect(bp.id).toBeDefined();
      expect(bp.address).toBe('0x7FFE0000');
      expect(bp.access).toBe('write');
      expect(bp.size).toBe(4);
      expect(bp.enabled).toBe(true);
    });

    it('should support up to 4 breakpoints', async () => {
      for (let i = 0; i < 4; i++) {
        await engine.setBreakpoint(1234, `0x${(i * 0x1000).toString(16)}`, 'write', 4);
      }
      const bps = engine.listBreakpoints();
      expect(bps.length).toBe(4);
    });

    it('should throw when all 4 DR registers are in use', async () => {
      for (let i = 0; i < 4; i++) {
        await engine.setBreakpoint(1234, `0x${(i * 0x1000).toString(16)}`, 'write', 4);
      }
      await expect(engine.setBreakpoint(1234, '0x5000', 'write', 4)).rejects.toThrow('All 4');
    });

    it('should support all access types', async () => {
      const types: Array<'read' | 'write' | 'readwrite' | 'execute'> = [
        'read',
        'write',
        'readwrite',
        'execute',
      ];
      for (const access of types) {
        const engine2 = new HardwareBreakpointEngine();
        const bp = await engine2.setBreakpoint(1234, '0x1000', access, 1);
        expect(bp.access).toBe(access);
      }
    });
  });

  describe('removeBreakpoint', () => {
    it('should free the DR register after removal', async () => {
      const bp = await engine.setBreakpoint(1234, '0x1000', 'write', 4);
      const removed = await engine.removeBreakpoint(bp.id);
      expect(removed).toBe(true);
      expect(engine.listBreakpoints().length).toBe(0);
    });

    it('should return false for non-existent breakpoint', async () => {
      expect(await engine.removeBreakpoint('nonexistent')).toBe(false);
    });

    it('should allow reuse of DR register after removal', async () => {
      // Fill all 4
      const bps = [];
      for (let i = 0; i < 4; i++) {
        bps.push(await engine.setBreakpoint(1234, `0x${(i * 0x1000).toString(16)}`, 'write', 4));
      }
      // Remove one
      await engine.removeBreakpoint(bps[0]!.id);
      // Should not throw
      const newBp = await engine.setBreakpoint(1234, '0x9000', 'execute', 1);
      expect(newBp.id).toBeDefined();
    });
  });

  describe('detach', () => {
    it('should remove breakpoints for a pid and tolerate stop failures', async () => {
      const bp = await engine.setBreakpoint(1234, '0x1000', 'write', 4);
      const stopSpy = vi.spyOn(Win32Debug, 'DebugActiveProcessStop').mockImplementation(() => {
        throw new Error('stop failed');
      });

      try {
        await expect(engine.detach(1234)).resolves.toBeUndefined();
        expect(engine.listBreakpoints()).toEqual([]);
        expect(stopSpy).toHaveBeenCalledWith(1234);
        expect(bp.id).toBeDefined();
      } finally {
        stopSpy.mockRestore();
      }
    });
  });

  describe('listBreakpoints', () => {
    it('should return empty array initially', () => {
      expect(engine.listBreakpoints()).toEqual([]);
    });

    it('should return all set breakpoints with hit counts', async () => {
      await engine.setBreakpoint(1234, '0x1000', 'write', 4);
      await engine.setBreakpoint(1234, '0x2000', 'read', 8);
      const list = engine.listBreakpoints();
      expect(list.length).toBe(2);
      expect(list[0]!.hitCount).toBe(0);
      expect(list[1]!.hitCount).toBe(0);
    });
  });

  describe('hit processing and wait loop', () => {
    it('should process a single-step hit and update breakpoint metadata', async () => {
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);

      vi.mocked(Win32Debug.parseContext).mockReturnValue({
        contextFlags: 0,
        eflags: 0x202,
        dr0: 0n,
        dr1: 0n,
        dr2: 0n,
        dr3: 0n,
        dr6: 1n,
        dr7: 0n,
        rax: 1n,
        rcx: 2n,
        rdx: 3n,
        rbx: 4n,
        rsp: 5n,
        rbp: 6n,
        rsi: 7n,
        rdi: 8n,
        r8: 9n,
        r9: 10n,
        r10: 11n,
        r11: 12n,
        r12: 13n,
        r13: 14n,
        r14: 15n,
        r15: 16n,
        rip: 0x401000n,
      } as any);

      // @ts-expect-error
      vi.mocked(Win32Debug.WaitForDebugEvent).mockReturnValueOnce({
        processId: 1234,
        threadId: 1001,
        exceptionCode: Win32Debug.EXCEPTION_CODE.SINGLE_STEP,
        exceptionAddress: 0x401000n,
      });

      const hit = await engine.waitForHit(20);
      expect(hit?.breakpointId).toBe(bp.id);
      expect(hit?.instructionAddress).toBe('0x401000');
      expect(engine.listBreakpoints()[0]?.hitCount).toBe(1);
    });

    it('should continue past non-single-step events before returning a hit', async () => {
      await engine.attach(1234);
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);

      vi.mocked(Win32Debug.parseContext).mockReturnValue({
        contextFlags: 0,
        eflags: 0x202,
        dr0: 0n,
        dr1: 0n,
        dr2: 0n,
        dr3: 0n,
        dr6: 1n,
        dr7: 0n,
        rax: 1n,
        rcx: 2n,
        rdx: 3n,
        rbx: 4n,
        rsp: 5n,
        rbp: 6n,
        rsi: 7n,
        rdi: 8n,
        r8: 9n,
        r9: 10n,
        r10: 11n,
        r11: 12n,
        r12: 13n,
        r13: 14n,
        r14: 15n,
        r15: 16n,
        rip: 0x401000n,
      } as any);

      vi.mocked(Win32Debug.WaitForDebugEvent)
        // @ts-expect-error
        .mockReturnValueOnce({
          processId: 1234,
          threadId: 1001,
          exceptionCode: 0xdeadbeef,
          exceptionAddress: 0x400000n,
        })
        // @ts-expect-error
        .mockReturnValueOnce({
          processId: 1234,
          threadId: 1001,
          exceptionCode: Win32Debug.EXCEPTION_CODE.SINGLE_STEP,
          exceptionAddress: 0x401000n,
        });

      const hit = await engine.waitForHit(20);

      expect(hit?.breakpointId).toBe(bp.id);
      expect(Win32Debug.ContinueDebugEvent).toHaveBeenCalledTimes(2);
      expect(Win32Debug.ContinueDebugEvent).toHaveBeenNthCalledWith(
        1,
        1234,
        1001,
        Win32Debug.DBG.CONTINUE,
      );
      expect(Win32Debug.ContinueDebugEvent).toHaveBeenNthCalledWith(
        2,
        1234,
        1001,
        Win32Debug.DBG.CONTINUE,
      );
    });

    it('should return null when no debug event arrives before timeout', async () => {
      expect(await engine.waitForHit(0)).toBeNull();
    });
  });

  describe('traceAccess', () => {
    it('should keep only hits for the traced breakpoint and clean it up', async () => {
      let tracedId = '';
      const originalSetBreakpoint = engine.setBreakpoint.bind(engine);
      const setSpy = vi.spyOn(engine, 'setBreakpoint').mockImplementation(async (...args) => {
        const bp = await originalSetBreakpoint(...args);
        tracedId = bp.id;
        return bp;
      });
      const waitSpy = vi
        .spyOn(engine, 'waitForHit')
        .mockImplementationOnce(
          async () =>
            ({
              breakpointId: 'other-bp',
              address: '0x2000',
              accessAddress: '0x2000',
              instructionAddress: '0x401000',
              threadId: 1001,
              accessType: 'write',
              timestamp: 1,
              registers: {} as any,
            }) as any,
        )
        .mockImplementationOnce(
          async () =>
            ({
              breakpointId: tracedId,
              address: '0x1000',
              accessAddress: '0x1000',
              instructionAddress: '0x401100',
              threadId: 1002,
              accessType: 'read',
              timestamp: 2,
              registers: {} as any,
            }) as any,
        );

      try {
        const result = await engine.traceAccess(1234, '0x1000', 'read', 1, 1000);

        expect(result).toHaveLength(1);
        expect(result[0]?.breakpointId).toBe(tracedId);
        expect(setSpy).toHaveBeenCalledWith(1234, '0x1000', 'read');
        expect(waitSpy).toHaveBeenCalledTimes(2);
        expect(engine.listBreakpoints()).toEqual([]);
      } finally {
        waitSpy.mockRestore();
        setSpy.mockRestore();
      }
    });
  });
});

/**
 * Win32Debug API bindings — unit tests.
 *
 * Tests parseContext, writeContext, encodeDR7, and buildAbsoluteJump helpers.
 * Win32 API calls themselves are integration tests (require Windows runtime).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseContext,
  writeContext,
  encodeDR7,
  CONTEXT_SIZE,
  CONTEXT_FLAGS,
  DR7,
  OpenThread,
  SuspendThread,
  ResumeThread,
  GetThreadContext,
  SetThreadContext,
  DebugActiveProcess,
  DebugActiveProcessStop,
  DebugSetProcessKillOnExit,
  WaitForDebugEvent,
  ContinueDebugEvent,
  FlushInstructionCache,
  EnumerateProcessThreads,
  openThreadForDebug,
  unloadDebugLibraries,
  DEBUG_EVENT_CODE,
} from '@native/Win32Debug';
import { vi } from 'vitest';
import * as Win32API from '@native/Win32API';

// Standardize the koffi mock
const mockFunc = vi.fn();
const mockSnapshot = vi.fn();
const mockFirst = vi.fn();
const mockNext = vi.fn();

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({
      func: vi.fn((sig: string) => {
        if (sig.includes('CreateToolhelp32Snapshot')) return mockSnapshot;
        if (sig.includes('Thread32First')) return mockFirst;
        if (sig.includes('Thread32Next')) return mockNext;
        return mockFunc;
      }),
      unload: vi.fn(),
    })),
  },
}));

vi.mock('@native/Win32API', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@native/Win32API')>();
  return {
    ...actual,
    GetLastError: vi.fn(() => 0x5), // Access Denied default
    CloseHandle: vi.fn(),
  };
});

describe('Win32Debug', () => {
  describe('parseContext', () => {
    it('should parse ContextFlags from offset 0x30', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeUInt32LE(CONTEXT_FLAGS.ALL, 0x30);
      const ctx = parseContext(buf);
      expect(ctx.contextFlags).toBe(CONTEXT_FLAGS.ALL);
    });

    it('should parse debug registers DR0-DR3, DR6, DR7', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeBigUInt64LE(0x7ffe0000n, 0x48); // DR0
      buf.writeBigUInt64LE(0x7ffe1000n, 0x50); // DR1
      buf.writeBigUInt64LE(0x7ffe2000n, 0x58); // DR2
      buf.writeBigUInt64LE(0x7ffe3000n, 0x60); // DR3
      buf.writeBigUInt64LE(0xabcdn, 0x68); // DR6
      buf.writeBigUInt64LE(0x1234n, 0x70); // DR7

      const ctx = parseContext(buf);
      expect(ctx.dr0).toBe(0x7ffe0000n);
      expect(ctx.dr1).toBe(0x7ffe1000n);
      expect(ctx.dr2).toBe(0x7ffe2000n);
      expect(ctx.dr3).toBe(0x7ffe3000n);
      expect(ctx.dr6).toBe(0xabcdn);
      expect(ctx.dr7).toBe(0x1234n);
    });

    it('should parse general-purpose registers RAX-R15 and RIP', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeBigUInt64LE(0x100n, 0x78); // RAX
      buf.writeBigUInt64LE(0x200n, 0x80); // RCX
      buf.writeBigUInt64LE(0xdeadbeefn, 0xf8); // RIP
      buf.writeUInt32LE(0x246, 0x44); // EFLAGS

      const ctx = parseContext(buf);
      expect(ctx.rax).toBe(0x100n);
      expect(ctx.rcx).toBe(0x200n);
      expect(ctx.rip).toBe(0xdeadbeefn);
      expect(ctx.eflags).toBe(0x246);
    });
  });

  describe('writeContext', () => {
    it('should write DR registers into buffer', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      writeContext(buf, {
        dr0: 0xaaaan,
        dr7: 0xbbbbn,
        rip: 0xccccn,
        contextFlags: CONTEXT_FLAGS.ALL,
      });

      expect(buf.readBigUInt64LE(0x48)).toBe(0xaaaan);
      expect(buf.readBigUInt64LE(0x70)).toBe(0xbbbbn);
      expect(buf.readBigUInt64LE(0xf8)).toBe(0xccccn);
      expect(buf.readUInt32LE(0x30)).toBe(CONTEXT_FLAGS.ALL);
    });

    it('should not touch unspecified fields and fully populate multiple properties', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeBigUInt64LE(0x9999n, 0x50); // DR1
      writeContext(buf, {
        dr0: 0x1111n,
        dr1: 0x2222n,
        dr2: 0x3333n,
        dr3: 0x4444n,
        dr6: 0x5555n,
        dr7: 0x6666n,
        rip: 0x7777n,
        eflags: 0x8888,
        contextFlags: 0x9999,
      });
      expect(buf.readBigUInt64LE(0x50)).toBe(0x2222n); // Changed
    });
  });

  describe('encodeDR7', () => {
    it('should encode local enable for DR0 execute breakpoint', () => {
      const dr7 = encodeDR7([
        {
          drIndex: 0,
          enabled: true,
          access: 'execute',
          size: 1,
        },
      ]);
      // Bit 0 (local enable DR0) = 1
      // Bits 16-17 (condition) = 00 (execute)
      // Bits 18-19 (size) = 00 (1 byte)
      expect(dr7 & 1n).toBe(1n); // Local enable
      expect((dr7 >> 16n) & 3n).toBe(0n); // Execute
      expect((dr7 >> 18n) & 3n).toBe(0n); // 1 byte
    });

    it('should encode DR1 write breakpoint of 4 bytes', () => {
      const dr7 = encodeDR7([
        {
          drIndex: 1,
          enabled: true,
          access: 'write',
          size: 4,
        },
      ]);
      expect((dr7 >> 2n) & 1n).toBe(1n); // Local enable DR1
      expect((dr7 >> 20n) & 3n).toBe(1n); // Write = 01
      expect((dr7 >> 22n) & 3n).toBe(3n); // 4 bytes = 11
    });

    it('should encode DR2 readwrite breakpoint of 8 bytes', () => {
      const dr7 = encodeDR7([
        {
          drIndex: 2,
          enabled: true,
          access: 'readwrite',
          size: 8,
        },
      ]);
      expect((dr7 >> 4n) & 1n).toBe(1n); // Local enable DR2
      expect((dr7 >> 24n) & 3n).toBe(3n); // Readwrite = 11
      expect((dr7 >> 26n) & 3n).toBe(2n); // 8 bytes = 10
    });

    it('should handle multiple breakpoints simultaneously', () => {
      const dr7 = encodeDR7([
        { drIndex: 0, enabled: true, access: 'execute', size: 1 },
        { drIndex: 3, enabled: true, access: 'write', size: 2 },
      ]);
      expect(dr7 & 1n).toBe(1n); // DR0 enabled
      expect((dr7 >> 6n) & 1n).toBe(1n); // DR3 enabled
      expect((dr7 >> 2n) & 1n).toBe(0n); // DR1 not enabled
    });

    it('should skip disabled entries', () => {
      const dr7 = encodeDR7([
        {
          drIndex: 0,
          enabled: false,
          access: 'write',
          size: 4,
        },
      ]);
      expect(dr7).toBe(0n);
    });
  });

  describe('DR7 helpers', () => {
    it('should compute correct local enable bit shifts', () => {
      expect(DR7.localEnable(0)).toBe(1n);
      expect(DR7.localEnable(1)).toBe(4n);
      expect(DR7.localEnable(2)).toBe(16n);
      expect(DR7.localEnable(3)).toBe(64n);
    });

    it('should compute correct condition and size shifts', () => {
      expect(DR7.conditionShift(0)).toBe(16);
      expect(DR7.conditionShift(1)).toBe(20);
      expect(DR7.sizeShift(0)).toBe(18);
      expect(DR7.sizeShift(1)).toBe(22);
    });
  });

  describe('Win32 API FFI Wrappers', () => {
    beforeEach(() => {
      mockFunc.mockReset();
      mockSnapshot.mockReset();
      mockFirst.mockReset();
      mockNext.mockReset();
      vi.mocked(Win32API.GetLastError).mockReturnValue(0x5);
    });

    afterEach(() => {
      unloadDebugLibraries();
    });

    it('should call OpenThread', () => {
      mockFunc.mockReturnValueOnce(1234n);
      expect(OpenThread(1, false, 999)).toBe(1234n);
    });

    it('should handle SuspendThread success and failure', () => {
      mockFunc.mockReturnValueOnce(1);
      expect(SuspendThread(123n)).toBe(1);

      mockFunc.mockReturnValueOnce(0xffffffff);
      expect(() => SuspendThread(123n)).toThrow(/SuspendThread failed/);
    });

    it('should handle ResumeThread success and failure', () => {
      mockFunc.mockReturnValueOnce(1);
      expect(ResumeThread(123n)).toBe(1);

      mockFunc.mockReturnValueOnce(0xffffffff);
      expect(() => ResumeThread(123n)).toThrow(/ResumeThread failed/);
    });

    it('should handle GetThreadContext success and failure', () => {
      // @ts-expect-error
      mockFunc.mockImplementationOnce((hThread, buf) => {
        expect(buf.readUInt32LE(0x30)).toBe(CONTEXT_FLAGS.ALL);
        return 1;
      });
      expect(GetThreadContext(123n, CONTEXT_FLAGS.ALL)).toBeInstanceOf(Buffer);

      mockFunc.mockReturnValueOnce(0);
      expect(() => GetThreadContext(123n, 0)).toThrow(/GetThreadContext failed/);
    });

    it('should handle SetThreadContext success and failure', () => {
      mockFunc.mockReturnValueOnce(1);
      SetThreadContext(123n, Buffer.alloc(CONTEXT_SIZE));

      mockFunc.mockReturnValueOnce(0);
      expect(() => SetThreadContext(123n, Buffer.alloc(CONTEXT_SIZE))).toThrow(
        /SetThreadContext failed/,
      );
    });

    it('should handle DebugActiveProcess success and failure', () => {
      mockFunc.mockReturnValueOnce(1);
      DebugActiveProcess(1234);

      mockFunc.mockReturnValueOnce(0);
      expect(() => DebugActiveProcess(1234)).toThrow(/DebugActiveProcess failed/);
    });

    it('should handle DebugActiveProcessStop success and failure', () => {
      mockFunc.mockReturnValueOnce(1);
      DebugActiveProcessStop(1234);

      mockFunc.mockReturnValueOnce(0);
      expect(() => DebugActiveProcessStop(1234)).toThrow(/DebugActiveProcessStop failed/);
    });

    it('should call DebugSetProcessKillOnExit', () => {
      DebugSetProcessKillOnExit(true);
      expect(mockFunc).toHaveBeenCalledWith(1);
      DebugSetProcessKillOnExit(false);
      expect(mockFunc).toHaveBeenCalledWith(0);
    });

    it('should handle ContinueDebugEvent success and failure', () => {
      mockFunc.mockReturnValueOnce(1);
      ContinueDebugEvent(1, 2, 3);

      mockFunc.mockReturnValueOnce(0);
      expect(() => ContinueDebugEvent(1, 2, 3)).toThrow(/ContinueDebugEvent failed/);
    });

    it('should call FlushInstructionCache', () => {
      FlushInstructionCache(123n, 456n, 100);
      expect(mockFunc).toHaveBeenCalledWith(123n, 456n, 100n);
    });

    it('should enumerate process threads', () => {
      // Mock CreateToolhelp32Snapshot loop
      mockSnapshot.mockReturnValueOnce(100n);

      // @ts-expect-error
      mockFirst.mockImplementationOnce((snap: any, entry: Buffer) => {
        // Thread32First
        entry.writeUInt32LE(999, 0x0c); // owner pid -> mismatch
        return 1;
      });

      mockNext
        // @ts-expect-error
        .mockImplementationOnce((snap: any, entry: Buffer) => {
          // Thread32Next
          entry.writeUInt32LE(1234, 0x0c); // owner pid -> match
          entry.writeUInt32LE(5678, 0x08); // thread id
          return 1;
        })
        .mockReturnValueOnce(0); // exits loop

      const threads = EnumerateProcessThreads(1234);
      expect(threads).toContain(5678);

      // Snapshot failure
      mockSnapshot.mockReturnValueOnce(BigInt('0xFFFFFFFFFFFFFFFF'));
      expect(() => EnumerateProcessThreads(1234)).toThrow(/CreateToolhelp32Snapshot failed/);
    });

    it('should openThreadForDebug successfully', () => {
      mockFunc.mockReturnValueOnce(123n); // OpenThread handle
      expect(openThreadForDebug(999)).toBe(123n);

      mockFunc.mockReturnValueOnce(0n); // OpenThread fails
      expect(() => openThreadForDebug(999)).toThrow(/Failed to open thread/);
    });

    it('should call WaitForDebugEvent correctly for exception and normal events', () => {
      // Normal event
      mockFunc.mockImplementationOnce((buf: Buffer) => {
        buf.writeUInt32LE(DEBUG_EVENT_CODE.CREATE_THREAD_DEBUG_EVENT, 0x00);
        return 1;
      });
      let info = WaitForDebugEvent(1000);
      expect(info?.debugEventCode).toBe(DEBUG_EVENT_CODE.CREATE_THREAD_DEBUG_EVENT);

      // Exception event
      mockFunc.mockImplementationOnce((buf: Buffer) => {
        buf.writeUInt32LE(DEBUG_EVENT_CODE.EXCEPTION_DEBUG_EVENT, 0x00);
        buf.writeUInt32LE(0x80000003, 0x10); // breakpoint
        buf.writeBigUInt64LE(0xabcd1234n, 0x20); // rip
        buf.writeUInt32LE(0, 0x14); // first chance true
        return 1;
      });
      info = WaitForDebugEvent(1000);
      expect(info?.exceptionCode).toBe(0x80000003);
      expect(info?.firstChance).toBe(true);

      // Timeout
      mockFunc.mockReturnValueOnce(0);
      expect(WaitForDebugEvent(0)).toBeNull();
    });
  });
});

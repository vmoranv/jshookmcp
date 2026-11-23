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
  writeBreakpointRegisters,
  readBreakpointRegisterAddress,
  setSingleStepFlag,
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
    address: vi.fn((value) => {
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number') return BigInt(value);
      return 0n;
    }),
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

  describe('writeBreakpointRegisters (AMD64)', () => {
    it('encodes an execution breakpoint with LEN=1 and updates only its DR7 slot', () => {
      const buf = Buffer.alloc(1232);
      writeBreakpointRegisters(buf, 0, 0x401000n, true, 'execute', 'break', false);

      expect(buf.readBigUInt64LE(0x48)).toBe(0x401000n); // Dr0
      const dr7 = buf.readBigUInt64LE(0x70);
      expect(dr7 & 0x1n).toBe(0x1n); // local enable DR0
      expect((dr7 >> 16n) & 0b11n).toBe(0b00n); // execute
      expect((dr7 >> 18n) & 0b11n).toBe(0b00n); // LEN=1 byte
    });

    it('clears stale RW/LEN bits when reconfiguring an existing slot', () => {
      const buf = Buffer.alloc(1232);
      // Slot 0: 8-byte readwrite watchpoint.
      writeBreakpointRegisters(buf, 0, 0x5000n, true, 'readwrite', 'watch', false);
      const before = buf.readBigUInt64LE(0x70);
      expect((before >> 18n) & 0b11n).toBe(0b10n); // LEN=8

      // Reconfigure slot 0 as execute: RW/LEN must return to 0/0.
      writeBreakpointRegisters(buf, 0, 0x401000n, true, 'execute', 'break', false);
      const after = buf.readBigUInt64LE(0x70);
      expect((after >> 16n) & 0b11n).toBe(0b00n);
      expect((after >> 18n) & 0b11n).toBe(0b00n);
    });

    it('ignores DR indices outside 0-3 instead of throwing', () => {
      const buf = Buffer.alloc(1232);
      expect(() =>
        writeBreakpointRegisters(buf, 4, 0x1000n, true, 'write', 'watch', false),
      ).not.toThrow();
      expect(readBreakpointRegisterAddress(buf, 4, false)).toBe(0n);
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
        buf.writeUInt32LE(1, 0xa8); // dwFirstChance (after 0x98-byte EXCEPTION_RECORD)
        return 1;
      });
      info = WaitForDebugEvent(1000);
      expect(info?.exceptionCode).toBe(0x80000003);
      expect(info?.firstChance).toBe(true);

      // Second-chance: dwFirstChance == 0, and ExceptionFlags is independent.
      mockFunc.mockImplementationOnce((buf: Buffer) => {
        buf.writeUInt32LE(DEBUG_EVENT_CODE.EXCEPTION_DEBUG_EVENT, 0x00);
        buf.writeUInt32LE(0xc0000005, 0x10); // access violation
        buf.writeUInt32LE(1, 0x14); // ExceptionFlags (not firstChance)
        buf.writeUInt32LE(0, 0xa8); // dwFirstChance == 0
        return 1;
      });
      info = WaitForDebugEvent(1000);
      expect(info?.exceptionCode).toBe(0xc0000005);
      expect(info?.firstChance).toBe(false);

      // Timeout (ERROR_SEM_TIMEOUT = 121) is the only FALSE that means "no event".
      mockFunc.mockReturnValueOnce(0);
      vi.mocked(Win32API.GetLastError).mockReturnValueOnce(121);
      expect(WaitForDebugEvent(0)).toBeNull();
    });

    it('throws on a WaitForDebugEvent failure other than ERROR_SEM_TIMEOUT', () => {
      mockFunc.mockReturnValueOnce(0);
      vi.mocked(Win32API.GetLastError).mockReturnValueOnce(6); // ERROR_INVALID_HANDLE
      expect(() => WaitForDebugEvent(0)).toThrow(/WaitForDebugEvent failed/);
    });
  });

  // ── Windows-on-ARM64 (ARM64_NT_CONTEXT) branch ──
  // Layout verified against the Windows SDK winnt.h. These tests lock the
  // offsets so the WOA path can't silently regress even though the branch is
  // not exercisable at runtime on an x64 host. ARM64_NT_CONTEXT is 912 bytes:
  // ContextFlags@0x00, Cpsr@0x04, X0..X28@0x08.., Fp@0xF0, Lr@0xF8, Sp@0x100,
  // Pc@0x108, Bvr[8]@0x338, Bcr[8]@0x318, Wvr[2]@0x380, Wcr[2]@0x378.
  describe('Windows-on-ARM64 (forceArm64)', () => {
    const ARM64 = true;
    const ARM64_CTX = 912;

    it('parseContext reads ARM64_NT_CONTEXT fields at the SDK offsets', () => {
      const buf = Buffer.alloc(ARM64_CTX);
      buf.writeUInt32LE(0x0040000f, 0x00); // ContextFlags
      buf.writeUInt32LE(0x600003c0, 0x04); // Cpsr
      buf.writeBigUInt64LE(0x1111n, 0x08); // X0
      buf.writeBigUInt64LE(0x2222n, 0xf0); // Fp (x29)
      buf.writeBigUInt64LE(0x3333n, 0xf8); // Lr (x30)
      buf.writeBigUInt64LE(0x5555n, 0x100); // Sp
      buf.writeBigUInt64LE(0x6666n, 0x108); // Pc
      buf.writeBigUInt64LE(0xaaaa0001n, 0x338); // Bvr0
      buf.writeUInt32LE(0x2003, 0x318); // Bcr0
      buf.writeBigUInt64LE(0xbbbb0002n, 0x380); // Wvr0
      buf.writeUInt32LE(0x2003, 0x378); // Wcr0

      const ctx = parseContext(buf, ARM64);
      expect(ctx.contextFlags).toBe(0x0040000f);
      expect(ctx.eflags).toBe(0x600003c0); // Cpsr → eflags slot
      expect(ctx.rax).toBe(0x1111n);
      expect(ctx.rbp).toBe(0x2222n); // Fp → rbp
      expect(ctx.lr).toBe(0x3333n);
      expect(ctx.rsp).toBe(0x5555n);
      expect(ctx.rip).toBe(0x6666n); // Pc → rip
      expect(ctx.bvr).toEqual([0xaaaa0001n, ...Array(7).fill(0n)]);
      expect(ctx.bcr[0]).toBe(0x2003);
      expect(ctx.wvr[0]).toBe(0xbbbb0002n);
      expect(ctx.wcr[0]).toBe(0x2003);
      // No DR registers on ARM64.
      expect(ctx.dr0).toBe(0n);
      expect(ctx.dr6).toBe(0n);
      expect(ctx.dr7).toBe(0n);
    });

    it('writeContext writes ARM64 fields without touching DR bytes', () => {
      const buf = Buffer.alloc(ARM64_CTX);
      writeContext(
        buf,
        { rip: 0xdeadn, rsp: 0xbeefn, contextFlags: CONTEXT_FLAGS.ALL, eflags: 0x200000 },
        ARM64,
      );
      expect(buf.readBigUInt64LE(0x108)).toBe(0xdeadn); // Pc
      expect(buf.readBigUInt64LE(0x100)).toBe(0xbeefn); // Sp
      expect(buf.readUInt32LE(0x00)).toBe(CONTEXT_FLAGS.ALL);
      expect(buf.readUInt32LE(0x04)).toBe(0x200000); // Cpsr
      expect(buf.readBigUInt64LE(0x48)).toBe(0n); // x64 Dr0 slot stays zero
    });

    it('writeBreakpointRegisters programs Wvr/Wcr watchpoint pair', () => {
      const buf = Buffer.alloc(ARM64_CTX);
      writeBreakpointRegisters(buf, 0, 0x1234n, true, 'readwrite', 'watch', ARM64);
      expect(buf.readBigUInt64LE(0x380)).toBe(0x1234n); // Wvr0
      expect(buf.readUInt32LE(0x378) & 0x2000).toBe(0x2000); // E (enabled) bit 13
      // LSC load|store (bits 2-3) = 0b11 for readwrite → wcr&0b1100 === 0b1100
      expect(buf.readUInt32LE(0x378) & 0b1100).toBe(0b1100);
      // BAS (bits 0-1) = 0b1111 grandule → low 2 bits set
      expect(buf.readUInt32LE(0x378) & 0b0011).toBe(0b0011);
    });

    it('readBreakpointRegisterAddress reads Wvr slots', () => {
      const buf = Buffer.alloc(ARM64_CTX);
      buf.writeBigUInt64LE(0x9999n, 0x380);
      expect(readBreakpointRegisterAddress(buf, 0, ARM64)).toBe(0x9999n);
      expect(readBreakpointRegisterAddress(buf, 1, ARM64)).toBe(0n);
      expect(readBreakpointRegisterAddress(buf, 5, ARM64)).toBe(0n); // out of range
    });

    it('setSingleStepFlag toggles PSTATE.SS (bit 21) in Cpsr', () => {
      const buf = Buffer.alloc(ARM64_CTX);
      buf.writeUInt32LE(0, 0x04);
      setSingleStepFlag(buf, true, ARM64);
      expect(buf.readUInt32LE(0x04) & (1 << 21)).toBe(1 << 21);
      setSingleStepFlag(buf, false, ARM64);
      expect(buf.readUInt32LE(0x04) & (1 << 21)).toBe(0);
    });

    it('writeBreakpointRegisters ignores out-of-range watchpoint index', () => {
      const buf = Buffer.alloc(ARM64_CTX);
      writeBreakpointRegisters(buf, 2, 0x4444n, true, 'write', 'watch', ARM64);
      // Wvr0/1 unchanged (only 2 watchpoints on ARM64)
      expect(buf.readBigUInt64LE(0x380)).toBe(0n);
      expect(buf.readBigUInt64LE(0x388)).toBe(0n);
    });
  });
});

/**
 * LinuxPtraceHelper — unit tests for the ptrace remote-syscall injection.
 *
 * Mocks koffi (ptrace/waitpid FFI) and node:fs (/proc/pid/maps + /proc/pid/mem)
 * with a register state machine that mirrors real ptrace semantics:
 *
 *   PTRACE_SYSCALL stop #1 = syscall-enter-stop (orig_rax = syscall nr, rax is
 *   still the pre-syscall value) — the process has NOT executed the syscall yet.
 *   PTRACE_SYSCALL stop #2 = syscall-exit-stop (rax now holds the return value).
 *
 * The bug under test: calling PTRACE_SYSCALL and stopping only once leaves the
 * tracee parked at syscall-enter-stop, so reading rax yields the syscall number
 * (9 for mmap) instead of the result — remoteMmap appeared to return 9.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPtrace = vi.fn();
const mockWaitpid = vi.fn();
const mockReadFileSync = vi.fn();
const mockOpenSync = vi.fn();
const mockReadSync = vi.fn();
const mockCloseSync = vi.fn();

// Register file state machine shared by the ptrace mock.
const regsState = Buffer.alloc(216);
let syscallStop: 'none' | 'enter' | 'exit' = 'none';

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({
      func: vi.fn((sig: string) => {
        if (sig.startsWith('long ptrace')) return mockPtrace;
        if (sig.startsWith('int waitpid')) return mockWaitpid;
        return vi.fn();
      }),
    })),
    // identity so the ptrace mock receives the real Buffer (GETREGS/SETREGS)
    address: vi.fn((buf: unknown) => buf),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: (p: string) => mockReadFileSync(p),
    openSync: () => mockOpenSync(),
    readSync: (fd: number, buf: Buffer) => mockReadSync(fd, buf),
    closeSync: () => mockCloseSync(),
  },
}));

import {
  remoteSyscall,
  remoteMmap,
  remoteMprotect,
  remoteMunmap,
} from '@native/platform/linux/LinuxPtraceHelper';

// x86-64 user_regs_struct offsets (mirror of the implementation).
const OFF_RAX = 80;

beforeEach(() => {
  vi.clearAllMocks();
  regsState.fill(0);
  syscallStop = 'none';

  // vDSO mapping in /proc/pid/maps.
  mockReadFileSync.mockReturnValue('7ffc00000000-7ffc00001000 r-xp 00000000 00:00 0 [vdso]\n');
  // /proc/pid/mem read: plant a `syscall` (0F 05) instruction at offset 0x10.
  mockOpenSync.mockReturnValue(7);
  mockReadSync.mockImplementation((_fd: number, buf: Buffer) => {
    buf.fill(0);
    buf[0x10] = 0x0f;
    buf[0x11] = 0x05;
    return buf.length;
  });

  // waitpid always reports the stopped pid (status value irrelevant here).
  mockWaitpid.mockReturnValue(999);

  mockPtrace.mockImplementation((req: bigint, _pid: number, _addr: unknown, data: unknown) => {
    const r = Number(req);
    if (r === 12 && data instanceof Buffer) {
      // PTRACE_GETREGS → copy current register state out.
      regsState.copy(data);
      return 0n;
    }
    if (r === 13 && data instanceof Buffer) {
      // PTRACE_SETREGS → copy injected registers in.
      data.copy(regsState);
      return 0n;
    }
    if (r === 24) {
      // PTRACE_SYSCALL → enter-stop first, exit-stop second.
      if (syscallStop === 'none') {
        syscallStop = 'enter';
      } else if (syscallStop === 'enter') {
        syscallStop = 'exit';
        // syscall-exit-stop: rax = return value; mmap returns a pointer.
        // The injected number lives in RAX (the vDSO gadget's syscall entry
        // copies RAX to orig_rax), so read RAX to decide the result.
        const syscallNr = Number(regsState.readBigUInt64LE(OFF_RAX));
        regsState.writeBigUInt64LE(syscallNr === 9 ? 0x7f001234n : 0n, OFF_RAX);
      }
      return 0n;
    }
    return 0n;
  });
});

describe('remoteSyscall / PTRACE_SYSCALL handshake', () => {
  it('calls PTRACE_SYSCALL twice — enter-stop then exit-stop — before reading rax', () => {
    remoteMmap(999, 0x1000, 7);

    const syscallCalls = mockPtrace.mock.calls.filter((c) => Number(c[0]) === 24);
    // One PTRACE_SYSCALL after SETREGS, one more to pass syscall-exit-stop.
    expect(syscallCalls).toHaveLength(2);

    // Both stops were awaited: one waitpid per PTRACE_SYSCALL (plus attach).
    expect(mockWaitpid).toHaveBeenCalledTimes(3);
  });

  it('remoteMmap returns the syscall result, not the syscall number (9)', () => {
    const addr = remoteMmap(999, 0x1000, 7);
    // Bug symptom: parked at syscall-enter-stop, rax still held the syscall
    // number 9 (SYS_MMAP). With the exit-stop, rax = the real mapped pointer.
    expect(addr).toBe(0x7f001234n);
  });

  it('remoteSyscall reports errno-style failures from the exit-stop rax', () => {
    // Force SYS_MMAP to fail with -ENOMEM (-12) at the exit stop.
    mockPtrace.mockImplementation((req: bigint, _pid: number, _addr: unknown, data: unknown) => {
      const r = Number(req);
      if (r === 12 && data instanceof Buffer) {
        regsState.copy(data);
        return 0n;
      }
      if (r === 13 && data instanceof Buffer) {
        data.copy(regsState);
        return 0n;
      }
      if (r === 24) {
        if (syscallStop === 'none') {
          syscallStop = 'enter';
        } else if (syscallStop === 'enter') {
          syscallStop = 'exit';
          regsState.writeBigUInt64LE(0xfffffffffffffff4n, OFF_RAX); // -12
        }
        return 0n;
      }
      return 0n;
    });

    expect(() => remoteMmap(999, 0x1000, 7)).toThrow(/remote mmap failed: errno 12/);
  });

  it('remoteMprotect / remoteMunmap complete their handshake without error', () => {
    // Exit-stop returns 0 for syscalls 10/11 (mprotect/munmap).
    expect(() => remoteMprotect(999, 0x7f001000n, 0x1000, 5)).not.toThrow();
    expect(() => remoteMunmap(999, 0x7f001000n, 0x1000)).not.toThrow();
    // attach + 2 SYSCALL stops + (restore + detach do not wait) per call.
    expect(mockWaitpid).toHaveBeenCalledTimes(6);
  });

  it('throws and detaches when waitpid fails mid-handshake', () => {
    // Attach stop succeeds, then the syscall-stop waitpid fails (ret = -1).
    mockWaitpid.mockReturnValueOnce(999).mockReturnValue(-1);

    expect(() => remoteMmap(999, 0x1000, 7)).toThrow(/waitpid failed for pid 999/);

    // The finally block still detaches (regs were saved before the failure).
    const detachCalls = mockPtrace.mock.calls.filter((c) => Number(c[0]) === 17);
    expect(detachCalls).toHaveLength(1);
  });

  it('does not SETREGS a zero buffer when the attach stop never arrives', () => {
    // waitpid fails at the attach stop — original regs were never read.
    mockWaitpid.mockReturnValue(-1);

    expect(() => remoteMmap(999, 0x1000, 7)).toThrow(/waitpid failed for pid 999/);

    const setRegsCalls = mockPtrace.mock.calls.filter((c) => Number(c[0]) === 13);
    expect(setRegsCalls).toHaveLength(0);
  });

  it('restores the original registers and detaches after the syscall', () => {
    // Pre-seed the tracee's saved registers with a distinctive rax.
    regsState.writeBigUInt64LE(0x11111111n, OFF_RAX);
    remoteSyscall(999, 9);

    const setRegsCalls = mockPtrace.mock.calls.filter((c) => Number(c[0]) === 13);
    expect(setRegsCalls).toHaveLength(2); // inject + restore
    const restored = setRegsCalls[1]![3] as Buffer;
    expect(restored.readBigUInt64LE(OFF_RAX)).toBe(0x11111111n);

    const detachCalls = mockPtrace.mock.calls.filter((c) => Number(c[0]) === 17);
    expect(detachCalls).toHaveLength(1);
  });
});

describe('remoteSyscall ptrace error handling', () => {
  function callsFor(req: number): unknown[] {
    return mockPtrace.mock.calls.filter((c) => Number(c[0]) === req);
  }

  it('does not detach or restore when PTRACE_ATTACH fails', () => {
    mockPtrace.mockImplementation((req: bigint) => (Number(req) === 16 ? -1n : 0n));

    expect(() => remoteSyscall(999, 9)).toThrow(/PTRACE_ATTACH/);
    expect(callsFor(17)).toHaveLength(0); // DETACH
    expect(callsFor(13)).toHaveLength(0); // SETREGS
  });

  it('does not write back zeroed registers when PTRACE_GETREGS fails', () => {
    mockPtrace.mockImplementation((req: bigint) => (Number(req) === 12 ? -1n : 0n));

    expect(() => remoteSyscall(999, 9)).toThrow(/PTRACE_GETREGS/);
    expect(callsFor(13)).toHaveLength(0); // SETREGS with the zero buffer
    expect(callsFor(17)).toHaveLength(1); // still detaches the attached tracee
  });
});

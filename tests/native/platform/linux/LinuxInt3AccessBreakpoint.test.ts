import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock koffi completely ───────────────────────────────────────────────
// Hoisted so the vi.mock factory (which vitest hoists above imports) can close
// over the shared state. Plain functions (not vi.fn) are used for load/func so
// mockReset does not wipe them; we reset state manually in beforeEach.
const { state } = vi.hoisted(() => ({
  state: {
    ptraceCalls: [] as Array<{ req: number; pid: number; addr: bigint; data: bigint }>,
    waitpidCalls: [] as Array<{ pid: number; options: number; ret: number }>,
    // Word that PTRACE_PEEKTEXT returns (full 8-byte unsigned value).
    peekReturn: 0xdeadbeef12345678n,
    // Return value + status word that the mocked waitpid writes.
    waitpidRet: 0,
    waitpidStatus: 0,
    // Stable Buffer<->address maps so the mocked waitpid can resolve the status
    // buffer from the address koffi.address() hands it.
    addrToBuf: new Map<bigint, Buffer>(),
    bufToAddr: new Map<Buffer, bigint>(),
    nextAddr: 0x10000n,
  },
}));

vi.mock('koffi', () => ({
  default: {
    load: () => ({
      func: (sig: string) => {
        if (sig.includes('ptrace')) {
          return (req: bigint, pid: number, addr: bigint, data: bigint): bigint => {
            const reqNum = Number(req);
            state.ptraceCalls.push({ req: reqNum, pid, addr, data });
            // PTRACE_PEEKTEXT (3) returns the scripted word; everything else 0n.
            if (reqNum === 3) return state.peekReturn;
            return 0n;
          };
        }
        if (sig.includes('waitpid')) {
          return (pid: number, statusBufAddr: bigint, options: number): number => {
            const buf = state.addrToBuf.get(statusBufAddr);
            if (buf) buf.writeInt32LE(state.waitpidStatus, 0);
            state.waitpidCalls.push({ pid, options, ret: state.waitpidRet });
            return state.waitpidRet;
          };
        }
        return (): bigint => 0n;
      },
    }),
    address: (buf: Buffer): bigint => {
      let a = state.bufToAddr.get(buf);
      if (a === undefined) {
        a = state.nextAddr;
        state.nextAddr += 0x10n;
        state.bufToAddr.set(buf, a);
        state.addrToBuf.set(a, buf);
      }
      return a;
    },
  },
}));

import { LinuxInt3AccessBreakpoint } from '@src/native/platform/linux/LinuxInt3AccessBreakpoint';

// ptrace request numbers the tests reason about.
const PTRACE_PEEKTEXT = 3;
const PTRACE_POKETEXT = 4;
const WNOHANG = 1;

describe('LinuxInt3AccessBreakpoint', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    state.ptraceCalls.length = 0;
    state.waitpidCalls.length = 0;
    state.peekReturn = 0xdeadbeef12345678n;
    state.waitpidRet = 0;
    state.waitpidStatus = 0;
    state.addrToBuf.clear();
    state.bufToAddr.clear();
    state.nextAddr = 0x10000n;
    Object.defineProperty(process, 'platform', { value: 'linux' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('throws from attach when process.platform is not linux', async () => {
    // Arrange — force the guard branch; no koffi call should happen.
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const engine = new LinuxInt3AccessBreakpoint();

    // Act / Assert
    await expect(engine.attach(1234)).rejects.toThrow("requires process.platform === 'linux'");
    expect(state.ptraceCalls).toHaveLength(0);
  });

  it('setBreakpoint patches the arch-correct breakpoint instruction (INT3 x86-64 / BRK aarch64)', async () => {
    // Arrange — the engine's arch is derived from process.arch at module load,
    // so the test's expectations track the host arch rather than hardcoding one.
    const isArm64 = process.arch === 'arm64';
    const insnWord = isArm64 ? 0xd4200000n : 0xccn; // BRK #0 / INT3
    const lowMask = isArm64 ? 0xffffffffn : 0xffn; // 4 bytes on arm64, 1 on x86-64

    const pid = 4242;
    const address = 0x401000n;
    const originalWord = 0xdeadbeef12345678n;
    state.peekReturn = originalWord;
    // waitpid (blocking, called from attach) returns the pid + SIGSTOP status.
    // SIGSTOP=19; stopped status encoding = (sig << 8) | 0x7f.
    state.waitpidRet = pid;
    state.waitpidStatus = (19 << 8) | 0x7f;

    // Act
    const engine = new LinuxInt3AccessBreakpoint();
    await engine.attach(pid);
    const { id } = await engine.setBreakpoint(pid, address, 'execute', 1);

    // Assert: PEEKTEXT happened at the requested address.
    const peek = state.ptraceCalls.find((c) => c.req === PTRACE_PEEKTEXT);
    expect(peek).toBeDefined();
    expect(peek!.addr).toBe(address);

    // Assert: POKETEXT happened with a word whose low bytes hold the breakpoint
    // instruction and whose upper bytes are the original word's upper bytes.
    const poke = state.ptraceCalls.find((c) => c.req === PTRACE_POKETEXT);
    expect(poke).toBeDefined();
    expect(poke!.addr).toBe(address);
    expect(poke!.data & lowMask).toBe(insnWord); // breakpoint instruction in low bytes
    expect(poke!.data & ~lowMask).toBe(originalWord & ~lowMask); // upper bytes preserved

    // Assert: a UUID-shaped id was returned.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('waitForHit returns null on timeout when no SIGTRAP arrives', async () => {
    // Arrange — waitpid (WNOHANG) always reports "no child ready".
    state.waitpidRet = 0;
    state.waitpidStatus = 0;

    // Act
    const engine = new LinuxInt3AccessBreakpoint();
    const hit = await engine.waitForHit(50);

    // Assert
    expect(hit).toBeNull();
    // At least one WNOHANG poll occurred.
    expect(state.waitpidCalls.length).toBeGreaterThan(0);
    expect(state.waitpidCalls.every((c) => c.options === WNOHANG)).toBe(true);
  });
});

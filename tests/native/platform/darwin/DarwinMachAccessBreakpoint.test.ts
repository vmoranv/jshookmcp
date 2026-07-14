import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted gives us references to the mock fns so per-test assertions and
// return-value scripting reach inside the mocked DarwinAPI module.
const mocks = vi.hoisted(() => ({
  taskForPid: vi.fn<(self: number, pid: number) => { kr: number; task: number }>(),
  machVmProtect:
    vi.fn<
      (task: number, address: bigint, size: bigint, setMaximum: boolean, prot: number) => number
    >(),
  machVmRegion: vi.fn<
    (
      task: number,
      address: bigint,
    ) => {
      kr: number;
      address: bigint;
      size: bigint;
      info: { protection: number };
    }
  >(),
  machPortDeallocate: vi.fn<(task: number, name: number) => number>(),
  taskSetExceptionPorts:
    vi.fn<(task: number, mask: number, port: number, behavior: number, flavor: number) => number>(),
  hostPageSize: vi.fn<() => number>(),
  machPortAllocateReceive: vi.fn<() => number>(),
  machPortInsertSendRight: vi.fn<(name: number) => number>(),
  machPortReleaseReceive: vi.fn<(name: number) => number>(),
  threadStateFlavor: vi.fn<() => number>(),
  receiveException: vi.fn<(receivePort: number, timeoutMs: number) => unknown>(),
  sendExceptionReply: vi.fn<(localPort: number, retCode: number, msgId?: number) => void>(),
  threadGetState: vi.fn<(thread: number, flavor: number, state: Buffer) => number>(),
}));

// Mock DarwinAPI entirely — the engine never reaches real koffi through it.
vi.mock('@src/native/platform/darwin/DarwinAPI', () => ({
  machTaskSelf: () => 42,
  taskForPid: mocks.taskForPid,
  machVmProtect: mocks.machVmProtect,
  machVmRegion: mocks.machVmRegion,
  machPortDeallocate: mocks.machPortDeallocate,
  taskSetExceptionPorts: mocks.taskSetExceptionPorts,
  hostPageSize: mocks.hostPageSize,
  machPortAllocateReceive: mocks.machPortAllocateReceive,
  machPortInsertSendRight: mocks.machPortInsertSendRight,
  machPortReleaseReceive: mocks.machPortReleaseReceive,
  threadStateFlavor: mocks.threadStateFlavor,
  receiveException: mocks.receiveException,
  sendExceptionReply: mocks.sendExceptionReply,
  threadGetState: mocks.threadGetState,
  KERN: { SUCCESS: 0, INVALID_ARGUMENT: 4, FAILURE: 5 },
  VM_PROT: { NONE: 0, READ: 1, WRITE: 2, EXECUTE: 4 },
  EXC_MASK: { BAD_ACCESS: 2 },
  EXCEPTION_BEHAVIOR: { DEFAULT: 1, MACH_CODES: 0x20000000 },
  THREAD_FLAVOR: { x86_THREAD_STATE64: 4 },
}));

// Defensive: koffi is never reached by the engine when DarwinAPI is mocked,
// but mock it so any transitive import is inert.
vi.mock('koffi', () => ({
  default: { load: () => ({ func: () => () => 0n }), address: () => 0n },
}));

import { DarwinMachAccessBreakpoint } from '@src/native/platform/darwin/DarwinMachAccessBreakpoint';

describe('DarwinMachAccessBreakpoint', () => {
  const originalPlatform = process.platform;
  const PAGE_SIZE = 0x1000n; // mocked hostPageSize returns 4096

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    // Default happy-path scripting.
    mocks.taskForPid.mockReturnValue({ kr: 0, task: 1234 });
    mocks.machVmRegion.mockReturnValue({
      kr: 0,
      address: 0x400000n,
      size: PAGE_SIZE,
      info: { protection: 3 }, // READ|WRITE
    });
    mocks.machVmProtect.mockReturnValue(0);
    mocks.machPortDeallocate.mockReturnValue(0);
    mocks.taskSetExceptionPorts.mockReturnValue(0);
    mocks.hostPageSize.mockReturnValue(4096);
    mocks.machPortAllocateReceive.mockReturnValue(5555);
    mocks.machPortInsertSendRight.mockReturnValue(0);
    mocks.machPortReleaseReceive.mockReturnValue(0);
    mocks.threadStateFlavor.mockReturnValue(6);
    mocks.receiveException.mockReturnValue(null);
    mocks.sendExceptionReply.mockImplementation(() => undefined);
    mocks.threadGetState.mockReturnValue(0);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('throws the entitlement error when task_for_pid fails', async () => {
    // Arrange — kern_return_t != KERN_SUCCESS (e.g. KERN_FAILURE = 5)
    mocks.taskForPid.mockReturnValue({ kr: 5, task: 0 });

    const engine = new DarwinMachAccessBreakpoint();

    // Act / Assert: the error mentions task_for_pid and the entitlement cause.
    await expect(engine.attach(9999)).rejects.toThrow('task_for_pid');
    await expect(engine.attach(9999)).rejects.toThrow('debugger entitlement');
  });

  it('setBreakpoint arms VM_PROT_NONE page guard + EXC_MASK_BAD_ACCESS on the allocated receive port', async () => {
    // Arrange
    const pid = 4242;
    const address = 0x401234n; // intentionally not page-aligned
    const expectedPageAddr = address & ~(PAGE_SIZE - 1n);
    const expectedTaskPort = 1234;
    const expectedReceivePort = 5555;

    // Act
    const engine = new DarwinMachAccessBreakpoint();
    await engine.attach(pid);
    const { id } = await engine.setBreakpoint(pid, address, 'execute', 1);

    // Assert: a Mach receive right was allocated for the exception port.
    expect(mocks.machPortAllocateReceive).toHaveBeenCalled();

    // Assert: machVmProtect was called with VM_PROT.NONE (0) on the
    // page-aligned address, with the correct task port and page size.
    const noneCall = mocks.machVmProtect.mock.calls.find((c) => c[4] === 0);
    expect(noneCall).toBeDefined();
    expect(noneCall![0]).toBe(expectedTaskPort);
    expect(noneCall![1]).toBe(expectedPageAddr);
    expect(noneCall![2]).toBe(PAGE_SIZE);
    expect(noneCall![3]).toBe(false);

    // Assert: a send right was made from the receive right (required before
    // task_set_exception_ports — the kernel needs a send right to deliver).
    expect(mocks.machPortInsertSendRight).toHaveBeenCalledWith(expectedReceivePort);

    // Assert: task_set_exception_ports armed EXC_MASK_BAD_ACCESS on the
    // allocated receive port with EXCEPTION_DEFAULT | MACH_EXCEPTION_CODES and
    // the arch-correct thread-state flavor (mocked threadStateFlavor → 6).
    expect(mocks.taskSetExceptionPorts).toHaveBeenCalledTimes(1);
    const excCall = mocks.taskSetExceptionPorts.mock.calls[0]!;
    expect(excCall[0]).toBe(expectedTaskPort); // task
    expect(excCall[1]).toBe(2); // EXC_MASK.BAD_ACCESS
    expect(excCall[2]).toBe(expectedReceivePort); // allocated receive right
    expect(excCall[3]).toBe(0x20000001); // EXCEPTION_BEHAVIOR.DEFAULT | MACH_CODES
    expect(excCall[4]).toBe(6); // arch-correct flavor (mocked threadStateFlavor)

    // Assert: UUID-shaped id.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('setBreakpoint falls back to 32-bit DEFAULT when MACH_EXCEPTION_CODES is rejected', async () => {
    // Arrange — first attempt (DEFAULT|CODES) returns KERN_INVALID_ARGUMENT (as
    // observed on Apple Silicon hardened runtime); the DEFAULT fallback succeeds.
    mocks.taskSetExceptionPorts.mockReturnValueOnce(4).mockReturnValueOnce(0);

    const engine = new DarwinMachAccessBreakpoint();
    await engine.attach(4242);
    const { id } = await engine.setBreakpoint(4242, 0x401000n, 'execute', 1);

    expect(mocks.taskSetExceptionPorts).toHaveBeenCalledTimes(2);
    expect(mocks.taskSetExceptionPorts.mock.calls[0]![3]).toBe(0x20000001); // DEFAULT|CODES
    expect(mocks.taskSetExceptionPorts.mock.calls[1]![3]).toBe(1); // DEFAULT fallback
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('waitForHit returns null when no EXC_BAD_ACCESS arrives within the window', async () => {
    // Arrange — arm one breakpoint so the receive loop has a port to poll;
    // receiveException is scripted to return null (no message dequeued).
    const engine = new DarwinMachAccessBreakpoint();
    await engine.attach(4242);
    await engine.setBreakpoint(4242, 0x401000n, 'execute', 1);

    // Act
    const hit = await engine.waitForHit(30);

    // Assert: no hit, and the receive loop polled the armed port.
    expect(hit).toBeNull();
    expect(mocks.receiveException).toHaveBeenCalled();
  });
});

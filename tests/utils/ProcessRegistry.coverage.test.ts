import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@src/constants', () => ({
  EXTERNAL_TOOL_FORCE_KILL_GRACE_MS: 100,
}));

describe('ProcessRegistry', () => {
  let ProcessRegistry: typeof import('@utils/ProcessRegistry').ProcessRegistry;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@utils/ProcessRegistry');
    ProcessRegistry = mod.ProcessRegistry;
    // Clear any leftover tracked processes
    await ProcessRegistry.terminateAll();
  });

  it('register and unregister a child process', async () => {
    const proc = { kill: vi.fn(), once: vi.fn(), pid: 123 } as any;
    ProcessRegistry.register(proc);
    ProcessRegistry.unregister(proc);
  });

  it('register handles falsy value', () => {
    ProcessRegistry.register(null as any);
  });

  it('unregister handles falsy value', () => {
    ProcessRegistry.unregister(null as any);
  });

  it('registers worker with once listener', () => {
    const worker = { terminate: vi.fn(), once: vi.fn() } as any;
    ProcessRegistry.register(worker);
    expect(worker.once).toHaveBeenCalledWith('exit', expect.any(Function));
  });

  it('registers worker with on listener when once unavailable', () => {
    const worker = { terminate: vi.fn(), once: undefined, on: vi.fn() } as any;
    ProcessRegistry.register(worker);
    expect(worker.on).toHaveBeenCalledWith('exit', expect.any(Function));
  });

  it('terminateAll handles empty registry', async () => {
    await ProcessRegistry.terminateAll();
  });

  it('terminateAll terminates workers', async () => {
    const worker = {
      terminate: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
    } as any;
    ProcessRegistry.register(worker);
    await ProcessRegistry.terminateAll();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('terminateAll handles worker terminate error', async () => {
    const worker = {
      terminate: vi.fn().mockRejectedValue(new Error('failed')),
      once: vi.fn(),
    } as any;
    ProcessRegistry.register(worker);
    await ProcessRegistry.terminateAll();
  });

  it('terminateAll kills child process that is already dead', async () => {
    const proc = {
      kill: vi.fn(),
      once: vi.fn(),
      killed: true,
      exitCode: 0,
      signalCode: null,
      pid: 42,
    } as any;
    ProcessRegistry.register(proc);
    await ProcessRegistry.terminateAll();
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('terminateAll kills child process with SIGTERM then SIGKILL', async () => {
    const listeners: Record<string, Function> = {};
    const proc = {
      kill: vi.fn(),
      once: vi.fn((event: string, cb: Function) => {
        listeners[event] = cb;
      }),
      killed: false,
      exitCode: null,
      signalCode: null,
      pid: 42,
    } as any;

    ProcessRegistry.register(proc);

    // Simulate process exit after terminateAll starts
    const promise = ProcessRegistry.terminateAll();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Simulate the exit event
    if (listeners['exit']) listeners['exit']();
    if (listeners['close']) listeners['close']();

    await promise;
  });

  it('auto-deregisters child process on close', async () => {
    let closeListener: Function | undefined;
    const proc = {
      kill: vi.fn(),
      once: vi.fn((event: string, cb: Function) => {
        if (event === 'close') closeListener = cb;
      }),
      pid: 1,
    } as any;

    ProcessRegistry.register(proc);

    // Trigger the close listener
    expect(closeListener).toBeDefined();
    closeListener!();
  });
});

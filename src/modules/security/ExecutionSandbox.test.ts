import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (payload: any) => void;

const sandboxState = vi.hoisted(() => {
  class WorkerMock {
    public listeners = new Map<string, Listener[]>();
    public terminate = vi.fn(async () => 0);

    constructor(
      public readonly script: string,
      public readonly options: Record<string, unknown>
    ) {}

    on(event: string, callback: Listener) {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.push(callback);
      this.listeners.set(event, callbacks);
      return this;
    }

    emit(event: string, payload?: any) {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.forEach((callback) => callback(payload));
    }
  }

  return {
    instances: [] as WorkerMock[],
    WorkerMock,
  };
});

vi.mock('node:worker_threads', () => ({
  Worker: class WorkerCtor {
    private readonly inner: InstanceType<typeof sandboxState.WorkerMock>;
    public terminate: ReturnType<typeof vi.fn>;

    constructor(script: string, options: Record<string, unknown>) {
      this.inner = new sandboxState.WorkerMock(script, options);
      sandboxState.instances.push(this.inner);
      this.terminate = this.inner.terminate;
    }

    on(event: string, callback: Listener) {
      this.inner.on(event, callback);
      return this;
    }
  },
}));

vi.mock('../../utils/concurrency.js', () => ({
  cpuLimit: vi.fn(async (fn: () => Promise<unknown> | unknown) => fn()),
}));

import { cpuLimit } from '../../utils/concurrency.js';
import { ExecutionSandbox } from './ExecutionSandbox.js';

describe('ExecutionSandbox', () => {
  beforeEach(() => {
    sandboxState.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executes code and returns worker output', async () => {
    const sandbox = new ExecutionSandbox();
    const task = sandbox.execute({ code: '1 + 2', timeoutMs: 500 });
    const worker = sandboxState.instances[0]!;

    worker.emit('message', { ok: true, output: 3, timedOut: false });
    await expect(task).resolves.toMatchObject({ ok: true, output: 3, timedOut: false });
    expect(cpuLimit).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('passes default timeout and memory limits to worker', async () => {
    const sandbox = new ExecutionSandbox();
    const task = sandbox.execute({ code: '42' });
    const worker = sandboxState.instances[0]!;

    const options = worker.options as {
      workerData: { timeoutMs: number };
      resourceLimits: { maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number };
    };
    expect(options.workerData.timeoutMs).toBe(5000);
    expect(options.resourceLimits.maxOldGenerationSizeMb).toBe(128);
    expect(options.resourceLimits.maxYoungGenerationSizeMb).toBe(32);

    worker.emit('message', { ok: true, output: 42 });
    await expect(task).resolves.toMatchObject({ ok: true, output: 42 });
  });

  it('returns worker error events as failed result', async () => {
    const sandbox = new ExecutionSandbox();
    const task = sandbox.execute({ code: 'throw new Error("x")' });
    const worker = sandboxState.instances[0]!;

    worker.emit('error', new Error('kaboom'));
    await expect(task).resolves.toMatchObject({
      ok: false,
      timedOut: false,
      error: expect.stringContaining('kaboom'),
    });
  });

  it('enforces hard timeout and terminates stalled worker', async () => {
    vi.useFakeTimers();
    const sandbox = new ExecutionSandbox();
    const task = sandbox.execute({ code: 'while(true){}', timeoutMs: 10 });
    const worker = sandboxState.instances[0]!;

    vi.advanceTimersByTime(2011);
    await expect(task).resolves.toMatchObject({
      ok: false,
      timedOut: true,
      error: expect.stringContaining('timed out'),
    });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('returns unexpected exit when worker exits before response', async () => {
    const sandbox = new ExecutionSandbox();
    const task = sandbox.execute({ code: 'process.exit(1)' });
    const worker = sandboxState.instances[0]!;

    worker.emit('exit', 1);
    await expect(task).resolves.toMatchObject({
      ok: false,
      timedOut: false,
      error: expect.stringContaining('code 1'),
    });
  });

  it('embeds restricted globals and vm isolation in worker script', async () => {
    const sandbox = new ExecutionSandbox();
    const task = sandbox.execute({ code: '2 + 2' });
    const worker = sandboxState.instances[0]!;

    expect(worker.script).toContain('vm.createContext');
    expect(worker.script).toContain('Explicitly denied');
    expect(worker.script).toContain('require');
    expect(worker.script).toContain('codeGeneration');

    worker.emit('message', { ok: true, output: 4 });
    await expect(task).resolves.toMatchObject({ ok: true, output: 4 });
  });
});

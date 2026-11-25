import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  buildWorkerSpawnArgs,
  createCrashGuard,
  parseWorkerInboundFrame,
  parseWorkerOutboundFrame,
  runSubprocessWorker,
  SubprocessWorker,
  SubprocessWorkerError,
  type SubprocessWorkerNotification,
  type SubprocessWorkerOutboundMessage,
} from '@utils/subprocess-worker';

// ============================================================
// Fixture — a real .mjs worker entry implementing the JSONL
// protocol by hand (spawns via node; no TS loader needed).
// ============================================================

const FIXTURE_WORKER_SOURCE = `
import { writeSync } from 'node:fs';

const pending = new Map();
let uncaughtTimes = [];
const UNCAUGHT_LIMIT = Number(process.env['FIXTURE_UNCAUGHT_LIMIT'] || 25);
const UNCAUGHT_WINDOW_MS = 60_000;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n');
}

process.on('uncaughtException', (error) => {
  send({ type: 'log', level: 'error', message: 'uncaughtException: ' + String(error && error.message) });
  const now = Date.now();
  uncaughtTimes.push(now);
  uncaughtTimes = uncaughtTimes.filter((t) => now - t < UNCAUGHT_WINDOW_MS);
  if (uncaughtTimes.length > UNCAUGHT_LIMIT) {
    // Last-gasp diagnostics on stderr (synchronous fd write): the parent
    // folds the stderr tail into the normalized child-exit error, so the
    // cause survives even when the final stdout frame loses the race against
    // the exit event on Windows pipes.
    try {
      writeSync(2, 'fixture flooded with uncaught exceptions\\n');
    } catch {
      // stderr unavailable
    }
    // Flush the final error frame before exiting — process.exit() races the
    // pipe buffer on Windows and would lose the message.
    process.stdout.write(
      JSON.stringify({ type: 'error', message: 'fixture flooded with uncaught exceptions' }) + '\\n',
      () => process.exit(1),
    );
    setTimeout(() => process.exit(1), 1000).unref();
  }
});

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handleLine(line);
    index = buffer.indexOf('\\n');
  }
});

function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === 'abort') {
    const controller = pending.get(msg.id);
    if (controller) {
      send({ type: 'event', id: msg.id, data: 'abort-received' });
      controller.abort();
      pending.delete(msg.id);
    }
    return;
  }
  if (msg.type !== 'start') return;
  const options = msg.options || {};
  const controller = new AbortController();
  pending.set(msg.id, controller);
  const done = () => pending.delete(msg.id);

  switch (options.command) {
    case 'echo':
      send({ type: 'result', id: msg.id, result: { echo: options.value, pid: process.pid } });
      done();
      break;
    case 'noise':
      process.stdout.write('this line is not json\\n');
      send({ type: 'result', id: msg.id, result: { echo: options.value, pid: process.pid } });
      done();
      break;
    case 'fail':
      send({ type: 'error', id: msg.id, message: options.message || 'boom' });
      done();
      break;
    case 'never':
      controller.signal.addEventListener(
        'abort',
        () => {
          send({ type: 'error', id: msg.id, message: 'aborted' });
          done();
        },
        { once: true },
      );
      break;
    case 'exit':
      process.exit(options.code === undefined ? 7 : options.code);
      break;
    case 'uncaught':
      setTimeout(() => {
        throw new Error('scheduled-uncaught');
      }, 0);
      send({ type: 'result', id: msg.id, result: 'scheduled' });
      done();
      break;
    case 'uncaught-hang':
      // Schedule an uncaught throw but never answer: used to observe the
      // flood path through a still-pending parent request.
      setTimeout(() => {
        throw new Error('scheduled-uncaught');
      }, 0);
      break;
    default:
      send({ type: 'error', id: msg.id, message: 'unknown command' });
      done();
  }
}
`;

let fixtureDir = '';
let fixtureWorkerPath = '';

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'subprocess-worker-test-'));
  fixtureWorkerPath = join(fixtureDir, 'fixture-worker.mjs');
  await writeFile(fixtureWorkerPath, FIXTURE_WORKER_SOURCE, 'utf8');
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

const workers: SubprocessWorker[] = [];

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.dispose().catch(() => undefined)));
});

function createFixtureWorker(tolerance?: { uncaughtLimit?: number }): SubprocessWorker {
  const worker = new SubprocessWorker({
    name: 'fixture',
    workerPath: fixtureWorkerPath,
    env:
      tolerance?.uncaughtLimit !== undefined
        ? { ...process.env, FIXTURE_UNCAUGHT_LIMIT: String(tolerance.uncaughtLimit) }
        : undefined,
  });
  workers.push(worker);
  return worker;
}

/** Wait until a worker notification matches; event-driven (no sleeps). */
function nextNotification(
  worker: SubprocessWorker,
  predicate: (notification: SubprocessWorkerNotification) => boolean,
): Promise<SubprocessWorkerNotification> {
  return new Promise((resolve) => {
    const unsubscribe = worker.onNotification((notification) => {
      if (predicate(notification)) {
        unsubscribe();
        resolve(notification);
      }
    });
  });
}

// ============================================================
// Frame parse guards
// ============================================================

describe('parseWorkerOutboundFrame', () => {
  it('accepts well-formed protocol frames', () => {
    expect(parseWorkerOutboundFrame('{"type":"log","level":"warn","message":"m"}')).toEqual({
      type: 'log',
      level: 'warn',
      message: 'm',
    });
    expect(parseWorkerOutboundFrame('{"type":"event","data":{"a":1}}')).toEqual({
      type: 'event',
      id: undefined,
      data: { a: 1 },
    });
    expect(parseWorkerOutboundFrame('{"type":"event","id":3,"data":null}')).toEqual({
      type: 'event',
      id: 3,
      data: null,
    });
    expect(parseWorkerOutboundFrame('{"type":"result","id":1,"result":{"x":2}}')).toEqual({
      type: 'result',
      id: 1,
      result: { x: 2 },
    });
    expect(parseWorkerOutboundFrame('{"type":"error","id":1,"message":"bad"}')).toEqual({
      type: 'error',
      id: 1,
      message: 'bad',
    });
    expect(parseWorkerOutboundFrame('{"type":"error","message":"global"}')).toEqual({
      type: 'error',
      id: undefined,
      message: 'global',
    });
  });

  it('rejects malformed lines instead of throwing', () => {
    expect(parseWorkerOutboundFrame('not json at all')).toBeNull();
    expect(parseWorkerOutboundFrame('{"type":"unknown"}')).toBeNull();
    expect(parseWorkerOutboundFrame('{"type":"log","level":"nope","message":"m"}')).toBeNull();
    expect(parseWorkerOutboundFrame('{"type":"result","result":{}}')).toBeNull();
    expect(parseWorkerOutboundFrame('{"type":"error"}')).toBeNull();
    expect(parseWorkerOutboundFrame('null')).toBeNull();
    expect(parseWorkerOutboundFrame('"string"')).toBeNull();
  });
});

describe('parseWorkerInboundFrame', () => {
  it('accepts start and abort frames', () => {
    expect(parseWorkerInboundFrame('{"type":"start","id":1,"options":{"a":1}}')).toEqual({
      type: 'start',
      id: 1,
      options: { a: 1 },
    });
    expect(parseWorkerInboundFrame('{"type":"abort","id":2}')).toEqual({ type: 'abort', id: 2 });
  });

  it('rejects malformed lines', () => {
    expect(parseWorkerInboundFrame('garbage')).toBeNull();
    expect(parseWorkerInboundFrame('{"type":"start"}')).toBeNull();
    expect(parseWorkerInboundFrame('{"type":"abort"}')).toBeNull();
  });
});

// ============================================================
// Crash guard (pure, injectable clock)
// ============================================================

describe('createCrashGuard', () => {
  it('tolerates up to the limit inside the window', () => {
    const clock = 1_000;
    const floods: number[] = [];
    const guard = createCrashGuard({
      uncaughtLimit: 3,
      uncaughtWindowMs: 10_000,
      now: () => clock,
      onFlood: (count) => floods.push(count),
    });
    guard.record();
    guard.record();
    guard.record();
    expect(guard.size()).toBe(3);
    expect(floods).toEqual([]);
  });

  it('fires the flood callback past the limit', () => {
    const clock = 1_000;
    const floods: number[] = [];
    const guard = createCrashGuard({
      uncaughtLimit: 3,
      uncaughtWindowMs: 10_000,
      now: () => clock,
      onFlood: (count) => floods.push(count),
    });
    guard.record();
    guard.record();
    guard.record();
    guard.record(); // 4th within the window → flood
    expect(floods).toEqual([4]);
    guard.record();
    expect(floods).toEqual([4, 5]);
  });

  it('expires entries outside the sliding window', () => {
    let clock = 1_000;
    const floods: number[] = [];
    const guard = createCrashGuard({
      uncaughtLimit: 2,
      uncaughtWindowMs: 5_000,
      now: () => clock,
      onFlood: (count) => floods.push(count),
    });
    guard.record();
    guard.record();
    clock += 6_000; // both entries expired
    guard.record();
    expect(guard.size()).toBe(1);
    expect(floods).toEqual([]);
  });
});

// ============================================================
// Worker template via injected streams (runSubprocessWorker)
// ============================================================

interface Harness {
  writeFrame: (message: Record<string, unknown>) => void;
  waitFor: (
    predicate: (frame: SubprocessWorkerOutboundMessage) => boolean,
  ) => Promise<SubprocessWorkerOutboundMessage>;
  frames: SubprocessWorkerOutboundMessage[];
  closeInput: () => void;
}

function createWorkerHarness(
  handler: (options: Record<string, unknown>, context: { signal: AbortSignal }) => Promise<unknown>,
): Harness {
  const input = new PassThrough();
  const output = new PassThrough({ encoding: 'utf8' });
  const frames: SubprocessWorkerOutboundMessage[] = [];
  const waiters: Array<{
    predicate: (frame: SubprocessWorkerOutboundMessage) => boolean;
    resolve: (frame: SubprocessWorkerOutboundMessage) => void;
  }> = [];

  const consider = (frame: SubprocessWorkerOutboundMessage): void => {
    frames.push(frame);
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index];
      if (waiter && waiter.predicate(frame)) {
        waiters.splice(index, 1);
        waiter.resolve(frame);
      }
    }
  };

  const lines = createInterface({ input: output, terminal: false });
  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const frame = parseWorkerOutboundFrame(trimmed);
    if (frame) consider(frame);
  });

  runSubprocessWorker(handler, {
    input,
    output,
    installProcessGuards: false,
    captureConsole: false,
  });

  return {
    frames,
    writeFrame: (message) => {
      input.write(`${JSON.stringify(message)}\n`);
    },
    waitFor: (predicate) =>
      new Promise((resolve) => {
        const existing = frames.find(predicate);
        if (existing) {
          resolve(existing);
          return;
        }
        waiters.push({ predicate, resolve });
      }),
    closeInput: () => {
      input.end();
    },
  };
}

describe('runSubprocessWorker (injected streams)', () => {
  it('resolves a request with a result frame correlated by id', async () => {
    const harness = createWorkerHarness(async (options) => ({ echoed: options['value'] }));
    harness.writeFrame({ type: 'start', id: 1, options: { value: 42 } });
    const frame = await harness.waitFor((candidate) => candidate.type === 'result');
    expect(frame).toEqual({ type: 'result', id: 1, result: { echoed: 42 } });
    harness.closeInput();
  });

  it('reports handler failures as error frames and keeps serving', async () => {
    let calls = 0;
    const harness = createWorkerHarness(async (options) => {
      calls += 1;
      if (options['fail'] === true) throw new Error('handler exploded');
      return 'ok';
    });
    harness.writeFrame({ type: 'start', id: 1, options: { fail: true } });
    const errorFrame = await harness.waitFor((candidate) => candidate.type === 'error');
    expect(errorFrame).toMatchObject({ type: 'error', id: 1 });
    harness.writeFrame({ type: 'start', id: 2, options: {} });
    const resultFrame = await harness.waitFor((candidate) => candidate.type === 'result');
    expect(resultFrame).toMatchObject({ type: 'result', id: 2, result: 'ok' });
    expect(calls).toBe(2);
    harness.closeInput();
  });

  it('aborts the per-request controller on an abort frame', async () => {
    const harness = createWorkerHarness(
      (options, context) =>
        new Promise((_resolve, reject) => {
          // Standard AbortSignal usage: check state first, then subscribe —
          // the abort frame can race the handler's first microtask.
          if (context.signal.aborted) {
            reject(new Error('handler aborted'));
            return;
          }
          context.signal.addEventListener('abort', () => reject(new Error('handler aborted')), {
            once: true,
          });
          void options;
        }),
    );
    harness.writeFrame({ type: 'start', id: 5, options: {} });
    harness.writeFrame({ type: 'abort', id: 5 });
    const errorFrame = await harness.waitFor((candidate) => candidate.type === 'error');
    expect(errorFrame).toMatchObject({ type: 'error', id: 5 });
    expect((errorFrame as { message: string }).message).toContain('handler aborted');
    harness.closeInput();
  });

  it('ignores duplicate start frames for an in-flight id', async () => {
    let calls = 0;
    const harness = createWorkerHarness(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'done';
    });
    harness.writeFrame({ type: 'start', id: 9, options: {} });
    harness.writeFrame({ type: 'start', id: 9, options: {} });
    await harness.waitFor((candidate) => candidate.type === 'result');
    // Let any duplicate handler run surface a second result frame.
    await harness.waitFor((candidate) => candidate.type === 'result');
    expect(calls).toBe(1);
    expect(harness.frames).toHaveLength(1);
    harness.closeInput();
  });
});

// ============================================================
// Parent side — SubprocessWorker against the real fixture child
// ============================================================

describe('SubprocessWorker', () => {
  it('correlates concurrent requests to their own results', async () => {
    const worker = createFixtureWorker();
    const [first, second] = await Promise.all([
      worker.request<{ command: string; value: string }, { echo: string }>({
        command: 'echo',
        value: 'one',
      }),
      worker.request<{ command: string; value: string }, { echo: string }>({
        command: 'echo',
        value: 'two',
      }),
    ]);
    expect(first.echo).toBe('one');
    expect(second.echo).toBe('two');
  });
  it('tolerates unparseable noise on the protocol channel', async () => {
    const worker = createFixtureWorker();
    const result = await worker.request<{ command: string; value: string }, { echo: string }>({
      command: 'noise',
      value: 'clean',
    });
    expect(result.echo).toBe('clean');
  });

  it('normalizes worker-reported request errors', async () => {
    const worker = createFixtureWorker();
    const error = await worker
      .request<{ command: string; message: string }, unknown>({
        command: 'fail',
        message: 'input rejected',
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SubprocessWorkerError);
    expect((error as SubprocessWorkerError).code).toBe('REQUEST_FAILED');
    expect((error as SubprocessWorkerError).message).toContain('input rejected');
  });

  it('rejects with TIMEOUT on deadline and keeps the worker usable', async () => {
    const worker = createFixtureWorker();
    const before = await worker.request<{ command: string }, { pid: number }>({ command: 'echo' });

    const abortReceived = nextNotification(
      worker,
      (notification) => notification.type === 'event' && notification.data === 'abort-received',
    );
    await expect(
      worker.request<{ command: string }, unknown>({ command: 'never' }, { timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    // The worker template received the abort frame for the dead request.
    await abortReceived;

    const after = await worker.request<
      { command: string; value: string },
      { echo: string; pid: number }
    >({
      command: 'echo',
      value: 'after-timeout',
    });
    expect(after.echo).toBe('after-timeout');
    // Same worker process — a timeout aborts the request, not the channel.
    expect(after.pid).toBe(before.pid);
  });

  it('rejects with ABORTED through the request AbortSignal', async () => {
    const worker = createFixtureWorker();
    const controller = new AbortController();
    const abortReceived = nextNotification(
      worker,
      (notification) => notification.type === 'event' && notification.data === 'abort-received',
    );
    const pending = worker.request<{ command: string }, unknown>(
      { command: 'never' },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await abortReceived;

    const result = await worker.request<{ command: string; value: string }, { echo: string }>({
      command: 'echo',
      value: 'after-abort',
    });
    expect(result.echo).toBe('after-abort');
  });

  it('normalizes child death and respawns a fresh process', async () => {
    const worker = createFixtureWorker();
    const before = await worker.request<{ command: string }, { pid: number }>({ command: 'echo' });

    await expect(
      worker.request<{ command: string; code?: number }, unknown>({ command: 'exit', code: 7 }),
    ).rejects.toMatchObject({ code: 'CHILD_EXITED', exitCode: 7 });

    // A fresh child is spawned transparently for the next request.
    const after = await worker.request<
      { command: string; value: string },
      { echo: string; pid: number }
    >({
      command: 'echo',
      value: 'after-crash',
    });
    expect(after.echo).toBe('after-crash');
    expect(after.pid).not.toBe(before.pid);
  });

  it('survives uncaught exceptions inside the tolerance window', async () => {
    const worker = createFixtureWorker({ uncaughtLimit: 3 });
    const first = await worker.request<{ command: string }, { pid: number }>({ command: 'echo' });

    // 3 uncaughts = exactly the limit → tolerated. Each uncaught produces a
    // log frame from the fixture's crash guard; the request itself resolves
    // before the async throw, so the log is the acknowledgment.
    for (let round = 0; round < 3; round++) {
      const logged = nextNotification(worker, (notification) => notification.type === 'log');
      const result = await worker.request<{ command: string }, string>({ command: 'uncaught' });
      expect(result).toBe('scheduled');
      await logged;
    }

    const result = await worker.request<
      { command: string; value: string },
      { echo: string; pid: number }
    >({
      command: 'echo',
      value: 'still-alive',
    });
    expect(result.echo).toBe('still-alive');
    // Same worker process — no tolerance-flood exit, no respawn.
    expect(result.pid).toBe(first.pid);
  });

  it('exits after flooding the tolerance window, then respawns', async () => {
    const worker = createFixtureWorker({ uncaughtLimit: 2 });
    const before = await worker.request<{ command: string }, { pid: number }>({ command: 'echo' });

    // 1st + 2nd uncaught tolerated (2 ≤ limit 2).
    for (let round = 0; round < 2; round++) {
      const logged = nextNotification(worker, (notification) => notification.type === 'log');
      await worker.request<{ command: string }, string>({ command: 'uncaught' });
      await logged;
    }

    // 3rd uncaught exceeds the limit → worker-global error frame while a
    // request is still pending → the pending request settles with
    // CHILD_EXITED and carries the flood message.
    const pending = worker
      .request<{ command: string }, unknown>({ command: 'uncaught-hang' })
      .catch((caught: unknown) => caught);
    const settled = (await pending) as SubprocessWorkerError;
    expect(settled).toBeInstanceOf(SubprocessWorkerError);
    expect(settled.code).toBe('CHILD_EXITED');
    expect(settled.message).toContain('flooded');

    // The next request transparently respawns a fresh worker process.
    const after = await worker.request<
      { command: string; value: string },
      { echo: string; pid: number }
    >({
      command: 'echo',
      value: 'after-flood',
    });
    expect(after.echo).toBe('after-flood');
    expect(after.pid).not.toBe(before.pid);
  });

  it('rejects pending and future requests after dispose()', async () => {
    const worker = createFixtureWorker();
    const pending = worker.request<{ command: string }, unknown>({ command: 'never' });
    // Attach the rejection expectation BEFORE disposing so the rejection is
    // observed in the same tick it happens.
    const settled = expect(pending).rejects.toMatchObject({ code: 'DISPOSED' });
    await worker.dispose();
    await settled;
    await expect(worker.request({ command: 'echo' })).rejects.toMatchObject({ code: 'DISPOSED' });
    // Idempotent.
    await expect(worker.dispose()).resolves.toBeUndefined();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const worker = createFixtureWorker();
    const controller = new AbortController();
    controller.abort();
    await expect(
      worker.request({ command: 'echo' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('rejects a non-serializable payload instead of pending until the timeout', async () => {
    const worker = createFixtureWorker();
    const circular: Record<string, unknown> = { command: 'echo' };
    circular.self = circular;

    const error = await worker
      .request(circular, { timeoutMs: 2_000 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SubprocessWorkerError);
    expect((error as SubprocessWorkerError).code).toBe('CHILD_EXITED');
    expect((error as SubprocessWorkerError).message).toMatch(/failed to write request/);

    // Serialization failure is a caller bug, not a broken pipe: the worker is
    // still usable for the next request.
    const result = await worker.request<{ command: string; value: string }, { echo: string }>({
      command: 'echo',
      value: 'after-serialization-failure',
    });
    expect(result.echo).toBe('after-serialization-failure');
  });
});

// ============================================================
// Spawn-arg construction
// ============================================================

describe('buildWorkerSpawnArgs', () => {
  it('places tolerance flags after the worker path (script arguments)', () => {
    const args = buildWorkerSpawnArgs('/tmp/worker.mjs', [], {
      uncaughtLimit: 25,
      uncaughtWindowMs: 15_000,
    });
    const pathIndex = args.indexOf('/tmp/worker.mjs');
    expect(pathIndex).toBeGreaterThanOrEqual(0);
    expect(args.indexOf('--subprocess-worker-uncaught-limit=25')).toBeGreaterThan(pathIndex);
    expect(args.indexOf('--subprocess-worker-uncaught-window-ms=15000')).toBeGreaterThan(pathIndex);
  });

  it('injects the tsx loader for .ts entries and forwards execArgv', () => {
    const args = buildWorkerSpawnArgs('/src/unidbg-worker.ts', ['--frozen-intrinsics'], {
      uncaughtLimit: 5,
    });
    expect(args.indexOf('--import')).toBeGreaterThanOrEqual(0);
    expect(args[args.indexOf('--import') + 1]).toBe('tsx');
    expect(args).toContain('--frozen-intrinsics');
    expect(args).toContain('/src/unidbg-worker.ts');
    expect(args).toContain('--subprocess-worker-uncaught-limit=5');
  });

  it('strips inspector flags from forwarded execArgv', async () => {
    const originalExecArgv = process.execArgv;
    process.execArgv = ['--inspect-brk', '--experimental-import-meta-resolve'];
    try {
      const args = buildWorkerSpawnArgs('/tmp/worker.mjs', []);
      expect(args).not.toContain('--inspect-brk');
      expect(args).toContain('--experimental-import-meta-resolve');
    } finally {
      process.execArgv = originalExecArgv;
    }
  });

  it('does not add a TS loader for compiled .mjs entries', () => {
    const args = buildWorkerSpawnArgs('/dist/worker.mjs', []);
    expect(args).not.toContain('--import');
  });
});

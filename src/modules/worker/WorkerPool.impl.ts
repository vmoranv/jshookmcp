import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import type {
  LegacyWorkerFailureMessage,
  LegacyWorkerSuccessMessage,
  TaskMessage,
  WorkerErrorMessage,
  WorkerResultMessage,
  WorkerTask,
} from './types.js';

const DEFAULT_INLINE_WORKER = `
const { parentPort } = require('node:worker_threads');

function isObject(value) {
  return value !== null && typeof value === 'object';
}

parentPort.on('message', (message) => {
  if (!isObject(message)) {
    return;
  }

  const id = typeof message.id === 'string' ? message.id : '';
  const type = typeof message.type === 'string' ? message.type : 'task';
  const payload = Object.prototype.hasOwnProperty.call(message, 'payload')
    ? message.payload
    : undefined;

  if (!id) {
    return;
  }

  if (type === 'parse-snapshot') {
    parentPort.postMessage({ type: 'result', id, data: payload });
    return;
  }

  parentPort.postMessage({ type: 'result', id, data: payload });
});
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readUnknownProperty(value: Record<string, unknown>, key: string): unknown | undefined {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function isWorkerResultMessage(value: unknown): value is WorkerResultMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    readString(readUnknownProperty(value, 'type')) === 'result' &&
    typeof readString(readUnknownProperty(value, 'id')) === 'string'
  );
}

function isWorkerErrorMessage(value: unknown): value is WorkerErrorMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    readString(readUnknownProperty(value, 'type')) === 'error' &&
    typeof readString(readUnknownProperty(value, 'id')) === 'string' &&
    typeof readString(readUnknownProperty(value, 'error')) === 'string'
  );
}

function isLegacyWorkerSuccessMessage(value: unknown): value is LegacyWorkerSuccessMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof readString(readUnknownProperty(value, 'id')) === 'string' &&
    readBoolean(readUnknownProperty(value, 'success')) === true
  );
}

function isLegacyWorkerFailureMessage(value: unknown): value is LegacyWorkerFailureMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof readString(readUnknownProperty(value, 'id')) === 'string' &&
    readBoolean(readUnknownProperty(value, 'success')) === false &&
    typeof readString(readUnknownProperty(value, 'error')) === 'string'
  );
}

interface PendingTaskController<T = unknown> {
  readonly task: WorkerTask;
  readonly timeoutMs: number;
  readonly queuedAt: number;
  startedAt?: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  deliver(value: T): void;
  fail(error: Error): void;
}

interface WorkerState {
  readonly id: number;
  busy: boolean;
  currentTaskId?: string;
  healthy: boolean;
}

export interface WorkerPoolImplOptions {
  maxWorkers?: number;
  workerScript?: string;
  defaultTimeoutMs?: number;
  initialWorkers?: number;
  workerEval?: boolean;
}

export interface WorkerPoolStats {
  workerCount: number;
  activeTasks: number;
  queuedTasks: number;
  totalCompleted: number;
  totalFailed: number;
}

export class WorkerPoolImpl {
  readonly maxWorkers: number;
  readonly idleWorkers: Worker[] = [];
  readonly pendingTasks = new Map<string, PendingTaskController>();

  private readonly workerScript: string;
  private readonly defaultTimeoutMs: number;
  private readonly workerEval: boolean;
  private readonly workerStates = new Map<Worker, WorkerState>();
  private readonly dispatchQueue: string[] = [];

  private nextWorkerId = 1;
  private shuttingDown = false;
  private terminated = false;
  private totalCompleted = 0;
  private totalFailed = 0;

  constructor(options: WorkerPoolImplOptions = {}) {
    this.maxWorkers = typeof options.maxWorkers === 'number' ? options.maxWorkers : 4;
    this.workerScript = options.workerScript ?? DEFAULT_INLINE_WORKER;
    this.defaultTimeoutMs =
      typeof options.defaultTimeoutMs === 'number' ? options.defaultTimeoutMs : 30_000;
    this.workerEval = typeof options.workerEval === 'boolean' ? options.workerEval : true;

    const initialWorkers = typeof options.initialWorkers === 'number' ? options.initialWorkers : 0;
    for (let index = 0; index < initialWorkers && index < this.maxWorkers; index += 1) {
      this.createWorker();
    }
  }

  dispatch<T>(task: WorkerTask): Promise<T> {
    if (this.shuttingDown || this.terminated) {
      return Promise.reject(new Error('Worker pool is shutting down'));
    }
    if (!task.id) {
      return Promise.reject(new Error('Worker task requires an id'));
    }
    if (this.pendingTasks.has(task.id)) {
      return Promise.reject(new Error(`Worker task ${task.id} is already pending`));
    }

    const timeoutMs =
      typeof task.timeoutMs === 'number' && task.timeoutMs > 0
        ? task.timeoutMs
        : this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const controller: PendingTaskController<T> = {
        task,
        timeoutMs,
        queuedAt: Date.now(),
        deliver(value) {
          resolve(value);
        },
        fail(error) {
          reject(error);
        },
      };

      this.pendingTasks.set(task.id, controller);
      this.dispatchQueue.push(task.id);
      this.scheduleDispatch();
    });
  }

  async drain(): Promise<void> {
    while (this.pendingTasks.size > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }

  async terminate(): Promise<void> {
    this.shuttingDown = true;
    await this.drain();
    this.terminated = true;

    const workers = [...this.workerStates.keys()];
    this.idleWorkers.length = 0;
    await Promise.all(
      workers.map(async (worker) => {
        this.workerStates.delete(worker);
        worker.removeAllListeners();
        await worker.terminate();
      }),
    );
  }

  healthCheck(): 'healthy' | 'degraded' | 'unavailable' {
    if (this.terminated) {
      return 'unavailable';
    }
    if (this.shuttingDown) {
      return 'degraded';
    }
    if (this.workerStates.size === 0 && this.pendingTasks.size > 0) {
      return 'degraded';
    }
    const unhealthyWorkers = [...this.workerStates.values()].filter((state) => !state.healthy);
    if (unhealthyWorkers.length > 0) {
      return 'degraded';
    }
    return 'healthy';
  }

  getStats(): WorkerPoolStats {
    let activeTasks = 0;
    for (const state of this.workerStates.values()) {
      if (state.busy) {
        activeTasks += 1;
      }
    }

    return {
      workerCount: this.workerStates.size,
      activeTasks,
      queuedTasks: this.dispatchQueue.length,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
    };
  }

  protected rejectAllPending(message: string): void {
    const taskIds = [...this.pendingTasks.keys()];
    for (const taskId of taskIds) {
      const controller = this.pendingTasks.get(taskId);
      if (!controller) {
        continue;
      }
      if (controller.timeoutHandle) {
        clearTimeout(controller.timeoutHandle);
      }
      this.pendingTasks.delete(taskId);
      controller.fail(new Error(message));
    }
    this.dispatchQueue.length = 0;
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerScript, { eval: this.workerEval });
    const state: WorkerState = {
      id: this.nextWorkerId,
      busy: false,
      healthy: true,
    };

    this.nextWorkerId += 1;
    this.workerStates.set(worker, state);
    this.idleWorkers.push(worker);

    worker.on('message', (message) => {
      this.handleWorkerMessage(worker, message);
    });
    worker.on('error', (error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.handleWorkerFailure(worker, normalizedError);
    });
    worker.on('exit', () => {
      this.removeWorker(worker);
    });

    return worker;
  }

  private scheduleDispatch(): void {
    while (this.dispatchQueue.length > 0) {
      const worker = this.acquireIdleWorker();
      if (!worker) {
        return;
      }

      const taskId = this.dispatchQueue.shift();
      if (!taskId) {
        this.releaseWorker(worker);
        return;
      }

      const controller = this.pendingTasks.get(taskId);
      if (!controller) {
        this.releaseWorker(worker);
        continue;
      }

      this.startTask(worker, controller);
    }
  }

  private acquireIdleWorker(): Worker | undefined {
    const idleWorker = this.idleWorkers.shift();
    if (idleWorker) {
      return idleWorker;
    }

    if (this.workerStates.size >= this.maxWorkers) {
      return undefined;
    }

    return this.createWorker();
  }

  private releaseWorker(worker: Worker): void {
    const state = this.workerStates.get(worker);
    if (!state) {
      return;
    }
    state.busy = false;
    state.currentTaskId = undefined;
    this.idleWorkers.push(worker);
  }

  private startTask(worker: Worker, controller: PendingTaskController): void {
    const state = this.workerStates.get(worker);
    if (!state) {
      controller.fail(new Error('Worker disappeared before task dispatch'));
      this.pendingTasks.delete(controller.task.id);
      return;
    }

    state.busy = true;
    state.currentTaskId = controller.task.id;
    controller.startedAt = Date.now();
    controller.timeoutHandle = setTimeout(() => {
      this.handleTaskTimeout(worker, controller.task.id);
    }, controller.timeoutMs);

    worker.postMessage({
      type: controller.task.type,
      id: controller.task.id,
      payload: controller.task.payload,
    });
  }

  private handleWorkerMessage(worker: Worker, message: unknown): void {
    if (isWorkerResultMessage(message)) {
      this.finishTask(worker, message.id, undefined, message.data);
      return;
    }

    if (isWorkerErrorMessage(message)) {
      this.finishTask(worker, message.id, new Error(message.error));
      return;
    }

    if (isLegacyWorkerSuccessMessage(message)) {
      this.finishTask(worker, message.id, undefined, message.data);
      return;
    }

    if (isLegacyWorkerFailureMessage(message)) {
      this.finishTask(worker, message.id, new Error(message.error));
    }
  }

  private handleWorkerFailure(worker: Worker, error: unknown): void {
    const state = this.workerStates.get(worker);
    if (!state) {
      return;
    }

    state.healthy = false;
    const currentTaskId = state.currentTaskId;
    const failure =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Worker failed');
    if (currentTaskId) {
      this.finishTask(worker, currentTaskId, failure);
    } else {
      this.removeWorker(worker);
    }
  }

  private handleTaskTimeout(worker: Worker, taskId: string): void {
    this.finishTask(worker, taskId, new Error(`Worker task ${taskId} timed out`));
  }

  private finishTask(worker: Worker, taskId: string, error?: Error, data?: unknown): void {
    const controller = this.pendingTasks.get(taskId);
    if (!controller) {
      this.releaseWorker(worker);
      this.scheduleDispatch();
      return;
    }

    if (controller.timeoutHandle) {
      clearTimeout(controller.timeoutHandle);
    }

    this.pendingTasks.delete(taskId);
    if (error) {
      this.totalFailed += 1;
      controller.fail(error);
    } else {
      this.totalCompleted += 1;
      controller.deliver(data);
    }

    this.releaseWorker(worker);
    this.scheduleDispatch();
  }

  private removeWorker(worker: Worker): void {
    const state = this.workerStates.get(worker);
    if (!state) {
      return;
    }

    const idleIndex = this.idleWorkers.indexOf(worker);
    if (idleIndex >= 0) {
      this.idleWorkers.splice(idleIndex, 1);
    }

    const currentTaskId = state.currentTaskId;
    this.workerStates.delete(worker);

    if (currentTaskId) {
      const controller = this.pendingTasks.get(currentTaskId);
      if (controller && controller.timeoutHandle) {
        clearTimeout(controller.timeoutHandle);
      }
      if (controller) {
        this.pendingTasks.delete(currentTaskId);
        this.totalFailed += 1;
        controller.fail(new Error(`Worker ${state.id} exited unexpectedly`));
      }
    }
  }
}

export interface WorkerPoolOptions {
  poolSize?: number;
  maxQueueSize?: number;
  defaultTimeout?: number;
  healthCheckInterval?: number;
}

export class WorkerPool extends WorkerPoolImpl {
  private readonly maxQueueSize: number;
  private wrapperShuttingDown = false;
  private readonly healthCheckTimer?: ReturnType<typeof setInterval>;

  constructor(
    options: WorkerPoolOptions = {},
    resolveWorkerScript: () => string = () => DEFAULT_INLINE_WORKER,
  ) {
    const cpuCount = cpus().length;
    const poolSize =
      typeof options.poolSize === 'number' ? options.poolSize : Math.max(2, cpuCount - 1);

    if (!Number.isInteger(poolSize) || poolSize < 1) {
      throw new Error('poolSize must be a positive integer');
    }

    const maxQueueSize = typeof options.maxQueueSize === 'number' ? options.maxQueueSize : 1000;
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 0) {
      throw new Error('maxQueueSize must be a non-negative integer');
    }

    const workerScript = resolveWorkerScript();
    const workerEval = workerScript === DEFAULT_INLINE_WORKER;
    super({
      maxWorkers: poolSize,
      workerScript,
      workerEval,
      defaultTimeoutMs: options.defaultTimeout,
      initialWorkers: poolSize,
    });

    this.maxQueueSize = maxQueueSize;

    const interval =
      typeof options.healthCheckInterval === 'number' ? options.healthCheckInterval : 0;
    if (interval > 0) {
      this.healthCheckTimer = setInterval(() => {
        this.healthCheck();
      }, interval);
    }
  }

  submit(task: TaskMessage): Promise<unknown> {
    if (this.wrapperShuttingDown) {
      return Promise.reject(new Error('Worker pool is shutting down'));
    }

    const stats = this.getStats();
    const inflightCount = stats.activeTasks + stats.queuedTasks;
    if (inflightCount >= this.maxQueueSize) {
      return Promise.reject(new Error('Queue full'));
    }

    return this.dispatch({
      ...task,
      timeoutMs: typeof task.timeoutMs === 'number' ? task.timeoutMs : undefined,
    });
  }

  async shutdown(timeoutMs = 1_000): Promise<void> {
    this.wrapperShuttingDown = true;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    await Promise.race([
      this.drain(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);

    this.rejectAllPending(`Worker pool shutdown timed out after ${timeoutMs}ms`);
    await this.terminate();
  }
}

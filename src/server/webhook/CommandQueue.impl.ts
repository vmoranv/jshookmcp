import { EventEmitter } from 'node:events';
import {
  WEBHOOK_PROCESS_TIMEOUT_MS,
  WEBHOOK_QUEUE_MAX_RETRIES,
  WEBHOOK_QUEUE_MAX_SIZE,
  WEBHOOK_QUEUE_RETRY_DELAY_MS,
} from '@src/constants';

export type WebhookCommandStoredStatus = 'pending' | 'processing' | 'processed' | 'failed';
export type WebhookCommandStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** ID prefix for queued commands (also parsed back in importState). */
const COMMAND_ID_PREFIX = 'cmd-';

export interface WebhookCommandInput {
  endpointId?: string;
  event?: string;
  payload: unknown;
}

export interface WebhookCommand {
  id: string;
  endpointId?: string;
  event?: string;
  payload: unknown;
  status: WebhookCommandStoredStatus;
  retries: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface CommandQueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  processTimeout?: number;
  maxQueueSize?: number;
}

function cloneCommand(command: WebhookCommand): WebhookCommand {
  return {
    ...command,
  };
}

function normalizeTimestamp(): string {
  return new Date().toISOString();
}

export class CommandQueueImpl extends EventEmitter {
  readonly maxQueueSize: number;

  protected readonly commands = new Map<string, WebhookCommand>();
  protected readonly order: string[] = [];
  protected readonly maxRetries: number;
  protected readonly retryDelay: number;
  protected readonly processTimeout: number;

  protected nextId = 1;

  constructor(options: CommandQueueOptions = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize ?? WEBHOOK_QUEUE_MAX_SIZE;
    this.maxRetries = options.maxRetries ?? WEBHOOK_QUEUE_MAX_RETRIES;
    this.retryDelay = options.retryDelay ?? WEBHOOK_QUEUE_RETRY_DELAY_MS;
    this.processTimeout = options.processTimeout ?? WEBHOOK_PROCESS_TIMEOUT_MS;
  }

  enqueue(command: WebhookCommandInput): string {
    // `order` retains processed/failed commands for history and export, so it
    // must not be the capacity signal: it only ever grows, which would
    // eventually reject every enqueue for the lifetime of the process.
    if (this.countInFlightCommands() >= this.maxQueueSize) {
      throw new Error(`Command queue is full (${this.maxQueueSize})`);
    }

    const id = `${COMMAND_ID_PREFIX}${this.nextId}`;
    this.nextId += 1;

    const createdAt = normalizeTimestamp();
    const entry: WebhookCommand = {
      id,
      endpointId: command.endpointId,
      event: command.event,
      payload: command.payload,
      status: 'pending',
      retries: 0,
      createdAt,
      updatedAt: createdAt,
    };

    this.commands.set(id, entry);
    this.order.push(id);
    this.emit('enqueued', cloneCommand(entry));
    return id;
  }

  dequeue(): WebhookCommand | undefined;
  dequeue(filter: {
    status?: WebhookCommandStoredStatus | 'completed';
    endpointId?: string;
  }): WebhookCommand[];
  dequeue(filter?: {
    status?: WebhookCommandStoredStatus | 'completed';
    endpointId?: string;
  }): WebhookCommand | WebhookCommand[] | undefined {
    if (!filter) {
      const firstPending = this.getCommandsByFilter({ status: 'pending' })[0];
      return firstPending ? cloneCommand(firstPending) : undefined;
    }

    return this.getCommandsByFilter(filter).map(cloneCommand);
  }

  getStatus(id: string): WebhookCommandStatus {
    const command = this.commands.get(id);
    if (!command) {
      return 'failed';
    }
    if (command.status === 'processed') {
      return 'completed';
    }
    return command.status;
  }

  retry(id: string): void {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Command ${id} not found`);
    }
    if (command.status !== 'failed') {
      throw new Error(`Command ${id} is not in failed state`);
    }

    command.status = 'pending';
    command.retries = 0;
    command.lastError = undefined;
    command.updatedAt = normalizeTimestamp();
  }

  protected getCommand(id: string): WebhookCommand | undefined {
    return this.commands.get(id);
  }

  /** Commands that still need work; terminal entries are retained for history. */
  private countInFlightCommands(): number {
    let count = 0;
    for (const command of this.commands.values()) {
      if (command.status === 'pending' || command.status === 'processing') {
        count += 1;
      }
    }
    return count;
  }

  protected getCommandsByFilter(filter: {
    status?: WebhookCommandStoredStatus | 'completed';
    endpointId?: string;
  }): WebhookCommand[] {
    const normalizedStatus = filter.status === 'completed' ? 'processed' : filter.status;

    const results: WebhookCommand[] = [];
    for (const id of this.order) {
      const command = this.commands.get(id);
      if (!command) {
        continue;
      }
      if (normalizedStatus && command.status !== normalizedStatus) {
        continue;
      }
      if (filter.endpointId && command.endpointId !== filter.endpointId) {
        continue;
      }
      results.push(command);
    }
    return results;
  }

  protected updateStatus(
    id: string,
    status: WebhookCommandStoredStatus,
    lastError?: string,
  ): WebhookCommand {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Command ${id} not found`);
    }

    command.status = status;
    command.updatedAt = normalizeTimestamp();
    command.lastError = lastError;
    return command;
  }
}

export class CommandQueue extends CommandQueueImpl {
  async process(
    id: string,
    handler: (command: WebhookCommand) => Promise<void> | void,
  ): Promise<void> {
    const command = this.getCommand(id);
    if (!command) {
      throw new Error(`Command ${id} not found`);
    }
    if (command.status === 'processed') {
      throw new Error(`Command ${id} already processed`);
    }
    if (command.status === 'failed') {
      throw new Error(`Command ${id} already processed with failure`);
    }
    if (command.status === 'processing') {
      throw new Error(`Command ${id} is already processing`);
    }

    this.updateStatus(id, 'processing');

    let finalStatus: WebhookCommandStoredStatus = 'processed';
    let lastError: string | undefined;

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve(handler(cloneCommand(command))),
          new Promise<void>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error('Process timeout'));
            }, this.processTimeout);
          }),
        ]);
      } finally {
        // Without this the timeout timer keeps the event loop (and the
        // process) alive for `processTimeout` after every successful command.
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // Count EVERY failed attempt, including the terminal one: previously the
      // `failed` record kept the previous attempt's count, so the observed
      // retries did not match reality.
      command.retries += 1;
      if (command.retries >= this.maxRetries) {
        finalStatus = 'failed';
      } else {
        finalStatus = 'pending';
      }
    }

    if (finalStatus === 'processed') {
      const processed = this.updateStatus(id, 'processed');
      this.emit('processed', cloneCommand(processed));
    } else if (finalStatus === 'pending') {
      // Rate-limit: actually wait retryDelay before handing the command back
      // for another attempt — otherwise the next process() retries instantly.
      if (this.retryDelay > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.retryDelay);
        });
      }
      const retried = this.updateStatus(id, 'pending', lastError);
      this.emit('retried', cloneCommand(retried));
      throw lastError !== undefined ? new Error(lastError) : new Error('retry');
    } else {
      const failed = this.updateStatus(id, 'failed', lastError);
      this.emit('failed', cloneCommand(failed));
      throw lastError !== undefined ? new Error(lastError) : new Error('failed');
    }
  }

  override async retry(id: string): Promise<void> {
    super.retry(id);
  }

  exportState(): WebhookCommand[] {
    const results: WebhookCommand[] = [];
    for (const id of this.order) {
      const command = this.commands.get(id);
      if (command) {
        results.push(cloneCommand(command));
      }
    }
    return results;
  }

  importState(commands: WebhookCommand[]): void {
    this.commands.clear();
    this.order.length = 0;

    let maxId = 0;
    for (const command of commands) {
      const entry = cloneCommand(command);
      this.commands.set(entry.id, entry);
      this.order.push(entry.id);

      // Extract numeric portion from command ID (e.g. "cmd-42" → 42)
      const match = new RegExp(`^${COMMAND_ID_PREFIX}(\\d+)$`).exec(entry.id);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxId) {
          maxId = num;
        }
      }
    }

    // Advance nextId past the highest existing command number
    if (maxId > 0) {
      this.nextId = maxId + 1;
    }
  }
}

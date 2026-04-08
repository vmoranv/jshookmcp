import { EventEmitter } from 'node:events';

export type WebhookCommandStoredStatus = 'pending' | 'processing' | 'processed' | 'failed';
export type WebhookCommandStatus = 'pending' | 'processing' | 'completed' | 'failed';

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

  private nextId = 1;

  constructor(options: CommandQueueOptions = {}) {
    super();
    this.maxQueueSize = typeof options.maxQueueSize === 'number' ? options.maxQueueSize : 1000;
    this.maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;
    this.retryDelay = typeof options.retryDelay === 'number' ? options.retryDelay : 0;
    this.processTimeout =
      typeof options.processTimeout === 'number' ? options.processTimeout : 10_000;
  }

  enqueue(command: WebhookCommandInput): string {
    if (this.order.length >= this.maxQueueSize) {
      throw new Error(`Command queue is full (${this.maxQueueSize})`);
    }

    const id = `cmd-${this.nextId}`;
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

    try {
      await Promise.race([
        Promise.resolve(handler(cloneCommand(command))),
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Process timeout'));
          }, this.processTimeout);
        }),
      ]);

      const processed = this.updateStatus(id, 'processed');
      this.emit('processed', cloneCommand(processed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.retryDelay > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.retryDelay);
        });
      }

      if (command.retries < this.maxRetries) {
        command.retries += 1;
        const retried = this.updateStatus(id, 'pending', message);
        this.emit('retried', cloneCommand(retried));
      } else {
        const failed = this.updateStatus(id, 'failed', message);
        this.emit('failed', cloneCommand(failed));
      }

      throw error;
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
      const match = /^cmd-(\d+)$/.exec(entry.id);
      if (match) {
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

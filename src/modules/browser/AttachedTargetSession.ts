import { EventEmitter } from 'node:events';
import { logger } from '@utils/logger';
import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';

interface ParentSessionLike extends CDPSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class AttachedTargetSession implements CDPSessionLike {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<number, PendingCommand>();
  private nextCommandId = 1;
  private detached = false;

  constructor(
    private readonly parentSession: ParentSessionLike,
    private readonly sessionId: string,
  ) {
    this.parentSession.on('Target.receivedMessageFromTarget', this.handleReceivedMessage);
    this.parentSession.on('Target.detachedFromTarget', this.handleDetachedFromTarget);
  }

  id(): string {
    return this.sessionId;
  }

  on(event: string, listener: (payload: unknown) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener: (payload: unknown) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.detached) {
      throw new Error(`CDP target session ${this.sessionId} is detached`);
    }

    const commandId = this.nextCommandId++;
    const message = JSON.stringify({
      id: commandId,
      method,
      params,
    });

    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(commandId, { resolve, reject });

      this.parentSession
        .send('Target.sendMessageToTarget', {
          sessionId: this.sessionId,
          message,
        })
        .catch((error) => {
          this.pending.delete(commandId);
          reject(error);
        });
    });
  }

  async detach(): Promise<void> {
    if (this.detached) {
      return;
    }

    try {
      await this.parentSession.send('Target.detachFromTarget', {
        sessionId: this.sessionId,
      });
    } finally {
      this.dispose(new Error(`CDP target session ${this.sessionId} detached`));
    }
  }

  private readonly handleReceivedMessage = (payload: unknown): void => {
    if (!this.matchesSession(payload)) {
      return;
    }

    const rawMessage = this.readString(payload, 'message');
    if (!rawMessage) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMessage);
    } catch (error) {
      logger.debug(
        `[AttachedTargetSession] Failed to parse incoming target message for ${this.sessionId}: ${String(error)}`,
      );
      return;
    }

    if (!this.isRecord(parsed)) {
      return;
    }

    const commandId = typeof parsed.id === 'number' ? parsed.id : null;
    if (commandId !== null) {
      const pending = this.pending.get(commandId);
      if (!pending) {
        return;
      }
      this.pending.delete(commandId);
      if (parsed.error) {
        pending.reject(this.normalizeError(parsed.error));
      } else {
        pending.resolve(parsed.result ?? null);
      }
      return;
    }

    const method = typeof parsed.method === 'string' ? parsed.method : null;
    if (!method) {
      return;
    }

    this.emitter.emit(method, parsed.params ?? {});
  };

  private readonly handleDetachedFromTarget = (payload: unknown): void => {
    if (!this.matchesSession(payload)) {
      return;
    }
    this.dispose(new Error(`CDP target session ${this.sessionId} detached by browser`));
  };

  private matchesSession(payload: unknown): boolean {
    return this.readString(payload, 'sessionId') === this.sessionId;
  }

  private dispose(reason: Error): void {
    if (this.detached) {
      return;
    }
    this.detached = true;
    this.parentSession.off('Target.receivedMessageFromTarget', this.handleReceivedMessage);
    this.parentSession.off('Target.detachedFromTarget', this.handleDetachedFromTarget);
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
    this.emitter.emit('disconnected', {
      sessionId: this.sessionId,
      reason: reason.message,
    });
    this.emitter.removeAllListeners();
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (this.isRecord(error)) {
      const message =
        (typeof error.message === 'string' && error.message) ||
        (typeof error.data === 'string' && error.data) ||
        JSON.stringify(error);
      return new Error(message || 'CDP target command failed');
    }
    return new Error(String(error));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private readString(payload: unknown, key: string): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }
    const value = payload[key];
    return typeof value === 'string' ? value : null;
  }
}

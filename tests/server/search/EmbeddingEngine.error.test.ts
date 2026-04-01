import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerState = vi.hoisted(() => ({
  mode: 'result' as 'result' | 'message-error' | 'worker-error' | 'exit-error',
}));

vi.mock('worker_threads', () => {
  class MockWorker {
    private handlers = new Map<string, (...args: any[]) => void>();

    on(event: string, handler: (...args: any[]) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    postMessage(msg: { type: string; id: number; text?: string }): void {
      queueMicrotask(() => {
        const message = this.handlers.get('message');
        const error = this.handlers.get('error');
        const exit = this.handlers.get('exit');

        switch (workerState.mode) {
          case 'message-error':
            message?.({ type: 'error', id: msg.id, message: 'worker said no' });
            break;
          case 'worker-error':
            error?.(new Error('thread exploded'));
            break;
          case 'exit-error':
            exit?.(2);
            break;
          default:
            message?.({
              type: 'result',
              id: msg.id,
              embedding: new Float32Array([1, 2, 3]),
            });
            break;
        }
      });
    }

    async terminate(): Promise<void> {
      // no-op for the mock
    }
  }

  return { Worker: MockWorker };
});

describe('search/EmbeddingEngine error handling', () => {
  beforeEach(() => {
    workerState.mode = 'result';
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects pending requests when the worker posts an error message', async () => {
    workerState.mode = 'message-error';
    const { EmbeddingEngine } = await import('@server/search/EmbeddingEngine');
    const engine = new EmbeddingEngine();

    await expect(engine.embed('broken')).rejects.toThrow('worker said no');
    expect(engine.isReady()).toBe(false);
  });

  it('rejects pending requests when the worker emits an error event', async () => {
    workerState.mode = 'worker-error';
    const { EmbeddingEngine } = await import('@server/search/EmbeddingEngine');
    const engine = new EmbeddingEngine();

    await expect(engine.embed('broken')).rejects.toThrow('thread exploded');
    expect(engine.isReady()).toBe(false);
  });

  it('rejects pending requests when the worker exits with a non-zero code', async () => {
    workerState.mode = 'exit-error';
    const { EmbeddingEngine } = await import('@server/search/EmbeddingEngine');
    const engine = new EmbeddingEngine();

    await expect(engine.embed('broken')).rejects.toThrow('Embedding worker exited with code 2');
    expect(engine.isReady()).toBe(false);
  });
});

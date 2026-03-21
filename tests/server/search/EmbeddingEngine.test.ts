import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock worker_threads to avoid actually spawning worker threads in tests
vi.mock('worker_threads', () => {
  class MockWorker {
    private messageHandler: ((msg: unknown) => void) | null = null;

    on(event: string, handler: (...args: unknown[]) => void): this {
      if (event === 'message') this.messageHandler = handler;
      // 'error' handler intentionally not stored — no test simulates worker errors
      return this;
    }

    postMessage(msg: { type: string; id: number; text?: string; texts?: string[] }): void {
      // Simulate async embedding response
      setTimeout(() => {
        if (msg.type === 'embed') {
          const embedding = new Float32Array(384);
          // Fill with deterministic values based on text
          const hash = (msg.text ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
          for (let i = 0; i < 384; i++) {
            embedding[i] = Math.sin(hash + i) * 0.1;
          }
          this.messageHandler?.({
            type: 'result',
            id: msg.id,
            embedding,
          });
        } else if (msg.type === 'embed_batch') {
          const texts = msg.texts ?? [];
          const embeddings = texts.map((text) => {
            const emb = new Float32Array(384);
            const hash = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
            for (let i = 0; i < 384; i++) {
              emb[i] = Math.sin(hash + i) * 0.1;
            }
            return emb;
          });
          this.messageHandler?.({
            type: 'result',
            id: msg.id,
            embedding: embeddings,
          });
        }
      }, 5);
    }

    async terminate(): Promise<void> {
      // no-op in mock
    }
  }

  return {
    Worker: MockWorker,
  };
});

describe('search/EmbeddingEngine', () => {
  let EmbeddingEngine: typeof import('@server/search/EmbeddingEngine').EmbeddingEngine;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@server/search/EmbeddingEngine');
    EmbeddingEngine = mod.EmbeddingEngine;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('can be constructed', () => {
    const engine = new EmbeddingEngine();
    expect(engine).toBeDefined();
    expect(engine.isReady()).toBe(false);
  });

  it('embed() returns Float32Array of length 384', async () => {
    const engine = new EmbeddingEngine();

    const result = await engine.embed('test query');

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
  });

  it('isReady() returns true after first embed', async () => {
    const engine = new EmbeddingEngine();

    expect(engine.isReady()).toBe(false);
    await engine.embed('test');
    expect(engine.isReady()).toBe(true);
  });

  it('embedBatch() returns array of Float32Array', async () => {
    const engine = new EmbeddingEngine();

    const result = await engine.embedBatch(['text one', 'text two', 'text three']);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    for (const emb of result) {
      expect(emb).toBeInstanceOf(Float32Array);
      expect(emb.length).toBe(384);
    }
  });

  it('embedBatch() returns empty array for empty input', async () => {
    const engine = new EmbeddingEngine();

    const result = await engine.embedBatch([]);
    expect(result).toEqual([]);
  });

  it('terminate() gracefully shuts down', async () => {
    const engine = new EmbeddingEngine();

    // Start the worker
    await engine.embed('init');
    expect(engine.isReady()).toBe(true);

    // Terminate
    await engine.terminate();
    expect(engine.isReady()).toBe(false);
  });

  it('terminate() is safe to call without starting worker', async () => {
    const engine = new EmbeddingEngine();
    // Should not throw
    await engine.terminate();
    expect(engine.isReady()).toBe(false);
  });
});

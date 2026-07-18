/**
 * Tests for EmbeddingWorker.ts
 *
 * The EmbeddingWorker runs in a worker thread and uses @huggingface/transformers.
 * Tests mock the parentPort and pipeline to test the message handling and
 * normalisation logic without actually loading ML models.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock parentPort and transformers before importing the module
const mockParentPort = {
  on: vi.fn(),
  postMessage: vi.fn(),
};

vi.mock('node:worker_threads', () => ({
  parentPort: mockParentPort,
}));

const mockPipeline = vi.fn();
const mockTransformerEnv = { fetch: vi.fn() };
vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
  env: mockTransformerEnv,
}));

describe('EmbeddingWorker', () => {
  let messageHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransformerEnv.fetch = vi.fn();
    messageHandler = null;

    // Capture the message handler registered by the module
    mockParentPort.on.mockImplementation((event: string, handler: any) => {
      if (event === 'message') {
        messageHandler = handler;
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('aborts remote model fetches at the configured timeout', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SEARCH_VECTOR_FETCH_TIMEOUT_MS', '5');
    mockTransformerEnv.fetch = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')), {
            once: true,
          });
        }),
    );
    mockPipeline.mockImplementation(async () => {
      await mockTransformerEnv.fetch('model-fetch');
      return async () => ({ data: new Float32Array([1]) });
    });

    await loadWorker();
    const pending = messageHandler!({ type: 'embed', id: 99, text: 'timeout' });
    await vi.advanceTimersByTimeAsync(6);
    await pending;

    expect(mockParentPort.postMessage).toHaveBeenCalledWith({
      type: 'error',
      id: 99,
      message: 'fetch aborted',
    });
  });

  async function loadWorker() {
    // Import the module — this triggers registration of the message handler
    await import('@server/search/EmbeddingWorker');
    expect(mockParentPort.on).toHaveBeenCalledWith('message', expect.any(Function));
  }

  describe('embed message type', () => {
    it('processes embed message and returns normalized embedding', async () => {
      // Setup mock pipeline to return a fake embedding
      const fakeEmbedding = new Float32Array([1, 2, 3, 0]);
      mockPipeline.mockResolvedValue(async () => ({ data: fakeEmbedding }));

      await loadWorker();
      expect(messageHandler).not.toBeNull();

      await messageHandler!({ type: 'embed', id: 1, text: 'test query' });

      expect(mockPipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/bge-micro-v2', {
        quantized: true,
      });
      expect(mockParentPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          id: 1,
        }),
        expect.any(Array),
      );
    });

    it('handles pipeline errors gracefully', async () => {
      const errorPipeline = vi.fn().mockRejectedValue(new Error('Pipeline failed'));
      mockPipeline.mockResolvedValue(errorPipeline);

      await loadWorker();

      await messageHandler!({ type: 'embed', id: 2, text: 'will fail' });

      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        id: 2,
        message: 'Pipeline failed',
      });
    });

    it('handles non-Error throws', async () => {
      const errorPipeline = vi.fn().mockRejectedValue('string error');
      mockPipeline.mockResolvedValue(errorPipeline);

      await loadWorker();

      await messageHandler!({ type: 'embed', id: 3, text: 'will throw string' });

      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        id: 3,
        message: 'string error',
      });
    });
  });

  describe('embed_batch message type', () => {
    it('processes batch of texts via batched pipeline call and returns sliced embeddings', async () => {
      // Transformers.js returns a single flat Float32Array for a batched call:
      // data length = batchSize × dim, with dims describing the shape.
      const dim = 4;
      const flat = new Float32Array([
        1,
        0,
        0,
        0, // row 0
        0,
        1,
        0,
        0, // row 1
        0,
        0,
        1,
        0, // row 2
      ]);
      const embedderFn = vi.fn().mockResolvedValue({ data: flat, dims: [3, dim] });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();

      await messageHandler!({
        type: 'embed_batch',
        id: 4,
        texts: ['text1', 'text2', 'text3'],
      });

      // One batched forward pass, not one call per text.
      expect(embedderFn).toHaveBeenCalledTimes(1);
      expect(embedderFn).toHaveBeenCalledWith(['text1', 'text2', 'text3'], {
        pooling: 'mean',
        normalize: true,
      });
      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'result',
        id: 4,
        embedding: expect.any(Array),
      });

      // @ts-expect-error
      const resultArg = mockParentPort.postMessage.mock.calls[0][0];
      expect(resultArg.embedding).toHaveLength(3);
      for (const emb of resultArg.embedding as Float32Array[]) {
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(dim);
      }
      // Each row sliced in order, then L2-normalised.
      expect(Array.from(resultArg.embedding[0] as Float32Array)[0]).toBeCloseTo(1, 5);
      expect(Array.from(resultArg.embedding[1] as Float32Array)[1]).toBeCloseTo(1, 5);
      expect(Array.from(resultArg.embedding[2] as Float32Array)[2]).toBeCloseTo(1, 5);
    });

    it('handles empty batch', async () => {
      const embedderFn = vi.fn();
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();

      await messageHandler!({
        type: 'embed_batch',
        id: 5,
        texts: [],
      });

      expect(embedderFn).not.toHaveBeenCalled();
      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'result',
        id: 5,
        embedding: [],
      });
    });

    it('falls back to per-item inference when the batched call rejects, then errors if per-item also fails', async () => {
      const embedderFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('batch OOM')) // batched call fails
        .mockRejectedValueOnce(new Error('Batch item failed')); // per-item fallback fails
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();

      await messageHandler!({
        type: 'embed_batch',
        id: 6,
        texts: ['ok', 'fail'],
      });

      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        id: 6,
        message: 'Batch item failed',
      });
    });

    it('recovers via per-item fallback when the batched call rejects but per-item succeeds', async () => {
      const single = new Float32Array([1, 0, 0]);
      const embedderFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('batch shape mismatch')) // batch fails
        .mockResolvedValueOnce({ data: single }) // per-item 1
        .mockResolvedValueOnce({ data: single }); // per-item 2
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();

      await messageHandler!({
        type: 'embed_batch',
        id: 7,
        texts: ['a', 'b'],
      });

      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'result',
        id: 7,
        embedding: expect.any(Array),
      });
      // @ts-expect-error
      const resultArg = mockParentPort.postMessage.mock.calls[0][0];
      expect(resultArg.embedding).toHaveLength(2);
    });
  });

  describe('embed output pass-through', () => {
    // Normalisation is delegated to the pipeline (`normalize: true`); the
    // worker thread just copies the already-normalised Float32Array into a
    // transfer-owned buffer. These tests verify the raw pass-through works
    // for both a unit-length vector and a zero vector (edge case).
    it('passes through a pre-normalised embedding unchanged', async () => {
      const normalised = new Float32Array([0.6, 0.8, 0.0]); // ‖v‖ = 1
      const embedderFn = vi.fn().mockResolvedValue({ data: normalised });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();
      await messageHandler!({ type: 'embed', id: 7, text: 'test' });

      // @ts-expect-error
      const resultArg = mockParentPort.postMessage.mock.calls[0][0];
      const embedding = resultArg.embedding as Float32Array;

      expect(embedding.length).toBe(3);
      expect(Math.abs(embedding[0]! - 0.6)).toBeLessThan(0.001);
      expect(Math.abs(embedding[1]! - 0.8)).toBeLessThan(0.001);
    });

    it('handles zero vector without NaN', async () => {
      const zeroVector = new Float32Array([0, 0, 0]);
      const embedderFn = vi.fn().mockResolvedValue({ data: zeroVector });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();
      await messageHandler!({ type: 'embed', id: 8, text: 'zero' });

      // @ts-expect-error
      const resultArg = mockParentPort.postMessage.mock.calls[0][0];
      const embedding = resultArg.embedding as Float32Array;

      // Should remain zeros without NaN
      for (let i = 0; i < embedding.length; i++) {
        expect(Number.isNaN(embedding[i])).toBe(false);
      }
    });
  });

  describe('pipeline caching', () => {
    it('reuses embedder singleton across multiple calls', async () => {
      const embedderFn = vi.fn().mockResolvedValue({ data: new Float32Array([1]) });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();

      await messageHandler!({ type: 'embed', id: 10, text: 'first' });
      await messageHandler!({ type: 'embed', id: 11, text: 'second' });

      // pipeline() should only be called once
      expect(mockPipeline).toHaveBeenCalledTimes(1);
      expect(embedderFn).toHaveBeenCalledTimes(2);
    });
  });
});

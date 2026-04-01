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

vi.mock('worker_threads', () => ({
  parentPort: mockParentPort,
}));

const mockPipeline = vi.fn();
vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
}));

describe('EmbeddingWorker', () => {
  let messageHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;

    // Capture the message handler registered by the module
    mockParentPort.on.mockImplementation((event: string, handler: any) => {
      if (event === 'message') {
        messageHandler = handler;
      }
    });
  });

  afterEach(() => {
    vi.resetModules();
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
    it('processes batch of texts and returns array of embeddings', async () => {
      const fakeEmbedding = new Float32Array([1, 0, 0]);
      const embedderFn = vi.fn().mockResolvedValue({ data: fakeEmbedding });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();

      await messageHandler!({
        type: 'embed_batch',
        id: 4,
        texts: ['text1', 'text2', 'text3'],
      });

      expect(embedderFn).toHaveBeenCalledTimes(3);
      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'result',
        id: 4,
        embedding: expect.any(Array),
      });

      const resultArg = mockParentPort.postMessage.mock.calls[0][0];
      expect(resultArg.embedding).toHaveLength(3);
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

    it('handles batch errors gracefully', async () => {
      const embedderFn = vi
        .fn()
        .mockResolvedValueOnce({ data: new Float32Array([1, 0]) })
        .mockRejectedValueOnce(new Error('Batch item failed'));
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
  });

  describe('normalise function', () => {
    it('normalizes embedding to unit length', async () => {
      // The embedder returns [3, 4, 0] → normalized [0.6, 0.8, 0]
      const unnormalized = new Float32Array([3, 4, 0]);
      const embedderFn = vi.fn().mockResolvedValue({ data: unnormalized });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();
      await messageHandler!({ type: 'embed', id: 7, text: 'test' });

      const resultArg = mockParentPort.postMessage.mock.calls[0][0];
      const embedding = resultArg.embedding as Float32Array;

      // Verify it's normalized (unit length)
      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i]! * embedding[i]!;
      }
      expect(Math.abs(Math.sqrt(norm) - 1.0)).toBeLessThan(0.001);
    });

    it('handles zero vector without division by zero', async () => {
      const zeroVector = new Float32Array([0, 0, 0]);
      const embedderFn = vi.fn().mockResolvedValue({ data: zeroVector });
      mockPipeline.mockResolvedValue(embedderFn);

      await loadWorker();
      await messageHandler!({ type: 'embed', id: 8, text: 'zero' });

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

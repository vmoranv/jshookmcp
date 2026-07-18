/**
 * Worker thread script for embedding inference using Transformers.js.
 *
 * Runs the BGE-micro-v2 ONNX model in a separate thread to avoid blocking
 * the main event loop. Communicates with the host via `parentPort` messages.
 *
 * Message protocol:
 *   → { type: 'embed',       id: number, text: string }
 *   → { type: 'embed_batch', id: number, texts: string[] }
 *   ← { type: 'result',      id: number, embedding: Float32Array | Float32Array[] }
 *   ← { type: 'error',       id: number, message: string }
 */
import { parentPort } from 'worker_threads';

// ── Lazy model singleton ──

/** Pipeline function type — loosened to accept Transformers.js Tensor output. */
type EmbedderPipeline = (
  text: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: Float32Array | ArrayLike<number>; dims?: number[] }>;

let embedder: EmbedderPipeline | null = null;
let loadedModelId: string | null = null;
const DEFAULT_MODEL_ID = 'Xenova/bge-micro-v2';
const FETCH_TIMEOUT_MS = Math.max(
  1,
  Number.parseInt(process.env.SEARCH_VECTOR_FETCH_TIMEOUT_MS ?? '15000', 10) || 15_000,
);

/**
 * Output dimension of bge-micro-v2. Used to slice the flattened batch tensor
 * (`data` is `batchSize × dim` long) back into per-text embeddings.
 */
const EMBEDDING_DIM = 384;

/**
 * How many texts to feed the pipeline in one forward pass. Batching collapses
 * N sequential ONNX inferences into ceil(N / BATCH) — a 10-20× throughput win
 * on the cold-start full-catalog embed (~600 tools). Capped to bound peak RSS;
 * bge-micro-v2 at 384-dim is small enough that 32 stays well under the OOM
 * threshold that motivated the original per-item loop.
 */
const EMBEDDING_BATCH_SIZE = 32;

async function getEmbedder(modelId: string): Promise<EmbedderPipeline> {
  if (embedder && loadedModelId !== modelId) {
    throw new Error(
      `Embedding worker already loaded model ${loadedModelId}; cannot switch to ${modelId}`,
    );
  }
  if (!embedder) {
    const { pipeline, env } = await import('@huggingface/transformers');
    const transformerEnv = env as unknown as {
      fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    };
    const originalFetch = transformerEnv.fetch ?? globalThis.fetch;
    transformerEnv.fetch = async (input, init = {}) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const upstreamSignal = init.signal;
      const abortUpstream = () => controller.abort();
      upstreamSignal?.addEventListener('abort', abortUpstream, { once: true });
      try {
        return await originalFetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
        upstreamSignal?.removeEventListener('abort', abortUpstream);
      }
    };
    embedder = (await pipeline('feature-extraction', modelId, {
      quantized: true,
    } as Record<string, unknown>)) as unknown as EmbedderPipeline;
    loadedModelId = modelId;
  }
  return embedder;
}

/**
 * Slice a flattened batch tensor back into one Float32Array per input text.
 *
 * A batched pipeline call returns `data` as a single flat Float32Array of
 * length `batchSize × dim`. The per-row embedding dimension comes from the
 * tensor's `dims` when available (last axis), falling back to the model
 * constant. Each row is copied into its own backing buffer so the worker can
 * transfer ownership to the host thread.
 *
 * Normalisation is delegated to the pipeline (`normalize: true`); no extra
 * L2 pass is applied here.
 */
function sliceBatch(data: Float32Array, batchSize: number, dims?: number[]): Float32Array[] {
  const reportedDim = dims && dims.length > 0 ? dims[dims.length - 1] : undefined;
  const inferredDim = data.length / batchSize;
  const dim =
    reportedDim && Number.isInteger(reportedDim) && reportedDim > 0
      ? reportedDim
      : Number.isInteger(inferredDim) && inferredDim > 0
        ? inferredDim
        : EMBEDDING_DIM;
  if (data.length < batchSize * dim) {
    throw new Error(`Unexpected embedding tensor size: ${data.length} for ${batchSize}x${dim}`);
  }
  const out: Float32Array[] = [];
  for (let i = 0; i < batchSize; i++) {
    const row = new Float32Array(dim);
    row.set(data.subarray(i * dim, (i + 1) * dim));
    out.push(row);
  }
  return out;
}

// ── Message handler ──

parentPort?.on(
  'message',
  async (msg: { type: string; id: number; modelId?: string; text?: string; texts?: string[] }) => {
    try {
      const modelId = msg.modelId?.trim() || DEFAULT_MODEL_ID;
      if (msg.type === 'embed') {
        const pipe = await getEmbedder(modelId);
        const output = await pipe(msg.text!, { pooling: 'mean', normalize: true });
        const raw = output.data as Float32Array;
        // pipeline `normalize:true` already L2-normalises per text;
        // the copy below is only needed for transfer-list ownership.
        const embedding = new Float32Array(raw);
        parentPort!.postMessage({ type: 'result', id: msg.id, embedding }, [
          embedding.buffer as ArrayBuffer,
        ]);
      } else if (msg.type === 'embed_batch') {
        const pipe = await getEmbedder(modelId);
        const texts = msg.texts!;
        const embeddings: Float32Array[] = [];
        // Batch the inputs through the pipeline in fixed-size chunks. The
        // pipeline flattens a chunk into one forward pass, collapsing
        // ceil(N / BATCH) inferences instead of N — the dominant cost on the
        // cold-start full-catalog embed. Falls back to single-item inference
        // when the batched output shape can't be resolved, preserving the
        // original per-item behaviour as a safe default.
        for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
          const chunk = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
          if (chunk.length === 0) continue;
          try {
            const output = await pipe(chunk, { pooling: 'mean', normalize: true });
            const raw = output.data as Float32Array;
            const sliced = sliceBatch(raw, chunk.length, output.dims);
            embeddings.push(...sliced);
          } catch {
            // Batch path failed (e.g. model returned unexpected shape) —
            // fall back to single-item inference for this chunk.
            for (const text of chunk) {
              const single = await pipe(text, { pooling: 'mean', normalize: true });
              // normalize:true already L2-normalises; copy needed for transfer.
              embeddings.push(new Float32Array(single.data as Float32Array));
            }
          }
        }
        parentPort!.postMessage({ type: 'result', id: msg.id, embedding: embeddings });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ type: 'error', id: msg.id, message });
    }
  },
);

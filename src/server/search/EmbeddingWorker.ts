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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null;

const MODEL_ID = 'Xenova/bge-micro-v2';

async function getEmbedder() {
  if (!embedder) {
    const { pipeline } = await import('@huggingface/transformers');
    embedder = await pipeline('feature-extraction', MODEL_ID, {
      quantized: true,
    } as Record<string, unknown>);
  }
  return embedder;
}

/**
 * Normalise a raw embedding tensor to a unit-length Float32Array.
 */
function normalise(data: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < data.length; i++) {
    norm += data[i]! * data[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < data.length; i++) {
      data[i]! /= norm;
    }
  }
  return data;
}

// ── Message handler ──

parentPort?.on('message', async (msg: { type: string; id: number; text?: string; texts?: string[] }) => {
  try {
    if (msg.type === 'embed') {
      const pipe = await getEmbedder();
      const output = await pipe(msg.text!, { pooling: 'mean', normalize: true });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const raw = output.data as Float32Array;
      const embedding = normalise(new Float32Array(raw));
      parentPort!.postMessage(
        { type: 'result', id: msg.id, embedding },
        [embedding.buffer as ArrayBuffer]
      );
    } else if (msg.type === 'embed_batch') {
      const pipe = await getEmbedder();
      const texts = msg.texts!;
      const embeddings: Float32Array[] = [];
      // Process individually to avoid OOM with large batches
      for (const text of texts) {
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const raw = output.data as Float32Array;
        embeddings.push(normalise(new Float32Array(raw)));
      }
      parentPort!.postMessage(
        { type: 'result', id: msg.id, embedding: embeddings },
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ type: 'error', id: msg.id, message });
  }
});

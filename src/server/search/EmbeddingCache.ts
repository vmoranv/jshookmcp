/**
 * Disk cache for full-catalog tool embeddings.
 *
 * Persists under ~/.jshookmcp/cache so each newly spawned MCP stdio process
 * can skip re-running ~600 ONNX inferences when the tool catalog fingerprint
 * matches. Query embeddings are intentionally not cached — they are tiny and
 * query-specific; the worker is idle-released instead.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { SEARCH_VECTOR_CACHE_ENABLED, SEARCH_VECTOR_MODEL_ID } from '@src/constants';
import { logger } from '@utils/logger';

const CACHE_VERSION = 1;
const DEFAULT_DIM = 384;

export interface EmbeddingCachePayload {
  version: number;
  modelId: string;
  fingerprint: string;
  dim: number;
  count: number;
  /** Concatenated Float32 embeddings, base64-encoded. */
  data: string;
}

export function buildEmbeddingFingerprint(
  modelId: string,
  descriptions: readonly string[],
): string {
  const hash = createHash('sha256');
  hash.update(modelId);
  hash.update('\0');
  hash.update(String(descriptions.length));
  hash.update('\0');
  for (const description of descriptions) {
    hash.update(description);
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function getEmbeddingCachePath(modelId: string = SEARCH_VECTOR_MODEL_ID): string {
  const overridden = process.env.JSHOOK_EMBEDDING_CACHE_DIR?.trim();
  const base = overridden
    ? resolve(overridden)
    : resolve(homedir(), '.jshookmcp', 'cache', 'embeddings');
  // Sanitize model id for filesystem use (Xenova/bge-micro-v2 → Xenova_bge-micro-v2)
  const safeModel = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return resolve(base, `${safeModel}.json`);
}

export function encodeEmbeddings(embeddings: readonly Float32Array[]): {
  dim: number;
  data: string;
} {
  if (embeddings.length === 0) {
    return { dim: DEFAULT_DIM, data: '' };
  }
  const dim = embeddings[0]!.length;
  const packed = new Float32Array(embeddings.length * dim);
  for (let i = 0; i < embeddings.length; i++) {
    const row = embeddings[i]!;
    if (row.length !== dim) {
      throw new Error(`Embedding dim mismatch at index ${i}: expected ${dim}, got ${row.length}`);
    }
    packed.set(row, i * dim);
  }
  return {
    dim,
    data: Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength).toString('base64'),
  };
}

export function decodeEmbeddings(data: string, count: number, dim: number): Float32Array[] | null {
  if (count <= 0) return [];
  if (!data) return null;
  const buf = Buffer.from(data, 'base64');
  const expectedBytes = count * dim * 4;
  if (buf.byteLength !== expectedBytes) return null;
  // Copy into a fresh ArrayBuffer so each row can be sliced independently.
  const copy = new Float32Array(count * dim);
  copy.set(new Float32Array(buf.buffer, buf.byteOffset, count * dim));
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    out.push(copy.slice(i * dim, (i + 1) * dim));
  }
  return out;
}

export async function loadToolEmbeddingsCache(
  modelId: string,
  descriptions: readonly string[],
): Promise<Float32Array[] | null> {
  if (!SEARCH_VECTOR_CACHE_ENABLED) return null;

  const fingerprint = buildEmbeddingFingerprint(modelId, descriptions);
  const path = getEmbeddingCachePath(modelId);

  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as EmbeddingCachePayload;
    if (parsed.version !== CACHE_VERSION) return null;
    if (parsed.modelId !== modelId) return null;
    if (parsed.fingerprint !== fingerprint) return null;
    if (!Number.isInteger(parsed.count) || parsed.count !== descriptions.length) return null;
    if (!Number.isInteger(parsed.dim) || parsed.dim <= 0) return null;

    const decoded = decodeEmbeddings(parsed.data, parsed.count, parsed.dim);
    if (!decoded || decoded.length !== descriptions.length) return null;
    logger.debug(`[embedding-cache] hit model=${modelId} tools=${decoded.length} path=${path}`);
    return decoded;
  } catch {
    return null;
  }
}

export async function saveToolEmbeddingsCache(
  modelId: string,
  descriptions: readonly string[],
  embeddings: readonly Float32Array[],
): Promise<void> {
  if (!SEARCH_VECTOR_CACHE_ENABLED) return;
  if (embeddings.length !== descriptions.length) return;

  const fingerprint = buildEmbeddingFingerprint(modelId, descriptions);
  const path = getEmbeddingCachePath(modelId);
  const { dim, data } = encodeEmbeddings(embeddings);
  const payload: EmbeddingCachePayload = {
    version: CACHE_VERSION,
    modelId,
    fingerprint,
    dim,
    count: embeddings.length,
    data,
  };

  try {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.tmp`;
    await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await rename(tmpPath, path);
    logger.debug(
      `[embedding-cache] wrote model=${modelId} tools=${embeddings.length} path=${path}`,
    );
  } catch (err) {
    logger.warn(
      `[embedding-cache] write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

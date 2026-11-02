import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { SEARCH_VECTOR_CACHE_ENABLED, SEARCH_VECTOR_MODEL_ID } from '@src/constants';
import { readEnvNullableString } from '@src/config/environment';
import { logger } from '@utils/logger';

/** v1 legacy format（fingerprint 全量校验）。仅读取兼容，不再写出。 */
const CACHE_VERSION_V1 = 1;
/** v2 当前写版本：items 按工具名对齐 + 逐项 hash，支持增量部分命中。 */
const CACHE_VERSION = 2;

interface EmbeddingCachePayload {
  version: number;
  modelId: string;
  fingerprint: string;
  dim: number;
  count: number;
  data: string;
}

interface EmbeddingCacheItem {
  name: string;
  hash: string;
}

interface EmbeddingCachePayloadV2 {
  version: number;
  modelId: string;
  dim: number;
  items: EmbeddingCacheItem[];
  data: string;
}

/** Partial load / v2 save 的工具键。hash = sha256(name + '\n' + description)。 */
export interface ToolEmbeddingKey {
  name: string;
  description: string;
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

function hashEmbeddingItem(name: string, description: string): string {
  const hash = createHash('sha256');
  hash.update(name);
  hash.update('\n');
  hash.update(description);
  return hash.digest('hex');
}

export function getEmbeddingCachePath(modelId: string = SEARCH_VECTOR_MODEL_ID): string {
  const overridden = readEnvNullableString('JSHOOK_EMBEDDING_CACHE_DIR', { trim: true });
  const base = overridden
    ? resolve(overridden)
    : resolve(homedir(), '.jshookmcp', 'cache', 'embeddings');
  const safeModel = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const modelHash = createHash('sha256').update(modelId).digest('hex').slice(0, 12);
  return resolve(base, `${safeModel}-${modelHash}.json`);
}

export function encodeEmbeddings(embeddings: readonly Float32Array[]): {
  dim: number;
  data: string;
} {
  if (embeddings.length === 0) return { dim: 0, data: '' };

  const dim = embeddings[0]!.length;
  if (dim <= 0) throw new Error('Embedding dimension must be positive');
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
  if (count === 0 && dim === 0 && data === '') return [];
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(dim) || dim <= 0 || !data) {
    return null;
  }

  const buf = Buffer.from(data, 'base64');
  const expectedBytes = count * dim * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(expectedBytes) || buf.byteLength !== expectedBytes) return null;

  const alignedBytes = new Uint8Array(expectedBytes);
  alignedBytes.set(buf);
  const packed = new Float32Array(alignedBytes.buffer);
  return Array.from({ length: count }, (_, index) =>
    packed.subarray(index * dim, (index + 1) * dim),
  );
}

export async function loadToolEmbeddingsCache(
  modelId: string,
  descriptions: readonly string[],
): Promise<Float32Array[] | null> {
  if (!SEARCH_VECTOR_CACHE_ENABLED) return null;

  const path = getEmbeddingCachePath(modelId);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<
      EmbeddingCachePayload & EmbeddingCachePayloadV2
    >;

    let decoded: Float32Array[] | null = null;
    if (parsed.version === CACHE_VERSION_V1) {
      const fingerprint = buildEmbeddingFingerprint(modelId, descriptions);
      if (
        parsed.modelId !== modelId ||
        parsed.fingerprint !== fingerprint ||
        parsed.count !== descriptions.length
      ) {
        return null;
      }
      decoded = decodeEmbeddings(parsed.data ?? '', parsed.count ?? 0, parsed.dim ?? 0);
    } else if (parsed.version === CACHE_VERSION) {
      if (parsed.modelId !== modelId || !Array.isArray(parsed.items)) return null;
      if (!itemsMatchUnnamed(parsed.items, descriptions)) return null;
      decoded = decodeEmbeddings(parsed.data ?? '', parsed.items.length, parsed.dim ?? 0);
    } else {
      return null;
    }

    if (!decoded || decoded.length !== descriptions.length) return null;
    logger.debug(`[embedding-cache] hit model=${modelId} tools=${decoded.length}`);
    return decoded;
  } catch {
    return null;
  }
}

function itemsMatchUnnamed(
  items: readonly EmbeddingCacheItem[],
  descriptions: readonly string[],
): boolean {
  if (items.length !== descriptions.length) return false;
  return items.every((item, index) => {
    if (item?.name !== '' || typeof item?.hash !== 'string') return false;
    const description = descriptions[index];
    return description !== undefined && item.hash === hashEmbeddingItem('', description);
  });
}

/**
 * v2 增量加载：按工具名对齐，未变工具返回独立拷贝的 embedding（.slice()，不共享可变底层），
 * 已变/新增/缺失返回 null；缓存整体不可用（v1 文件、modelId 不符、数据损坏等）返回 null。
 */
export async function loadToolEmbeddingsCachePartial(
  modelId: string,
  tools: readonly ToolEmbeddingKey[],
): Promise<(Float32Array | null)[] | null> {
  if (!SEARCH_VECTOR_CACHE_ENABLED) return null;

  const path = getEmbeddingCachePath(modelId);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<EmbeddingCachePayloadV2>;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.modelId !== modelId ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }

    const items = parsed.items;
    const decoded = decodeEmbeddings(parsed.data ?? '', items.length, parsed.dim ?? 0);
    if (!decoded) return null;

    const byName = new Map<string, { hash: string; index: number }>();
    for (const [index, item] of items.entries()) {
      if (typeof item?.name !== 'string' || typeof item?.hash !== 'string') return null;
      byName.set(item.name, { hash: item.hash, index });
    }

    let hits = 0;
    const result = tools.map((tool) => {
      const entry = byName.get(tool.name);
      if (!entry || entry.hash !== hashEmbeddingItem(tool.name, tool.description)) return null;
      hits++;
      return decoded[entry.index]!.slice();
    });
    logger.debug(`[embedding-cache] partial hit model=${modelId} tools=${hits}/${tools.length}`);
    return result;
  } catch {
    return null;
  }
}

async function writeCache(
  modelId: string,
  items: readonly EmbeddingCacheItem[],
  embeddings: readonly Float32Array[],
): Promise<void> {
  if (!SEARCH_VECTOR_CACHE_ENABLED || embeddings.length !== items.length) return;

  const path = getEmbeddingCachePath(modelId);
  const { dim, data } = encodeEmbeddings(embeddings);
  const payload: EmbeddingCachePayloadV2 = {
    version: CACHE_VERSION,
    modelId,
    dim,
    items: items.slice(),
    data,
  };
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await rename(tmpPath, path);
    logger.debug(`[embedding-cache] wrote model=${modelId} tools=${embeddings.length}`);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    logger.warn(
      `[embedding-cache] write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 兼容签名：升级为写 v2。无名调用路径退化为 name=''（hash 仅覆盖 description），
 * 可继续被 loadToolEmbeddingsCache 全量读取。
 */
export async function saveToolEmbeddingsCache(
  modelId: string,
  descriptions: readonly string[],
  embeddings: readonly Float32Array[],
): Promise<void> {
  await writeCache(
    modelId,
    descriptions.map((description) => ({ name: '', hash: hashEmbeddingItem('', description) })),
    embeddings,
  );
}

/** v2 写入：items 携带真实工具名，供 loadToolEmbeddingsCachePartial 增量复用。 */
export async function saveToolEmbeddingsCacheV2(
  modelId: string,
  tools: readonly ToolEmbeddingKey[],
  embeddings: readonly Float32Array[],
): Promise<void> {
  await writeCache(
    modelId,
    tools.map((tool) => ({
      name: tool.name,
      hash: hashEmbeddingItem(tool.name, tool.description),
    })),
    embeddings,
  );
}

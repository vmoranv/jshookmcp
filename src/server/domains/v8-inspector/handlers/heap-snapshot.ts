import { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';
import {
  MCP_V8_HEAP_SNAPSHOT_MAX_COUNT,
  MCP_V8_HEAP_SNAPSHOT_MAX_TOTAL_MB,
} from '@src/constants/server';
import { isRecord } from '@utils/type-guards';
import type { CDPSessionLike, TargetProvenance, TargetSessionResolver } from './cdp-session';
import { enforceSnapshotRetention, persistSnapshot } from './snapshot-persistence';

export interface StoredHeapSnapshot {
  id: string;
  chunks: string[];
  capturedAt: string;
  sizeBytes: number;
  /** True when the snapshot is a degraded/size-only capture rather than real CDP data. */
  simulated?: boolean;
  /** Optional provenance hint (page URL) captured alongside the snapshot. */
  targetUrl?: string | null;
  /** CDP target type when captured against an attached non-page target (worker/service_worker/shared_worker). Omitted for the page target. */
  targetType?: string | null;
  /** CDP targetId when captured against an attached target. Omitted for the page target. */
  targetId?: string | null;
  /** Absolute + project-relative path of the persisted .heapsnapshot file, when written. */
  persisted?: { absolutePath: string; displayPath: string };
}

const snapshotCache = new Map<string, StoredHeapSnapshot>();

export interface HeapSnapshotHandlerOptions {
  getPage: () => Promise<unknown>;
  getSnapshot: () => string | null;
  setSnapshot: (snapshot: string | null) => void;
  client?: V8InspectorClient;
  /** Persist the captured snapshot to artifacts/heap-snapshots/ (default: true). */
  persist?: boolean;
  /** Optional accessor for the current page URL, recorded as snapshot provenance. */
  getTargetUrl?: () => Promise<string | null>;
  /** Target-aware session resolver — when an attached CDP target (worker/SW) is present, the snapshot is captured from it instead of the page. */
  resolver?: TargetSessionResolver;
}

export function getSnapshotCache(): Map<string, StoredHeapSnapshot> {
  return snapshotCache;
}

export function clearSnapshotCache(): void {
  snapshotCache.clear();
}

export function storeSnapshot(snapshot: StoredHeapSnapshot): StoredHeapSnapshot {
  snapshotCache.set(snapshot.id, snapshot);
  return snapshot;
}

export function getSnapshot(snapshotId: string): StoredHeapSnapshot | undefined {
  return snapshotCache.get(snapshotId);
}

/**
 * Bound the in-memory snapshot cache: evict oldest-by-capturedAt entries until
 * the cache holds at most `maxCount` snapshots. Returns the evicted ids.
 * Non-positive caps are ignored (no eviction). This is the memory-side half of
 * retention — `enforceSnapshotRetention` handles the on-disk files; without this
 * the cache would retain every captured snapshot's chunks (GB-scale) forever.
 */
export function enforceSnapshotCacheRetention(maxCount: number): string[] {
  if (!Number.isInteger(maxCount) || maxCount <= 0) {
    return [];
  }
  if (snapshotCache.size <= maxCount) {
    return [];
  }

  const entries = Array.from(snapshotCache.entries());
  entries.sort((a, b) => {
    const ca = a[1].capturedAt;
    const cb = b[1].capturedAt;
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });

  const toEvict = entries.slice(0, entries.length - maxCount);
  for (const [id] of toEvict) {
    snapshotCache.delete(id);
  }
  return toEvict.map(([id]) => id);
}

/**
 * Read retention caps from the constants layer. `maxCount` defaults to 3
 * (bounding both the in-memory and on-disk snapshot store); `maxTotalBytes`
 * defaults to 0 (disabled). Both are env-overridable and clamp to >= 0.
 */
function getRetentionConfig(): { maxCount: number; maxTotalBytes: number } {
  const maxCount = Math.max(0, MCP_V8_HEAP_SNAPSHOT_MAX_COUNT);
  const maxTotalMb = Math.max(0, MCP_V8_HEAP_SNAPSHOT_MAX_TOTAL_MB);
  return { maxCount, maxTotalBytes: maxTotalMb * 1024 * 1024 };
}

function isCDPPageLike(v: unknown): v is {
  createCDPSession: () => Promise<unknown>;
  evaluate: (...args: unknown[]) => Promise<unknown>;
} {
  return (
    isRecord(v) &&
    typeof v['createCDPSession'] === 'function' &&
    typeof v['evaluate'] === 'function'
  );
}

function unwrapRuntimeValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if ('value' in value) {
    return unwrapRuntimeValue(value['value']);
  }

  if ('result' in value) {
    return unwrapRuntimeValue(value['result']);
  }

  return value;
}

/**
 * In-page `performance.memory` read (Chromium-only): used/total/limit sizes,
 * or null when the API is unavailable. Shared by the CDP-session fallback and
 * the minimal page-evaluate fallback so both degrade identically.
 */
const PERFORMANCE_MEMORY_EXPRESSION = `(() => {
  const m = performance.memory;
  return m
    ? {
        jsHeapSizeUsed: m.usedJSHeapSize,
        jsHeapSizeTotal: m.totalJSHeapSize,
        jsHeapSizeLimit: m.jsHeapSizeLimit
      }
    : null;
})()`;

/** Extract the used heap size from a `performance.memory` evaluation result. */
function extractUsedHeapSizeBytes(result: unknown): number {
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result) as unknown;
    } catch {
      return 0;
    }
  }
  if (isRecord(result) && typeof result['jsHeapSizeUsed'] === 'number') {
    return result['jsHeapSizeUsed'];
  }
  return 0;
}

interface CaptureReturn {
  /**
   * True only when a real CDP heap snapshot was captured. A degraded
   * size-only fallback returns false so callers cannot mistake a few
   * hundred bytes of `performance.memory` metadata for a heap dump.
   */
  success: boolean;
  snapshotId: string;
  capturedAt: string;
  sizeBytes: number;
  chunks: string[];
  simulated: boolean;
  /** True when the capture degraded to a size-only fallback (`success` is false). */
  degraded: boolean;
  /** Which capture path produced this result. */
  captureMode: 'cdp' | 'simulated';
  /** Failure reason; present exactly when `success` is false. */
  error?: string;
  warnings: string[];
  persisted?: { displayPath: string; bytesWritten: number };
  evicted?: string[];
  /** Which target the snapshot was captured from (set for attached non-page targets). */
  target?: TargetProvenance;
}

/**
 * Capture a full heap snapshot via HeapProfiler over a given CDP session.
 * Used for the attached-target path (worker/SW) where the session is owned by
 * the collector and must NOT be detached here. Uses optional on/off guards so
 * it tolerates minimal session shapes.
 */
async function captureHeapSnapshotViaSession(
  session: CDPSessionLike,
  onChunk: (chunk: string) => void,
): Promise<number> {
  await session.send('HeapProfiler.enable').catch(() => undefined);
  try {
    return await new Promise<number>((resolve, reject) => {
      let totalSize = 0;
      const chunkHandler = (data: unknown) => {
        const chunk = (data as { chunk?: string } | null)?.chunk;
        if (typeof chunk === 'string') {
          totalSize += Buffer.byteLength(chunk, 'utf8');
          onChunk(chunk);
        }
      };
      session.on?.('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
      session
        .send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
        .then(() => {
          session.off?.('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
          resolve(totalSize);
        })
        .catch((error: unknown) => {
          session.off?.('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
          reject(error);
        });
    });
  } finally {
    // Every enable must be paired with a disable — even on the failure path —
    // so the (collector-managed) attached session is left in its prior state.
    await session.send('HeapProfiler.disable').catch(() => undefined);
  }
}

export async function handleHeapSnapshotCapture(
  _args: Record<string, unknown>,
  options: HeapSnapshotHandlerOptions,
): Promise<CaptureReturn> {
  const snapshotId = `snapshot_${Date.now().toString(36)}`;
  const capturedAt = new Date().toISOString();
  const warnings: string[] = [];
  const persist = options.persist !== false;

  let targetUrl: string | null = null;
  if (persist && options.getTargetUrl) {
    try {
      targetUrl = await options.getTargetUrl();
    } catch {
      targetUrl = null;
    }
  }

  const pageTarget: TargetProvenance = { type: 'page', url: targetUrl, targetId: null };

  /**
   * Persist (when enabled), enforce retention caps, and build the final
   * capture return. Persistence is fail-soft: a disk failure pushes a warning
   * but the in-memory snapshot remains usable.
   */
  const finalize = async (
    stored: StoredHeapSnapshot,
    simulated: boolean,
    target: TargetProvenance,
  ): Promise<CaptureReturn> => {
    options.setSnapshot(stored.id);
    const captureMode = simulated ? 'simulated' : 'cdp';
    const base: CaptureReturn = {
      // Honest verdict: a simulated fallback did NOT capture a heap snapshot.
      // The payload still carries the snapshot id/size so callers can inspect
      // the degraded result, but `success:false` + `degraded:true` prevents a
      // 0-byte placeholder from being treated as a usable dump.
      success: !simulated,
      ...(simulated
        ? {
            error:
              'No real heap snapshot was captured; returned a degraded size-only fallback. ' +
              'Attach or launch a browser page (browser_launch / browser_attach) and retry.',
          }
        : {}),
      snapshotId: stored.id,
      capturedAt: stored.capturedAt,
      sizeBytes: stored.sizeBytes,
      chunks: [],
      simulated,
      degraded: simulated,
      captureMode,
      warnings,
      target,
    };

    const retention = getRetentionConfig();

    // Bound the in-memory cache regardless of persistence — the snapshot cache
    // must never grow unbounded even when persistence is disabled.
    const memoryEvicted = enforceSnapshotCacheRetention(retention.maxCount);

    if (!persist) {
      return memoryEvicted.length > 0 ? { ...base, evicted: memoryEvicted } : base;
    }

    try {
      const persisted = await persistSnapshot({
        id: stored.id,
        chunks: stored.chunks,
        capturedAt: stored.capturedAt,
        sizeBytes: stored.sizeBytes,
        simulated,
        targetUrl,
      });
      // Refresh the cache entry so list/export can resolve the on-disk path.
      snapshotCache.set(stored.id, {
        ...stored,
        ...(typeof targetUrl === 'string' ? { targetUrl } : {}),
        persisted: { absolutePath: persisted.absolutePath, displayPath: persisted.displayPath },
      });

      // Disk retention keeps the in-memory cache in lockstep: an evicted disk
      // snapshot's chunks must not linger in memory either.
      const disk = await enforceSnapshotRetention({ ...retention, memoryCache: snapshotCache });
      const evictedIds = [...new Set([...memoryEvicted, ...disk.evictedIds])];

      return {
        ...base,
        persisted: { displayPath: persisted.displayPath, bytesWritten: persisted.bytesWritten },
        ...(evictedIds.length > 0 ? { evicted: evictedIds } : {}),
      };
    } catch (e) {
      warnings.push(
        `heap snapshot persistence failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return base;
    }
  };

  // Attached CDP target (worker/SW/page via browser_attach_cdp_target) —
  // snapshot that target directly. This is the path that lets v8 heap
  // forensics run inside a worker, not only the page. The session is owned
  // by the collector; we must NOT detach it (captureHeapSnapshotViaSession
  // only enables HeapProfiler and listens, never detaches).
  const attachedSession = options.resolver?.getAttachedTargetSession?.() ?? null;
  if (attachedSession) {
    try {
      const chunks: string[] = [];
      const totalSize = await captureHeapSnapshotViaSession(attachedSession, (chunk) => {
        chunks.push(chunk);
      });
      const info = options.resolver?.getAttachedTargetInfo?.() ?? null;
      const attachedTarget: TargetProvenance = {
        type: info?.type ?? null,
        url: info?.url ?? targetUrl,
        targetId: info?.targetId ?? null,
      };
      const stored = storeSnapshot({
        id: snapshotId,
        chunks,
        capturedAt,
        sizeBytes: totalSize,
        simulated: false,
        ...(attachedTarget.type ? { targetType: attachedTarget.type } : {}),
        ...(attachedTarget.targetId ? { targetId: attachedTarget.targetId } : {}),
      });
      return await finalize(stored, false, attachedTarget);
    } catch (e: unknown) {
      warnings.push(
        `Attached-target heap snapshot failed: ${e instanceof Error ? e.message : String(e)}. Trying page fallback...`,
      );
    }
  }

  if (options.client) {
    // Real CDP heap snapshot capture
    try {
      const chunks: string[] = [];
      const totalSize = await options.client.takeHeapSnapshot((chunk) => {
        chunks.push(chunk);
      });
      const stored = storeSnapshot({
        id: snapshotId,
        chunks,
        capturedAt,
        sizeBytes: totalSize,
        simulated: false,
      });
      return await finalize(stored, false, pageTarget);
    } catch (e: unknown) {
      // Fall through to graceful degradation
      warnings.push(
        `Direct CDP snapshot capture failed: ${e instanceof Error ? e.message : String(e)}. Trying page-evaluate fallback...`,
      );
    }
  }

  // Graceful degradation: PageController fallback via JS evaluate
  try {
    const page = await options.getPage();

    if (isCDPPageLike(page)) {
      const session = await page.createCDPSession();
      const sessionSend = (method: string, params?: Record<string, unknown>) =>
        (session as { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> }).send(
          method,
          params,
        );
      const sessionDetach = () => (session as { detach: () => Promise<void> }).detach();

      await sessionSend('HeapProfiler.enable');
      let response: unknown;
      try {
        response = await sessionSend('Runtime.evaluate', {
          expression: PERFORMANCE_MEMORY_EXPRESSION,
          returnByValue: true,
        });
      } finally {
        // Pair the enable with a disable before the session is detached.
        await sessionSend('HeapProfiler.disable').catch(() => undefined);
      }
      await sessionDetach().catch(() => undefined);

      const sizeBytes = extractUsedHeapSizeBytes(unwrapRuntimeValue(response));

      const stored = storeSnapshot({
        id: snapshotId,
        chunks: [`{"simulated":true,"sizeBytes":${sizeBytes}}`],
        capturedAt,
        sizeBytes,
        simulated: true,
      });
      return await finalize(stored, true, pageTarget);
    }
  } catch (e: unknown) {
    // Fall through to minimal fallback
    warnings.push(`Page-evaluate fallback failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Minimal fallback: attempt to get performance.memory via page.evaluate.
  // Runs the same shared expression as the CDP-session fallback above.
  let fallbackSizeBytes = 0;
  try {
    const page = await options.getPage();
    const pageWithEvaluate = page as {
      evaluate?: (fn: string | (() => unknown)) => Promise<unknown>;
    };
    if (pageWithEvaluate && typeof pageWithEvaluate.evaluate === 'function') {
      const memInfo = await pageWithEvaluate.evaluate(PERFORMANCE_MEMORY_EXPRESSION);
      fallbackSizeBytes = extractUsedHeapSizeBytes(memInfo);
    }
  } catch (e: unknown) {
    warnings.push(
      `performance.memory fallback failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const stored = storeSnapshot({
    id: snapshotId,
    chunks:
      fallbackSizeBytes > 0
        ? [`{"simulated":true,"approximateHeapSize":${fallbackSizeBytes}}`]
        : ['{}'],
    capturedAt,
    sizeBytes: fallbackSizeBytes,
    simulated: true,
  });
  return await finalize(stored, true, pageTarget);
}

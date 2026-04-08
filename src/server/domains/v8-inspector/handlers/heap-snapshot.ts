import { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';

export interface StoredHeapSnapshot {
  id: string;
  chunks: string[];
  capturedAt: string;
  sizeBytes: number;
}

const snapshotCache = new Map<string, StoredHeapSnapshot>();

export interface HeapSnapshotHandlerOptions {
  getPage: () => Promise<unknown>;
  getSnapshot: () => string | null;
  setSnapshot: (snapshot: string | null) => void;
  client?: V8InspectorClient;
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isCDPPageLike(v: unknown): v is { createCDPSession: () => Promise<unknown> } {
  return isRecord(v) && typeof v['createCDPSession'] === 'function';
}

export async function handleHeapSnapshotCapture(
  _args: Record<string, unknown>,
  options: HeapSnapshotHandlerOptions,
): Promise<{
  success: boolean;
  snapshotId: string;
  capturedAt: string;
  sizeBytes: number;
  chunks: string[];
  simulated: boolean;
}> {
  const snapshotId = `snapshot_${Date.now().toString(36)}`;
  const capturedAt = new Date().toISOString();
  const chunks: string[] = [];

  if (options.client) {
    // Real CDP heap snapshot capture
    try {
      const totalSize = await options.client.takeHeapSnapshot((chunk) => {
        chunks.push(chunk);
      });
      const stored = storeSnapshot({
        id: snapshotId,
        chunks,
        capturedAt,
        sizeBytes: totalSize,
      });
      options.setSnapshot(snapshotId);
      return {
        success: true,
        snapshotId: stored.id,
        capturedAt: stored.capturedAt,
        sizeBytes: stored.sizeBytes,
        chunks: [],
        simulated: false,
      };
    } catch {
      // Fall through to graceful degradation
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
      const response = await sessionSend('Runtime.evaluate', {
        expression: `
          (() => {
            const m = performance.memory;
            return m ? JSON.stringify({
              jsHeapSizeUsed: m.usedJSHeapSize,
              jsHeapSizeTotal: m.totalJSHeapSize,
              jsHeapSizeLimit: m.jsHeapSizeLimit
            }) : null;
          })()
        `,
        returnByValue: true,
      });
      await sessionDetach().catch(() => undefined);

      const result = isRecord(response) ? response['result'] : undefined;
      let sizeBytes = 0;
      if (typeof result === 'string' && result !== 'null') {
        const parsed = JSON.parse(result) as Record<string, number>;
        sizeBytes = parsed.jsHeapSizeUsed ?? 0;
      }

      const stored = storeSnapshot({
        id: snapshotId,
        chunks: [`{"simulated":true,"sizeBytes":${sizeBytes}}`],
        capturedAt,
        sizeBytes,
      });
      options.setSnapshot(snapshotId);
      return {
        success: true,
        snapshotId: stored.id,
        capturedAt: stored.capturedAt,
        sizeBytes: stored.sizeBytes,
        chunks: [],
        simulated: true,
      };
    }
  } catch {
    // Fall through to minimal fallback
  }

  // Minimal fallback: record a stub snapshot
  const stored = storeSnapshot({
    id: snapshotId,
    chunks: ['{}'],
    capturedAt,
    sizeBytes: 0,
  });
  options.setSnapshot(snapshotId);
  return {
    success: true,
    snapshotId: stored.id,
    capturedAt: stored.capturedAt,
    sizeBytes: stored.sizeBytes,
    chunks: [],
    simulated: true,
  };
}

export async function handleHeapSearch(
  args: Record<string, unknown>,
  options: HeapSnapshotHandlerOptions,
): Promise<{ success: boolean; snapshotId: string; query: string; matches: string[] }> {
  const query = typeof args.query === 'string' && args.query.length > 0 ? args.query : '.*';
  const snapshotId =
    typeof args.snapshotId === 'string' && args.snapshotId.length > 0
      ? args.snapshotId
      : options.getSnapshot();

  await options.getPage();

  if (!snapshotId) {
    throw new Error('snapshotId is required');
  }

  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  return {
    success: true,
    snapshotId,
    query,
    matches: snapshot.chunks.filter((chunk) => chunk.includes(query)),
  };
}

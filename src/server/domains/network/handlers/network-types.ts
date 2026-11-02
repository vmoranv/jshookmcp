/**
 * Shared types, constants, and type-guard utilities for the network domain handlers.
 */

// ── Constants ──

/** Resource types excluded by default when no explicit filters are set. */
export const EXCLUDED_RESOURCE_TYPES = new Set([
  'Image',
  'Font',
  'Stylesheet',
  'Media',
  'Manifest',
  'Ping',
]);

/** Priority order for smart sorting (lower = higher priority). */
export const TYPE_SORT_PRIORITY: Record<string, number> = {
  XHR: 0,
  Fetch: 1,
  Document: 2,
  Script: 3,
  WebSocket: 4,
  EventSource: 5,
};
export const DEFAULT_SORT_PRIORITY = 6;

// ── Helper Types ──

export interface NetworkRequestPayload {
  requestId?: string;
  rawRequestId?: string;
  sessionId?: string;
  targetId?: string;
  targetType?: string;
  frameId?: string;
  url: string;
  method: string;
  type?: string;
  timestamp?: number;
  /** Which layer captured this request: CDP protocol, in-page JS interceptor, or external proxy. */
  captureSource?: 'cdp' | 'inpage' | 'proxy';
  [key: string]: unknown;
}

export interface NetworkResponsePayload {
  status: number;
  [key: string]: unknown;
}

// ── CPU Profile Types ──

export interface CpuProfileCallFramePayload {
  functionName?: string;
  url?: string;
  lineNumber?: number;
}

export interface CpuProfileNodePayload {
  id?: number;
  hitCount?: number;
  callFrame?: CpuProfileCallFramePayload;
  children?: number[];
}

export interface CpuProfilePayload {
  nodes: CpuProfileNodePayload[];
  samples?: number[];
  startTime: number;
  endTime: number;
}

export interface HotFunctionSummary {
  functionName: string;
  url?: string;
  line?: number;
  hitCount: number;
}

export interface HotFunctionsResult {
  hotFunctions: HotFunctionSummary[];
  /** Present when no hot data could be derived (samples absent + hitCount all zero). */
  message?: string;
}

/**
 * Aggregate the hottest functions of a CDP CPU profile.
 *
 * Modern Chrome profiles are samples + timeDeltas shaped — `hitCount` is
 * deprecated and always 0/undefined, so hot functions are derived by counting
 * how often each node id appears in `samples`, walking bottom-up so every
 * ancestor accumulates its descendants' samples. Falls back to `hitCount`
 * when `samples` is unavailable or yields no nodes.
 */
export function buildHotFunctions(profile: CpuProfilePayload): HotFunctionsResult {
  const samples = profile.samples;
  if (samples && samples.length > 0) {
    const nodeById = new Map<number, CpuProfileNodePayload>();
    const parentByChildId = new Map<number, number>();
    for (const node of profile.nodes) {
      if (node.id === undefined) continue;
      nodeById.set(node.id, node);
      for (const childId of node.children ?? []) {
        if (childId !== undefined) parentByChildId.set(childId, node.id);
      }
    }

    const counts = new Map<number, number>();
    for (const sampleId of samples) {
      let nodeId: number | undefined = sampleId;
      while (nodeId !== undefined && nodeById.has(nodeId)) {
        counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
        nodeId = parentByChildId.get(nodeId);
      }
    }

    if (counts.size > 0) {
      return {
        hotFunctions: [...counts.entries()]
          .toSorted((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([nodeId, count]) => {
            const node = nodeById.get(nodeId);
            return {
              functionName: node?.callFrame?.functionName || '(anonymous)',
              url: node?.callFrame?.url,
              line: node?.callFrame?.lineNumber,
              hitCount: count,
            };
          }),
      };
    }
  }

  const hotFunctions = profile.nodes
    .filter((n) => (n.hitCount || 0) > 0)
    .toSorted((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
    .slice(0, 20)
    .map((n) => ({
      functionName: n.callFrame?.functionName || '(anonymous)',
      url: n.callFrame?.url,
      line: n.callFrame?.lineNumber,
      hitCount: n.hitCount || 0,
    }));

  if (hotFunctions.length === 0) {
    return {
      hotFunctions,
      message: 'CPU profile uses samples-based format; no hitCount available',
    };
  }
  return { hotFunctions };
}

// ── Type Guards ──

export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isNetworkRequestPayload = (value: unknown): value is NetworkRequestPayload => {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.url === 'string' && typeof value.method === 'string';
};

export const isNetworkResponsePayload = (value: unknown): value is NetworkResponsePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }
  return isFiniteNumber(value.status);
};

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const asOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

export const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const asOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string') ? value : undefined;
};

export const isCpuProfileNodePayload = (value: unknown): value is CpuProfileNodePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.hitCount !== undefined && typeof value.hitCount !== 'number') {
    return false;
  }

  if (value.callFrame !== undefined && !isObjectRecord(value.callFrame)) {
    return false;
  }
  if (isObjectRecord(value.callFrame)) {
    if (
      value.callFrame.functionName !== undefined &&
      typeof value.callFrame.functionName !== 'string'
    ) {
      return false;
    }
    if (value.callFrame.url !== undefined && typeof value.callFrame.url !== 'string') {
      return false;
    }
    if (
      value.callFrame.lineNumber !== undefined &&
      typeof value.callFrame.lineNumber !== 'number'
    ) {
      return false;
    }
  }

  return true;
};

export const toCpuProfilePayload = (value: unknown): CpuProfilePayload | null => {
  if (!isObjectRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.nodes)) {
    return null;
  }
  if (typeof value.startTime !== 'number' || typeof value.endTime !== 'number') {
    return null;
  }
  if (!value.nodes.every((node) => isCpuProfileNodePayload(node))) {
    return null;
  }

  return {
    nodes: value.nodes,
    samples: Array.isArray(value.samples)
      ? (value.samples as unknown[]).filter((s): s is number => typeof s === 'number')
      : undefined,
    startTime: value.startTime,
    endTime: value.endTime,
  };
};

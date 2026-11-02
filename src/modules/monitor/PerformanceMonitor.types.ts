/**
 * Polled performance metrics. Note: FID is intentionally absent — it cannot
 * be recovered by polling after the fact; it requires a PerformanceObserver
 * registered before first input (use browser_performance_observer for that).
 */
export interface PerformanceMetrics {
  fcp?: number;
  lcp?: number;
  cls?: number;
  /** Time to first byte; null when the navigation entry has no requestStart. */
  ttfb?: number | null;

  domContentLoaded?: number;
  loadComplete?: number;

  /** Engine-level totals from CDP Performance.getMetrics (cross-origin aggregate). */
  scriptDuration?: number;
  layoutDuration?: number;
  recalcStyleDuration?: number;

  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;

  /** Navigation Timing Level 2 resource sizes (bytes; 0 when cached/cross-origin). */
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
}

export interface CoverageInfo {
  url: string;
  ranges: Array<{
    start: number;
    end: number;
    count: number;
  }>;
  text?: string;
  totalBytes: number;
  usedBytes: number;
  coveragePercentage: number;
}

export interface CPUProfile {
  nodes: Array<{
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    hitCount?: number;
    children?: number[];
  }>;
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export interface LargestContentfulPaintEntryLike extends PerformanceEntry {
  renderTime?: number;
  loadTime?: number;
}

export interface LayoutShiftEntryLike extends PerformanceEntry {
  hadRecentInput?: boolean;
  value?: number;
}

export interface PerformanceMemoryLike {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}

export interface PerformanceTimelineEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}

export interface CDPHeapSnapshotChunkPayload {
  chunk: string;
}

export interface CDPHeapSamplingNode {
  callFrame?: {
    functionName?: string;
    url?: string;
  };
  selfSize?: number;
  children?: CDPHeapSamplingNode[];
}

export interface CDPHeapSamplingProfile {
  head: CDPHeapSamplingNode;
}

export interface CDPHeapSamplingPayload {
  profile: CDPHeapSamplingProfile;
}

export interface HeapAllocationSummary {
  functionName: string;
  url: string;
  selfSize: number;
}

// ── Type Guards ──────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCDPHeapSnapshotChunkPayload(
  value: unknown,
): value is CDPHeapSnapshotChunkPayload {
  return isRecord(value) && typeof value.chunk === 'string';
}

function isCDPHeapSamplingNode(value: unknown): value is CDPHeapSamplingNode {
  if (!isRecord(value)) {
    return false;
  }
  const { callFrame, selfSize, children } = value;
  if (callFrame !== undefined) {
    if (!isRecord(callFrame)) {
      return false;
    }
    if (callFrame.functionName !== undefined && typeof callFrame.functionName !== 'string') {
      return false;
    }
    if (callFrame.url !== undefined && typeof callFrame.url !== 'string') {
      return false;
    }
  }
  if (selfSize !== undefined && typeof selfSize !== 'number') {
    return false;
  }
  if (children !== undefined && !Array.isArray(children)) {
    return false;
  }
  return true;
}

export function isCDPHeapSamplingPayload(value: unknown): value is CDPHeapSamplingPayload {
  return isRecord(value) && isRecord(value.profile) && isCDPHeapSamplingNode(value.profile.head);
}

export function countTraceEvents(traceData: Buffer | string): number {
  if (typeof traceData === 'string') {
    const eventPattern = /"ph"\s*:/g;
    let count = 0;
    while (eventPattern.exec(traceData) !== null) {
      count++;
    }
    return count;
  }
  // Buffer scan — avoids a full UTF-8 decode of multi-MB traces.
  const needle = Buffer.from('"ph":');
  let count = 0;
  let index = 0;
  while ((index = traceData.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

function insertTopAllocation(
  topAllocations: HeapAllocationSummary[],
  candidate: HeapAllocationSummary,
  topN: number,
): void {
  if (topN <= 0) {
    return;
  }

  if (
    topAllocations.length === topN &&
    candidate.selfSize <= topAllocations[topAllocations.length - 1]!.selfSize
  ) {
    return;
  }

  let insertIndex = topAllocations.findIndex((entry) => candidate.selfSize > entry.selfSize);
  if (insertIndex === -1) {
    insertIndex = topAllocations.length;
  }
  topAllocations.splice(insertIndex, 0, candidate);

  if (topAllocations.length > topN) {
    topAllocations.length = topN;
  }
}

export function collectTopHeapAllocations(
  root: CDPHeapSamplingNode,
  topN: number,
): { sampleCount: number; topAllocations: HeapAllocationSummary[] } {
  const stack: CDPHeapSamplingNode[] = [root];
  const topAllocations: HeapAllocationSummary[] = [];
  let sampleCount = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    if (node.callFrame) {
      sampleCount++;
      insertTopAllocation(
        topAllocations,
        {
          functionName: node.callFrame.functionName || '(anonymous)',
          url: node.callFrame.url || '',
          selfSize: node.selfSize || 0,
        },
        topN,
      );
    }

    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child) {
          stack.push(child);
        }
      }
    }
  }

  return { sampleCount, topAllocations };
}

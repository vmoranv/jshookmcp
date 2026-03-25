/**
 * TraceSummarizer — Server-side trace data pre-processing for LLM consumption.
 *
 * Transforms large trace event streams into compact, structured summaries
 * to avoid overwhelming LLM context windows with raw trace data.
 *
 * Three detail levels:
 * - compact: category aggregation + timeline overview
 * - balanced: compact + key moments (breakpoints, network, memory anomalies)
 * - full: passthrough (no compression)
 */

// ── Types ──

export type SummaryDetail = 'compact' | 'balanced' | 'full';

export interface TraceEvent {
  timestamp: number;
  category: string;
  eventType: string;
  data?: unknown;
  scriptId?: string;
  lineNumber?: number;
}

export interface MemoryDelta {
  timestamp: number;
  address: string;
  oldValue: string;
  newValue: string;
  size: number;
  valueType: string;
}

export interface CategorySummary {
  category: string;
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
  topEventTypes: Array<{ type: string; count: number }>;
}

export interface KeyMoment {
  timestamp: number;
  type: 'breakpoint' | 'network_complete' | 'memory_anomaly' | 'exception' | 'navigation';
  description: string;
  data?: unknown;
}

export interface TraceSummary {
  detail: SummaryDetail;
  totalEvents: number;
  timeRange: { start: number; end: number; durationMs: number };
  categories: CategorySummary[];
  keyMoments?: KeyMoment[];
}

export interface MemorySummary {
  totalDeltas: number;
  uniqueAddresses: number;
  anomalies: Array<{
    address: string;
    writeCount: number;
    description: string;
  }>;
  topAddresses: Array<{ address: string; writeCount: number }>;
}

// ── Implementation ──

/**
 * Summarize trace events at the specified detail level.
 */
export function summarizeEvents(
  events: TraceEvent[],
  detail: SummaryDetail = 'balanced',
): TraceSummary {
  if (events.length === 0) {
    return {
      detail,
      totalEvents: 0,
      timeRange: { start: 0, end: 0, durationMs: 0 },
      categories: [],
      keyMoments: detail !== 'compact' ? [] : undefined,
    };
  }

  // Time range
  const timestamps = events.map((e) => e.timestamp);
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);

  // Category aggregation (always included)
  const catMap = new Map<
    string,
    { count: number; first: number; last: number; types: Map<string, number> }
  >();

  for (const event of events) {
    let cat = catMap.get(event.category);
    if (!cat) {
      cat = { count: 0, first: event.timestamp, last: event.timestamp, types: new Map() };
      catMap.set(event.category, cat);
    }
    cat.count++;
    cat.first = Math.min(cat.first, event.timestamp);
    cat.last = Math.max(cat.last, event.timestamp);
    cat.types.set(event.eventType, (cat.types.get(event.eventType) ?? 0) + 1);
  }

  const categories: CategorySummary[] = [...catMap.entries()]
    .toSorted((a, b) => b[1].count - a[1].count)
    .map(([category, info]) => ({
      category,
      count: info.count,
      firstTimestamp: info.first,
      lastTimestamp: info.last,
      topEventTypes: [...info.types.entries()]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    }));

  const summary: TraceSummary = {
    detail,
    totalEvents: events.length,
    timeRange: { start, end, durationMs: end - start },
    categories,
  };

  // Balanced and full modes include key moments
  if (detail === 'balanced' || detail === 'full') {
    summary.keyMoments = extractKeyMoments(events);
  }

  return summary;
}

/**
 * Extract key moments from a trace event stream.
 *
 * Identifies:
 * - Debugger pauses (breakpoint hits)
 * - Network request completions
 * - Runtime exceptions
 * - Page navigations
 */
export function extractKeyMoments(events: TraceEvent[]): KeyMoment[] {
  const moments: KeyMoment[] = [];

  for (const event of events) {
    if (event.eventType === 'Debugger.paused') {
      moments.push({
        timestamp: event.timestamp,
        type: 'breakpoint',
        description: `Debugger paused${event.scriptId ? ` at script ${event.scriptId}` : ''}${event.lineNumber ? `:${event.lineNumber}` : ''}`,
        data: event.data,
      });
    } else if (event.eventType === 'Network.loadingFinished') {
      moments.push({
        timestamp: event.timestamp,
        type: 'network_complete',
        description: 'Network request completed',
        data: event.data,
      });
    } else if (event.eventType === 'Runtime.exceptionThrown') {
      moments.push({
        timestamp: event.timestamp,
        type: 'exception',
        description: 'Runtime exception thrown',
        data: event.data,
      });
    } else if (
      event.eventType === 'Page.frameNavigated' ||
      event.eventType === 'Page.navigatedWithinDocument'
    ) {
      moments.push({
        timestamp: event.timestamp,
        type: 'navigation',
        description: 'Page navigation',
        data: event.data,
      });
    }
  }

  return moments;
}

/**
 * Summarize memory deltas, detecting anomalies.
 *
 * An anomaly is defined as an address that receives significantly more
 * writes than the average (> 3× the mean write count).
 */
export function summarizeMemoryDeltas(deltas: MemoryDelta[]): MemorySummary {
  if (deltas.length === 0) {
    return { totalDeltas: 0, uniqueAddresses: 0, anomalies: [], topAddresses: [] };
  }

  // Count writes per address
  const writeMap = new Map<string, number>();
  for (const delta of deltas) {
    writeMap.set(delta.address, (writeMap.get(delta.address) ?? 0) + 1);
  }

  const uniqueAddresses = writeMap.size;
  const totalWrites = deltas.length;
  const meanWrites = totalWrites / uniqueAddresses;

  // Top addresses by write count
  const sorted = [...writeMap.entries()].toSorted((a, b) => b[1] - a[1]);
  const topAddresses = sorted
    .slice(0, 10)
    .map(([address, writeCount]) => ({ address, writeCount }));

  // Anomaly detection: > 3× mean
  const anomalyThreshold = meanWrites * 3;
  const anomalies = sorted
    .filter(([, count]) => count > anomalyThreshold)
    .map(([address, writeCount]) => ({
      address,
      writeCount,
      description: `${writeCount} writes (${(writeCount / meanWrites).toFixed(1)}× average)`,
    }));

  return { totalDeltas: totalWrites, uniqueAddresses, anomalies, topAddresses };
}

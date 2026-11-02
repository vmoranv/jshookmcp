/**
 * Per-tool latency histograms (r1-2).
 *
 * Production observability that does NOT depend on E2E env gating: the existing
 * execution metrics are only collected behind E2E_COLLECT_PERFORMANCE=1, leaving
 * production with zero visibility into per-tool latency. This module records each
 * tool call's `durationMs` (emitted on the EventBus 'tool:called' event) into a
 * fixed-capacity ring buffer per tool, and computes p50/p90/p99 lazily — only when
 * /health verbose is polled. Surfaces the slowest tools through the /health verbose
 * branch.
 *
 * The collection path is deliberately allocation-light and synchronous: a single
 * Map lookup plus a number push into a preallocated ring (bounded by distinct tool
 * count, never by call count). Sorting/percentile math happens only in getSummary().
 *
 * Zero external dependencies.
 */

import { RingBuffer } from '@utils/RingBuffer';

/** Default number of recent samples retained per tool (ring capacity). */
const DEFAULT_TOOL_LATENCY_SAMPLES = 200;

/** Default number of slowest tools surfaced in the /health verbose summary. */
export const DEFAULT_TOOL_LATENCY_TOP_N = 10;

/** Millisecond latency percentiles + sample count for one tool. */
export interface ToolLatencyPercentiles {
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  samples: number;
}

/** A per-tool latency entry, keyed by tool name. */
export interface ToolLatencyEntry extends ToolLatencyPercentiles {
  toolName: string;
}

/** Aggregate per-tool latency summary, ordered by p99 descending. */
export interface ToolLatencySummary {
  /** Slowest tools by p99, capped at the requested `topN`. */
  top: ToolLatencyEntry[];
  /** Number of distinct tools currently tracked (≥ `top.length`). */
  trackedTools: number;
}

/** Tracker construction options. `sampleLimit` is the per-tool ring capacity. */
export interface ToolLatencyTrackerOptions {
  sampleLimit?: number;
}

function roundMs(ms: number): number {
  return Number(ms.toFixed(2));
}

/** Pure: nearest-rank percentile of an already-sorted ascending sample array. */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)]!;
}

/** Pure: p50/p90/p99 + sample count from an unsorted sample list. */
export function computePercentiles(samples: number[]): ToolLatencyPercentiles {
  if (samples.length === 0) return { p50Ms: 0, p90Ms: 0, p99Ms: 0, samples: 0 };
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    p50Ms: roundMs(percentileOf(sorted, 50)),
    p90Ms: roundMs(percentileOf(sorted, 90)),
    p99Ms: roundMs(percentileOf(sorted, 99)),
    samples: sorted.length,
  };
}

export class ToolLatencyTracker {
  private readonly sampleLimit: number;
  private readonly buffers = new Map<string, RingBuffer<number>>();

  constructor(sampleLimit: number = DEFAULT_TOOL_LATENCY_SAMPLES) {
    this.sampleLimit = sampleLimit;
  }

  record(toolName: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    let buffer = this.buffers.get(toolName);
    if (!buffer) {
      buffer = new RingBuffer<number>(this.sampleLimit);
      this.buffers.set(toolName, buffer);
    }
    buffer.push(durationMs);
  }

  getSummary(topN = DEFAULT_TOOL_LATENCY_TOP_N): ToolLatencySummary {
    const entries: ToolLatencyEntry[] = [];
    for (const [toolName, buffer] of this.buffers) {
      if (buffer.length === 0) continue;
      entries.push({ toolName, ...computePercentiles(buffer.toArray()) });
    }
    entries.sort(
      (a, b) => b.p99Ms - a.p99Ms || b.p90Ms - a.p90Ms || a.toolName.localeCompare(b.toolName),
    );
    return {
      top: entries.slice(0, topN),
      trackedTools: this.buffers.size,
    };
  }

  dispose(): void {
    for (const buffer of this.buffers.values()) buffer.clear();
    this.buffers.clear();
  }
}

/**
 * Creates a per-tool latency tracker. Recording is synchronous and bounded; the
 * p50/p90/p99 percentiles are computed lazily by `getSummary()`.
 */
export function createToolLatencyTracker(
  options: ToolLatencyTrackerOptions = {},
): ToolLatencyTracker {
  return new ToolLatencyTracker(options.sampleLimit ?? DEFAULT_TOOL_LATENCY_SAMPLES);
}

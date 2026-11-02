/**
 * Event-loop lag sampling (r1-1).
 *
 * Production observability that does NOT depend on E2E env gating: the existing
 * execution metrics are only collected behind E2E_COLLECT_PERFORMANCE=1, leaving
 * production with zero visibility into event-loop blocking. node:perf_hooks
 * `monitorEventLoopDelay` samples the libuv event-loop delay in nanoseconds and
 * is exposed here as a p50/p90/p99 summary (milliseconds) plus a sample count —
 * surfaced through the /health verbose branch.
 *
 * Zero external dependencies.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Nanoseconds per millisecond. */
const NS_PER_MS = 1_000_000;

/** Default summary window (ms). Startup blocking samples only pollute the first window. */
const DEFAULT_LOOP_LAG_WINDOW_MS = 30_000;

/**
 * Millisecond latency summary + sample count.
 *
 * `p50Ms`/`p90Ms`/`p99Ms`/`samples` describe the **recent window** (since the
 * last reset), NOT the lifetime of the process. `cumulativeSamples` is the
 * total sample count across all windows and never decreases.
 */
export interface LoopLagSummary {
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  samples: number;
  cumulativeSamples?: number;
}

/**
 * Minimal histogram surface the summarizer depends on. Extracted so the
 * ns→ms + percentile reduction can be unit-tested with a plain object
 * instead of a live `IntervalHistogram`.
 */
export interface LoopLagHistogram {
  /** Returns the recorded value at `percentile` (0-100], in nanoseconds. */
  percentile(percentile: number): number;
  /** Number of samples recorded since the last reset. */
  readonly count: number;
}

/** A histogram that can also be reset — the surface the windowed sampler needs. */
export interface ResettableLoopLagHistogram extends LoopLagHistogram {
  reset(): void;
}

/** A started / startable event-loop lag sampler. */
export interface LoopLagSampler {
  /** Starts recording. Returns an idempotent stop function. */
  enable(): () => void;
  /** Stops recording (idempotent). */
  stop(): void;
  /** Current-window p50/p90/p99 (milliseconds) + sample count (+ cumulative total). */
  getSummary(): LoopLagSummary;
}

/** Pure: convert a histogram-like (nanoseconds) into a millisecond summary. */
export function summarizeLoopLag(histogram: LoopLagHistogram): LoopLagSummary {
  return {
    p50Ms: nsToMs(histogram.percentile(50)),
    p90Ms: nsToMs(histogram.percentile(90)),
    p99Ms: nsToMs(histogram.percentile(99)),
    samples: histogram.count,
  };
}

function nsToMs(nanoseconds: number): number {
  return Number((nanoseconds / NS_PER_MS).toFixed(2));
}

/** Sampler construction options. `histogram`/`now` are test seams. */
export interface LoopLagSamplerOptions {
  resolution?: number;
  /** Summary window length in ms — `getSummary()` resets once this elapses. */
  windowMs?: number;
  /**
   * Test seam: inject a histogram instead of `monitorEventLoopDelay`.
   * @internal
   */
  histogram?: ResettableLoopLagHistogram & { enable(): void; disable(): void };
  /**
   * Test seam: inject a clock.
   * @internal
   */
  now?: () => number;
}

/**
 * Creates a sampler backed by `monitorEventLoopDelay`. Call `enable()` to start
 * recording; `stop()` (or the returned stop function) disables it. Both are
 * idempotent, so a restarted server re-arms cleanly.
 *
 * `monitorEventLoopDelay` never resets on its own, so startup blocking samples
 * would permanently pollute p50/p90/p99. This sampler windows the histogram:
 * each `getSummary()` reads the current window and, once `windowMs` has elapsed
 * since the previous reset, resets the histogram. The cumulative sample count is
 * preserved in an external field so it survives the resets.
 */
export function createLoopLagSampler(options: LoopLagSamplerOptions = {}): LoopLagSampler {
  const {
    resolution = 100,
    windowMs = DEFAULT_LOOP_LAG_WINDOW_MS,
    now = Date.now,
    histogram = monitorEventLoopDelay({ resolution }),
  } = options;

  const disable = () => histogram.disable();
  let lastResetAt = now();
  let closedWindowSamples = 0;

  return {
    enable() {
      histogram.enable();
      return disable;
    },
    stop() {
      disable();
    },
    getSummary() {
      const summary = summarizeLoopLag(histogram);
      if (now() - lastResetAt >= windowMs) {
        closedWindowSamples += summary.samples;
        histogram.reset();
        lastResetAt = now();
      }
      // Compute the cumulative total from the post-reset histogram state: a
      // re-entrant getSummary that closes the window mid-read (two /health
      // requests crossing a window boundary) would otherwise add the closing
      // window's samples twice — once into `closedWindowSamples` and once from
      // the pre-reset snapshot above.
      return { ...summary, cumulativeSamples: closedWindowSamples + histogram.count };
    },
  };
}

/**
 * Paired significance for Search evaluation.
 *
 * Pure functions: no I/O, no clock, no global state. Deterministic given a seed.
 * The harness consumes these; tests exercise them through the harness report,
 * but they are exported so a reviewer can recompute a verdict by hand.
 */

export interface BootstrapInterval {
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  readonly confidence: number;
  readonly resamples: number;
}

export interface SignTestResult {
  readonly positive: number;
  readonly negative: number;
  readonly tied: number;
  /** Exact two-sided binomial p-value with p=0.5. */
  readonly pValue: number;
}

export interface WinLossTie {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

export type AdoptionVerdict = 'adopt' | 'reject' | 'unproven';

export interface BootstrapOptions {
  readonly resamples?: number;
  readonly confidence?: number;
  readonly seed?: number;
}

/** Counts deltas above/below zero; |delta| <= epsilon counts as a tie. */
export function winLossTie(deltas: readonly number[], epsilon = 1e-12): WinLossTie {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const delta of deltas) {
    if (delta > epsilon) wins += 1;
    else if (delta < -epsilon) losses += 1;
    else ties += 1;
  }
  return { wins, losses, ties };
}

/** Exact two-sided sign test over the non-tied deltas. */
export function signTest(deltas: readonly number[], epsilon = 1e-12): SignTestResult {
  const { wins, losses, ties } = winLossTie(deltas, epsilon);
  const n = wins + losses;
  if (n === 0) return { positive: 0, negative: 0, tied: ties, pValue: 1 };
  const k = Math.min(wins, losses);
  // Two-sided exact p = 2 * P(X <= min(wins, losses)), capped at 1.
  const pValue = Math.min(1, 2 * Math.exp(logSumSmallerOrEqual(n, k)));
  return { positive: wins, negative: losses, tied: ties, pValue: Math.max(0, pValue) };
}

/** Paired bootstrap over per-case deltas. */
export function pairedBootstrap(
  deltas: readonly number[],
  options: BootstrapOptions = {},
): BootstrapInterval {
  const resamples = Math.max(100, Math.floor(options.resamples ?? 10_000));
  const confidence = clamp(options.confidence ?? 0.95, 0.5, 0.999);
  const n = deltas.length;
  if (n === 0) {
    return { point: 0, lower: 0, upper: 0, confidence, resamples };
  }
  const point = mean(deltas);
  const rand = mulberry32(options.seed ?? 42);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const index = Math.min(n - 1, Math.floor(rand() * n));
      sum += deltas[index]!;
    }
    means[r] = sum / n;
  }
  const sortedMeans = means.toSorted();
  const alpha = (1 - confidence) / 2;
  const lower = quantileSorted(sortedMeans, alpha);
  const upper = quantileSorted(sortedMeans, 1 - alpha);
  return { point, lower, upper, confidence, resamples };
}

/**
 * Four-state-capable verdict for one candidate. `untested` is a corpus-level
 * state (no cases), not produced here; callers map zero-case runs themselves.
 */
export function adoptionVerdict(
  point: number,
  interval: Pick<BootstrapInterval, 'lower' | 'upper'>,
  practicalFloor = 0.02,
): AdoptionVerdict {
  if (interval.lower > 0 && point >= practicalFloor) return 'adopt';
  if (interval.upper < 0) return 'reject';
  return 'unproven';
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function quantileSorted(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function logBinomialPmf(n: number, k: number): number {
  return logChoose(n, k) - n * Math.LN2;
}

function logSumSmallerOrEqual(n: number, k: number): number {
  let sum = -Infinity;
  for (let i = 0; i <= k; i += 1) {
    sum = logAdd(sum, logBinomialPmf(n, i));
  }
  return sum;
}

function logChoose(n: number, k: number): number {
  const kk = Math.min(k, n - k);
  let value = 0;
  for (let i = 1; i <= kk; i += 1) {
    value += Math.log(n - kk + i) - Math.log(i);
  }
  return value;
}

function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const max = Math.max(a, b);
  return max + Math.log(Math.exp(a - max) + Math.exp(b - max));
}

/** Deterministic PRNG so a reviewer can reproduce the interval. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

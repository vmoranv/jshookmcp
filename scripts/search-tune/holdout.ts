/**
 * Stratified evolve/holdout split for search tuning (RRSI mechanism #1).
 *
 * Pure splitting is random and therefore domain-blind: the fixture's tag
 * distribution is heavily skewed (browser/network carry many cases while a
 * dozen tags carry exactly one), so a uniform shuffle can strand every
 * `mojo-ipc` / `syscall-hook` case on one side and leave that domain with no
 * evaluation signal at all. Stratifying by tag keeps every domain represented
 * on both sides, which is what makes the holdout score a meaningful
 * out-of-distribution check rather than a second sample of the same skew.
 *
 * No I/O, no env reads, no global state: callers pass cases in, get slices out.
 */

import type { SearchEvalCase } from '../../tests/server/search/fixtures/search-quality.fixture';

// ── public types ──

export interface HoldoutSplit {
  /** Cases used to evolve a candidate. */
  readonly evolve: readonly SearchEvalCase[];
  /** Cases reserved to validate generalization; never used for selection. */
  readonly holdout: readonly SearchEvalCase[];
  /** Tag → number of cases in the full input, before splitting. */
  readonly domainCoverage: ReadonlyMap<string, number>;
  /**
   * Tags whose lone case was forced into `evolve` (no holdout counterpart).
   * Upper layers should know these domains contribute zero holdout signal.
   */
  readonly singleTagCases: readonly SingleTagCase[];
}

export interface SingleTagCase {
  readonly tag: string;
  readonly caseId: string;
}

export interface HoldoutOptions {
  /**
   * Fraction of cases routed to `evolve`; the remainder goes to `holdout`.
   * Clamped to (0, 1). Defaults to {@link EVOLVE_HOLDOUT_DEFAULT_RATIO}.
   */
  readonly evolveRatio?: number;
  /** PRNG seed — same seed and same input order always yield the same split. */
  readonly seed?: number;
  /**
   * When true, a tag with a single case is duplicated into both slices instead
   * of being routed to `evolve` only. Off by default: duplicating leaks the
   * case into selection, which is exactly what the holdout exists to prevent.
   */
  readonly duplicateSingletons?: boolean;
}

// ── defaults ──

/** Fraction of cases routed to the evolve set when no ratio is supplied. */
export const EVOLVE_HOLDOUT_DEFAULT_RATIO = 0.7;

/** Default PRNG seed — matches the `--seed` default used by optimize.ts. */
const DEFAULT_SEED = 42;

// ── public API ──

/**
 * Split evaluation cases into evolve/holdout slices, stratified by tag.
 *
 * Guarantees, in order of precedence:
 *   1. Every case lands in exactly one slice (unless `duplicateSingletons`).
 *   2. A tag with ≥2 cases contributes at least one case to each slice.
 *   3. A tag with 1 case contributes it to `evolve` and is reported in
 *      `singleTagCases`.
 *   4. Slice sizes otherwise track `evolveRatio` across the whole input.
 */
export function splitEvolveHoldout(
  cases: readonly SearchEvalCase[],
  options: HoldoutOptions = {},
): HoldoutSplit {
  const ratio = clampRatio(options.evolveRatio ?? EVOLVE_HOLDOUT_DEFAULT_RATIO);
  const duplicateSingletons = options.duplicateSingletons ?? false;
  const state = { s: (options.seed ?? DEFAULT_SEED) >>> 0 };

  const domainCoverage = computeDomainCoverage(cases);
  const byTag = groupByTag(cases);

  const evolve: SearchEvalCase[] = [];
  const holdout: SearchEvalCase[] = [];
  const singleTagCases: SingleTagCase[] = [];

  // Tags are visited in first-seen order so the PRNG draw sequence is a pure
  // function of the input array; reordering the input changes the split.
  for (const tag of byTag.keys()) {
    const bucket = byTag.get(tag)!;
    // "Single-case tag" is a property of the whole case set, not of one
    // bucket: a case tagged [x, y] belongs to y as well, so x may hold a lone
    // case while also being represented through that shared case elsewhere.
    if ((domainCoverage.get(tag) ?? bucket.length) <= 1) {
      const lone = bucket[0]!;
      evolve.push(lone);
      singleTagCases.push({ tag, caseId: lone.id });
      if (duplicateSingletons) holdout.push(lone);
      continue;
    }

    const shuffled = shuffle(bucket, state);
    // At least one case per slice: holdout takes max(1, round(n * (1-ratio)))
    // capped at n-1 so evolve can never be emptied.
    const holdoutCount = Math.min(
      bucket.length - 1,
      Math.max(1, Math.round(bucket.length * (1 - ratio))),
    );
    holdout.push(...shuffled.slice(0, holdoutCount));
    evolve.push(...shuffled.slice(holdoutCount));
  }

  // Strata rounding can drift the overall ratio when a tag carries many cases.
  // Rebalance only among tags that already appear on both sides — moving a
  // case out of a single-sided tag would leave that domain with no evaluation
  // signal, which is the exact failure stratification exists to prevent.
  rebalanceIfBalanced(evolve, holdout, ratio);

  return {
    evolve: sortById(evolve),
    holdout: sortById(holdout),
    domainCoverage,
    singleTagCases,
  };
}

/**
 * Count cases per tag. Multi-tag cases are counted under every tag they carry,
 * so the returned counts can exceed `cases.length`; treat them as per-domain
 * coverage, not a partition.
 */
export function computeDomainCoverage(
  cases: readonly SearchEvalCase[],
): ReadonlyMap<string, number> {
  const coverage = new Map<string, number>();
  for (const testCase of cases) {
    for (const tag of testCase.tags) {
      coverage.set(tag, (coverage.get(tag) ?? 0) + 1);
    }
  }
  return coverage;
}

/**
 * Tags that carry exactly one case in the input — these cannot appear on both
 * sides of the split, so their domain is unrepresented in `holdout` unless
 * `duplicateSingletons` is enabled.
 */
export function findSingleCaseTags(cases: readonly SearchEvalCase[]): readonly SingleTagCase[] {
  const coverage = computeDomainCoverage(cases);
  const byTag = groupByTag(cases);
  const singles: SingleTagCase[] = [];
  for (const [tag, count] of coverage) {
    if (count !== 1) continue;
    const bucket = byTag.get(tag);
    if (bucket?.[0]) singles.push({ tag, caseId: bucket[0].id });
  }
  return singles;
}

// ── internal helpers ──

function groupByTag(cases: readonly SearchEvalCase[]): Map<string, SearchEvalCase[]> {
  const byTag = new Map<string, SearchEvalCase[]>();
  for (const testCase of cases) {
    // Primary tag drives stratification; a case tagged both `network` and
    // `fuzzy` is assigned by whichever tag is listed first.
    const primary = testCase.tags[0];
    if (primary === undefined) continue;
    const bucket = byTag.get(primary);
    if (bucket) bucket.push(testCase);
    else byTag.set(primary, [testCase]);
  }
  return byTag;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return EVOLVE_HOLDOUT_DEFAULT_RATIO;
  return Math.min(0.95, Math.max(0.05, ratio));
}

/** Fisher–Yates driven by the shared PRNG state; returns a new array. */
function shuffle<T>(items: readonly T[], state: { s: number }): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    state.s = xorshift32(state.s);
    const j = nextFloat(state, i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Nudge the global ratio toward `ratio` by moving cases only between tags that
 * already have representatives on both sides.
 *
 * Returns the number of cases moved. When no balanced tag can absorb the
 * difference, the split stays as the strata produced it — the ratio is a soft
 * target, domain coverage is a hard requirement.
 */
function rebalanceIfBalanced(
  evolve: SearchEvalCase[],
  holdout: SearchEvalCase[],
  ratio: number,
): number {
  const total = evolve.length + holdout.length;
  if (total === 0) return 0;
  const targetEvolve = Math.round(total * ratio);
  let moved = 0;

  while (evolve.length > targetEvolve) {
    const candidate = popBalanced(evolve, holdout);
    if (candidate === null) break;
    holdout.push(candidate);
    moved++;
  }
  while (evolve.length < targetEvolve) {
    const candidate = popBalanced(holdout, evolve);
    if (candidate === null) break;
    evolve.push(candidate);
    moved++;
  }
  return moved;
}

/**
 * Remove one case from `from` such that every tag it carries is still present
 * in `keep` afterwards. Returns null when no case qualifies.
 */
function popBalanced(
  from: SearchEvalCase[],
  keep: readonly SearchEvalCase[],
): SearchEvalCase | null {
  for (let i = from.length - 1; i >= 0; i--) {
    const candidate = from[i]!;
    const keepTags = new Set<string>();
    for (const c of keep) for (const tag of c.tags) keepTags.add(tag);
    const stranded = candidate.tags.some((tag) => !keepTags.has(tag));
    if (stranded) continue;
    from.splice(i, 1);
    return candidate;
  }
  return null;
}

function sortById(cases: readonly SearchEvalCase[]): readonly SearchEvalCase[] {
  return [...cases].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function nextFloat(state: { s: number }, bound: number): number {
  const t = state.s / 4294967296; // [0, 1)
  return Math.min(bound - 1, Math.floor(t * bound));
}

/** xorshift32 — same generator used by search-space.ts sampling. */
function xorshift32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return x >>> 0;
}

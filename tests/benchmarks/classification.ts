/**
 * A-phase core: assertion-kind classification for benchmark cases.
 *
 * `origin` (external-vector / homemade / adversarial) describes WHERE the
 * ground truth comes from. `assertionKind` describes WHAT the assertion proves:
 *   - semantic:    the tool's actual computation is correct (RFC vectors,
 *                  AES roundtrip, add_two(40,2)===42, state machines, ...)
 *   - contract:    admission/refusal/argument validation (a no-browser tool
 *                  names PREREQUISITE, an SSRF gate blocks a private IP, ...)
 *   - adversarial: negative/abuse input that must be rejected
 *
 * They are ORTHOGONAL. A homemade case can be either semantic or contract;
 * redefining `origin` would misclassify the ~759 homemade cases. This module
 * is intentionally dependency-free so both the harness and the per-tool
 * scorecard can import it without cycles (oxlint import/no-cycle).
 */
import type { BenchmarkOrigin } from './harness';

export type AssertionKind = 'semantic' | 'contract' | 'adversarial';
export type Difficulty = 'smoke' | 'semantic' | 'adversarial';

export interface BenchCaseClassification {
  readonly origin: BenchmarkOrigin;
  readonly assertionKind: AssertionKind;
  readonly difficulty: Difficulty;
}

export interface BucketCount {
  passed: number;
  total: number;
}

export interface ToolBuckets {
  semantic: BucketCount;
  contract: BucketCount;
  adversarial: BucketCount;
  totalMs: number;
  skipped: number;
}

export function emptyBuckets(): ToolBuckets {
  return {
    semantic: { passed: 0, total: 0 },
    contract: { passed: 0, total: 0 },
    adversarial: { passed: 0, total: 0 },
    totalMs: 0,
    skipped: 0,
  };
}

/**
 * Decide a case's classification. Deterministic, backward compatible:
 *   1. origin 'adversarial' => assertionKind 'adversarial' (forced)
 *   2. explicit assertionKind => use it
 *   3. otherwise 'semantic' (NEVER silently downgrade a legacy case)
 * Unknown extra fields are ignored rather than thrown.
 */
export function classify(c: {
  origin?: BenchmarkOrigin;
  assertionKind?: AssertionKind;
  difficulty?: Difficulty;
}): BenchCaseClassification {
  const origin: BenchmarkOrigin = c.origin ?? 'homemade';
  const assertionKind: AssertionKind =
    origin === 'adversarial'
      ? 'adversarial'
      : ((c.assertionKind as AssertionKind | undefined) ?? 'semantic');
  const difficulty: Difficulty =
    c.difficulty ?? (origin === 'adversarial' ? 'adversarial' : 'smoke');
  return { origin, assertionKind, difficulty };
}

/**
 * Stamp an entire case array as `contract` (admission/refusal/arg-validation).
 * Used by pure-contract suites so the per-tool split is meaningful. Returns a
 * new array — the original case objects are never mutated. Generic over ANY
 * case shape (full BenchCase objects included).
 */
export function asContract<T extends object>(
  cases: readonly T[],
): (T & { readonly assertionKind: 'contract' })[] {
  return cases.map((c) => ({ ...c, assertionKind: 'contract' as const }));
}

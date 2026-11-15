/**
 * A-phase: `assertionKind` is ORTHOGONAL to `origin`. We do not redefine
 * `origin` (homemade contains BOTH real semantic vectors and refusal
 * contracts); the new field says what the assertion actually proves.
 *
 * Default rule is the load-bearing honesty guarantee: an unannotated legacy
 * case is `semantic`, NEVER silently downgraded to `contract`. Otherwise the
 * 759 homemade cases would be reclassified wholesale and `debt` would jump
 * for reasons that have nothing to do with the tools.
 */
import { describe, expect, it } from 'vitest';
import {
  classify,
  emptyBuckets,
  type BenchCaseClassification,
} from '@tests/benchmarks/classification';

describe('classify (A: assertion-kind buckets)', () => {
  it("origin 'adversarial' is forced to assertionKind 'adversarial'", () => {
    expect(classify({ origin: 'adversarial' }).assertionKind).toBe('adversarial');
  });

  it('an explicit assertionKind is honored (contract)', () => {
    expect(classify({ origin: 'homemade', assertionKind: 'contract' }).assertionKind).toBe(
      'contract',
    );
  });

  it('an explicit assertionKind is honored (semantic)', () => {
    expect(classify({ origin: 'external-vector', assertionKind: 'semantic' }).assertionKind).toBe(
      'semantic',
    );
  });

  it('unannotated homemade defaults to semantic (no silent downgrade)', () => {
    expect(classify({ origin: 'homemade' }).assertionKind).toBe('semantic');
  });

  it('unannotated external-vector defaults to semantic', () => {
    expect(classify({ origin: 'external-vector' }).assertionKind).toBe('semantic');
  });

  it('adversarial assertionKind wins even when origin is homemade', () => {
    expect(classify({ origin: 'homemade', assertionKind: 'adversarial' }).assertionKind).toBe(
      'adversarial',
    );
  });

  it('difficulty defaults to smoke, explicit values pass through', () => {
    expect(classify({ origin: 'homemade' }).difficulty).toBe('smoke');
    expect(classify({ origin: 'homemade', difficulty: 'semantic' }).difficulty).toBe('semantic');
    expect(classify({ origin: 'homemade', difficulty: 'adversarial' }).difficulty).toBe(
      'adversarial',
    );
  });

  it('adversarial origin also defaults difficulty to adversarial', () => {
    expect(classify({ origin: 'adversarial' }).difficulty).toBe('adversarial');
  });

  it('never throws on unknown/extra fields (backward compatible)', () => {
    const c = classify({ origin: 'homemade', whatever: 123 } as unknown as Parameters<
      typeof classify
    >[0]);
    expect(c.assertionKind).toBe('semantic');
    expect(c.origin).toBe('homemade');
  });

  it('origin is carried through unchanged', () => {
    const c: BenchCaseClassification = classify({ origin: 'external-vector' });
    expect(c.origin).toBe('external-vector');
  });
});

describe('emptyBuckets', () => {
  it('all three buckets start at zero, ms/skipped at zero', () => {
    expect(emptyBuckets()).toEqual({
      semantic: { passed: 0, total: 0 },
      contract: { passed: 0, total: 0 },
      adversarial: { passed: 0, total: 0 },
      totalMs: 0,
      skipped: 0,
    });
  });
});

/**
 * B-phase: difficulty layering. smoke cases must ALL pass; adversarial cases
 * are reported separately (never merged into the regression score); the suite
 * floor still governs semantic/admission cases. This restores gate
 * differentiation without "manufacturing red".
 */
import { describe, expect, it } from 'vitest';
import { layeredVerdict } from '@tests/benchmarks/gate-layers';
import type { BenchCaseResult } from '@tests/benchmarks/harness';

function c(over: Partial<BenchCaseResult> = {}): BenchCaseResult {
  return {
    name: 'c',
    tool: 't',
    origin: 'homemade',
    reference: 'unit',
    status: 'pass',
    ms: 1,
    ...over,
  };
}

describe('layeredVerdict (B: gate differentiation)', () => {
  it('all smoke cases pass => smoke layer ok', () => {
    const v = layeredVerdict([c({ difficulty: 'smoke' }), c({ difficulty: 'smoke' })], 90);
    expect(v.smokeOk).toBe(true);
    expect(v.smokeTotal).toBe(2);
  });

  it('a single failed smoke case fails the smoke layer regardless of floor', () => {
    const v = layeredVerdict(
      [c({ difficulty: 'smoke', status: 'fail' }), c({ difficulty: 'smoke' })],
      90,
    );
    expect(v.smokeOk).toBe(false);
  });

  it('adversarial cases are counted separately, never in the regression denominator', () => {
    const v = layeredVerdict(
      [
        c({ difficulty: 'smoke' }),
        c({ assertionKind: 'adversarial', difficulty: 'adversarial' }),
        c({ assertionKind: 'adversarial', difficulty: 'adversarial', status: 'fail' }),
      ],
      90,
    );
    expect(v.adversarialTotal).toBe(2);
    expect(v.regressionEvaluated).toBe(1); // only the non-adversarial, non-skipped case
    expect(v.regressionScore).toBe(100);
  });

  it('skipped cases never enter any denominator', () => {
    const v = layeredVerdict(
      [c({ difficulty: 'smoke', status: 'skipped' }), c({ difficulty: 'smoke' })],
      90,
    );
    expect(v.smokeTotal).toBe(1);
    expect(v.regressionEvaluated).toBe(1);
  });

  it('floor breach is reported (semantic layer)', () => {
    const v = layeredVerdict(
      [c({ difficulty: 'semantic', status: 'fail' }), c({ difficulty: 'semantic' })],
      90,
    );
    expect(v.regressionScore).toBe(50);
    expect(v.floorBreached).toBe(true);
  });
});

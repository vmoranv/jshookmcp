/**
 * B-phase: difficulty-layered gate verdict, computed from an ALREADY-RUN
 * BenchSuiteResult's cases (no re-execution). Three layers:
 *   - smoke:        MUST all pass (default difficulty), no skip allowed
 *   - semantic:     governed by the suite regression floor
 *   - adversarial:  reported separately, NEVER merged into the regression
 *                   score (so adding negative cases cannot silently change a
 *                   suite's pass percentage, and cannot "manufacture red").
 *
 * Skipped cases never enter any denominator (inherited honesty rule).
 */
import { classify } from './classification';
import type { BenchCaseResult } from './harness';

export interface LayeredVerdict {
  readonly smokeOk: boolean;
  readonly smokeTotal: number;
  readonly smokeFailed: number;
  readonly adversarialTotal: number;
  readonly regressionEvaluated: number;
  readonly regressionPassed: number;
  readonly regressionScore: number;
  readonly floorBreached: boolean;
}

export function layeredVerdict(cases: readonly BenchCaseResult[], floor: number): LayeredVerdict {
  let smokeTotal = 0;
  let smokeFailed = 0;
  let adversarialTotal = 0;
  let regressionEvaluated = 0;
  let regressionPassed = 0;

  for (const c of cases) {
    const { difficulty } = classify(c);
    if (c.status === 'skipped') continue; // skip is not a measurement
    if (difficulty === 'adversarial' || c.assertionKind === 'adversarial') {
      adversarialTotal += 1;
      continue; // reported, not scored
    }
    if (difficulty === 'smoke') {
      smokeTotal += 1;
      if (c.status !== 'pass') smokeFailed += 1;
    }
    regressionEvaluated += 1;
    if (c.status === 'pass') regressionPassed += 1;
  }

  const regressionScore =
    regressionEvaluated === 0 ? 0 : (regressionPassed / regressionEvaluated) * 100;
  return {
    smokeOk: smokeFailed === 0,
    smokeTotal,
    smokeFailed,
    adversarialTotal,
    regressionEvaluated,
    regressionPassed,
    regressionScore,
    floorBreached: regressionScore < floor,
  };
}

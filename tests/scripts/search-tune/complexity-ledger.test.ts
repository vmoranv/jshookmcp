import { describe, expect, it } from 'vitest';

import {
  compareComplexity,
  computeComplexityLedger,
} from '../../../scripts/search-tune/complexity-ledger';
import type { ComplexityCounts } from '../../../scripts/search-tune/complexity-ledger';

const BEFORE: ComplexityCounts = {
  scoreStages: 20,
  tunableParams: 35,
  runtimeDeps: 22,
  searchLoc: 5_000,
};

describe('computeComplexityLedger', () => {
  it('returns exactly what the injected source reports', async () => {
    const counts = await computeComplexityLedger({ read: async () => BEFORE });
    expect(counts).toEqual(BEFORE);
  });
});

describe('compareComplexity', () => {
  it('passes when nothing grows', () => {
    expect(compareComplexity(BEFORE, { ...BEFORE })).toMatchObject({
      withinBudget: true,
      violations: [],
    });
  });

  it('flags each count that grows', () => {
    const result = compareComplexity(BEFORE, {
      scoreStages: 21,
      tunableParams: 36,
      runtimeDeps: 23,
      searchLoc: 5_500,
    });
    expect(result.withinBudget).toBe(false);
    expect(result.violations).toEqual(['scoreStages', 'tunableParams', 'runtimeDeps']);
  });

  it('allows LOC growth inside the tolerance but not beyond it', () => {
    const atBudget = compareComplexity(BEFORE, { ...BEFORE, searchLoc: 5_500 });
    const overBudget = compareComplexity(BEFORE, { ...BEFORE, searchLoc: 5_501 });
    expect(atBudget.withinBudget).toBe(true);
    expect(overBudget.violations).toEqual(['searchLoc']);
  });
});

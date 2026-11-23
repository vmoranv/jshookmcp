import { describe, expect, it } from 'vitest';

import {
  adoptionVerdict,
  pairedBootstrap,
  signTest,
  winLossTie,
} from '../../../scripts/search-tune/significance';

describe('winLossTie', () => {
  it('counts deltas above and below zero and treats near-zero as a tie', () => {
    expect(winLossTie([0.2, -0.1, 0, 1e-13, -2])).toEqual({ wins: 1, losses: 2, ties: 2 });
  });
});

describe('signTest', () => {
  it('returns p=1 when every delta is a tie', () => {
    expect(signTest([0, 0, 0])).toMatchObject({ positive: 0, negative: 0, tied: 3, pValue: 1 });
  });

  it('returns a small p-value for a consistent positive shift', () => {
    const deltas = Array.from({ length: 20 }, () => 0.1);
    const result = signTest(deltas);
    expect(result.positive).toBe(20);
    expect(result.pValue).toBeLessThan(0.001);
  });
});

describe('pairedBootstrap', () => {
  it('is deterministic for a fixed seed', () => {
    const first = pairedBootstrap([0.1, 0.2, 0.3], { resamples: 500, seed: 9 });
    const second = pairedBootstrap([0.1, 0.2, 0.3], { resamples: 500, seed: 9 });
    expect(first).toEqual(second);
  });

  it('excludes zero for a uniform positive shift', () => {
    const deltas = Array.from({ length: 40 }, (_, index) => 0.05 + (index % 3) * 0.001);
    const interval = pairedBootstrap(deltas, { resamples: 2_000, seed: 7 });
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.point).toBeGreaterThanOrEqual(0.05);
  });

  it('straddles zero for symmetric noise', () => {
    const interval = pairedBootstrap([-0.1, -0.05, 0, 0.05, 0.1], { resamples: 2_000, seed: 7 });
    expect(interval.lower).toBeLessThan(0);
    expect(interval.upper).toBeGreaterThan(0);
  });
});

describe('adoptionVerdict', () => {
  it('adopts only when the interval excludes zero and the floor is met', () => {
    expect(adoptionVerdict(0.03, { lower: 0.01, upper: 0.05 })).toBe('adopt');
    expect(adoptionVerdict(0.01, { lower: 0.001, upper: 0.02 })).toBe('unproven');
  });

  it('rejects when the interval is entirely negative', () => {
    expect(adoptionVerdict(-0.05, { lower: -0.08, upper: -0.01 })).toBe('reject');
  });

  it('is unproven when the interval straddles zero', () => {
    expect(adoptionVerdict(0.05, { lower: -0.01, upper: 0.1 })).toBe('unproven');
  });
});

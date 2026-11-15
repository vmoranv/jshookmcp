/**
 * B-phase: suite floors may only be TIGHTENED (ratchet). A silent loosening is
 * exactly how a 100%-green gate loses its meaning. Re-calibration is allowed
 * but must be an explicit baseline-file change (auditable), never a quiet
 * downgrade in code.
 */
import { describe, expect, it } from 'vitest';
import { assertMonotonic, seedMissingFloors } from '@tests/benchmarks/floor-baseline';

describe('assertMonotonic (B: floor ratchet)', () => {
  it('passes when every current floor >= baseline', () => {
    expect(assertMonotonic({ encoding: 92, browser: 90 }, { encoding: 90, browser: 90 })).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('fails when a floor is loosened below baseline', () => {
    const r = assertMonotonic({ encoding: 85, browser: 90 }, { encoding: 90, browser: 90 });
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('encoding');
    expect(r.violations.join(' ')).toContain('85');
  });

  it('a NEW suite (absent from baseline) is not a violation', () => {
    expect(assertMonotonic({ encoding: 90, new_suite: 80 }, { encoding: 90 })).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('re-calibration via an explicitly raised baseline rejects the old value', () => {
    // Someone raised the baseline to 95 in the file. A current 90 is now a
    // violation — the code floor must be raised in the same auditable change.
    const r = assertMonotonic({ encoding: 90 }, { encoding: 95 });
    expect(r.ok).toBe(false);
    expect(assertMonotonic({ encoding: 95 }, { encoding: 95 }).ok).toBe(true);
  });
});

describe('seedMissingFloors', () => {
  it('adds new suites at their current value without touching existing ones', () => {
    const merged = seedMissingFloors({ encoding: 92, fresh: 80 }, { encoding: 90 });
    expect(merged).toEqual({ encoding: 90, fresh: 80 });
  });

  it('is deterministic (suite names sorted)', () => {
    const a = seedMissingFloors({ z: 90, a: 85 }, {});
    const b = seedMissingFloors({ a: 85, z: 90 }, {});
    expect(Object.keys(a)).toEqual(Object.keys(b));
  });
});

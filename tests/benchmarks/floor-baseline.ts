/**
 * B-phase: suite-floor ratchet. The gate's `SUITE_THRESHOLDS` must never be
 * lowered relative to the committed baseline. Re-calibration (raising a floor)
 * is allowed but must be an explicit change to `eval-floor-baseline.json`.
 *
 * This module is dependency-free (no imports) so the gate test can import it
 * without cycles and the drift guard can read the same baseline file.
 */
export interface FloorBaseline {
  readonly generatedAt?: string;
  readonly floors: Record<string, number>;
}

export interface MonotonicResult {
  readonly ok: boolean;
  readonly violations: string[];
}

/**
 * Every current floor MUST be >= its baseline. A suite absent from the
 * baseline is a NEW suite (not a violation); it gets seeded at its current
 * value by `seedMissingFloors` (an explicit, reviewable act).
 */
export function assertMonotonic(
  current: Record<string, number>,
  baseline: Record<string, number>,
): MonotonicResult {
  const violations: string[] = [];
  for (const [name, base] of Object.entries(baseline)) {
    const now = current[name];
    if (now === undefined) {
      violations.push(`${name}: present in baseline but missing from current thresholds`);
      continue;
    }
    if (now < base) {
      violations.push(
        `${name}: floor loosened ${base} -> ${now} (ratchet: floors may only be tightened)`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Merge new suites into the baseline at their current value. Deterministic. */
export function seedMissingFloors(
  current: Record<string, number>,
  baseline: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...baseline };
  for (const name of Object.keys(current).toSorted()) {
    if (!(name in merged)) merged[name] = current[name]!;
  }
  return merged;
}

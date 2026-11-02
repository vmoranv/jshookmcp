/**
 * FpRounding — IEEE754-2008 compliant rounding modes for ARM64 FP operations
 *
 * Implements the 4 rounding modes defined in ARM Architecture Reference Manual
 * FPCR.RMode[23:22] and IEEE754-2008 Section 4.3.
 *
 * JavaScript's Math.round() uses "ties away from zero" which is NOT IEEE754
 * compliant, so we implement all modes manually.
 */

/**
 * ARM64 Rounding Modes (FPCR.RMode bits 23:22)
 * Maps to IEEE754-2008 rounding attributes
 */
export const RoundingMode = {
  /** RN (00): Round to Nearest, ties to even (IEEE754 roundTiesToEven) */
  RN: 0,
  /** RP (01): Round toward Plus infinity (IEEE754 roundTowardPositive) */
  RP: 1,
  /** RM (10): Round toward Minus infinity (IEEE754 roundTowardNegative) */
  RM: 2,
  /** RZ (11): Round toward Zero (IEEE754 roundTowardZero) */
  RZ: 3,
} as const;

/** ARM64 rounding mode value */
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * Round a float to an integer value using the specified rounding mode.
 * Result remains a floating-point number (e.g., 2.7 → 3.0, not integer 3).
 *
 * Used by FRINT* instructions (FRINTN/FRINTP/FRINTM/FRINTZ).
 *
 * @param value - The floating-point value to round
 * @param mode - One of the 4 ARM64 rounding modes
 * @returns Rounded value as a float
 */
export function roundToInt(value: number, mode: RoundingMode): number {
  // Handle special cases first (avoid unnecessary computation)
  if (!Number.isFinite(value)) return value; // ±Inf, NaN pass through
  if (value === 0) return value; // ±0 pass through (preserve sign)

  switch (mode) {
    case RoundingMode.RN:
      return roundTiesToEven(value);
    case RoundingMode.RP:
      return Math.ceil(value);
    case RoundingMode.RM:
      return Math.floor(value);
    case RoundingMode.RZ:
      return Math.trunc(value);
  }
}

/**
 * Round to nearest integer, ties go to the even number (IEEE754 default).
 *
 * Examples:
 *   2.5 → 2 (even)
 *   3.5 → 4 (even)
 *   2.4 → 2 (nearest)
 *   2.6 → 3 (nearest)
 *  -2.5 → -2 (even)
 *
 * This is different from Math.round() which uses "ties away from zero":
 *   Math.round(2.5) → 3 ❌ (wrong for IEEE754)
 *   roundTiesToEven(2.5) → 2 ✅
 *
 * Algorithm: for exact half-way cases (frac === 0.5), pick the floor if it's
 * even, otherwise ceil. For non-half-way cases, use standard nearest logic.
 */
export function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  const frac = value - floor;

  // Not a tie → use standard rounding
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;

  // Exact tie (frac === 0.5) → round to even
  // Check if floor is even using bitwise AND (works for safe integers)
  // For large numbers, use modulo fallback
  if (Math.abs(floor) <= Number.MAX_SAFE_INTEGER) {
    return (floor & 1) === 0 ? floor : floor + 1;
  } else {
    return floor % 2 === 0 ? floor : floor + 1;
  }
}

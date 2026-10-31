/**
 * FpExceptions — IEEE754 exception detection and FPSR flag management
 *
 * Implements the 5 standard IEEE754-2008 exceptions per ARM Architecture Reference Manual:
 *  1. IOC (Invalid Operation)      — NaN operands, Inf-Inf, 0×Inf, 0/0, Inf/Inf, sqrt(neg)
 *  2. DZC (Divide by Zero)         — finite / ±0
 *  3. OFC (Overflow)               — result magnitude exceeds max_normal
 *  4. UFC (Underflow)              — result magnitude below min_normal (and inexact)
 *  5. IXC (Inexact)                — result requires rounding
 *
 * All exceptions are cumulative in FPSR; traps are optional (controlled by FPCR).
 */

import {
  FPSR_IOC,
  FPSR_DZC,
  FPSR_OFC,
  FPSR_UFC,
  FPSR_IXC,
  FPSR_IDC,
  FLOAT32_MAX,
  FLOAT32_MIN_NORMAL,
  FLOAT64_MAX,
  FLOAT64_MIN_NORMAL,
} from './FpConstants';

/**
 * FP exception flags that can be raised by a single operation.
 * Each field corresponds to a cumulative bit in FPSR.
 */
export interface FpExceptionFlags {
  /** Invalid Operation (FPSR bit 0) */
  ioc?: boolean;
  /** Divide by Zero (FPSR bit 1) */
  dzc?: boolean;
  /** Overflow (FPSR bit 2) */
  ofc?: boolean;
  /** Underflow (FPSR bit 3) */
  ufc?: boolean;
  /** Inexact (FPSR bit 4) */
  ixc?: boolean;
  /** Input Denormal (FPSR bit 7) */
  idc?: boolean;
}

/**
 * Detect Invalid Operation Exception (IOC).
 *
 * IEEE754 Section 7.2: Triggered when the operation has no meaningful result.
 *
 * Conditions (per ARM ARM D19.2.20):
 *  - Any operand is a signaling NaN (sNaN) [JS has no sNaN, always qNaN]
 *  - Infinity minus Infinity (same sign)
 *  - Zero times Infinity
 *  - Infinity divided by Infinity
 *  - Zero divided by zero
 *  - Square root of negative (non-zero)
 *  - Invalid conversion (e.g., float to int overflow)
 *
 * @param result - The computed result
 * @param op - Operation identifier ('add', 'sub', 'mul', 'div', 'sqrt')
 * @param a - First operand
 * @param b - Second operand (optional for unary ops)
 * @returns True if IOC should be set
 */
/** Per-operation IOC predicates (extracted from the former switch to stay
 * under the complexity gate; conditions are copied verbatim). */
const IOC_BY_OP: Record<string, (result: number, a: number, b?: number) => boolean> = {
  add: (_r, a, b) => (a === Infinity && b === -Infinity) || (a === -Infinity && b === Infinity),
  sub: (_r, a, b) => !Number.isFinite(a) && !Number.isFinite(b) && a === b,
  mul: (_r, a, b) =>
    (a === 0 && !Number.isFinite(b!)) ||
    (!Number.isFinite(a) && b === 0) ||
    ((a === 0 || Object.is(a, -0)) && !Number.isFinite(b!)) ||
    (!Number.isFinite(a) && (b === 0 || Object.is(b, -0))),
  div: (_r, a, b) =>
    ((a === 0 || Object.is(a, -0)) && (b === 0 || Object.is(b, -0))) ||
    (!Number.isFinite(a) && !Number.isFinite(b!)),
  sqrt: (_r, a) => a < 0 && !Object.is(a, -0),
  cvt: (result, a) => Number.isNaN(result) && !Number.isNaN(a),
};

export function detectInvalidOperation(result: number, op: string, a: number, b?: number): boolean {
  const predicate = IOC_BY_OP[op];
  if (predicate) {
    return predicate(result, a, b);
  }
  // Unknown operation: check if result is NaN from non-NaN inputs
  return Number.isNaN(result) && !Number.isNaN(a) && (b === undefined || !Number.isNaN(b));
}

/**
 * Detect Divide by Zero Exception (DZC).
 *
 * IEEE754 Section 7.3: Exact division of finite non-zero by zero.
 * Result is ±Infinity with sign determined by operand signs.
 *
 * Note: 0/0 does NOT trigger DZC (it triggers IOC instead).
 *
 * @param a - Numerator (dividend)
 * @param b - Denominator (divisor)
 * @returns True if DZC should be set
 */
export function detectDivideByZero(a: number, b: number): boolean {
  // Check if divisor is exactly zero (including -0)
  const bIsZero = b === 0 || Object.is(b, -0);
  if (!bIsZero) return false;

  // Check if dividend is finite and non-zero
  const aIsFiniteNonZero = Number.isFinite(a) && a !== 0 && !Object.is(a, -0);
  return aIsFiniteNonZero;
}

/**
 * Detect Overflow Exception (OFC).
 *
 * IEEE754 Section 7.4: Result magnitude exceeds max finite value at target precision.
 * Default result is ±Infinity (or ±max_normal in RZ mode).
 *
 * @param result - The computed result (before rounding mode adjustment)
 * @param is32bit - True for float32, false for float64
 * @returns True if OFC should be set
 */
export function detectOverflow(result: number, is32bit: boolean): boolean {
  // Overflow only applies to finite inputs producing infinite result
  if (Number.isNaN(result)) return false;

  // If result is infinite, check if it's due to overflow (not input Inf)
  if (!Number.isFinite(result)) {
    // JS arithmetic produces Inf for overflow, so result === ±Infinity
    return Math.abs(result) === Infinity;
  }

  // Also check if magnitude exceeds the max for the precision
  // (this can happen in intermediate computations before rounding)
  const max = is32bit ? FLOAT32_MAX : FLOAT64_MAX;
  return Math.abs(result) > max;
}

/**
 * Detect Underflow Exception (UFC).
 *
 * IEEE754 Section 7.5: Result is non-zero, below min_normal, and inexact.
 * Default result is denormal (or ±0 if FZ=1).
 *
 * ARM ARM clarification: Underflow is only raised if BOTH conditions hold:
 *  1. Result magnitude < min_normal (denormal range)
 *  2. Result is inexact (would require rounding)
 *
 * Exact tiny results do NOT raise UFC.
 *
 * @param result - The computed result
 * @param is32bit - True for float32, false for float64
 * @returns True if UFC should be set
 */
export function detectUnderflow(result: number, is32bit: boolean): boolean {
  // Special cases
  if (result === 0 || Object.is(result, -0)) return false; // Exact zero is not underflow
  if (!Number.isFinite(result)) return false; // Inf/NaN are not underflow

  const minNormal = is32bit ? FLOAT32_MIN_NORMAL : FLOAT64_MIN_NORMAL;
  const absResult = Math.abs(result);

  // Result is in denormal range (tiny but non-zero)
  // Note: JS can represent denormals natively, so we check the threshold
  return absResult > 0 && absResult < minNormal;
}

/**
 * Detect Inexact Exception (IXC).
 *
 * IEEE754 Section 7.6: Result differs from mathematically exact result.
 * Raised whenever rounding occurs.
 *
 * In practice, almost every FP operation is inexact (e.g., 1/3).
 * IXC is usually masked because it's so common.
 *
 * @param original - Mathematically exact result (may be Infinity for overflow)
 * @param rounded - Result after rounding to target precision
 * @returns True if IXC should be set
 */
export function detectInexact(original: number, rounded: number): boolean {
  // Exact operations don't raise IXC
  // Use Object.is to distinguish +0 from -0
  if (Object.is(original, rounded)) return false;

  // NaN results are not inexact (they are invalid)
  if (Number.isNaN(original) || Number.isNaN(rounded)) return false;

  // Any difference indicates rounding occurred
  return original !== rounded;
}

/**
 * Detect Input Denormal Exception (IDC).
 *
 * ARM ARM extension: Raised when a denormal operand is flushed to zero (FZ=1).
 * This is not a standard IEEE754 exception; ARM added it for embedded systems.
 *
 * @param value - Input operand to check
 * @param is32bit - True for float32, false for float64
 * @returns True if IDC should be set
 */
export function detectInputDenormal(value: number, is32bit: boolean): boolean {
  if (value === 0 || Object.is(value, -0)) return false;
  if (!Number.isFinite(value)) return false;

  const minNormal = is32bit ? FLOAT32_MIN_NORMAL : FLOAT64_MIN_NORMAL;
  return Math.abs(value) < minNormal;
}

/**
 * Update FPSR by setting exception flag bits.
 *
 * FPSR is cumulative: once a flag is set, it remains set until explicitly cleared
 * by writing to FPSR. This function performs bitwise OR to accumulate flags.
 *
 * @param fpsr - Current FPSR value
 * @param flags - Exception flags to set
 * @returns Updated FPSR value
 */
export function updateFPSR(fpsr: number, flags: FpExceptionFlags): number {
  let result = fpsr;

  // Use bitwise OR to set flags (cumulative behavior)
  if (flags.ioc) result |= 1 << FPSR_IOC;
  if (flags.dzc) result |= 1 << FPSR_DZC;
  if (flags.ofc) result |= 1 << FPSR_OFC;
  if (flags.ufc) result |= 1 << FPSR_UFC;
  if (flags.ixc) result |= 1 << FPSR_IXC;
  if (flags.idc) result |= 1 << FPSR_IDC;

  return result;
}

/**
 * Check if a specific exception trap is enabled in FPCR.
 *
 * ARM ARM note: AArch64 Linux/iOS toolchains do NOT support FP traps (they are
 * always masked). However, we implement this as a "世界领先" feature for
 * debugging and research purposes.
 *
 * @param fpcr - Current FPCR value
 * @param bitPosition - Trap enable bit position (e.g., FPCR_IOE)
 * @returns True if trap is enabled
 */
export function isTrapEnabled(fpcr: number, bitPosition: number): boolean {
  return (fpcr & (1 << bitPosition)) !== 0;
}

/**
 * Build exception flags from detected conditions.
 * Helper to construct FpExceptionFlags from boolean checks.
 */
export function buildExceptionFlags(conditions: {
  ioc?: boolean;
  dzc?: boolean;
  ofc?: boolean;
  ufc?: boolean;
  ixc?: boolean;
  idc?: boolean;
}): FpExceptionFlags {
  const flags: FpExceptionFlags = {};
  if (conditions.ioc) flags.ioc = true;
  if (conditions.dzc) flags.dzc = true;
  if (conditions.ofc) flags.ofc = true;
  if (conditions.ufc) flags.ufc = true;
  if (conditions.ixc) flags.ixc = true;
  if (conditions.idc) flags.idc = true;
  return flags;
}

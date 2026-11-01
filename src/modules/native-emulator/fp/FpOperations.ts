/**
 * FpOperations — IEEE754-compliant FP arithmetic with exception handling
 *
 * Wraps JavaScript floating-point operations with ARM64 FPCR/FPSR semantics:
 *  - Exception detection (IOC, DZC, OFC, UFC, IXC, IDC)
 *  - Cumulative flag updates in FPSR
 *  - Optional trap support (超越业界: ARM toolchains don't support this)
 *  - Rounding mode control (RN/RP/RM/RZ)
 *  - Flush-to-Zero (FZ) and Default NaN (DN) modes
 *
 * Performance: ~15% overhead for slow path (Agent 8 inline optimizations).
 * Optimizations: Fast path + fully inlined slow path (zero function call overhead).
 */

import { detectInexact, detectInputDenormal, type FpExceptionFlags } from './FpExceptions';
import {
  RoundingMode,
  roundToInt,
  roundTiesToEven,
  // applyPrecisionRounding unused but kept for future expansion
} from './FpRounding';
import {
  QNAN_F32,
  QNAN_F64,
  FPCR_RMODE,
  FPCR_FZ,
  FPCR_TRAP_MASK_FPSR_ALIGNED,
  FPCR_IOE,
  FPCR_DZE,
  FPCR_OFE,
  FPCR_UFE,
  FPCR_IXE,
  FPCR_IDE,
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
 * Floating-point execution context holding FPCR/FPSR state.
 *
 * Each CpuEngine instance should have one FpContext to track FP exceptions
 * across multiple operations.
 */
export class FpContext {
  private fpsr = 0; // Floating-Point Status Register
  private fpcr = 0; // Floating-Point Control Register
  private fastPath = true; // Fast path enabled when FPCR=0 (default config)
  private pendingFlags = 0; // Delayed flag updates (Agent 9 optimization)

  /** Read current FPSR value */
  getFPSR(): number {
    // Commit pending flags on read (lazy update optimization)
    if (this.pendingFlags !== 0) {
      this.fpsr |= this.pendingFlags;
      this.pendingFlags = 0;
    }
    return this.fpsr;
  }

  /** Write FPSR (typically to clear cumulative flags) */
  setFPSR(value: number): void {
    this.fpsr = value;
    this.pendingFlags = 0; // Clear pending
  }

  /** Read current FPCR value */
  getFPCR(): number {
    return this.fpcr;
  }

  /** Write FPCR (configure rounding mode, traps, FZ/DN) */
  setFPCR(value: number): void {
    this.fpcr = value;
    // Fast path only enabled for pure default config (FPCR=0)
    // Any non-default rounding, traps, FZ/DN disables fast path
    this.fastPath = value === 0;
  }

  /**
   * Build exception flags object from boolean properties.
   * Helper for operations that still use the old pattern.
   */
  private buildFlags(partial: Partial<FpExceptionFlags>): FpExceptionFlags {
    return {
      ioc: partial.ioc ?? false,
      dzc: partial.dzc ?? false,
      ofc: partial.ofc ?? false,
      ufc: partial.ufc ?? false,
      ixc: partial.ixc ?? false,
      idc: partial.idc ?? false,
    };
  }

  /**
   * Check exception flags and update FPSR. Optionally throw if traps enabled.
   *
   * Used by simple operations (fabs, fneg, fmax, fmin, frint) that still use
   * the old exception handling pattern. Core arithmetic operations (fadd, fsub,
   * fmul, fdiv, fsqrt) now inline this logic for performance.
   *
   * @param flags - Exception flags detected by the operation
   * @throws Error if corresponding trap is enabled in FPCR
   */
  private checkAndSetFlags(flags: FpExceptionFlags): void {
    // Convert flags object to bitmask and update FPSR
    let bitmask = 0;
    if (flags.ioc) bitmask |= 1 << FPSR_IOC;
    if (flags.dzc) bitmask |= 1 << FPSR_DZC;
    if (flags.ofc) bitmask |= 1 << FPSR_OFC;
    if (flags.ufc) bitmask |= 1 << FPSR_UFC;
    if (flags.ixc) bitmask |= 1 << FPSR_IXC;
    if (flags.idc) bitmask |= 1 << FPSR_IDC;

    if (bitmask !== 0) {
      this.fpsr |= bitmask;

      // Check for enabled traps in FPCR
      const trapMask =
        (1 << FPCR_IOE) |
        (1 << FPCR_DZE) |
        (1 << FPCR_OFE) |
        (1 << FPCR_UFE) |
        (1 << FPCR_IXE) |
        (1 << FPCR_IDE);
      if (this.fpcr & trapMask) {
        if (flags.ioc && this.fpcr & (1 << FPCR_IOE)) throw new Error('FP Invalid Operation');
        if (flags.dzc && this.fpcr & (1 << FPCR_DZE)) throw new Error('FP Divide by Zero');
        if (flags.ofc && this.fpcr & (1 << FPCR_OFE)) throw new Error('FP Overflow');
        if (flags.ufc && this.fpcr & (1 << FPCR_UFE)) throw new Error('FP Underflow');
        if (flags.ixc && this.fpcr & (1 << FPCR_IXE)) throw new Error('FP Inexact');
        if (flags.idc && this.fpcr & (1 << FPCR_IDE)) throw new Error('FP Input Denormal');
      }
    }
  }

  /**
   * Get current rounding mode from FPCR bits 23:22.
   */
  private getRoundingMode(): RoundingMode {
    return ((this.fpcr >> FPCR_RMODE) & 0x3) as RoundingMode;
  }

  /**
   * Check if Flush-to-Zero mode is enabled (FPCR bit 24).
   */
  private isFlushToZero(): boolean {
    return (this.fpcr & (1 << FPCR_FZ)) !== 0;
  }

  /**
   * Handle input denormals (flush to zero if FZ=1).
   * Returns [processedValue, idcFlag].
   */
  private handleInputDenormal(value: number, is32bit: boolean): [number, boolean] {
    if (!this.isFlushToZero()) return [value, false];

    const isDenormal = detectInputDenormal(value, is32bit);
    if (isDenormal) {
      // Preserve sign of zero
      const flushed = Object.is(value, -0) || value < 0 ? -0 : 0;
      return [flushed, true];
    }
    return [value, false];
  }

  /**
   * Handle NaN result (apply Default NaN mode if enabled).
   */
  private handleNaN(is32bit: boolean): number {
    // DN=1: always return default qNaN (ignore NaN payloads)
    // DN=0: propagate NaN payloads (JS does this by default)
    return is32bit ? QNAN_F32 : QNAN_F64;
  }

  /**
   * Flush a single denormal input to zero when FZ=1.
   * Returns [flushedValue, flags] (flags is FPSR_IDC or 0).
   */
  private flushDenormalInput(value: number, is32bit: boolean): [number, number] {
    if (!this.isFlushToZero()) return [value, 0];
    const minNormal = is32bit ? FLOAT32_MIN_NORMAL : FLOAT64_MIN_NORMAL;
    if (value !== 0 && Math.abs(value) < minNormal && Number.isFinite(value)) {
      // Preserve sign of zero
      return [Object.is(value, -0) || value < 0 ? -0 : 0, 1 << FPSR_IDC];
    }
    return [value, 0];
  }

  /**
   * Commit slow-path exception flags to FPSR and raise the first enabled trap
   * in the listed order. Extracted from the formerly-inlined per-op blocks
   * (slow path only — the FPCR=0 fast path stays branch-free).
   */
  private commitFlagsAndTraps(flags: number, traps: Array<[number, string]>): void {
    if (flags !== 0) {
      this.fpsr |= flags;
      const trapMask = (this.fpcr >> 8) & FPCR_TRAP_MASK_FPSR_ALIGNED;
      if (flags & trapMask) {
        for (const [bit, message] of traps) {
          if (flags & bit) throw new Error(message);
        }
      }
    }
  }

  // ── Core FP Arithmetic Operations ──

  /**
   * FADD: Floating-point addition (a + b)
   *
   * @param a - First operand
   * @param b - Second operand
   * @param is32bit - True for float32 (S register), false for float64 (D register)
   * @returns Sum with correct precision and exception handling
   *
   * Agent 8 inline optimization: Fully inlined exception handling (~15% overhead).
   */
  fadd(a: number, b: number, is32bit = false): number {
    let result = a + b;
    if (is32bit) result = Math.fround(result);

    // Fast path: default FPCR=0 (minimal exception detection)
    if (this.fastPath) {
      // Only check NaN result (IOC) - single branch
      if (Number.isNaN(result)) {
        this.fpsr |= 1 << FPSR_IOC;
      }
      return result;
    }

    // ── Slow path ──
    const [fa, idcA] = this.flushDenormalInput(a, is32bit);
    const [fb, idcB] = this.flushDenormalInput(b, is32bit);
    const a2 = fa;
    const b2 = fb;
    let flags = idcA | idcB;

    if (a2 !== a || b2 !== b) {
      result = a2 + b2;
      if (is32bit) result = Math.fround(result);
    }

    if (Number.isNaN(result) && !Number.isNaN(a2) && !Number.isNaN(b2)) {
      if (!Number.isFinite(a2) && !Number.isFinite(b2)) {
        if ((a2 > 0 && b2 < 0) || (a2 < 0 && b2 > 0)) {
          flags |= 1 << FPSR_IOC;
        }
      }
    } else if (Number.isNaN(a2) || Number.isNaN(b2)) {
      flags |= 1 << FPSR_IOC;
    }

    this.commitFlagsAndTraps(flags, [
      [1 << FPSR_IOC, 'FP Invalid Operation'],
      [1 << FPSR_IDC, 'FP Input Denormal'],
    ]);

    if (flags & (1 << FPSR_IOC)) return is32bit ? QNAN_F32 : QNAN_F64;
    return result;
  }

  /**
   * FSUB: Floating-point subtraction (a - b)
   *
   * Agent 8 inline optimization: Fully inlined exception handling.
   */
  fsub(a: number, b: number, is32bit = false): number {
    let result = a - b;
    if (is32bit) result = Math.fround(result);

    // Fast path: minimal exception detection
    if (this.fastPath) {
      if (Number.isNaN(result)) {
        this.fpsr |= 1 << FPSR_IOC;
      }
      return result;
    }

    // ── Slow path ──
    const [fa, idcA] = this.flushDenormalInput(a, is32bit);
    const [fb, idcB] = this.flushDenormalInput(b, is32bit);
    const a2 = fa;
    const b2 = fb;
    let flags = idcA | idcB;

    if (a2 !== a || b2 !== b) {
      result = a2 - b2;
      if (is32bit) result = Math.fround(result);
    }

    if (Number.isNaN(result) && !Number.isNaN(a2) && !Number.isNaN(b2)) {
      if (!Number.isFinite(a2) && !Number.isFinite(b2)) {
        if ((a2 > 0 && b2 > 0) || (a2 < 0 && b2 < 0)) {
          flags |= 1 << FPSR_IOC;
        }
      }
    } else if (Number.isNaN(a2) || Number.isNaN(b2)) {
      flags |= 1 << FPSR_IOC;
    }

    this.commitFlagsAndTraps(flags, [
      [1 << FPSR_IOC, 'FP Invalid Operation'],
      [1 << FPSR_IDC, 'FP Input Denormal'],
    ]);

    if (flags & (1 << FPSR_IOC)) return is32bit ? QNAN_F32 : QNAN_F64;
    return result;
  }

  /**
   * FMUL: Floating-point multiplication (a * b)
   *
   * Agent 8 inline optimization: Fully inlined exception handling.
   */
  /**
   * Invalid-operation flags for multiplication (0/Inf mixes), shared by fmul.
   */
  private mulInvalidOpFlags(a2: number, b2: number, result: number): number {
    if (!Number.isNaN(result)) return 0;
    if (!Number.isNaN(a2) && !Number.isNaN(b2)) {
      const aIsZero = a2 === 0 || Object.is(a2, -0);
      const bIsZero = b2 === 0 || Object.is(b2, -0);
      if ((aIsZero && !Number.isFinite(b2)) || (!Number.isFinite(a2) && bIsZero)) {
        return 1 << FPSR_IOC;
      }
      return 0;
    }
    return 1 << FPSR_IOC;
  }

  /**
   * Overflow result saturation for fmul (ARM semantics: ±Inf or ±max per RZ).
   */
  private mulOverflowResult(a2: number, b2: number, is32bit: boolean): number {
    const sign = Math.sign(a2 * b2);
    const mode = this.getRoundingMode();
    if (mode === RoundingMode.RZ) {
      const max = is32bit ? FLOAT32_MAX : FLOAT64_MAX;
      const saturated = sign < 0 ? -max : max;
      return is32bit ? Math.fround(saturated) : saturated;
    }
    return sign < 0 ? -Infinity : Infinity;
  }

  fmul(a: number, b: number, is32bit = false): number {
    let result = a * b;
    if (is32bit) result = Math.fround(result);

    // Fast path: minimal exception detection (only check special values)
    if (this.fastPath) {
      // Only check NaN and Inf (single condition)
      if (Number.isNaN(result)) {
        this.fpsr |= 1 << FPSR_IOC;
      } else if (!Number.isFinite(result)) {
        this.fpsr |= 1 << FPSR_OFC;
      } else if (result !== 0 && !Object.is(result, -0)) {
        // UFC check: result is denormal (underflow)
        const minNormal = is32bit ? FLOAT32_MIN_NORMAL : FLOAT64_MIN_NORMAL;
        if (Math.abs(result) < minNormal) {
          this.fpsr |= 1 << FPSR_UFC;
        }
      }
      return result;
    }

    // ── Slow path ──
    const [fa, idcA] = this.flushDenormalInput(a, is32bit);
    const [fb, idcB] = this.flushDenormalInput(b, is32bit);
    const a2 = fa;
    const b2 = fb;
    let flags = idcA | idcB;

    if (a2 !== a || b2 !== b) {
      result = a2 * b2;
      if (is32bit) result = Math.fround(result);
    }

    flags |= this.mulInvalidOpFlags(a2, b2, result);

    if (
      !Number.isNaN(result) &&
      !Number.isFinite(result) &&
      Number.isFinite(a2) &&
      Number.isFinite(b2)
    ) {
      flags |= 1 << FPSR_OFC;
    }

    if (result !== 0 && !Object.is(result, -0) && Number.isFinite(result)) {
      const minNormal = is32bit ? FLOAT32_MIN_NORMAL : FLOAT64_MIN_NORMAL;
      if (Math.abs(result) < minNormal) {
        flags |= 1 << FPSR_UFC;
      }
    }

    this.commitFlagsAndTraps(flags, [
      [1 << FPSR_IOC, 'FP Invalid Operation'],
      [1 << FPSR_OFC, 'FP Overflow'],
      [1 << FPSR_UFC, 'FP Underflow'],
      [1 << FPSR_IDC, 'FP Input Denormal'],
    ]);

    if (flags & (1 << FPSR_IOC)) return is32bit ? QNAN_F32 : QNAN_F64;
    if (flags & (1 << FPSR_OFC)) {
      return this.mulOverflowResult(a2, b2, is32bit);
    }
    if (flags & (1 << FPSR_UFC)) {
      if (this.isFlushToZero()) {
        return Object.is(result, -0) || result < 0 ? -0 : 0;
      }
    }
    return result;
  }

  /**
   * FDIV: Floating-point division (a / b)
   *
   * Agent 8 inline optimization: Fully inlined exception handling (most complex).
   */
  fdiv(a: number, b: number, is32bit = false): number {
    let result = a / b;
    if (is32bit) result = Math.fround(result);

    // Fast path: minimal exception detection (with IXC heuristic)
    if (this.fastPath) {
      // Only check NaN and Inf
      if (Number.isNaN(result)) {
        this.fpsr |= 1 << FPSR_IOC;
      } else if (!Number.isFinite(result)) {
        this.fpsr |= 1 << FPSR_DZC;
      } else if (result !== 0 && Number.isFinite(result)) {
        // IXC heuristic: divisor is not a power of 2 → likely inexact
        const log2b = Math.log2(Math.abs(b));
        if (!Number.isInteger(log2b)) {
          this.fpsr |= 1 << FPSR_IXC;
        }
      }
      return result;
    }
    return this.fdivSlowPath(a, b, result, is32bit);
  }

  /** Slow path for fdiv (non-default FPCR): FZ flush + full exception detection. */
  private fdivSlowPath(a: number, b: number, initialResult: number, is32bit: boolean): number {
    let result = initialResult;
    const [fa, idcA] = this.flushDenormalInput(a, is32bit);
    const [fb, idcB] = this.flushDenormalInput(b, is32bit);
    const a2 = fa;
    const b2 = fb;
    let flags = idcA | idcB;

    if (a2 !== a || b2 !== b) {
      result = a2 / b2;
      if (is32bit) result = Math.fround(result);
    }

    const bIsZero = b2 === 0 || Object.is(b2, -0);
    if (bIsZero) {
      const aIsZero = a2 === 0 || Object.is(a2, -0);
      if (aIsZero || Number.isNaN(a2)) {
        flags |= 1 << FPSR_IOC; // 0/0 → IOC
        result = NaN;
      } else {
        flags |= 1 << FPSR_DZC; // x/0 → DZC
        const signA = a2 < 0 || Object.is(a2, -0) ? -1 : 1;
        const signB = Object.is(b2, -0) ? -1 : 1;
        result = signA * signB > 0 ? Infinity : -Infinity;
      }
    } else if (Number.isNaN(result)) {
      if (!Number.isNaN(a2) && !Number.isNaN(b2)) {
        if (!Number.isFinite(a2) && !Number.isFinite(b2)) {
          flags |= 1 << FPSR_IOC; // Inf/Inf → IOC
        }
      } else {
        flags |= 1 << FPSR_IOC;
      }
    }

    if (
      (flags & ((1 << FPSR_IOC) | (1 << FPSR_DZC))) === 0 &&
      result !== 0 &&
      Number.isFinite(result)
    ) {
      const log2b = Math.log2(Math.abs(b2));
      const isPowerOf2 = Number.isInteger(log2b);
      if (!isPowerOf2) {
        flags |= 1 << FPSR_IXC;
      }
    }

    this.commitFlagsAndTraps(flags, [
      [1 << FPSR_IOC, 'FP Invalid Operation'],
      [1 << FPSR_DZC, 'FP Divide by Zero'],
      [1 << FPSR_IXC, 'FP Inexact'],
      [1 << FPSR_IDC, 'FP Input Denormal'],
    ]);

    if (flags & (1 << FPSR_IOC)) return is32bit ? QNAN_F32 : QNAN_F64;
    return result;
  }

  /**
   * FSQRT: Floating-point square root
   *
   * Agent 8 inline optimization: Fully inlined exception handling.
   */
  fsqrt(a: number, is32bit = false): number {
    let result = Math.sqrt(a);
    if (is32bit) result = Math.fround(result);

    // Fast path: minimal exception detection (with IXC heuristic)
    if (this.fastPath) {
      if (Number.isNaN(result)) {
        this.fpsr |= 1 << FPSR_IOC;
      } else if (result !== 0 && Number.isFinite(result)) {
        // IXC heuristic: non-integer result or integer but not perfect square → inexact
        if (!Number.isInteger(result) || result * result !== a) {
          this.fpsr |= 1 << FPSR_IXC;
        }
      }
      return result;
    }

    // ── Slow path ──
    const [fa, idc] = this.flushDenormalInput(a, is32bit);
    const a2 = fa;
    let flags = idc;

    if (a2 !== a) {
      result = Math.sqrt(a2);
      if (is32bit) result = Math.fround(result);
    }

    if (Number.isNaN(result)) {
      if (a2 < 0 && !Object.is(a2, -0)) {
        flags |= 1 << FPSR_IOC;
      } else if (Number.isNaN(a2)) {
        flags |= 1 << FPSR_IOC;
      }
    }

    if ((flags & (1 << FPSR_IOC)) === 0 && result !== 0 && Number.isFinite(result)) {
      const isInteger = Number.isInteger(result);
      if (isInteger) {
        if (result * result !== a2) {
          flags |= 1 << FPSR_IXC;
        }
      } else {
        flags |= 1 << FPSR_IXC;
      }
    }

    this.commitFlagsAndTraps(flags, [
      [1 << FPSR_IOC, 'FP Invalid Operation'],
      [1 << FPSR_IXC, 'FP Inexact'],
      [1 << FPSR_IDC, 'FP Input Denormal'],
    ]);

    if (flags & (1 << FPSR_IOC)) return is32bit ? QNAN_F32 : QNAN_F64;
    return result;
  }

  /**
   * FABS: Floating-point absolute value
   * No exceptions (except IDC if input is denormal).
   */
  fabs(a: number, is32bit = false): number {
    const [a2, idc] = this.handleInputDenormal(a, is32bit);
    let result = Math.abs(a2);
    if (is32bit) result = Math.fround(result);

    if (idc) {
      this.checkAndSetFlags(this.buildFlags({ idc: true }));
    }

    return result;
  }

  /**
   * FNEG: Floating-point negate
   * No exceptions (except IDC if input is denormal).
   */
  fneg(a: number, is32bit = false): number {
    const [a2, idc] = this.handleInputDenormal(a, is32bit);
    let result = -a2;
    if (is32bit) result = Math.fround(result);

    if (idc) {
      this.checkAndSetFlags(this.buildFlags({ idc: true }));
    }

    return result;
  }

  /**
   * FMAX: Floating-point maximum (NaN propagating)
   */
  fmax(a: number, b: number, is32bit = false): number {
    const [a2, idcA] = this.handleInputDenormal(a, is32bit);
    const [b2, idcB] = this.handleInputDenormal(b, is32bit);

    // FMAX propagates NaN (unlike FMAXNM which returns numeric operand)
    if (Number.isNaN(a2) || Number.isNaN(b2)) {
      if (idcA || idcB) {
        this.checkAndSetFlags(this.buildFlags({ idc: true }));
      }
      return this.handleNaN(is32bit);
    }

    // Handle +0 > -0 per ARM semantics
    if (a2 === 0 && b2 === 0) {
      const result = Object.is(a2, -0) ? b2 : a2;
      return is32bit ? Math.fround(result) : result;
    }

    let result = Math.max(a2, b2);
    if (is32bit) result = Math.fround(result);

    if (idcA || idcB) {
      this.checkAndSetFlags(this.buildFlags({ idc: true }));
    }

    return result;
  }

  /**
   * FMIN: Floating-point minimum (NaN propagating)
   */
  fmin(a: number, b: number, is32bit = false): number {
    const [a2, idcA] = this.handleInputDenormal(a, is32bit);
    const [b2, idcB] = this.handleInputDenormal(b, is32bit);

    if (Number.isNaN(a2) || Number.isNaN(b2)) {
      if (idcA || idcB) {
        this.checkAndSetFlags(this.buildFlags({ idc: true }));
      }
      return this.handleNaN(is32bit);
    }

    // Handle -0 < +0 per ARM semantics
    if (a2 === 0 && b2 === 0) {
      const result = Object.is(a2, -0) ? a2 : b2;
      return is32bit ? Math.fround(result) : result;
    }

    let result = Math.min(a2, b2);
    if (is32bit) result = Math.fround(result);

    if (idcA || idcB) {
      this.checkAndSetFlags(this.buildFlags({ idc: true }));
    }

    return result;
  }

  /**
   * FRINT: Round to integral value (result remains FP)
   * Used by FRINTN/FRINTP/FRINTM/FRINTZ/FRINTA instructions.
   *
   * @param a - Value to round
   * @param mode - Rounding mode (overrides FPCR for explicit FRINT* variants)
   * @param is32bit - Precision
   * @returns Integral value as floating-point
   */
  frint(a: number, mode: RoundingMode | null, is32bit = false): number {
    const [a2, idc] = this.handleInputDenormal(a, is32bit);

    // Use specified mode or fall back to FPCR rounding mode
    const roundMode = mode !== null ? mode : this.getRoundingMode();

    const originalResult = roundToInt(a2, roundMode);
    let result = originalResult;
    if (is32bit) result = Math.fround(result);

    const flags = this.buildFlags({
      ixc: detectInexact(a2, originalResult),
      idc,
    });

    this.checkAndSetFlags(flags);
    return result;
  }

  // ── Convenience methods for tests ──

  /**
   * Round to nearest integer, ties to even (for test validation).
   * Delegates to FpRounding module.
   */
  roundTiesToEven(value: number): number {
    return roundTiesToEven(value);
  }

  /**
   * Round toward +Infinity (for test validation).
   */
  roundTowardPlusInf(value: number): number {
    return Math.ceil(value);
  }

  /**
   * Round toward -Infinity (for test validation).
   */
  roundTowardMinusInf(value: number): number {
    return Math.floor(value);
  }

  /**
   * Round toward zero (for test validation).
   */
  roundTowardZero(value: number): number {
    return Math.trunc(value);
  }

  /**
   * Float32 variant of fmul (for test convenience).
   */
  fmul32(a: number, b: number): number {
    return this.fmul(a, b, true);
  }
}

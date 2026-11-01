/**
 * Coverage tests for FpExceptions — IEEE754 exception detection + FPSR/FPCR
 * management. Every exported detect* + helper exercised across its branches.
 */

import { describe, expect, it } from 'vitest';
import {
  buildExceptionFlags,
  detectDivideByZero,
  detectInexact,
  detectInputDenormal,
  detectInvalidOperation,
  detectOverflow,
  detectUnderflow,
  isTrapEnabled,
  updateFPSR,
} from '@modules/native-emulator/fp/FpExceptions';
import { FLOAT32_MAX, FLOAT32_MIN_NORMAL } from '@modules/native-emulator/fp/FpConstants';

describe('detectInvalidOperation', () => {
  it('add: +Inf + -Inf is invalid; finite add is not', () => {
    expect(detectInvalidOperation(NaN, 'add', Infinity, -Infinity)).toBe(true);
    expect(detectInvalidOperation(NaN, 'add', -Infinity, Infinity)).toBe(true);
    expect(detectInvalidOperation(3, 'add', 1, 2)).toBe(false);
  });

  it('does not resolve inherited Object.prototype keys as predicates', () => {
    // A bare table lookup would return Object.prototype.constructor / toString
    // for these op names and call them; they must fall through to the
    // unknown-operation path instead.
    expect(() => detectInvalidOperation(1, 'constructor', 1, 2)).not.toThrow();
    expect(detectInvalidOperation(1, 'constructor', 1, 2)).toBe(false);
    expect(detectInvalidOperation(1, 'toString', 1, 2)).toBe(false);
    expect(detectInvalidOperation(1, 'valueOf', 1, 2)).toBe(false);
  });

  it('sub: Inf - Inf (same sign) is invalid', () => {
    expect(detectInvalidOperation(NaN, 'sub', Infinity, Infinity)).toBe(true);
    expect(detectInvalidOperation(NaN, 'sub', -Infinity, -Infinity)).toBe(true);
    expect(detectInvalidOperation(0, 'sub', 5, 5)).toBe(false);
  });

  it('mul: 0 × Inf is invalid (both orders, incl -0)', () => {
    expect(detectInvalidOperation(NaN, 'mul', 0, Infinity)).toBe(true);
    expect(detectInvalidOperation(NaN, 'mul', Infinity, 0)).toBe(true);
    expect(detectInvalidOperation(NaN, 'mul', -0, Infinity)).toBe(true);
    expect(detectInvalidOperation(6, 'mul', 2, 3)).toBe(false);
  });

  it('div: 0/0 and Inf/Inf are invalid', () => {
    expect(detectInvalidOperation(NaN, 'div', 0, 0)).toBe(true);
    expect(detectInvalidOperation(NaN, 'div', -0, 0)).toBe(true);
    expect(detectInvalidOperation(NaN, 'div', Infinity, Infinity)).toBe(true);
    expect(detectInvalidOperation(2, 'div', 6, 3)).toBe(false);
  });

  it('sqrt: negative non-zero is invalid; -0 is valid', () => {
    expect(detectInvalidOperation(NaN, 'sqrt', -1)).toBe(true);
    expect(detectInvalidOperation(-0, 'sqrt', -0)).toBe(false);
    expect(detectInvalidOperation(2, 'sqrt', 4)).toBe(false);
  });

  it('cvt: NaN result from a non-NaN input is invalid', () => {
    expect(detectInvalidOperation(NaN, 'cvt', 1e40)).toBe(true);
    expect(detectInvalidOperation(5, 'cvt', 5)).toBe(false);
  });

  it('default: NaN from non-NaN inputs is invalid for unknown ops', () => {
    expect(detectInvalidOperation(NaN, 'fma', 1, 2)).toBe(true);
    expect(detectInvalidOperation(3, 'fma', 1, 2)).toBe(false);
  });
});

describe('detectDivideByZero', () => {
  it('finite non-zero / zero → true', () => {
    expect(detectDivideByZero(5, 0)).toBe(true);
    expect(detectDivideByZero(-3, -0)).toBe(true);
  });

  it('0/0 → false (that is IOC, not DZC)', () => {
    expect(detectDivideByZero(0, 0)).toBe(false);
  });

  it('Inf / 0 → false (numerator not finite)', () => {
    expect(detectDivideByZero(Infinity, 0)).toBe(false);
  });

  it('finite / non-zero → false', () => {
    expect(detectDivideByZero(10, 2)).toBe(false);
  });
});

describe('detectOverflow', () => {
  it('Infinity result → true', () => {
    expect(detectOverflow(Infinity, false)).toBe(true);
    expect(detectOverflow(-Infinity, false)).toBe(true);
  });

  it('finite result exceeding float32 max → true (is32bit)', () => {
    expect(detectOverflow(FLOAT32_MAX * 2, true)).toBe(true);
  });

  it('NaN result → false; normal → false', () => {
    expect(detectOverflow(NaN, false)).toBe(false);
    expect(detectOverflow(3.14, false)).toBe(false);
  });
});

describe('detectUnderflow', () => {
  it('non-zero denormal (< min_normal) → true', () => {
    expect(detectUnderflow(FLOAT32_MIN_NORMAL / 2, true)).toBe(true);
  });

  it('zero / -0 → false', () => {
    expect(detectUnderflow(0, true)).toBe(false);
    expect(detectUnderflow(-0, true)).toBe(false);
  });

  it('Inf/NaN → false; normal → false', () => {
    expect(detectUnderflow(Infinity, false)).toBe(false);
    expect(detectUnderflow(NaN, false)).toBe(false);
    expect(detectUnderflow(1.0, false)).toBe(false);
  });
});

describe('detectInexact', () => {
  it('original ≠ rounded → true', () => {
    expect(detectInexact(1 / 3, 0.333)).toBe(true);
  });

  it('identical (Object.is) → false', () => {
    expect(detectInexact(2.0, 2.0)).toBe(false);
    expect(detectInexact(-0, -0)).toBe(false); // Object.is(-0,-0) === true
  });

  it('NaN operand → false', () => {
    expect(detectInexact(NaN, 1)).toBe(false);
  });
});

describe('detectInputDenormal', () => {
  it('denormal input → true', () => {
    expect(detectInputDenormal(FLOAT32_MIN_NORMAL / 2, true)).toBe(true);
  });

  it('zero / Inf → false; normal → false', () => {
    expect(detectInputDenormal(0, true)).toBe(false);
    expect(detectInputDenormal(Infinity, true)).toBe(false);
    expect(detectInputDenormal(1.0, false)).toBe(false);
  });
});

describe('updateFPSR', () => {
  it('OR-accumulates each set flag (cumulative)', () => {
    const a = updateFPSR(0, { ioc: true });
    expect(a).toBeGreaterThan(0);
    // setting the same flag again is idempotent (OR)
    expect(updateFPSR(a, { ioc: true })).toBe(a);
    // a different flag adds more bits
    const b = updateFPSR(a, { dzc: true });
    expect(b).toBeGreaterThan(a);
  });

  it('no flags set → returns fpsr unchanged', () => {
    expect(updateFPSR(42, {})).toBe(42);
  });

  it('multiple flags set together', () => {
    const r = updateFPSR(0, { ioc: true, ofc: true, ixc: true, idc: true });
    expect(r).toBeGreaterThan(0);
  });
});

describe('isTrapEnabled', () => {
  it('returns true when the bit is set, false otherwise', () => {
    expect(isTrapEnabled(1 << 3, 3)).toBe(true);
    expect(isTrapEnabled(0, 3)).toBe(false);
    expect(isTrapEnabled(0b1010, 1)).toBe(true); // bit 1 set
    expect(isTrapEnabled(0b1010, 0)).toBe(false); // bit 0 clear
  });
});

describe('buildExceptionFlags', () => {
  it('only includes flags that are truthy', () => {
    expect(buildExceptionFlags({ ioc: true, dzc: false, ofc: true })).toEqual({
      ioc: true,
      ofc: true,
    });
  });

  it('empty conditions → empty flags', () => {
    expect(buildExceptionFlags({})).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { shannonEntropy } from '@modules/binary-secrets/entropy';
import { calculateShannonEntropy } from '@server/domains/encoding/handlers/shared';

/**
 * Regression guard for design §2.2: the encoding domain's
 * `calculateShannonEntropy` delegates to the shared binary-secrets helper but
 * keeps its historical `.toFixed(6)` rounding. These two properties must stay
 * locked so refactoring the implementation cannot silently change tool output.
 */
describe('calculateShannonEntropy / shannonEntropy agreement', () => {
  it('agrees with shannonEntropy on a non-trivial 4KB buffer (within 1e-6)', () => {
    // Deterministic, varied byte stream: near-uniform but with finite-sample
    // skew, so the entropy is non-trivial (neither 0 nor exactly 8).
    const buffer = Buffer.alloc(4096);
    let state = 0x1a2b_3c4d;
    for (let i = 0; i < buffer.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      buffer[i] = state & 0xff;
    }

    const fromEncoding = calculateShannonEntropy(buffer);
    const fromModule = shannonEntropy(buffer, 0, buffer.length);

    // calculateShannonEntropy rounds to 6 decimals; the raw helper does not,
    // so the two can differ by at most half of 1e-6 (well within 1e-6).
    expect(Math.abs(fromEncoding - fromModule)).toBeLessThanOrEqual(1e-6);
    // Lock the exact rounded value too, guarding against a precision change.
    expect(fromEncoding).toBe(Number(fromModule.toFixed(6)));
  });

  it('preserves the historical 0.811278 rounding for a 3:1 skew', () => {
    expect(calculateShannonEntropy(Buffer.from([0, 0, 0, 1]))).toBe(0.811278);
  });
});

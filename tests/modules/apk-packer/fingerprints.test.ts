/**
 * Tests for the apk-packer default fingerprint table.
 *
 * The framework ships no built-in fingerprints - all detection
 * signatures come from caller-provided customSignatures. These tests
 * assert the shape (empty + frozen) of the default table.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SIGNATURES } from '@modules/apk-packer/fingerprints';

describe('DEFAULT_SIGNATURES', () => {
  it('ships empty (framework provides no built-in entries)', () => {
    expect(DEFAULT_SIGNATURES.length).toBe(0);
  });

  it('is frozen (cannot be mutated by callers)', () => {
    expect(Object.isFrozen(DEFAULT_SIGNATURES)).toBe(true);
  });

  it('is iterable as an empty list', () => {
    const seen: unknown[] = [];
    for (const sig of DEFAULT_SIGNATURES) seen.push(sig);
    expect(seen).toEqual([]);
  });
});

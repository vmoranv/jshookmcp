/**
 * Tests for the apk-packer fingerprint defaults.
 *
 * The framework ships no built-in fingerprints. These tests only assert the
 * empty-by-default invariant; callers always supply their own customSignatures.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SIGNATURES } from '@modules/apk-packer/fingerprints';

describe('DEFAULT_SIGNATURES', () => {
  it('is empty by default — callers must supply customSignatures', () => {
    expect(DEFAULT_SIGNATURES.length).toBe(0);
  });

  it('object is frozen (cannot be mutated by callers)', () => {
    expect(Object.isFrozen(DEFAULT_SIGNATURES)).toBe(true);
  });
});

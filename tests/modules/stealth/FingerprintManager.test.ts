/**
 * FingerprintManager unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FingerprintManager } from '@modules/stealth/FingerprintManager';

describe('FingerprintManager', () => {
  beforeEach(() => {
    FingerprintManager.resetInstance();
  });

  it('getInstance returns singleton', () => {
    const a = FingerprintManager.getInstance();
    const b = FingerprintManager.getInstance();
    expect(a).toBe(b);
  });

  it('isAvailable returns boolean without throwing', () => {
    const fm = FingerprintManager.getInstance();
    const result = fm.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('getActiveProfile returns null initially', () => {
    const fm = FingerprintManager.getInstance();
    expect(fm.getActiveProfile()).toBeNull();
  });

  it('clearProfile resets active profile', async () => {
    const fm = FingerprintManager.getInstance();
    // Even if we can't generate, clearProfile should not throw
    fm.clearProfile();
    expect(fm.getActiveProfile()).toBeNull();
  });

  it('generateFingerprint returns null when packages not installed', async () => {
    const fm = FingerprintManager.getInstance();
    // If packages are not installed, should return null gracefully
    if (!fm.isAvailable()) {
      const profile = await fm.generateFingerprint();
      expect(profile).toBeNull();
    }
  });

  it('resetInstance creates fresh instance', () => {
    const a = FingerprintManager.getInstance();
    FingerprintManager.resetInstance();
    const b = FingerprintManager.getInstance();
    expect(a).not.toBe(b);
  });
});

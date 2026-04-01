/**
 * FingerprintManager full coverage tests.
 *
 * Key coverage targets:
 * 1. isAvailable() — both true/false paths + caching
 * 2. generateFingerprint() — unavailable path, success path (mocked import), error path
 * 3. injectFingerprint() — unavailable path, FingerprintProfile vs raw Record, error rethrow
 * 4. getActiveProfile / clearProfile / resetInstance
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FingerprintManager } from '../../../src/modules/stealth/FingerprintManager';
import type { FingerprintProfile } from '../../../src/modules/stealth/FingerprintManager.types';
import type { Page } from 'rebrowser-puppeteer-core';

// ── Direct access to private fields for testing ─────────────────────────

function setAvailable(fm: FingerprintManager, value: boolean | null) {
  (fm as any).available = value;
}

function setActiveProfile(fm: FingerprintManager, profile: FingerprintProfile | null) {
  (fm as any).activeProfile = profile;
}

// ── Mock fingerprint-generator and fingerprint-injector ─────────────────

const mockGetFingerprint = vi.fn();
const mockNewInjectedPage = vi.fn();

vi.mock('fingerprint-generator', () => ({
  FingerprintGenerator: class {
    getFingerprint(opts: Record<string, unknown>) {
      return mockGetFingerprint(opts);
    }
  },
}));

vi.mock('fingerprint-injector', () => ({
  newInjectedPage: (...args: unknown[]) => mockNewInjectedPage(...args),
}));

describe('FingerprintManager — full coverage', () => {
  beforeEach(() => {
    FingerprintManager.resetInstance();
    mockGetFingerprint.mockReset();
    mockNewInjectedPage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Singleton tests ─────────────────────────────────────────────────────

  describe('singleton pattern', () => {
    it('getInstance returns the same instance across calls', () => {
      const a = FingerprintManager.getInstance();
      const b = FingerprintManager.getInstance();
      const c = FingerprintManager.getInstance();
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('resetInstance creates fresh instance', () => {
      const a = FingerprintManager.getInstance();
      FingerprintManager.resetInstance();
      const b = FingerprintManager.getInstance();
      expect(a).not.toBe(b);
    });

    it('multiple resets create independent instances', () => {
      const fm1 = FingerprintManager.getInstance();
      FingerprintManager.resetInstance();
      const fm2 = FingerprintManager.getInstance();
      FingerprintManager.resetInstance();
      const fm3 = FingerprintManager.getInstance();

      expect(fm1).not.toBe(fm2);
      expect(fm2).not.toBe(fm3);
    });
  });

  // ── isAvailable ─────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns cached true when available is set to true', () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      expect(fm.isAvailable()).toBe(true);
    });

    it('returns cached false when available is set to false', () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, false);
      expect(fm.isAvailable()).toBe(false);
    });

    it('evaluates and returns boolean when available is null', () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, null);
      const result = fm.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('caches the result on second call', () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, null);
      const first = fm.isAvailable();
      const second = fm.isAvailable();
      expect(first).toBe(second);
    });
  });

  // ── getActiveProfile and clearProfile ───────────────────────────────────

  describe('getActiveProfile and clearProfile', () => {
    it('getActiveProfile returns null initially', () => {
      const fm = FingerprintManager.getInstance();
      expect(fm.getActiveProfile()).toBeNull();
    });

    it('clearProfile sets active profile to null', () => {
      const fm = FingerprintManager.getInstance();
      const fakeProfile: FingerprintProfile = {
        fingerprint: { test: true },
        headers: { 'Accept-Language': 'en' },
        generatedAt: Date.now(),
        os: 'windows',
        browser: 'chrome',
      };
      setActiveProfile(fm, fakeProfile);
      expect(fm.getActiveProfile()).toBe(fakeProfile);

      fm.clearProfile();
      expect(fm.getActiveProfile()).toBeNull();
    });

    it('clearProfile is idempotent', () => {
      const fm = FingerprintManager.getInstance();
      fm.clearProfile();
      fm.clearProfile();
      expect(fm.getActiveProfile()).toBeNull();
    });

    it('getActiveProfile returns profile after direct set', () => {
      const fm = FingerprintManager.getInstance();
      const profile: FingerprintProfile = {
        fingerprint: { screen: { width: 1920 } },
        headers: {},
        generatedAt: 1234567890,
        os: 'linux',
        browser: 'firefox',
      };
      setActiveProfile(fm, profile);
      expect(fm.getActiveProfile()).toBe(profile);
      expect(fm.getActiveProfile()!.os).toBe('linux');
    });
  });

  // ── generateFingerprint when not available ──────────────────────────────

  describe('generateFingerprint when not available', () => {
    it('returns null when isAvailable is false', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, false);
      const result = await fm.generateFingerprint();
      expect(result).toBeNull();
    });

    it('returns null with options provided', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, false);
      const result = await fm.generateFingerprint({
        os: 'linux',
        browser: 'firefox',
        locale: 'de-DE',
        screen: { width: 1920, height: 1080 },
      });
      expect(result).toBeNull();
    });
  });

  // ── generateFingerprint success path ────────────────────────────────────

  describe('generateFingerprint success path', () => {
    beforeEach(() => {
      mockGetFingerprint.mockReturnValue({
        fingerprint: { screen: { width: 1920 }, navigator: { userAgent: 'test' } },
        headers: { 'Accept-Language': 'en-US' },
      });
    });

    it('generates fingerprint with default options', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      const result = await fm.generateFingerprint();

      expect(result).not.toBeNull();
      expect(result!.fingerprint).toEqual({
        screen: { width: 1920 },
        navigator: { userAgent: 'test' },
      });
      expect(result!.headers).toEqual({ 'Accept-Language': 'en-US' });
      expect(result!.os).toBe('windows');
      expect(result!.browser).toBe('chrome');
      expect(result!.generatedAt).toBeGreaterThan(0);
      expect(fm.getActiveProfile()).toBe(result);
    });

    it('generates fingerprint with all options specified', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      const result = await fm.generateFingerprint({
        os: 'macos',
        browser: 'firefox',
        locale: 'fr-FR',
        screen: { width: 1440, height: 900 },
      });

      expect(result).not.toBeNull();
      expect(result!.os).toBe('macos');
      expect(result!.browser).toBe('firefox');

      expect(mockGetFingerprint).toHaveBeenCalledWith({
        operatingSystems: ['macos'],
        browsers: ['firefox'],
        locales: ['fr-FR'],
        screen: { width: 1440, height: 900 },
      });
    });

    it('maps os windows correctly', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      await fm.generateFingerprint({ os: 'windows' });
      expect(mockGetFingerprint).toHaveBeenCalledWith({
        operatingSystems: ['windows'],
      });
    });

    it('maps os linux correctly', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      await fm.generateFingerprint({ os: 'linux' });
      expect(mockGetFingerprint).toHaveBeenCalledWith({
        operatingSystems: ['linux'],
      });
    });

    it('passes browser option', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      await fm.generateFingerprint({ browser: 'chrome' });
      expect(mockGetFingerprint).toHaveBeenCalledWith({
        browsers: ['chrome'],
      });
    });

    it('passes locale option', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      await fm.generateFingerprint({ locale: 'ja-JP' });
      expect(mockGetFingerprint).toHaveBeenCalledWith({
        locales: ['ja-JP'],
      });
    });

    it('passes screen option', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      await fm.generateFingerprint({ screen: { width: 2560, height: 1440 } });
      expect(mockGetFingerprint).toHaveBeenCalledWith({
        screen: { width: 2560, height: 1440 },
      });
    });

    it('handles missing headers (uses empty object fallback)', async () => {
      mockGetFingerprint.mockReturnValue({
        fingerprint: { test: true },
        headers: undefined,
      });
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      const result = await fm.generateFingerprint();
      expect(result!.headers).toEqual({});
    });

    it('caches profile in activeProfile', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      expect(fm.getActiveProfile()).toBeNull();
      const result = await fm.generateFingerprint({ os: 'macos' });
      expect(fm.getActiveProfile()).toBe(result);
    });

    it('generates with empty options object', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      const result = await fm.generateFingerprint({});
      expect(result).not.toBeNull();
      expect(result!.os).toBe('windows');
      expect(result!.browser).toBe('chrome');
      expect(mockGetFingerprint).toHaveBeenCalledWith({});
    });

    it('falls back to windows for unknown OS value (covers ?? fallback)', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      // Force an os value that doesn't exist in the osMap
      const result = await fm.generateFingerprint({ os: 'freebsd' as any });
      expect(result).not.toBeNull();
      expect(result!.os).toBe('freebsd');
      // The operatingSystems should have used the ?? 'windows' fallback
      expect(mockGetFingerprint).toHaveBeenCalledWith({
        operatingSystems: ['windows'],
      });
    });
  });

  // ── generateFingerprint error handling ─────────────────────────────────

  describe('generateFingerprint error handling', () => {
    it('catches generator error and returns null', async () => {
      mockGetFingerprint.mockImplementation(() => {
        throw new Error('Generator failure');
      });

      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);
      const result = await fm.generateFingerprint();
      expect(result).toBeNull();
    });
  });

  // ── injectFingerprint ───────────────────────────────────────────────────

  describe('injectFingerprint', () => {
    beforeEach(() => {
      mockNewInjectedPage.mockResolvedValue(undefined);
    });

    it('throws when packages not available', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, false);

      const mockPage = {} as Page;
      const profile: FingerprintProfile = {
        fingerprint: { test: true },
        headers: {},
        generatedAt: Date.now(),
        os: 'windows',
        browser: 'chrome',
      };

      await expect(fm.injectFingerprint(mockPage, profile)).rejects.toThrow(
        'fingerprint-injector not installed',
      );
    });

    it('extracts fingerprint from FingerprintProfile (has fingerprint key)', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);

      const mockPage = {} as Page;
      const profile: FingerprintProfile = {
        fingerprint: { screen: { width: 1920 } },
        headers: { 'Accept-Language': 'en' },
        generatedAt: Date.now(),
        os: 'linux',
        browser: 'firefox',
      };

      await fm.injectFingerprint(mockPage, profile);

      expect(mockNewInjectedPage).toHaveBeenCalledWith(mockPage, {
        fingerprint: { screen: { width: 1920 } },
      });
    });

    it('uses raw Record directly when no fingerprint key present', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);

      const mockPage = {} as Page;
      const rawFingerprint: Record<string, unknown> = {
        screen: { width: 1920, height: 1080 },
        navigator: { userAgent: 'Mozilla/5.0' },
      };

      await fm.injectFingerprint(mockPage, rawFingerprint);

      expect(mockNewInjectedPage).toHaveBeenCalledWith(mockPage, {
        fingerprint: rawFingerprint,
      });
    });

    it('rethrows error from newInjectedPage', async () => {
      mockNewInjectedPage.mockRejectedValue(new Error('Injection failed'));

      const fm = FingerprintManager.getInstance();
      setAvailable(fm, true);

      const mockPage = {} as Page;
      const profile = { fingerprint: { test: 1 } };

      await expect(fm.injectFingerprint(mockPage, profile)).rejects.toThrow('Injection failed');
    });
  });

  // ── State management edge cases ────────────────────────────────────────

  describe('state management edge cases', () => {
    it('clearProfile after failed generate', async () => {
      const fm = FingerprintManager.getInstance();
      setAvailable(fm, false);

      await fm.generateFingerprint();
      expect(fm.getActiveProfile()).toBeNull();

      fm.clearProfile();
      expect(fm.getActiveProfile()).toBeNull();
    });

    it('clearProfile works after direct profile set', () => {
      const fm = FingerprintManager.getInstance();
      setActiveProfile(fm, {
        fingerprint: {},
        headers: {},
        generatedAt: 0,
        os: 'windows',
        browser: 'chrome',
      });
      expect(fm.getActiveProfile()).not.toBeNull();
      fm.clearProfile();
      expect(fm.getActiveProfile()).toBeNull();
    });
  });
});

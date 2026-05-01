import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionProfileManager } from '@modules/stealth/SessionProfileManager';
import type { SessionProfile } from '@internal-types/SessionProfile';

const mockPage = {
  url: vi.fn(() => 'https://example.com/path'),
  cookies: vi.fn(),
  evaluate: vi.fn(),
};

const BASE_PROFILE: SessionProfile = {
  cookies: [
    { name: 'cf_clearance', value: 'test_value_123', domain: '.example.com' },
    { name: 'session', value: 'abc', path: '/' },
  ],
  userAgent: 'Mozilla/5.0 (Test)',
  acceptLanguage: 'en-US',
  platform: 'Win32',
  origin: 'https://example.com',
  collectedAt: Date.now(),
  ttlSec: 1800,
};

beforeEach(() => {
  SessionProfileManager.resetInstance();
  vi.clearAllMocks();
});

describe('SessionProfileManager', () => {
  describe('getInstance', () => {
    it('returns singleton', () => {
      const a = SessionProfileManager.getInstance();
      const b = SessionProfileManager.getInstance();
      expect(a).toBe(b);
    });

    it('resetInstance creates fresh instance', () => {
      const a = SessionProfileManager.getInstance();
      SessionProfileManager.resetInstance();
      const b = SessionProfileManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('exportFromPage', () => {
    it('collects cookies and navigator metadata', async () => {
      mockPage.cookies.mockResolvedValue([
        { name: 'cf_clearance', value: 'xyz', domain: '.example.com' },
      ]);
      mockPage.evaluate.mockResolvedValue({
        userAgent: 'Mozilla/5.0 Test',
        platform: 'Win32',
        acceptLanguage: 'en-US',
        referer: 'https://google.com',
        clientHints: { secChUa: '"Chrome";v="120"', secChUaMobile: '?0' },
      });

      const mgr = SessionProfileManager.getInstance();
      const profile = await mgr.exportFromPage(mockPage as never);

      expect(profile.cookies).toHaveLength(1);
      expect(profile.cookies[0]!.name).toBe('cf_clearance');
      expect(profile.userAgent).toBe('Mozilla/5.0 Test');
      expect(profile.acceptLanguage).toBe('en-US');
      expect(profile.platform).toBe('Win32');
      expect(profile.referer).toBe('https://google.com');
      expect(profile.clientHints?.secChUa).toBe('"Chrome";v="120"');
      expect(profile.origin).toBe('https://example.com');
      expect(profile.collectedAt).toBeGreaterThan(0);
      expect(profile.ttlSec).toBe(1800);
    });

    it('respects custom options', async () => {
      mockPage.cookies.mockResolvedValue([]);
      mockPage.evaluate.mockResolvedValue({
        userAgent: 'UA',
        platform: 'Linux',
        acceptLanguage: 'zh-CN',
        referer: undefined,
        clientHints: {},
      });

      const mgr = SessionProfileManager.getInstance();
      const profile = await mgr.exportFromPage(mockPage as never, {
        ttlSec: 600,
        origin: 'https://custom.com',
        referer: 'https://referrer.com',
      });

      expect(profile.ttlSec).toBe(600);
      expect(profile.origin).toBe('https://custom.com');
      expect(profile.referer).toBe('https://referrer.com');
    });

    it('handles about:blank origin gracefully', async () => {
      mockPage.url.mockReturnValue('about:blank');
      mockPage.cookies.mockResolvedValue([]);
      mockPage.evaluate.mockResolvedValue({
        userAgent: 'UA',
        platform: 'Win32',
        acceptLanguage: 'en',
        referer: undefined,
        clientHints: {},
      });

      const mgr = SessionProfileManager.getInstance();
      const profile = await mgr.exportFromPage(mockPage as never);
      expect(profile.origin).toBeUndefined();
    });

    it('caches profile after export', async () => {
      mockPage.cookies.mockResolvedValue([]);
      mockPage.evaluate.mockResolvedValue({
        userAgent: 'UA',
        platform: 'Win',
        acceptLanguage: 'en',
        referer: undefined,
        clientHints: {},
      });

      const mgr = SessionProfileManager.getInstance();
      await mgr.exportFromPage(mockPage as never);
      expect(mgr.getProfile()).not.toBeNull();
      expect(mgr.getProfile()!.userAgent).toBe('UA');
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips a profile', () => {
      const mgr = SessionProfileManager.getInstance();
      const json = mgr.serialize(BASE_PROFILE);
      const restored = mgr.deserialize(json);

      expect(restored.cookies).toEqual(BASE_PROFILE.cookies);
      expect(restored.userAgent).toBe(BASE_PROFILE.userAgent);
      expect(restored.origin).toBe(BASE_PROFILE.origin);
      expect(restored.ttlSec).toBe(1800);
    });

    it('fills defaults for missing fields', () => {
      const mgr = SessionProfileManager.getInstance();
      const restored = mgr.deserialize('{"cookies":[{"name":"a","value":"b"}]}');

      expect(restored.cookies).toHaveLength(1);
      expect(restored.userAgent).toBeUndefined();
      expect(restored.ttlSec).toBe(1800);
      expect(restored.collectedAt).toBeGreaterThan(0);
    });
  });

  describe('TTL expiry', () => {
    it('isExpired returns true for stale profile', () => {
      const mgr = SessionProfileManager.getInstance();
      const stale: SessionProfile = {
        ...BASE_PROFILE,
        collectedAt: Date.now() - 2000_000,
        ttlSec: 1,
      };
      expect(mgr.isExpired(stale)).toBe(true);
    });

    it('isExpired returns false for fresh profile', () => {
      const mgr = SessionProfileManager.getInstance();
      expect(mgr.isExpired(BASE_PROFILE)).toBe(false);
    });

    it('getValidProfile returns null when expired', () => {
      const mgr = SessionProfileManager.getInstance();
      mgr.setProfile({ ...BASE_PROFILE, collectedAt: 0, ttlSec: 0 });
      expect(mgr.getValidProfile()).toBeNull();
    });

    it('getValidProfile returns profile when fresh', () => {
      const mgr = SessionProfileManager.getInstance();
      mgr.setProfile(BASE_PROFILE);
      expect(mgr.getValidProfile()).toEqual(BASE_PROFILE);
    });
  });

  describe('clearProfile', () => {
    it('clears cached profile', () => {
      const mgr = SessionProfileManager.getInstance();
      mgr.setProfile(BASE_PROFILE);
      expect(mgr.getProfile()).not.toBeNull();
      mgr.clearProfile();
      expect(mgr.getProfile()).toBeNull();
    });
  });
});

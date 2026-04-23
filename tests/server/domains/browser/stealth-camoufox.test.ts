import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { injectAllMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    injectAll: (...args: any[]) => injectAllMock(...args),
  },
}));

vi.mock('camoufox-js/fingerprints', () => ({
  generateFingerprint: vi.fn().mockResolvedValue({ vendor: 'Intel', renderer: 'HD 630' }),
}));

vi.mock('camoufox-js/locale', () => ({
  getGeolocation: vi
    .fn()
    .mockResolvedValue({ latitude: 37.7749, longitude: -122.4194, accuracy: 50 }),
}));

vi.mock('camoufox-js/ip', () => ({
  publicIP: vi.fn().mockResolvedValue('1.2.3.4'),
}));

import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';
import { _resetFingerprintCacheForTesting } from '@server/domains/browser/handlers/stealth-injection';

describe('StealthInjectionHandlers — camoufox features', () => {
  const pageController = { getPage: vi.fn() } as any;
  const getActiveDriver = vi.fn();
  let handlers: StealthInjectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFingerprintCacheForTesting();
    getActiveDriver.mockReturnValue('chrome');
    handlers = new StealthInjectionHandlers({ pageController, getActiveDriver });
  });

  describe('handleStealthGenerateFingerprint — camoufox routing', () => {
    it('routes to camoufox native when driver is camoufox', async () => {
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson<any>(await handlers.handleStealthGenerateFingerprint({ os: 'linux' }));

      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(body.fingerprint).toEqual({ vendor: 'Intel', renderer: 'HD 630' });
    });

    it('defaults os to windows when not specified for camoufox', async () => {
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson<any>(await handlers.handleStealthGenerateFingerprint({}));

      expect(body.success).toBe(true);
      const { generateFingerprint } = await import('camoufox-js/fingerprints');
      expect(generateFingerprint).toHaveBeenCalledWith('windows');
    });

    it('returns failure when camoufox fingerprint module throws', async () => {
      getActiveDriver.mockReturnValue('camoufox');
      const { generateFingerprint } = await import('camoufox-js/fingerprints');
      (generateFingerprint as any).mockRejectedValueOnce(new Error('no fingerprints db'));

      const body = parseJson<any>(await handlers.handleStealthGenerateFingerprint({}));

      expect(body.success).toBe(false);
      expect(body.error).toContain('Camoufox fingerprint generation failed');
    });
  });

  describe('handleCamoufoxGeolocation', () => {
    it('returns geolocation for a valid locale', async () => {
      const body = parseJson<any>(await handlers.handleCamoufoxGeolocation({ locale: 'en-US' }));

      expect(body.success).toBe(true);
      expect(body.locale).toBe('en-US');
      expect(body.geolocation).toEqual({ latitude: 37.7749, longitude: -122.4194, accuracy: 50 });
    });

    it('returns public IP when proxy is provided', async () => {
      const body = parseJson<any>(
        await handlers.handleCamoufoxGeolocation({
          locale: 'en-US',
          proxy: 'http://user:pass@host:port',
        }),
      );

      expect(body.success).toBe(true);
      expect(body.publicIp).toBe('1.2.3.4');
    });

    it('returns geolocation without publicIp when proxy is omitted', async () => {
      const body = parseJson<any>(await handlers.handleCamoufoxGeolocation({ locale: 'zh-CN' }));

      expect(body.success).toBe(true);
      expect(body.publicIp).toBeNull();
    });

    it('returns geolocation even when publicIP throws', async () => {
      const { publicIP } = await import('camoufox-js/ip');
      (publicIP as any).mockRejectedValueOnce(new Error('proxy unreachable'));

      const body = parseJson<any>(
        await handlers.handleCamoufoxGeolocation({ locale: 'en-US', proxy: 'bad://proxy' }),
      );

      expect(body.success).toBe(true);
      expect(body.publicIp).toBeNull();
    });

    it('returns failure when locale is missing', async () => {
      const body = parseJson<any>(await handlers.handleCamoufoxGeolocation({}));

      expect(body.success).toBe(false);
      expect(body.error).toContain('locale is required');
    });

    it('returns failure when camoufox-js/locale is unavailable', async () => {
      vi.doMock('camoufox-js/locale', () => {
        throw new Error("Cannot find module 'camoufox-js/locale'");
      });

      const body = parseJson<any>(await handlers.handleCamoufoxGeolocation({ locale: 'en-US' }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('Camoufox locale module unavailable');
    });
  });
});

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Driver = 'chrome' | 'camoufox';
type Platform = 'windows' | 'mac' | 'linux';

interface JitterResponse {
  success: boolean;
  jitterOptions: {
    enabled: boolean;
    minDelayMs: number;
    maxDelayMs: number;
    burstMode: boolean;
  };
  message: string;
}

interface FingerprintResponse {
  success: boolean;
  message: string;
  profile?: unknown;
}

interface StealthVerifyResponse {
  success: boolean;
  message?: string;
  score?: number;
  checks?: Array<{
    name: string;
    passed: boolean;
    details?: string;
  }>;
}

interface StealthInjectResponse {
  success: boolean;
  message: string;
  fingerprintApplied: boolean;
  _nextStepHint?: string;
}

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn(),
  setRealisticUserAgentMock: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    injectAll: (page: unknown) => injectAllMock(page),
    setRealisticUserAgent: (page: unknown, platform: Platform) =>
      setRealisticUserAgentMock(page, platform),
  },
}));

vi.mock('@utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock CDPTimingProxy types
vi.mock('@modules/stealth/CDPTimingProxy.types', () => ({
  DEFAULT_TIMING_OPTIONS: {
    enabled: true,
    minDelayMs: 20,
    maxDelayMs: 80,
    burstMode: false,
  },
}));

vi.mock('@modules/stealth/CDPTimingProxy', () => ({
  CDPTimingProxy: vi.fn().mockImplementation((session, options) => ({
    session,
    options,
  })),
}));

import {
  StealthInjectionHandlers,
  getJitterOptions,
  createJitteredSession,
  _resetFingerprintCacheForTesting,
} from '@server/domains/browser/handlers/stealth-injection';

describe('StealthInjectionHandlers — comprehensive coverage', () => {
  const page = { id: 'page-1' };
  const pageController = {
    getPage: vi.fn(),
  };
  const getActiveDriver = vi.fn<() => Driver>();

  let handlers: StealthInjectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController.getPage.mockResolvedValue(page);
    getActiveDriver.mockReturnValue('chrome');
    handlers = new StealthInjectionHandlers({
      pageController: pageController as any,
      getActiveDriver,
    });
  });

  describe('handleStealthConfigureJitter', () => {
    it('returns current jitter options with defaults', async () => {
      const body = parseJson<JitterResponse>(await handlers.handleStealthConfigureJitter({}));

      expect(body.success).toBe(true);
      expect(body.jitterOptions).toBeDefined();
      expect(body.message).toContain('CDP timing jitter');
    });

    it('enables jitter when enabled=true', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ enabled: true }),
      );

      expect(body.success).toBe(true);
      expect(body.jitterOptions.enabled).toBe(true);
      expect(body.message).toContain('enabled');
    });

    it('disables jitter when enabled=false', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ enabled: false }),
      );

      expect(body.success).toBe(true);
      expect(body.jitterOptions.enabled).toBe(false);
      expect(body.message).toContain('disabled');
    });

    it('updates minDelayMs', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ minDelayMs: 50 }),
      );

      expect(body.success).toBe(true);
      expect(body.jitterOptions.minDelayMs).toBe(50);
    });

    it('updates maxDelayMs', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ maxDelayMs: 200 }),
      );

      expect(body.success).toBe(true);
      expect(body.jitterOptions.maxDelayMs).toBe(200);
    });

    it('enables burstMode', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ burstMode: true }),
      );

      expect(body.success).toBe(true);
      expect(body.jitterOptions.burstMode).toBe(true);
      expect(body.message).toContain('burst mode');
    });

    it('updates all options at once', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({
          enabled: true,
          minDelayMs: 10,
          maxDelayMs: 100,
          burstMode: true,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.jitterOptions).toMatchObject({
        enabled: true,
        minDelayMs: 10,
        maxDelayMs: 100,
        burstMode: true,
      });
    });

    it('ignores non-number minDelayMs', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ minDelayMs: 'invalid' as any }),
      );

      expect(body.success).toBe(true);
      // Should not change from previous value
      expect(typeof body.jitterOptions.minDelayMs).toBe('number');
    });

    it('ignores non-number maxDelayMs', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({ maxDelayMs: null as any }),
      );

      expect(body.success).toBe(true);
      expect(typeof body.jitterOptions.maxDelayMs).toBe('number');
    });

    it('message includes delay range', async () => {
      const body = parseJson<JitterResponse>(
        await handlers.handleStealthConfigureJitter({
          enabled: true,
          minDelayMs: 30,
          maxDelayMs: 150,
        }),
      );

      expect(body.message).toContain('30-150ms');
    });
  });

  describe('handleStealthGenerateFingerprint', () => {
    // Reset the module-level FingerprintManager cache before each test
    // to prevent cross-test contamination from the lazy-init singleton.
    beforeEach(() => {
      _resetFingerprintCacheForTesting();
    });

    it('returns error when fingerprint packages are not installed', async () => {
      // FingerprintManager import will fail in test environment
      vi.resetModules();

      vi.doMock('@modules/stealth/FingerprintManager', () => {
        throw new Error('Module not found');
      });

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<FingerprintResponse>(
        await freshHandlers.handleStealthGenerateFingerprint({}),
      );

      expect(body.success).toBe(false);
      expect(body.message).toContain('fingerprint-generator');
      expect(body.message).toContain('fingerprint-injector');

      vi.doUnmock('@modules/stealth/FingerprintManager');
    });

    it('returns error when FingerprintManager is not available', async () => {
      vi.resetModules();

      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => false,
          }),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<FingerprintResponse>(
        await freshHandlers.handleStealthGenerateFingerprint({}),
      );

      expect(body.success).toBe(false);
      expect(body.message).toContain('not installed');

      vi.doUnmock('@modules/stealth/FingerprintManager');
    });

    it('generates fingerprint successfully when available', async () => {
      vi.resetModules();

      const mockProfile = { screen: { width: 1920, height: 1080 } };
      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => true,
            generateFingerprint: vi.fn().mockResolvedValue(mockProfile),
          }),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<FingerprintResponse>(
        await freshHandlers.handleStealthGenerateFingerprint({}),
      );

      expect(body.success).toBe(true);
      expect(body.profile).toEqual(mockProfile);
      expect(body.message).toContain('Fingerprint generated');

      vi.doUnmock('@modules/stealth/FingerprintManager');
    });

    it('passes os, browser, and locale options', async () => {
      vi.resetModules();

      const generateFingerprintMock = vi.fn().mockResolvedValue({});
      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => true,
            generateFingerprint: generateFingerprintMock,
          }),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      await freshHandlers.handleStealthGenerateFingerprint({
        os: 'linux',
        browser: 'firefox',
        locale: 'zh-CN',
      });

      expect(generateFingerprintMock).toHaveBeenCalledWith({
        os: 'linux',
        browser: 'firefox',
        locale: 'zh-CN',
      });

      vi.doUnmock('@modules/stealth/FingerprintManager');
    });

    it('defaults browser to chrome and locale to en-US', async () => {
      vi.resetModules();

      const generateFingerprintMock = vi.fn().mockResolvedValue({});
      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => true,
            generateFingerprint: generateFingerprintMock,
          }),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      await freshHandlers.handleStealthGenerateFingerprint({});

      expect(generateFingerprintMock).toHaveBeenCalledWith({
        os: undefined,
        browser: 'chrome',
        locale: 'en-US',
      });

      vi.doUnmock('@modules/stealth/FingerprintManager');
    });
  });

  describe('handleStealthVerify', () => {
    it('returns error when verify throws Error', async () => {
      vi.resetModules();

      vi.doMock('@modules/stealth/StealthVerifier', () => ({
        StealthVerifier: vi.fn().mockImplementation(() => ({
          verify: vi.fn().mockRejectedValue(new Error('Page not ready')),
        })),
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<StealthVerifyResponse>(await freshHandlers.handleStealthVerify({}));

      expect(body.success).toBe(false);
      expect(body.message).toContain('Page not ready');

      vi.doUnmock('@modules/stealth/StealthVerifier');
    });

    it('returns error when verify throws non-Error', async () => {
      vi.resetModules();

      vi.doMock('@modules/stealth/StealthVerifier', () => ({
        StealthVerifier: vi.fn().mockImplementation(() => ({
          verify: vi.fn().mockRejectedValue('string error'),
        })),
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<StealthVerifyResponse>(await freshHandlers.handleStealthVerify({}));

      expect(body.success).toBe(false);
      expect(body.message).toContain('string error');

      vi.doUnmock('@modules/stealth/StealthVerifier');
    });
  });

  describe('handleStealthInject with fingerprint integration', () => {
    beforeEach(() => {
      _resetFingerprintCacheForTesting();
    });

    it('applies fingerprint when FingerprintManager is available and has profile', async () => {
      vi.resetModules();

      const mockProfile = { screen: { width: 1920 } };
      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => true,
            getActiveProfile: () => mockProfile,
            injectFingerprint: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }));

      vi.doMock('@server/domains/shared/modules', () => ({
        StealthScripts: {
          injectAll: vi.fn().mockResolvedValue(undefined),
          setRealisticUserAgent: vi.fn(),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<StealthInjectResponse>(await freshHandlers.handleStealthInject({}));

      expect(body.success).toBe(true);
      expect(body.fingerprintApplied).toBe(true);

      vi.doUnmock('@modules/stealth/FingerprintManager');
      vi.doUnmock('@server/domains/shared/modules');
    });

    it('generates fingerprint when no active profile exists', async () => {
      vi.resetModules();

      const generatedProfile = { screen: { width: 1920 } };
      const injectFingerprintMock = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => true,
            getActiveProfile: () => null,
            generateFingerprint: vi.fn().mockResolvedValue(generatedProfile),
            injectFingerprint: injectFingerprintMock,
          }),
        },
      }));

      vi.doMock('@server/domains/shared/modules', () => ({
        StealthScripts: {
          injectAll: vi.fn().mockResolvedValue(undefined),
          setRealisticUserAgent: vi.fn(),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<StealthInjectResponse>(await freshHandlers.handleStealthInject({}));

      expect(body.success).toBe(true);
      expect(body.fingerprintApplied).toBe(true);
      expect(injectFingerprintMock).toHaveBeenCalledWith(page, generatedProfile);

      vi.doUnmock('@modules/stealth/FingerprintManager');
      vi.doUnmock('@server/domains/shared/modules');
    });

    it('falls back to stealth scripts when fingerprint injection fails', async () => {
      vi.resetModules();

      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => true,
            getActiveProfile: () => ({ test: true }),
            injectFingerprint: vi.fn().mockRejectedValue(new Error('Injection failed')),
          }),
        },
      }));

      vi.doMock('@server/domains/shared/modules', () => ({
        StealthScripts: {
          injectAll: vi.fn().mockResolvedValue(undefined),
          setRealisticUserAgent: vi.fn(),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<StealthInjectResponse>(await freshHandlers.handleStealthInject({}));

      // Should still succeed but without fingerprint
      expect(body.success).toBe(true);
      expect(body.fingerprintApplied).toBe(false);

      vi.doUnmock('@modules/stealth/FingerprintManager');
      vi.doUnmock('@server/domains/shared/modules');
    });

    it('skips fingerprint when FingerprintManager is not available', async () => {
      vi.resetModules();

      vi.doMock('@modules/stealth/FingerprintManager', () => ({
        FingerprintManager: {
          getInstance: () => ({
            isAvailable: () => false,
          }),
        },
      }));

      vi.doMock('@server/domains/shared/modules', () => ({
        StealthScripts: {
          injectAll: vi.fn().mockResolvedValue(undefined),
          setRealisticUserAgent: vi.fn(),
        },
      }));

      const { StealthInjectionHandlers: FreshHandlers } =
        await import('@server/domains/browser/handlers/stealth-injection');

      const freshHandlers = new FreshHandlers({
        pageController: pageController as any,
        getActiveDriver,
      });

      const body = parseJson<StealthInjectResponse>(await freshHandlers.handleStealthInject({}));

      expect(body.success).toBe(true);
      expect(body.fingerprintApplied).toBe(false);

      vi.doUnmock('@modules/stealth/FingerprintManager');
      vi.doUnmock('@server/domains/shared/modules');
    });
  });

  describe('module-level exports', () => {
    it('getJitterOptions returns a copy of current options', () => {
      const options = getJitterOptions();

      expect(options).toBeDefined();
      expect(typeof options.enabled).toBe('boolean');
      expect(typeof options.minDelayMs).toBe('number');
      expect(typeof options.maxDelayMs).toBe('number');
      expect(typeof options.burstMode).toBe('boolean');
    });

    it('getJitterOptions returns a new object each time (not reference)', () => {
      const options1 = getJitterOptions();
      const options2 = getJitterOptions();

      expect(options1).not.toBe(options2);
      expect(options1).toEqual(options2);
    });

    it('createJitteredSession creates CDPTimingProxy', () => {
      const mockSession = {
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      };

      const proxy = createJitteredSession(mockSession);

      expect(proxy).toBeDefined();
    });
  });
});

import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleCaptchaVisionSolve,
  handleWidgetChallengeSolve,
} from '@server/domains/browser/handlers/captcha-solver';



// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function createMockPage(overrides: Record<string, any> = {}) {
  return {
    evaluate: vi.fn().mockResolvedValue({ challengeType: 'image', taskKind: 'image', siteKey: '' }),
    url: vi.fn(() => 'http://test.local/page'),
    ...overrides,
  };
}

function createMockCollector(page: unknown = null) {
  return {
    getActivePage: vi.fn().mockResolvedValue(page),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
}

describe('captcha-solver additional coverage', () => {
  let origEnv: Record<string, string | undefined>;

  beforeEach(() => {
    origEnv = {
      CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY,
      CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER,
      CAPTCHA_SOLVER_BASE_URL: process.env.CAPTCHA_SOLVER_BASE_URL,
    };
    delete process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_PROVIDER;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(origEnv)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as unknown)[k] = v;
    }
  });

  describe('handleCaptchaVisionSolve', () => {
    it('normalizes mode from provider env var as external_service for 2captcha', async () => {
      process.env.CAPTCHA_PROVIDER = '2captcha';
      const page = createMockPage();
      const collector = createMockCollector(page);

      // No API key => should error with credentials message
      const result = parseJson<BrowserStatusResponse>(await handleCaptchaVisionSolve({}, collector));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('credentials');
    });

    it('normalizes mode from provider env var as external_service for anticaptcha', async () => {
      process.env.CAPTCHA_PROVIDER = 'anticaptcha';
      const page = createMockPage();
      const collector = createMockCollector(page);

      // This triggers external_service mode, anticaptcha not implemented
      const result = parseJson<BrowserStatusResponse>(await handleCaptchaVisionSolve({ apiKey: 'test' }, collector));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('implemented');
    });

    it('normalizes mode from provider env var as external_service for capsolver', async () => {
      process.env.CAPTCHA_PROVIDER = 'capsolver';
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(await handleCaptchaVisionSolve({ apiKey: 'test' }, collector));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('implemented');
    });

    it('normalizes unknown mode strings to manual', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(await handleCaptchaVisionSolve({ mode: 'unknown_xyz' }, collector));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.mode).toBe('manual');
    });

    it('normalizes hook mode correctly', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      // hook mode without api key should fall through to... it's not manual, so
      // it requires credentials
      delete process.env.CAPTCHA_API_KEY;
      const result = parseJson<BrowserStatusResponse>(await handleCaptchaVisionSolve({ mode: 'hook' }, collector));
      // hook mode is not 'manual' so it requires API key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('credentials');
    });

    it('auto-detects widget type via data-sitekey + cf-turnstile', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          challengeType: 'widget',
          taskKind: 'turnstile',
          siteKey: 'turnstile-key-123',
        }),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'auto',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('auto-detects widget type via hcaptcha', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          challengeType: 'widget',
          taskKind: 'hcaptcha',
          siteKey: 'hcaptcha-key',
        }),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('handles explicit image challengeType hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'image',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('image');
    });

    it('handles explicit widget challengeType hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'recaptcha_v2',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('handles recaptcha_v3 as widget type hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'recaptcha_v3',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('handles hcaptcha as widget type hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'hcaptcha',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('handles funcaptcha as widget type hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'funcaptcha',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('handles turnstile as widget type hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'turnstile',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('widget');
    });

    it('handles browser_check challengeType hint', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'browser_check',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
    });

    it('handles managed_widget challengeType hint as browser_check', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'managed_widget',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
    });

    it('uses pageUrl from args if provided', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            pageUrl: 'https://custom-page.com',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
    });

    it('uses siteKey from args if provided', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            siteKey: 'manual-site-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.siteKey).toBe('manual-site-key');
    });

    it('uses typeHint alias for challengeType', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            typeHint: 'image',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.challengeType).toBe('image');
    });

    it('resolves provider from args.provider overriding env', async () => {
      process.env.CAPTCHA_PROVIDER = '2captcha';
      const page = createMockPage();
      const collector = createMockCollector(page);

      // anticaptcha override should take precedence over env
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: 'anticaptcha',
            apiKey: 'test-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('implemented');
    });

    it('resolves external service name from env when no provider arg', async () => {
      process.env.CAPTCHA_PROVIDER = 'anticaptcha';
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('implemented');
    });

    it('defaults to 2captcha when no provider arg or env', async () => {
      delete process.env.CAPTCHA_PROVIDER;
      const page = createMockPage();
      const collector = createMockCollector(page);

      // No API key => credentials error (but confirms defaults to 2captcha path)
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('credentials');
    });

    it('handles empty string provider gracefully', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: '  ',
          },
          collector
        )
      );

      // Empty provider = falls to env or default (2captcha), no key => creds error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('credentials');
    });

    it('reads apiKey from env when not in args', async () => {
      process.env.CAPTCHA_API_KEY = 'env-key';
      const page = createMockPage();
      const collector = createMockCollector(page);

      // Using unsupported provider so we can verify it reaches that path
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: 'unknown_svc',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('Unsupported');
    });

    it('auto-detects siteKey from page in auto mode', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          challengeType: 'widget',
          taskKind: 'recaptcha_v2',
          siteKey: 'detected-key',
        }),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'auto',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.siteKey).toBe('detected-key');
    });

    it('does not overwrite explicit siteKey with detected one', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          challengeType: 'widget',
          taskKind: 'recaptcha_v2',
          siteKey: 'detected-key',
        }),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'auto',
            siteKey: 'explicit-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.siteKey).toBe('explicit-key');
    });
  });

  describe('handleWidgetChallengeSolve', () => {
    it('auto-detects siteKey from turnstile element', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('detected-site-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.siteKey).toBe('detected-site-key');
    });

    it('uses provided siteKey over auto-detected', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('auto-detected-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'explicit-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.siteKey).toBe('explicit-key');
    });

    it('uses pageUrl from args if provided', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('test-key'),
        url: vi.fn(() => 'http://original.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
            pageUrl: 'https://custom.url',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.pageUrl).toBe('https://custom.url');
    });

    it('hook mode returns null token when evaluate catches error', async () => {
      const page = createMockPage({
        evaluate: vi
          .fn()
          // First call: siteKey auto-detect (not needed with explicit siteKey)
          // Second call: hook evaluation (returns null via catch)
          .mockRejectedValue(new Error('Hook timeout')),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      // hook mode with no callbacks found -> falls through to manual
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
          },
          collector
        )
      );

      // After hook fails, it doesn't return manual (hook mode, not manual)
      // Without API key it should fail at credentials check or return non-2captcha error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
    });

    it('hook mode with successful token returns it', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('hooked-token'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.token).toBe('hooked-token');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.method).toBe('hook');
    });

    it('hook mode with null token falls through', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(null),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      // hook returns null -> falls through to external, which needs credentials
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('credentials');
    });

    it('rejects non-2captcha external service for widget flow', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('test-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      process.env.CAPTCHA_PROVIDER = 'capsolver';

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'external_service',
            siteKey: 'test-key',
            apiKey: 'test',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('implemented');
    });

    it('uses timeoutMs from args clamped to valid range', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('test-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      // manual mode with extreme timeout
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
            timeoutMs: 999999,
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
    });

    it('injectToken defaults to true', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('test-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
          },
          collector
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(true);
    });

    it('returns error when page.evaluate returns empty string for siteKey', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(''),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(await handleWidgetChallengeSolve({}, collector));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('siteKey');
    });

    it('returns error when page.evaluate returns undefined for siteKey', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(undefined),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson<BrowserStatusResponse>(await handleWidgetChallengeSolve({}, collector));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(result.error).toContain('siteKey');
    });
  });
});

// Import afterEach at module scope for cleanup
import { afterEach } from 'vitest';

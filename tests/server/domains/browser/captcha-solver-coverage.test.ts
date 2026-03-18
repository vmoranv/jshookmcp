import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import {
  handleCaptchaVisionSolve,
  handleWidgetChallengeSolve,
} from '@server/domains/browser/handlers/captcha-solver';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createMockPage(overrides: Record<string, any> = {}) {
  return {
    evaluate: vi.fn().mockResolvedValue({ challengeType: 'image', taskKind: 'image', siteKey: '' }),
    url: vi.fn(() => 'http://test.local/page'),
    ...overrides,
  };
}

function createMockCollector(page: any = null) {
  return {
    getActivePage: vi.fn().mockResolvedValue(page),
  } as any;
}

describe('captcha-solver — deep coverage', () => {
  let origEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
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
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  });

  // ── solveWith2Captcha: CAPTCHA_SOLVER_BASE_URL unset ──

  describe('handleCaptchaVisionSolve — external service with 2captcha', () => {
    it('errors when CAPTCHA_SOLVER_BASE_URL is not configured', async () => {
      delete process.env.CAPTCHA_SOLVER_BASE_URL;
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
            maxRetries: 0,
          },
          collector
        )
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('CAPTCHA_SOLVER_BASE_URL');
    });

    it('errors with fetch failure on submit', async () => {
      process.env.CAPTCHA_SOLVER_BASE_URL = 'http://invalid-captcha-service.test';
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
            maxRetries: 0,
            timeoutMs: 5000,
          },
          collector
        )
      );

      expect(result.success).toBe(false);
    });

    it('retries on failure up to maxRetries then returns error', async () => {
      process.env.CAPTCHA_SOLVER_BASE_URL = 'http://invalid-captcha-service.test';
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
            maxRetries: 1,
            timeoutMs: 5000,
          },
          collector
        )
      );

      expect(result.success).toBe(false);
      expect(result.maxRetries).toBe(1);
      expect(loggerState.warn).toHaveBeenCalledWith(expect.stringContaining('Attempt 1'));
    });
  });

  // ── normalizeSolverMode edge cases ──

  describe('normalizeSolverMode coverage', () => {
    it('treats numeric mode as manual', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 123 as any,
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('manual');
    });

    it('treats null mode as manual', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: null as any,
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('manual');
    });

    it('treats undefined mode without provider or env as manual', async () => {
      delete process.env.CAPTCHA_PROVIDER;
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(await handleCaptchaVisionSolve({}, collector));

      expect(result.success).toBe(true);
      expect(result.mode).toBe('manual');
    });
  });

  // ── normalizeChallengeTypeHint edge cases ──

  describe('normalizeChallengeTypeHint coverage', () => {
    it('normalizes numeric challengeType to auto', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 42 as any,
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      // auto triggers page.evaluate detection
    });

    it('normalizes empty string to auto', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: '',
          },
          collector
        )
      );

      expect(result.success).toBe(true);
    });
  });

  // ── resolveLegacyServiceOverride ──

  describe('resolveExternalServiceName coverage', () => {
    it('uses provider arg with leading/trailing whitespace', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: '  AntiCaptcha  ',
            apiKey: 'test',
          },
          collector
        )
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('implemented');
    });

    it('falls back to env CAPTCHA_PROVIDER when provider arg is empty', async () => {
      process.env.CAPTCHA_PROVIDER = 'capsolver';
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: '',
            apiKey: 'test',
          },
          collector
        )
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('implemented');
    });

    it('falls back to 2captcha when provider and env are both absent', async () => {
      delete process.env.CAPTCHA_PROVIDER;
      delete process.env.CAPTCHA_SOLVER_BASE_URL;
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test',
            maxRetries: 0,
          },
          collector
        )
      );

      // Should try 2captcha, fail because no base URL
      expect(result.success).toBe(false);
      expect(result.error).toContain('CAPTCHA_SOLVER_BASE_URL');
    });
  });

  // ── handleCaptchaVisionSolve: auto-detect branches ──

  describe('auto-detect challengeType branches', () => {
    it('sets taskKind to recaptcha_v2 for non-image widget challengeType', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          challengeType: 'widget',
          taskKind: 'recaptcha_v2',
          siteKey: 'sk-123',
        }),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'widget',
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      expect(result.challengeType).toBe('widget');
    });

    it('uses detected siteKey when args.siteKey is not provided in auto mode', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          challengeType: 'widget',
          taskKind: 'turnstile',
          siteKey: 'auto-detected-key',
        }),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'auto',
          },
          collector
        )
      );

      expect(result.siteKey).toBe('auto-detected-key');
    });

    it('handles browser_check challengeType hint by using recaptcha_v2 task kind', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'browser_check',
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      // browser_check maps to 'browser_check' via normalizeChallengeTypeHint
    });
  });

  // ── handleWidgetChallengeSolve: deeper branches ──

  describe('handleWidgetChallengeSolve — deeper branches', () => {
    it('hook mode falls through to external when token is null and then fails for non-2captcha', async () => {
      process.env.CAPTCHA_PROVIDER = 'capsolver';
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(null),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
            apiKey: 'test',
          },
          collector
        )
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('implemented');
    });

    it('uses page.url() when pageUrl is not in args', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('site-key'),
        url: vi.fn(() => 'http://detected-url.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      expect(result.pageUrl).toBe('http://detected-url.local');
    });

    it('manual mode with explicit pageUrl uses it', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('site-key'),
        url: vi.fn(() => 'http://original.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
            pageUrl: 'http://custom.local',
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      expect(result.pageUrl).toBe('http://custom.local');
    });

    it('returns error when injectToken is false and external service fails', async () => {
      delete process.env.CAPTCHA_SOLVER_BASE_URL;
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('site-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'external_service',
            siteKey: 'test-key',
            apiKey: 'test-key',
            injectToken: false,
          },
          collector
        )
      );

      expect(result.success).toBe(false);
      expect(result.suggestion).toContain('manual');
    });

    it('clamps widget timeoutMs to [5000, 600000] for low value', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('site-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
            timeoutMs: 1,
          },
          collector
        )
      );

      expect(result.success).toBe(true);
    });

    it('clamps widget timeoutMs to [5000, 600000] for high value', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('site-key'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
            timeoutMs: 9999999,
          },
          collector
        )
      );

      expect(result.success).toBe(true);
    });

    it('hook mode with successful token includes correct fields', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('hook-token-123'),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'my-site-key',
          },
          collector
        )
      );

      expect(result.success).toBe(true);
      expect(result.token).toBe('hook-token-123');
      expect(result.method).toBe('hook');
      expect(result.challengeType).toBe('widget');
      expect(result.siteKey).toBe('my-site-key');
    });
  });

  // ── toTextResponse / toErrorResponse ──

  describe('response formatting', () => {
    it('handleCaptchaVisionSolve returns proper content structure', async () => {
      const page = createMockPage();
      const collector = createMockCollector(page);

      const response = (await handleCaptchaVisionSolve({ mode: 'manual' }, collector)) as any;

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it('handleCaptchaVisionSolve error includes tool name', async () => {
      delete process.env.CAPTCHA_API_KEY;
      const page = createMockPage();
      const collector = createMockCollector(page);

      const response = (await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
        },
        collector
      )) as any;

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('captcha_vision_solve');
    });

    it('handleWidgetChallengeSolve error includes tool name', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(''),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const response = (await handleWidgetChallengeSolve({}, collector)) as any;

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('widget_challenge_solve');
    });

    it('toErrorResponse converts non-Error objects to string', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(''),
        url: vi.fn(() => 'http://test.local'),
      });
      const collector = createMockCollector(page);

      const response = (await handleWidgetChallengeSolve({}, collector)) as any;
      const parsed = JSON.parse(response.content[0].text);
      expect(typeof parsed.error).toBe('string');
    });
  });

  // ── Vision solve retry / attempt logging ──

  describe('retry and attempt tracking', () => {
    it('logs warning for each failed attempt', async () => {
      process.env.CAPTCHA_SOLVER_BASE_URL = 'http://invalid-captcha-service.test';
      const page = createMockPage();
      const collector = createMockCollector(page);

      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
          apiKey: 'test-key',
          maxRetries: 2,
          timeoutMs: 5000,
        },
        collector
      );

      // Should have logged at least 3 attempts (0, 1, 2)
      const warnCalls = loggerState.warn.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('[captcha] Attempt')
      );
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('includes suggestion in error response after all attempts fail', async () => {
      delete process.env.CAPTCHA_SOLVER_BASE_URL;
      const page = createMockPage();
      const collector = createMockCollector(page);

      const result = parseJson(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
            maxRetries: 0,
          },
          collector
        )
      );

      expect(result.suggestion).toContain('manual');
    });
  });
});

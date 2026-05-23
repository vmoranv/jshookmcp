import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';
import {
  handleCaptchaVisionSolve,
  handleWidgetChallengeSolve,
} from '@server/domains/browser/handlers/captcha-solver';

function createMockPage(overrides: Record<string, any> = {}) {
  return {
    evaluate: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
    url: vi.fn(() => buildTestUrl('test', { scheme: 'http', suffix: 'local', path: 'page' })),
    ...overrides,
  };
}

function createMockCollector(page: unknown = null) {
  return {
    getActivePage: vi.fn().mockResolvedValue(page),
  } as any;
}

function installJsonTaskApiFailureMock() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/createTask')) {
      return {
        json: async () => ({
          errorId: 1,
          errorCode: 'ERROR_INVALID_TASK_DATA',
        }),
      } as any;
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;
}

describe('captcha-solver additional coverage', () => {
  let origEnv: Record<string, string | undefined>;
  let origFetch: typeof fetch | undefined;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origEnv = {
      CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY,
      CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER,
      CAPTCHA_SOLVER_BASE_URL: process.env.CAPTCHA_SOLVER_BASE_URL,
      CAPTCHA_ANTICAPTCHA_BASE_URL: process.env.CAPTCHA_ANTICAPTCHA_BASE_URL,
      CAPTCHA_CAPSOLVER_BASE_URL: process.env.CAPTCHA_CAPSOLVER_BASE_URL,
    };
    delete process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_PROVIDER;
  });

  afterEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  });

  describe('handleCaptchaVisionSolve', () => {
    it('normalizes provider env to external_service for 2captcha', async () => {
      process.env.CAPTCHA_PROVIDER = '2captcha';
      const collector = createMockCollector(createMockPage());

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve({}, collector),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('credentials');
    });

    it('normalizes provider env to external_service for anticaptcha', async () => {
      process.env.CAPTCHA_PROVIDER = 'anticaptcha';
      process.env.CAPTCHA_ANTICAPTCHA_BASE_URL = buildTestUrl('solver-anticaptcha', {
        path: 'anticaptcha',
      });
      installJsonTaskApiFailureMock();

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          { apiKey: 'test', taskKind: 'image', imageBase64: 'dGVzdA==' },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERROR_INVALID_TASK_DATA');
    });

    it('normalizes provider env to external_service for capsolver', async () => {
      process.env.CAPTCHA_PROVIDER = 'capsolver';
      process.env.CAPTCHA_CAPSOLVER_BASE_URL = buildTestUrl('solver-capsolver', {
        path: 'capsolver',
      });
      installJsonTaskApiFailureMock();

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          { apiKey: 'test', taskKind: 'image', imageBase64: 'dGVzdA==' },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERROR_INVALID_TASK_DATA');
    });

    it('normalizes unknown mode strings to manual', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          { mode: 'unknown_xyz' },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.mode).toBe('manual');
    });

    it('treats hook mode on vision solve as external flow requiring credentials', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve({ mode: 'hook' }, createMockCollector(createMockPage())),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('credentials');
    });

    it('accepts explicit widget challengeType', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'widget',
            siteKey: 'explicit-key',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.challengeType).toBe('widget');
      expect(result.siteKey).toBe('explicit-key');
    });

    it('requires explicit siteKey for widget-solving paths', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            taskKind: 'turnstile',
            apiKey: 'test',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('siteKey');
    });

    it('uses typeHint alias for explicit image challenge type', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            typeHint: 'image',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.challengeType).toBe('image');
    });

    it('lets provider arg override env provider', async () => {
      process.env.CAPTCHA_PROVIDER = '2captcha';
      process.env.CAPTCHA_ANTICAPTCHA_BASE_URL = buildTestUrl('solver-anticaptcha', {
        path: 'anticaptcha',
      });
      installJsonTaskApiFailureMock();

      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: 'anticaptcha',
            apiKey: 'test-key',
            taskKind: 'image',
            imageBase64: 'dGVzdA==',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERROR_INVALID_TASK_DATA');
    });
  });

  describe('handleWidgetChallengeSolve', () => {
    it('manual mode works without siteKey auto-detection', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve({ mode: 'manual' }, createMockCollector(createMockPage())),
      );
      expect(result.success).toBe(true);
      expect(result.mode).toBe('manual');
      expect(result.siteKey).toBeNull();
    });

    it('uses provided siteKey and explicit pageUrl', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'explicit-key',
            pageUrl: 'https://custom.url',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.siteKey).toBe('explicit-key');
      expect(result.pageUrl).toBe('https://custom.url');
    });

    it('hook mode requires explicit callbackName', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('callbackName');
    });

    it('hook mode falls through after failed callback interception', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockRejectedValue(new Error('Hook timeout')),
      });
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
            callbackName: 'captchaDone',
          },
          createMockCollector(page),
        ),
      );
      expect(result.success).toBe(false);
    });

    it('hook mode returns token when callback interception succeeds', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('hooked-token'),
      });
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
            callbackName: 'captchaDone',
          },
          createMockCollector(page),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.token).toBe('hooked-token');
      expect(result.method).toBe('hook');
    });

    it('supports non-2captcha providers in widget flow with explicit taskKind', async () => {
      process.env.CAPTCHA_PROVIDER = 'capsolver';
      process.env.CAPTCHA_CAPSOLVER_BASE_URL = buildTestUrl('solver-capsolver', {
        path: 'capsolver',
      });
      installJsonTaskApiFailureMock();

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'external_service',
            siteKey: 'test-key',
            apiKey: 'test',
            taskKind: 'hcaptcha',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERROR_INVALID_TASK_DATA');
    });

    it('manual mode ignores timeout extremes', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
            timeoutMs: 999999,
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
    });

    it('returns explicit siteKey error for non-manual flows', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('siteKey');
    });
  });
});

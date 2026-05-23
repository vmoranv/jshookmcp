import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';

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

describe('captcha-solver deep coverage', () => {
  let origEnv: Record<string, string | undefined>;
  let origFetch: typeof fetch | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('vision solve external-service paths', () => {
    it('fails when the 2captcha base URL is missing', async () => {
      delete process.env.CAPTCHA_SOLVER_BASE_URL;
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
            imageBase64: 'dGVzdA==',
            taskKind: 'image',
            maxRetries: 0,
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('CAPTCHA_SOLVER_BASE_URL');
    });

    it('retries on network failures and records warnings', async () => {
      process.env.CAPTCHA_SOLVER_BASE_URL = buildTestUrl('invalid-captcha-service', {
        scheme: 'http',
        suffix: 'test',
        path: '/',
      });
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            apiKey: 'test-key',
            imageBase64: 'dGVzdA==',
            taskKind: 'image',
            maxRetries: 1,
            timeoutMs: 5000,
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.maxRetries).toBe(1);
      expect(loggerState.warn).toHaveBeenCalledWith(expect.stringContaining('Attempt 1'));
    });

    it('uses provider arg with leading and trailing whitespace', async () => {
      process.env.CAPTCHA_ANTICAPTCHA_BASE_URL = buildTestUrl('solver-anticaptcha', {
        path: 'anticaptcha',
      });
      installJsonTaskApiFailureMock();
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'external_service',
            provider: '  AntiCaptcha  ',
            apiKey: 'test',
            imageBase64: 'dGVzdA==',
            taskKind: 'image',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERROR_INVALID_TASK_DATA');
    });
  });

  describe('challenge normalization', () => {
    it('treats numeric challengeType as image fallback', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 42 as any,
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.challengeType).toBe('image');
    });

    it('treats empty challengeType as image fallback', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: '',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.challengeType).toBe('image');
    });

    it('uses explicit taskKind for widget-solving responses', async () => {
      const result = parseJson<BrowserStatusResponse>(
        await handleCaptchaVisionSolve(
          {
            mode: 'manual',
            challengeType: 'widget',
            taskKind: 'hcaptcha',
            siteKey: 'auto-detected-key',
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.siteKey).toBe('auto-detected-key');
    });
  });

  describe('widget solve branches', () => {
    it('falls through from hook mode to external mode after null result', async () => {
      process.env.CAPTCHA_PROVIDER = 'capsolver';
      process.env.CAPTCHA_CAPSOLVER_BASE_URL = buildTestUrl('solver-capsolver', {
        path: 'capsolver',
      });
      installJsonTaskApiFailureMock();
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(null),
      });

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'test-key',
            callbackName: 'captchaDone',
            apiKey: 'test',
            taskKind: 'hcaptcha',
          },
          createMockCollector(page),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERROR_INVALID_TASK_DATA');
    });

    it('uses page.url() when pageUrl is not supplied', async () => {
      const page = createMockPage({
        url: vi.fn(() =>
          buildTestUrl('detected-url', { scheme: 'http', suffix: 'local', path: '/' }),
        ),
      });

      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'manual',
            siteKey: 'test-key',
          },
          createMockCollector(page),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.pageUrl).toBe(
        buildTestUrl('detected-url', { scheme: 'http', suffix: 'local', path: '/' }),
      );
    });

    it('reports external-service failure when injectToken is false', async () => {
      delete process.env.CAPTCHA_SOLVER_BASE_URL;
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'external_service',
            siteKey: 'test-key',
            apiKey: 'test-key',
            taskKind: 'turnstile',
            injectToken: false,
          },
          createMockCollector(createMockPage()),
        ),
      );
      expect(result.success).toBe(false);
      expect(result.suggestion).toContain('manual');
    });

    it('returns hook success fields when interception succeeds', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue('hook-token-123'),
      });
      const result = parseJson<BrowserStatusResponse>(
        await handleWidgetChallengeSolve(
          {
            mode: 'hook',
            siteKey: 'my-site-key',
            callbackName: 'captchaDone',
          },
          createMockCollector(page),
        ),
      );
      expect(result.success).toBe(true);
      expect(result.token).toBe('hook-token-123');
      expect(result.method).toBe('hook');
      expect(result.siteKey).toBe('my-site-key');
    });
  });

  describe('response formatting', () => {
    it('serializes successful manual responses', async () => {
      const response = (await handleCaptchaVisionSolve(
        { mode: 'manual' },
        createMockCollector(createMockPage()),
      )) as any;
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it('serializes failure responses with string errors', async () => {
      const response = (await handleWidgetChallengeSolve(
        { mode: 'external_service' },
        createMockCollector(createMockPage()),
      )) as any;
      const parsed = JSON.parse(response.content[0].text);
      expect(typeof parsed.error).toBe('string');
    });
  });
});

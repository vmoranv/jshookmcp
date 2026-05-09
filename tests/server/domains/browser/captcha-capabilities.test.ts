import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCaptchaSolverCapabilities } from '@server/domains/browser/handlers/captcha-capabilities';
import { buildTestUrl } from '@tests/shared/test-urls';

function createCollector(page: unknown = null) {
  return {
    getActivePage: vi.fn().mockResolvedValue(page),
  } as any;
}

describe('handleCaptchaSolverCapabilities', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY,
      CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER,
      CAPTCHA_SOLVER_BASE_URL: process.env.CAPTCHA_SOLVER_BASE_URL,
      CAPTCHA_2CAPTCHA_BASE_URL: process.env.CAPTCHA_2CAPTCHA_BASE_URL,
    };
    delete process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_PROVIDER;
    delete process.env.CAPTCHA_SOLVER_BASE_URL;
    delete process.env.CAPTCHA_2CAPTCHA_BASE_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete (process.env as any)[key];
      else (process.env as any)[key] = value;
    }
  });

  it('reports manual availability, unsupported providers, and missing page state truthfully', async () => {
    const parsed = parseJson<any>(await handleCaptchaSolverCapabilities(createCollector()));

    expect(parsed.tool).toBe('captcha_solver_capabilities');
    expect(parsed.configuredProvider).toBe('manual');
    expect(parsed.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'captcha_manual',
          available: true,
        }),
        expect.objectContaining({
          capability: 'captcha_external_service_2captcha',
          available: false,
        }),
        expect.objectContaining({
          capability: 'captcha_external_service_anticaptcha',
          available: false,
        }),
        expect.objectContaining({
          capability: 'captcha_external_service_capsolver',
          available: false,
        }),
        expect.objectContaining({
          capability: 'captcha_widget_hook_current_page',
          status: 'unknown',
        }),
      ]),
    );
  });

  it('reports external 2captcha path and widget hook as available when configured', async () => {
    process.env.CAPTCHA_PROVIDER = '2captcha';
    process.env.CAPTCHA_API_KEY = 'test-key';
    process.env.CAPTCHA_SOLVER_BASE_URL = buildTestUrl('solver', { suffix: 'example', path: '/' });

    const page = {
      evaluate: vi.fn().mockResolvedValue({
        url: buildTestUrl('example', { suffix: 'test', path: 'captcha' }),
        callbackCount: 2,
      }),
    };

    const parsed = parseJson<any>(await handleCaptchaSolverCapabilities(createCollector(page)));
    const external = parsed.capabilities.find(
      (entry: { capability: string }) => entry.capability === 'captcha_external_service_2captcha',
    );
    const hook = parsed.capabilities.find(
      (entry: { capability: string }) => entry.capability === 'captcha_widget_hook_current_page',
    );

    expect(external).toMatchObject({
      available: true,
      configuredProvider: '2captcha',
      defaultExternalProviderSupported: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
    });
    expect(hook).toMatchObject({
      available: true,
      pageAttached: true,
      callbackCount: 2,
      url: buildTestUrl('example', { suffix: 'test', path: 'captcha' }),
    });
  });
});

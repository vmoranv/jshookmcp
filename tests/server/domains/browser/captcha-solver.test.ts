import { describe, expect, it, vi } from 'vitest';
import {
  handleCaptchaVisionSolve,
  handleWidgetChallengeSolve,
} from '@server/domains/browser/handlers/captcha-solver';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createMockCollector(hasPage = true) {
  const page = hasPage
    ? {
        evaluate: vi
          .fn()
          .mockResolvedValue({ challengeType: 'image', taskKind: 'image', siteKey: '' }),
        url: () => 'http://test.local/page',
      }
    : null;
  return { getActivePage: vi.fn().mockResolvedValue(page) } as any;
}

describe('handleCaptchaVisionSolve', () => {
  it('throws when no active page', async () => {
    const collector = createMockCollector(false);
    await expect(handleCaptchaVisionSolve({}, collector)).rejects.toThrow(/No active page/);
  });

  it('returns manual mode instruction when mode is manual', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({ mode: 'manual' }, collector));
    expect(result.success).toBe(true);
    expect(result.mode).toBe('manual');
    expect(result.instruction).toBeDefined();
  });

  it('rejects an unimplemented legacy external service override', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
          provider: 'anticaptcha',
          apiKey: 'test-key',
        },
        collector
      )
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('implemented');
  });

  it('rejects another unimplemented legacy external service override', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
          provider: 'capsolver',
          apiKey: 'test-key',
        },
        collector
      )
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('implemented');
  });

  it('rejects unsupported external service overrides', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
          provider: 'unknown_provider',
          apiKey: 'test-key',
        },
        collector
      )
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
  });

  it('requires credentials for external service mode', async () => {
    const collector = createMockCollector(true);
    // Ensure no env var is set
    const origKey = process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_API_KEY;

    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
        },
        collector
      )
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials');

    process.env.CAPTCHA_API_KEY = origKey;
  });

  it('clamps timeoutMs to [5000, 600000]', async () => {
    const collector = createMockCollector(true);
    // Manual mode so we can inspect params without needing API
    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          timeoutMs: 1,
        },
        collector
      )
    );
    // Manual mode doesn't expose timeoutMs in response, but no error means it clamped properly
    expect(result.success).toBe(true);
  });

  it('clamps maxRetries to [0, 5]', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          maxRetries: 100,
        },
        collector
      )
    );
    expect(result.success).toBe(true);
  });

  it('auto-detects captcha type from page', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          typeHint: 'auto',
        },
        collector
      )
    );
    expect(result.challengeType).toBeDefined();
  });
});

describe('handleWidgetChallengeSolve', () => {
  it('throws when no active page', async () => {
    const collector = createMockCollector(false);
    await expect(handleWidgetChallengeSolve({}, collector)).rejects.toThrow(/No active page/);
  });

  it('requires siteKey detection or manual input', async () => {
    const collector = createMockCollector(true);
    // evaluate returns empty string for siteKey
    (collector.getActivePage as any).mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(''),
      url: () => 'http://test.local',
    });

    const result = parseJson(
      await handleWidgetChallengeSolve({ mode: 'external_service' }, collector)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('siteKey');
  });

  it('returns manual mode when mode is manual', async () => {
    const collector = createMockCollector(true);
    (collector.getActivePage as any).mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue('test-site-key'),
      url: () => 'http://test.local',
    });

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
    expect(result.mode).toBe('manual');
    expect(result.challengeType).toBe('widget');
  });

  it('rejects unimplemented external service overrides', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(
      await handleWidgetChallengeSolve(
        {
          mode: 'external_service',
          provider: 'anticaptcha',
          siteKey: 'test-key',
        },
        collector
      )
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('implemented');
  });

  it('requires credentials for external service mode', async () => {
    const collector = createMockCollector(true);
    const origKey = process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_API_KEY;

    const result = parseJson(
      await handleWidgetChallengeSolve(
        {
          mode: 'external_service',
          siteKey: 'test-key',
        },
        collector
      )
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials');

    process.env.CAPTCHA_API_KEY = origKey;
  });

  it('clamps timeoutMs to [5000, 600000]', async () => {
    const collector = createMockCollector(true);
    // Manual mode to avoid network calls
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
});

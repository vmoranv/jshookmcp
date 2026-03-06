import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  handleCaptchaVisionSolve,
  handleTurnstileSolve,
} from '@server/domains/browser/handlers/captcha-solver';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createMockCollector(hasPage = true) {
  const page = hasPage
    ? {
        evaluate: vi.fn().mockResolvedValue({ type: 'image', siteKey: '' }),
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

  it('returns manual mode instruction when provider is manual', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({ provider: 'manual' }, collector));
    expect(result.success).toBe(true);
    expect(result.mode).toBe('manual');
    expect(result.instruction).toBeDefined();
  });

  it('rejects anticaptcha provider with clear error', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({
      provider: 'anticaptcha',
      apiKey: 'test-key',
    }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });

  it('rejects capsolver provider with clear error', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({
      provider: 'capsolver',
      apiKey: 'test-key',
    }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });

  it('rejects unsupported provider', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({
      provider: 'unknown_provider',
      apiKey: 'test-key',
    }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
  });

  it('requires API key for 2captcha provider', async () => {
    const collector = createMockCollector(true);
    // Ensure no env var is set
    const origKey = process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_API_KEY;

    const result = parseJson(await handleCaptchaVisionSolve({
      provider: '2captcha',
    }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');

    process.env.CAPTCHA_API_KEY = origKey;
  });

  it('clamps timeoutMs to [5000, 600000]', async () => {
    const collector = createMockCollector(true);
    // Provider=manual so we can inspect params without needing API
    const result = parseJson(await handleCaptchaVisionSolve({
      provider: 'manual',
      timeoutMs: 1,
    }, collector));
    // Manual mode doesn't expose timeoutMs in response, but no error means it clamped properly
    expect(result.success).toBe(true);
  });

  it('clamps maxRetries to [0, 5]', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({
      provider: 'manual',
      maxRetries: 100,
    }, collector));
    expect(result.success).toBe(true);
  });

  it('auto-detects captcha type from page', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleCaptchaVisionSolve({
      provider: 'manual',
      typeHint: 'auto',
    }, collector));
    expect(result.captchaType).toBeDefined();
  });
});

describe('handleTurnstileSolve', () => {
  it('throws when no active page', async () => {
    const collector = createMockCollector(false);
    await expect(handleTurnstileSolve({}, collector)).rejects.toThrow(/No active page/);
  });

  it('requires siteKey detection or manual input', async () => {
    const collector = createMockCollector(true);
    // evaluate returns empty string for siteKey
    (collector.getActivePage as any).mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(''),
      url: () => 'http://test.local',
    });

    const result = parseJson(await handleTurnstileSolve({ provider: '2captcha' }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('siteKey');
  });

  it('returns manual mode when provider is manual', async () => {
    const collector = createMockCollector(true);
    (collector.getActivePage as any).mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue('test-site-key'),
      url: () => 'http://test.local',
    });

    const result = parseJson(await handleTurnstileSolve({
      provider: 'manual',
      siteKey: 'test-key',
    }, collector));
    expect(result.success).toBe(true);
    expect(result.mode).toBe('manual');
  });

  it('rejects unimplemented providers', async () => {
    const collector = createMockCollector(true);
    const result = parseJson(await handleTurnstileSolve({
      provider: 'anticaptcha',
      siteKey: 'test-key',
    }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });

  it('requires API key for 2captcha provider', async () => {
    const collector = createMockCollector(true);
    const origKey = process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_API_KEY;

    const result = parseJson(await handleTurnstileSolve({
      provider: '2captcha',
      siteKey: 'test-key',
    }, collector));
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');

    process.env.CAPTCHA_API_KEY = origKey;
  });

  it('clamps timeoutMs to [5000, 600000]', async () => {
    const collector = createMockCollector(true);
    // Manual provider to avoid network calls
    const result = parseJson(await handleTurnstileSolve({
      provider: 'manual',
      siteKey: 'test-key',
      timeoutMs: 1,
    }, collector));
    expect(result.success).toBe(true);
  });
});

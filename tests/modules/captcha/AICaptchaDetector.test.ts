import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalize } from 'node:path';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const fsState = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('fs/promises', () => ({
  mkdir: fsState.mkdir,
  writeFile: fsState.writeFile,
}));

import { AICaptchaDetector } from '@modules/captcha/AICaptchaDetector';

class TestAICaptchaDetector extends AICaptchaDetector {
  public getScreenshotDir() {
    return this.screenshotDir;
  }

  public evaluateFallback(pageInfo: any) {
    return super.evaluateFallbackTextAnalysis(pageInfo);
  }

  public applyGuardrails(pageInfo: any, result: any) {
    return super.applyLocalGuardrails(pageInfo, result);
  }

  public override async saveScreenshot(base64: string): Promise<string> {
    return super.saveScreenshot(base64);
  }
}

function createPage(overrides: Record<string, unknown> = {}) {
  return {
    screenshot: vi.fn(async () => Buffer.from('img').toString('base64')),
    url: vi.fn(() => 'https://vmoranv.github.io/jshookmcp/login'),
    title: vi.fn(async () => 'Security Check'),
    evaluate: vi.fn(async () => ({
      bodyText: 'Please verify',
      hasIframes: true,
      suspiciousElements: ['.captcha (1)'],
    })),
    ...overrides,
  } as any;
}

describe('AICaptchaDetector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    fsState.mkdir.mockReset();
    fsState.writeFile.mockReset();
  });

  it('detects captcha from strong local heuristics', async () => {
    const detector = new TestAICaptchaDetector();
    const page = createPage({
      title: vi.fn(async () => '安全验证'),
      evaluate: vi.fn(async () => ({
        bodyText: '请完成安全验证，并拖动滑块继续',
        hasIframes: false,
        suspiciousElements: ['.captcha-slider (1)'],
      })),
    });

    const result = await detector.detect(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(60);
    expect(result.reasoning).toContain('Fallback heuristics');
  });

  it('does not misclassify OTP text as captcha during fallback analysis', async () => {
    const detector = new TestAICaptchaDetector();
    const page = createPage({
      title: vi.fn(async () => '手机验证'),
      evaluate: vi.fn(async () => ({
        bodyText: '请输入验证码，我们已发送短信验证码',
        hasIframes: false,
        suspiciousElements: ['[class*="verify"] (1)'],
      })),
    });

    const result = await detector.detect(page);

    expect(result.detected).toBe(false);
    expect(result.type).toBe('none');
    expect(result.confidence).toBe(95);
    expect(result.reasoning).toContain('OTP');
  });

  it('returns a generic negative result when strong captcha signals are absent', async () => {
    const detector = new TestAICaptchaDetector();
    const page = createPage({
      title: vi.fn(async () => 'Home'),
      evaluate: vi.fn(async () => ({
        bodyText: 'Welcome back',
        hasIframes: false,
        suspiciousElements: [],
      })),
    });

    const result = await detector.detect(page);

    expect(result.detected).toBe(false);
    expect(result.type).toBe('none');
    expect(result.confidence).toBe(90);
  });

  it('treats strong captcha signals as higher priority than OTP-like wording', async () => {
    const detector = new TestAICaptchaDetector();
    const page = createPage({
      title: vi.fn(async () => '安全验证'),
      evaluate: vi.fn(async () => ({
        bodyText: '请输入验证码后拖动滑块完成安全验证',
        hasIframes: false,
        suspiciousElements: ['.captcha-slider (1)'],
      })),
    });

    const result = await detector.detect(page);

    expect(result.detected).toBe(true);
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(55);
    expect(result.reasoning).toContain('strong CAPTCHA signals');
  });

  it('evaluateFallbackTextAnalysis handles verification wording without strong markers', () => {
    const detector = new TestAICaptchaDetector();
    const result = detector.evaluateFallback({
      url: 'https://vmoranv.github.io/jshookmcp/verify',
      title: '账号验证',
      bodyText: '请完成验证后继续',
      hasIframes: false,
      suspiciousElements: ['[class*="verify"] (1)'],
    });

    expect(result.detected).toBe(false);
    expect(result.type).toBe('none');
    expect(result.confidence).toBe(90);
  });

  it('applyLocalGuardrails overrides false negatives when local heuristics are strong', () => {
    const detector = new TestAICaptchaDetector();
    const pageInfo = {
      url: 'https://vmoranv.github.io/jshookmcp/login',
      title: '安全验证',
      bodyText: '请完成安全验证，并拖动滑块继续',
      hasIframes: false,
      suspiciousElements: ['.captcha-slider (1)'],
    };

    const result = detector.applyGuardrails(pageInfo, {
      detected: false,
      type: 'none',
      confidence: 92,
      reasoning: 'no captcha',
      screenshotPath: 'snap.png',
    });

    expect(result.detected).toBe(true);
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(60);
    expect(result.reasoning).toContain('AI reported no CAPTCHA');
    expect(result.screenshotPath).toBe('snap.png');
  });

  it('applyLocalGuardrails preserves negatives when no strong override signals exist', () => {
    const detector = new TestAICaptchaDetector();
    const pageInfo = {
      url: 'https://vmoranv.github.io/jshookmcp/verify',
      title: '账号验证',
      bodyText: '请完成验证后继续',
      hasIframes: false,
      suspiciousElements: ['[class*="verify"] (1)'],
    };

    const result = detector.applyGuardrails(pageInfo, {
      detected: false,
      type: 'none',
      confidence: 92,
      reasoning: 'no captcha',
    });

    expect(result.detected).toBe(false);
    expect(result.type).toBe('none');
    expect(result.confidence).toBe(92);
    expect(result.reasoning).toBe('no captcha');
  });

  it('waitForCompletion returns true when captcha disappears or confidence drops', async () => {
    vi.useFakeTimers();
    const detector = new TestAICaptchaDetector();
    vi.spyOn(detector, 'detect')
      .mockResolvedValueOnce({ detected: true, type: 'unknown', confidence: 80, reasoning: '' })
      .mockResolvedValueOnce({ detected: true, type: 'unknown', confidence: 40, reasoning: '' });

    const promise = detector.waitForCompletion(createPage(), 5000);
    await vi.advanceTimersByTimeAsync(3100);
    const done = await promise;

    expect(done).toBe(true);
  });

  it('waitForCompletion returns false after timeout', async () => {
    vi.useFakeTimers();
    const detector = new TestAICaptchaDetector();
    vi.spyOn(detector, 'detect').mockResolvedValue({
      detected: true,
      type: 'unknown',
      confidence: 99,
      reasoning: '',
    });

    const promise = detector.waitForCompletion(createPage(), 1000);
    await vi.advanceTimersByTimeAsync(3500);
    const done = await promise;

    expect(done).toBe(false);
  });

  it('saveScreenshot writes decoded bytes and returns path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    const detector = new TestAICaptchaDetector('/tmp/captcha');

    const path = await detector.saveScreenshot(Buffer.from('abc').toString('base64'));

    expect(normalize(path)).toContain(normalize('/tmp/captcha'));
    expect(path).toContain('captcha-42.png');
    expect(fsState.writeFile).toHaveBeenCalled();
  });
});

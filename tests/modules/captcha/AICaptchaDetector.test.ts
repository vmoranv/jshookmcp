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

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('fs/promises', () => ({
  mkdir: fsState.mkdir,
  writeFile: fsState.writeFile,
}));

import { AICaptchaDetector } from '../../../src/modules/captcha/AICaptchaDetector.js';

function createPage(overrides: Partial<any> = {}) {
  return {
    screenshot: vi.fn(async () => Buffer.from('img').toString('base64')),
    url: vi.fn(() => 'https://site.test/login'),
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

  it('detects captcha from AI JSON response', async () => {
    const llm = {
      analyzeImage: vi.fn(async () =>
        JSON.stringify({
          detected: true,
          type: 'slider',
          confidence: 96,
          reasoning: 'slider present',
          vendor: 'geetest',
          suggestions: ['solve'],
        })
      ),
    } as any;
    const detector = new AICaptchaDetector(llm);
    const result = await detector.detect(createPage());

    expect(result.detected).toBe(true);
    expect(result.type).toBe('slider');
    expect(result.vendor).toBe('geetest');
    expect(llm.analyzeImage).toHaveBeenCalledTimes(1);
  });

  it('falls back to external-analysis guidance when model has no vision support', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const llm = {
      analyzeImage: vi.fn(async () => {
        throw new Error('model does not support image analysis');
      }),
    } as any;
    const detector = new AICaptchaDetector(llm, '/tmp/snaps');
    const result = await detector.detect(createPage());

    expect(result.detected).toBe(false);
    expect(result.vendor).toBe('external-ai-required');
    expect(result.screenshotPath).toContain('captcha-1700000000000.png');
    expect(fsState.mkdir).toHaveBeenCalled();
    expect(fsState.writeFile).toHaveBeenCalled();
  });

  it('falls back to rule-based text analysis on generic AI failure', async () => {
    const llm = {
      analyzeImage: vi.fn(async () => {
        throw new Error('network error');
      }),
    } as any;
    const page = createPage({
      title: vi.fn(async () => 'Home'),
      evaluate: vi.fn(async () => ({ bodyText: 'Welcome', hasIframes: false, suspiciousElements: [] })),
    });
    const detector = new AICaptchaDetector(llm);
    const result = await detector.detect(page);

    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(90);
  });

  it('handles malformed AI response with heuristic fallback parser', () => {
    const detector = new AICaptchaDetector({ analyzeImage: vi.fn() } as any) as any;
    const result = detector.parseAIResponse('Detected: true; confidence maybe high', '');

    expect(result.detected).toBe(true);
    expect(result.reasoning).toContain('AI parse failed');
  });

  it('waitForCompletion returns true when captcha disappears or confidence drops', async () => {
    vi.useFakeTimers();
    const detector = new AICaptchaDetector({ analyzeImage: vi.fn() } as any);
    vi.spyOn(detector, 'detect')
      .mockResolvedValueOnce({ detected: true, confidence: 80, reasoning: '' })
      .mockResolvedValueOnce({ detected: true, confidence: 40, reasoning: '' });

    const promise = detector.waitForCompletion(createPage(), 5000);
    await vi.advanceTimersByTimeAsync(3100);
    const done = await promise;

    expect(done).toBe(true);
  });

  it('waitForCompletion returns false after timeout', async () => {
    vi.useFakeTimers();
    const detector = new AICaptchaDetector({ analyzeImage: vi.fn() } as any);
    vi.spyOn(detector, 'detect').mockResolvedValue({ detected: true, confidence: 99, reasoning: '' });

    const promise = detector.waitForCompletion(createPage(), 1000);
    await vi.advanceTimersByTimeAsync(3500);
    const done = await promise;

    expect(done).toBe(false);
  });

  it('saveScreenshot writes decoded bytes and returns path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    const detector = new AICaptchaDetector({ analyzeImage: vi.fn() } as any, '/tmp/captcha') as any;

    const path = await detector.saveScreenshot(Buffer.from('abc').toString('base64'));

    expect(normalize(path)).toContain(normalize('/tmp/captcha'));
    expect(path).toContain('captcha-42.png');
    expect(fsState.writeFile).toHaveBeenCalled();
  });
});

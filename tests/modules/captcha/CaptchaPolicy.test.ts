import { describe, expect, it } from 'vitest';

import { determineCaptchaResolution } from '@modules/captcha/CaptchaPolicy';
import type { CaptchaAssessment } from '@modules/captcha/types';

function createAssessment(overrides: Partial<CaptchaAssessment> = {}): CaptchaAssessment {
  return {
    signals: [],
    candidates: [],
    score: 0,
    excludeScore: 0,
    confidence: 0,
    likelyCaptcha: false,
    recommendedNextStep: 'ignore',
    primaryDetection: { detected: false, type: 'none', confidence: 0 },
    ...overrides,
  };
}

describe('CaptchaPolicy', () => {
  it('switches to headed mode for manual handling when allowed', () => {
    const resolution = determineCaptchaResolution(
      createAssessment({
        likelyCaptcha: true,
        recommendedNextStep: 'manual',
        primaryDetection: { detected: true, type: 'slider', confidence: 95 },
      }),
      {
        autoDetectCaptcha: true,
        autoSwitchHeadless: true,
        isHeadless: true,
      }
    );

    expect(resolution.action).toBe('switch_to_headed');
  });

  it('keeps manual handling in the current mode when switching is disabled', () => {
    const resolution = determineCaptchaResolution(
      createAssessment({
        likelyCaptcha: true,
        recommendedNextStep: 'manual',
        primaryDetection: { detected: true, type: 'slider', confidence: 95 },
      }),
      {
        autoDetectCaptcha: true,
        autoSwitchHeadless: false,
        isHeadless: true,
      }
    );

    expect(resolution.action).toBe('manual');
  });

  it('preserves ask_ai for ambiguous assessments', () => {
    const resolution = determineCaptchaResolution(
      createAssessment({
        likelyCaptcha: false,
        recommendedNextStep: 'ask_ai',
      }),
      {
        autoDetectCaptcha: true,
        autoSwitchHeadless: true,
        isHeadless: true,
      }
    );

    expect(resolution.action).toBe('ask_ai');
  });
});

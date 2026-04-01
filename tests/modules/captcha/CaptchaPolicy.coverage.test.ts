import { describe, expect, it } from 'vitest';

import {
  determineCaptchaResolution,
  type CaptchaResolutionContext,
} from '@modules/captcha/CaptchaPolicy';
import type { CaptchaAssessment, CaptchaNextStep } from '@modules/captcha/types';

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

function createContext(
  overrides: Partial<CaptchaResolutionContext> = {},
): CaptchaResolutionContext {
  return {
    autoDetectCaptcha: true,
    autoSwitchHeadless: true,
    isHeadless: true,
    ...overrides,
  };
}

describe('CaptchaPolicy — full coverage', () => {
  // ── autoDetectCaptcha disabled ──

  describe('when autoDetectCaptcha is disabled', () => {
    it('returns ignore action regardless of assessment', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({
          likelyCaptcha: true,
          recommendedNextStep: 'manual',
          confidence: 99,
        }),
        createContext({ autoDetectCaptcha: false }),
      );

      expect(resolution.action).toBe('ignore');
      expect(resolution.reason).toContain('disabled');
    });

    it.each<CaptchaNextStep>(['ignore', 'ask_ai', 'observe', 'manual', 'switch_to_headed'])(
      'returns ignore for recommendedNextStep=%s when auto-detect is off',
      (step) => {
        const resolution = determineCaptchaResolution(
          createAssessment({ recommendedNextStep: step }),
          createContext({ autoDetectCaptcha: false }),
        );

        expect(resolution.action).toBe('ignore');
      },
    );
  });

  // ── recommendedNextStep: ignore ──

  describe('recommendedNextStep: ignore', () => {
    it('returns ignore action', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'ignore' }),
        createContext(),
      );

      expect(resolution.action).toBe('ignore');
      expect(resolution.reason).toContain('did not find strong CAPTCHA evidence');
    });
  });

  // ── recommendedNextStep: ask_ai ──

  describe('recommendedNextStep: ask_ai', () => {
    it('returns ask_ai action', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'ask_ai' }),
        createContext(),
      );

      expect(resolution.action).toBe('ask_ai');
      expect(resolution.reason).toContain('ambiguous');
    });
  });

  // ── recommendedNextStep: observe ──

  describe('recommendedNextStep: observe', () => {
    it('returns observe action', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'observe' }),
        createContext(),
      );

      expect(resolution.action).toBe('observe');
      expect(resolution.reason).toContain('weak CAPTCHA signals');
    });
  });

  // ── recommendedNextStep: switch_to_headed ──

  describe('recommendedNextStep: switch_to_headed', () => {
    it('switches to headed mode when isHeadless and autoSwitchHeadless are true', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'switch_to_headed' }),
        createContext({ isHeadless: true, autoSwitchHeadless: true }),
      );

      expect(resolution.action).toBe('switch_to_headed');
      expect(resolution.reason).toContain('switch to headed mode');
    });

    it('falls back to manual when not headless', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'switch_to_headed' }),
        createContext({ isHeadless: false, autoSwitchHeadless: true }),
      );

      expect(resolution.action).toBe('manual');
      expect(resolution.reason).toContain('disabled or already unnecessary');
    });

    it('falls back to manual when autoSwitchHeadless is false', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'switch_to_headed' }),
        createContext({ isHeadless: true, autoSwitchHeadless: false }),
      );

      expect(resolution.action).toBe('manual');
      expect(resolution.reason).toContain('disabled or already unnecessary');
    });

    it('falls back to manual when both isHeadless and autoSwitchHeadless are false', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'switch_to_headed' }),
        createContext({ isHeadless: false, autoSwitchHeadless: false }),
      );

      expect(resolution.action).toBe('manual');
    });
  });

  // ── recommendedNextStep: manual ──

  describe('recommendedNextStep: manual', () => {
    it('switches to headed mode when headless and auto-switch are allowed', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'manual' }),
        createContext({ isHeadless: true, autoSwitchHeadless: true }),
      );

      expect(resolution.action).toBe('switch_to_headed');
      expect(resolution.reason).toContain('headed mode is allowed');
    });

    it('keeps manual when auto-switch is disabled', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'manual' }),
        createContext({ isHeadless: true, autoSwitchHeadless: false }),
      );

      expect(resolution.action).toBe('manual');
      expect(resolution.reason).toContain('wait for manual completion');
    });

    it('keeps manual when not headless', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'manual' }),
        createContext({ isHeadless: false, autoSwitchHeadless: true }),
      );

      expect(resolution.action).toBe('manual');
      expect(resolution.reason).toContain('wait for manual completion');
    });

    it('keeps manual when both headless and auto-switch are off', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'manual' }),
        createContext({ isHeadless: false, autoSwitchHeadless: false }),
      );

      expect(resolution.action).toBe('manual');
    });
  });

  // ── default branch (unknown step values) ──

  describe('default branch for unknown step values', () => {
    it('handles unknown recommendedNextStep as manual (default case)', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'unknown_value' as CaptchaNextStep }),
        createContext({ isHeadless: true, autoSwitchHeadless: true }),
      );

      // Falls into default case which behaves like 'manual'
      expect(resolution.action).toBe('switch_to_headed');
    });

    it('handles unknown recommendedNextStep as manual when switching disabled', () => {
      const resolution = determineCaptchaResolution(
        createAssessment({ recommendedNextStep: 'unknown_value' as CaptchaNextStep }),
        createContext({ isHeadless: false, autoSwitchHeadless: false }),
      );

      expect(resolution.action).toBe('manual');
    });
  });
});

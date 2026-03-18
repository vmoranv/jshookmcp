import type { CaptchaAssessment, CaptchaNextStep } from '@modules/captcha/types';

export interface CaptchaResolutionContext {
  autoDetectCaptcha: boolean;
  autoSwitchHeadless: boolean;
  isHeadless: boolean;
}

export interface CaptchaResolution {
  action: CaptchaNextStep;
  reason: string;
}

/**
 * Convert a detection assessment into an executable action while keeping the
 * policy separate from signal extraction.
 */
export function determineCaptchaResolution(
  assessment: CaptchaAssessment,
  context: CaptchaResolutionContext
): CaptchaResolution {
  if (!context.autoDetectCaptcha) {
    return {
      action: 'ignore',
      reason: 'Automatic CAPTCHA handling is disabled by configuration.',
    };
  }

  switch (assessment.recommendedNextStep) {
    case 'ignore':
      return {
        action: 'ignore',
        reason: 'Rule-based assessment did not find strong CAPTCHA evidence.',
      };
    case 'ask_ai':
      return {
        action: 'ask_ai',
        reason:
          'Signals are mixed or ambiguous; escalate to AI/manual review instead of auto-acting.',
      };
    case 'observe':
      return {
        action: 'observe',
        reason: 'There are weak CAPTCHA signals, but not enough to justify intervention yet.',
      };
    case 'switch_to_headed':
      return context.isHeadless && context.autoSwitchHeadless
        ? {
            action: 'switch_to_headed',
            reason:
              'High-confidence CAPTCHA detected in headless mode; switch to headed mode for manual completion.',
          }
        : {
            action: 'manual',
            reason: 'CAPTCHA detected, but headed switching is disabled or already unnecessary.',
          };
    case 'manual':
    default:
      return context.isHeadless && context.autoSwitchHeadless
        ? {
            action: 'switch_to_headed',
            reason: 'CAPTCHA detected and headed mode is allowed for manual completion.',
          }
        : {
            action: 'manual',
            reason: 'CAPTCHA detected; wait for manual completion in the current browser mode.',
          };
  }
}

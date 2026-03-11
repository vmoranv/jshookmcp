import { CAPTCHA_SELECTORS } from '@modules/captcha/rules/selectors';
import type { CaptchaDomRule } from '@modules/captcha/types';

export const DOM_MATCH_RULES: readonly CaptchaDomRule[] = [
  {
    id: 'generic-slider-dom',
    label: 'generic slider challenge selector',
    selectors: CAPTCHA_SELECTORS.slider,
    confidence: 92,
    typeHint: 'slider',
    requiresVisibility: true,
    verifier: 'slider',
  },
  {
    id: 'embedded-widget-dom',
    label: 'embedded widget challenge selector',
    selectors: CAPTCHA_SELECTORS.widget,
    confidence: 98,
    typeHint: 'widget',
    providerHint: 'embedded_widget',
  },
  {
    id: 'edge-browser-check-dom',
    label: 'edge browser-check selector',
    selectors: CAPTCHA_SELECTORS.browserCheck,
    confidence: 97,
    typeHint: 'browser_check',
    providerHint: 'edge_service',
  },
] as const;

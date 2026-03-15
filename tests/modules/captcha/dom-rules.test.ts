import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DOM_MATCH_RULES } from '@modules/captcha/rules/dom-rules';
import { CAPTCHA_SELECTORS } from '@modules/captcha/rules/selectors';

describe('captcha DOM rules', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps DOM heuristics to the selector collections with visibility and verifier hints', () => {
    const sliderRule = DOM_MATCH_RULES.find((rule) => rule.id === 'generic-slider-dom');
    const widgetRule = DOM_MATCH_RULES.find((rule) => rule.id === 'embedded-widget-dom');
    const browserCheckRule = DOM_MATCH_RULES.find((rule) => rule.id === 'edge-browser-check-dom');

    expect(sliderRule?.selectors).toEqual(CAPTCHA_SELECTORS.slider);
    expect(sliderRule?.requiresVisibility).toBe(true);
    expect(sliderRule?.verifier).toBe('slider');
    expect(widgetRule?.providerHint).toBe('embedded_widget');
    expect(browserCheckRule?.providerHint).toBe('edge_service');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CAPTCHA_SELECTORS, EXCLUDE_SELECTORS } from '@modules/captcha/rules/selectors';

describe('captcha selectors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defines slider, widget and browser-check selector buckets', () => {
    expect(CAPTCHA_SELECTORS.slider).toContain('.captcha-slider');
    expect(CAPTCHA_SELECTORS.widget).toContain('[data-sitekey]');
    expect(CAPTCHA_SELECTORS.browserCheck).toContain('#challenge-form');
    expect(CAPTCHA_SELECTORS.generic).toContain('[class*="captcha"]');
  });

  it('keeps known non-captcha slider-like elements in the exclude list', () => {
    expect(EXCLUDE_SELECTORS).toContain('[class*="video"]');
    expect(EXCLUDE_SELECTORS).toContain('[class*="swiper"]');
    expect(EXCLUDE_SELECTORS).toContain('[class*="progress"]');
  });
});

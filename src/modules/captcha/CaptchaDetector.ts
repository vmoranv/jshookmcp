import { Page } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import {
  CAPTCHA_KEYWORDS,
  CAPTCHA_SELECTORS,
  EXCLUDE_KEYWORDS,
  EXCLUDE_SELECTORS,
} from '@modules/captcha/CaptchaDetector.constants';
import type { CaptchaDetectionResult } from '@modules/captcha/types';

// Re-export for backward compatibility
export type { CaptchaDetectionResult } from '@modules/captcha/types';

export class CaptchaDetector {
  private static readonly EXCLUDE_SELECTORS = EXCLUDE_SELECTORS;
  private static readonly CAPTCHA_SELECTORS = CAPTCHA_SELECTORS;
  private static readonly CAPTCHA_KEYWORDS = CAPTCHA_KEYWORDS;
  private static readonly EXCLUDE_KEYWORDS = EXCLUDE_KEYWORDS;
  async detect(page: Page): Promise<CaptchaDetectionResult> {
    try {
      logger.info('Starting CAPTCHA detection checks');

      const urlCheck = await this.checkUrl(page);
      if (urlCheck.detected) {
        return urlCheck;
      }

      const titleCheck = await this.checkTitle(page);
      if (titleCheck.detected) {
        return titleCheck;
      }

      const domCheck = await this.checkDOMElements(page);
      if (domCheck.detected) {
        return domCheck;
      }

      const textCheck = await this.checkPageText(page);
      if (textCheck.detected) {
        return textCheck;
      }

      const vendorCheck = await this.checkVendorSpecific(page);
      if (vendorCheck.detected) {
        return vendorCheck;
      }

      logger.info('No CAPTCHA detected by current heuristics');
      return { detected: false, type: 'none', confidence: 0 };
    } catch (error) {
      logger.error('CAPTCHA detection failed', error);
      return { detected: false, type: 'none', confidence: 0 };
    }
  }

  private async checkUrl(page: Page): Promise<CaptchaDetectionResult> {
    const url = page.url();
    const lowerUrl = url.toLowerCase();

    for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.url) {
      if (lowerUrl.includes(excludeKeyword)) {
        logger.debug(`URL matched exclusion keyword: ${excludeKeyword}`);
        return {
          detected: false,
          type: 'none',
          confidence: 0,
          falsePositiveReason: `URL exclusion: ${excludeKeyword}`,
        };
      }
    }

    for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.url) {
      if (lowerUrl.includes(keyword)) {
        let type: CaptchaDetectionResult['type'] = 'url_redirect';
        let providerHint: CaptchaDetectionResult['providerHint'];
        let confidence = 70;

        if (
          lowerUrl.includes('cloudflare') ||
          lowerUrl.includes('cdn-cgi') ||
          lowerUrl.includes('akamai') ||
          lowerUrl.includes('datadome') ||
          lowerUrl.includes('perimeterx') ||
          lowerUrl.includes('perimeter') ||
          lowerUrl.includes('px-captcha') ||
          lowerUrl.includes('incapsula') ||
          lowerUrl.includes('distil') ||
          lowerUrl.includes('shield-square')
        ) {
          type = 'browser_check';
          providerHint = 'edge_service';
          confidence = 95;
        } else if (
          lowerUrl.includes('recaptcha') ||
          lowerUrl.includes('turnstile') ||
          lowerUrl.includes('hcaptcha')
        ) {
          type = 'widget';
          providerHint = 'embedded_widget';
          confidence = 95;
        } else if (
          lowerUrl.includes('geetest') ||
          lowerUrl.includes('aliyun/captcha') ||
          lowerUrl.includes('tencent/captcha') ||
          lowerUrl.includes('netease-captcha') ||
          lowerUrl.includes('yidun')
        ) {
          type = 'slider';
          providerHint = 'regional_service';
          confidence = 90;
        } else if (
          lowerUrl.includes('arkose') ||
          lowerUrl.includes('funcaptcha') ||
          lowerUrl.includes('friendly-captcha') ||
          lowerUrl.includes('keycaptcha') ||
          lowerUrl.includes('iw-captcha')
        ) {
          type = 'widget';
          providerHint = 'managed_service';
          confidence = 90;
        }

        if (confidence < 80) {
          const domCheck = await this.verifyByDOM(page);
          if (!domCheck) {
            logger.debug(`URL keyword match in DOM, skipping: ${keyword}`);
            return {
              detected: false,
              type: 'none',
              confidence: 0,
              falsePositiveReason: `URLDOM: ${keyword}`,
            };
          }
          confidence = 85;
        }

        logger.warn(`CAPTCHA URL signal detected (confidence: ${confidence}%)`);
        return {
          detected: true,
          type,
          url,
          providerHint,
          confidence,
        };
      }
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkTitle(page: Page): Promise<CaptchaDetectionResult> {
    const title = await page.title();
    const lowerTitle = title.toLowerCase();

    for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.title) {
      if (lowerTitle.includes(excludeKeyword.toLowerCase())) {
        logger.debug(`Title matched exclusion keyword: ${excludeKeyword}`);
        return {
          detected: false,
          type: 'none',
          confidence: 0,
          falsePositiveReason: `Title exclusion: ${excludeKeyword}`,
        };
      }
    }

    for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.title) {
      if (lowerTitle.includes(keyword)) {
        const domCheck = await this.verifyByDOM(page);
        if (!domCheck) {
          logger.debug(`DOM keyword is common UI element, skipping: ${keyword}`);
          return {
            detected: false,
            type: 'none',
            confidence: 0,
            falsePositiveReason: `DOM: ${keyword}`,
          };
        }

        logger.warn(`CAPTCHA DOM keyword detected: ${keyword}`);
        return {
          detected: true,
          type: 'page_redirect',
          title,
          confidence: 85,
        };
      }
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkDOMElements(page: Page): Promise<CaptchaDetectionResult> {
    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.slider) {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await element.isIntersectingViewport();
        if (isVisible) {
          const isRealSlider = await this.verifySliderElement(page, selector);
          if (!isRealSlider) {
            logger.debug(`Selector is generic, skipping: ${selector}`);
            continue;
          }

          logger.warn(`Slider CAPTCHA selector detected: ${selector}`);

          let providerHint: CaptchaDetectionResult['providerHint'];
          if (
            selector.includes('geetest') ||
            selector.includes('nc_') ||
            selector.includes('aliyun') ||
            selector.includes('tcaptcha') ||
            selector.includes('tencent') ||
            selector.includes('yidun')
          ) {
            providerHint = 'regional_service';
          }

          return {
            detected: true,
            type: 'slider',
            selector,
            providerHint,
            confidence: 95,
          };
        }
      }
    }

    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.recaptcha) {
      const element = await page.$(selector);
      if (element) {
        logger.warn(`Embedded challenge widget detected: ${selector}`);
        return {
          detected: true,
          type: 'widget',
          selector,
          providerHint: 'embedded_widget',
          confidence: 98,
        };
      }
    }

    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.hcaptcha) {
      const element = await page.$(selector);
      if (element) {
        logger.warn(`Embedded challenge widget detected: ${selector}`);
        return {
          detected: true,
          type: 'widget',
          selector,
          providerHint: 'embedded_widget',
          confidence: 98,
        };
      }
    }

    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.cloudflare) {
      const element = await page.$(selector);
      if (element) {
        logger.warn(`Edge browser-check challenge detected: ${selector}`);
        return {
          detected: true,
          type: 'browser_check',
          selector,
          providerHint: 'edge_service',
          confidence: 97,
        };
      }
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkPageText(page: Page): Promise<CaptchaDetectionResult> {
    const bodyText = await page.evaluate(() => document.body.innerText);

    for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.text) {
      if (bodyText.includes(excludeKeyword)) {
        logger.debug(`Body text matched exclusion keyword: ${excludeKeyword}`);
        return {
          detected: false,
          type: 'none',
          confidence: 0,
          falsePositiveReason: `Text exclusion: ${excludeKeyword}`,
        };
      }
    }

    for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.text) {
      if (bodyText.includes(keyword)) {
        const domCheck = await this.verifyByDOM(page);
        if (!domCheck) {
          logger.debug(`Keyword is common element, skipping: ${keyword}`);
          return {
            detected: false,
            type: 'none',
            confidence: 0,
            falsePositiveReason: `DOM: ${keyword}`,
          };
        }

        logger.warn(`CAPTCHA keyword detected: ${keyword}`);
        return {
          detected: true,
          type: 'unknown',
          confidence: 75,
          details: { keyword },
        };
      }
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkVendorSpecific(page: Page): Promise<CaptchaDetectionResult> {
    const geetestCheck = await page.evaluate(() => {
      const win = window as unknown as { initGeetest?: unknown };
      return !!win.initGeetest || document.querySelector('.geetest_holder');
    });

    if (geetestCheck) {
      logger.warn('Regional slider CAPTCHA indicators detected');
      return {
        detected: true,
        type: 'slider',
        providerHint: 'regional_service',
        confidence: 95,
      };
    }

    const tencentCheck = await page.evaluate(() => {
      const win = window as unknown as { TencentCaptcha?: unknown };
      return !!win.TencentCaptcha || document.querySelector('.tcaptcha-transform');
    });

    if (tencentCheck) {
      logger.warn('Regional slider CAPTCHA indicators detected');
      return {
        detected: true,
        type: 'slider',
        providerHint: 'regional_service',
        confidence: 95,
      };
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  async waitForCompletion(page: Page, timeout: number = 300000): Promise<boolean> {
    logger.info('Waiting for CAPTCHA to be solved...');

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.detect(page);

      if (!result.detected) {
        logger.info('CAPTCHA no longer detected; continuing workflow');
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    logger.error('Timed out while waiting for CAPTCHA completion');
    return false;
  }

  private async verifyByDOM(page: Page): Promise<boolean> {
    try {
      const hasSlider = await page.evaluate(() => {
        const sliderSelectors = [
          '.captcha-slider',
          '.geetest_slider',
          '.tcaptcha-transform',
          '#nc_1_wrapper',
          '.slide-verify',
        ];
        return sliderSelectors.some((sel) => document.querySelector(sel) !== null);
      });

      const hasRecaptcha = await page.evaluate(() => {
        return (
          !!document.querySelector('iframe[src*="recaptcha"]') ||
          !!document.querySelector('.g-recaptcha')
        );
      });

      const hasHcaptcha = await page.evaluate(() => {
        return (
          !!document.querySelector('iframe[src*="hcaptcha"]') ||
          !!document.querySelector('.h-captcha')
        );
      });

      const hasCloudflare = await page.evaluate(() => {
        return (
          !!document.querySelector('#challenge-form') || !!document.querySelector('.cf-challenge')
        );
      });

      return hasSlider || hasRecaptcha || hasHcaptcha || hasCloudflare;
    } catch (error) {
      logger.error('DOM verification failed during CAPTCHA detection', error);
      return false;
    }
  }

  private async verifySliderElement(page: Page, selector: string): Promise<boolean> {
    try {
      const excludeSelectors = CaptchaDetector.EXCLUDE_SELECTORS;

      const result = await page.evaluate(
        (sel, excludeSels) => {
          const element = document.querySelector(sel);
          if (!element) return false;

          for (const excludeSel of excludeSels) {
            if (element.matches(excludeSel)) {
              console.warn(`[CaptchaDetector] Excluded selector match: ${excludeSel}`);
              return false;
            }
            if (element.closest(excludeSel)) {
              console.warn(`[CaptchaDetector] Excluded selector ancestor: ${excludeSel}`);
              return false;
            }
          }

          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;

          const className = element.className.toLowerCase();
          const id = element.id.toLowerCase();
          const excludeKeywords = [
            'video',
            'player',
            'swiper',
            'carousel',
            'banner',
            'gallery',
            'douyin',
            'tiktok',
            'scroll',
            'progress',
            'range',
            'volume',
            'seek',
            'timeline',
          ];

          for (const keyword of excludeKeywords) {
            if (className.includes(keyword) || id.includes(keyword)) {
              console.warn(`[CaptchaDetector] Excluded class/id keyword: ${keyword}`);
              return false;
            }
          }

          const hasCaptchaKeyword =
            className.includes('captcha') ||
            className.includes('verify') ||
            className.includes('challenge') ||
            id.includes('captcha') ||
            id.includes('verify') ||
            id.includes('challenge');

          const style = window.getComputedStyle(element);
          const hasDraggableStyle =
            style.cursor === 'move' || style.cursor === 'grab' || style.cursor === 'grabbing';

          const hasSliderClass = className.includes('slider') || className.includes('slide');

          const hasDragAttribute =
            element.hasAttribute('draggable') ||
            element.hasAttribute('data-slide') ||
            element.hasAttribute('data-captcha') ||
            element.hasAttribute('data-verify');

          let parent = element.parentElement;
          let hasParentCaptcha = false;
          for (let i = 0; i < 3 && parent; i++) {
            const parentClass = parent.className.toLowerCase();
            const parentId = parent.id.toLowerCase();

            if (
              parentClass.includes('captcha') ||
              parentClass.includes('verify') ||
              parentClass.includes('challenge') ||
              parentId.includes('captcha') ||
              parentId.includes('verify')
            ) {
              hasParentCaptcha = true;
              break;
            }
            parent = parent.parentElement;
          }

          const width = rect.width;
          const height = rect.height;
          const hasReasonableSize = width >= 30 && width <= 500 && height >= 30 && height <= 200;

          if (!hasReasonableSize) {
            console.warn(`[CaptchaDetector] Rejected by size heuristic: ${width}x${height}`);
            return false;
          }

          const conditionA = hasCaptchaKeyword && (hasSliderClass || hasDraggableStyle);

          const conditionB = hasParentCaptcha && hasSliderClass && hasDragAttribute;

          const isVendorSpecific =
            className.includes('geetest') ||
            className.includes('nc_') ||
            className.includes('tcaptcha') ||
            className.includes('yidun') ||
            id.includes('nc_1_wrapper');

          const isValid = conditionA || conditionB || isVendorSpecific;

          if (!isValid) {
            console.warn(
              `[CaptchaDetector] Slider verification rejected - captcha:${hasCaptchaKeyword}, slider:${hasSliderClass}, parent:${hasParentCaptcha}`
            );
          }

          return isValid;
        },
        selector,
        excludeSelectors
      );

      return result;
    } catch (error) {
      logger.error('Slider element verification failed', error);
      return false;
    }
  }
}

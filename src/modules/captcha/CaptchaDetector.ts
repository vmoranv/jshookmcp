import { Page } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';

export interface CaptchaDetectionResult {
  detected: boolean;
  type?:
    | 'slider'
    | 'image'
    | 'recaptcha'
    | 'hcaptcha'
    | 'cloudflare'
    | 'page_redirect'
    | 'url_redirect'
    | 'unknown';
  selector?: string;
  title?: string;
  url?: string;
  confidence: number;
  vendor?:
    | 'geetest'
    | 'tencent'
    | 'aliyun'
    | 'cloudflare'
    | 'akamai'
    | 'datadome'
    | 'perimeter-x'
    | 'recaptcha'
    | 'hcaptcha'
    | 'unknown';
  details?: any;
  falsePositiveReason?: string;
}

export class CaptchaDetector {
  private static readonly EXCLUDE_SELECTORS = [
    '[class*="video"]',
    '[class*="player"]',
    '[id*="video"]',
    '[id*="player"]',
    '[class*="swiper"]',
    '[class*="carousel"]',
    '[class*="banner"]',
    '[class*="gallery"]',
    '[class*="douyin"]',
    '[class*="tiktok"]',
    '[class*="scroll"]',
    '[class*="scrollbar"]',
    '[class*="progress"]',
    '[class*="range"]',
    '[class*="volume"]',
  ];

  private static readonly CAPTCHA_SELECTORS = {
    slider: [
      '.captcha-slider',
      '.verify-slider',
      '#captcha-slider',
      '.slide-verify',
      '#nc_1_wrapper',
      '.nc-container',
      '.geetest_slider',
      '.geetest_holder',
      '.tcaptcha-transform',
      '.JDJRV-slide-inner',
      '.yidun_slider',
      '[class*="captcha"][class*="slider"]',
      '[class*="verify"][class*="slider"]',
      '[id*="captcha"][id*="slider"]',
      '[id*="verify"][id*="slider"]',
    ],

    image: [
      '[class*="captcha-image"]',
      '[id*="captcha-image"]',
      '.verify-img',
      '.captcha-img',
      'img[src*="captcha"]',
      'img[alt*=""]',
      'img[alt*="captcha"]',
    ],

    recaptcha: [
      'iframe[src*="recaptcha"]',
      '.g-recaptcha',
      '#g-recaptcha',
      '[class*="recaptcha"]',
      'iframe[title*="reCAPTCHA"]',
    ],

    hcaptcha: [
      'iframe[src*="hcaptcha"]',
      '.h-captcha',
      '#h-captcha',
      '[class*="hcaptcha"]',
      'iframe[title*="hCaptcha"]',
    ],

    cloudflare: [
      '#challenge-form',
      '.cf-challenge',
      '[id*="cf-challenge"]',
      'iframe[src*="challenges.cloudflare.com"]',
      '#cf-wrapper',
      '.ray-id',
    ],

    generic: [
      '[class*="captcha"]',
      '[id*="captcha"]',
      '[class*="verify"]',
      '[id*="verify"]',
      '[class*="challenge"]',
      '[id*="challenge"]',
      'iframe[src*="captcha"]',
      'iframe[src*="verify"]',
    ],
  };

  private static readonly CAPTCHA_KEYWORDS = {
    title: [
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'captcha',
      'challenge',
      'verify',
      'verification',
      'robot',
      'human',
      'security check',
      'bot check',
      'anti-bot',
      'cloudflare',
      'geetest',
      'recaptcha',
      'hcaptcha',
      'turnstile',
    ],
    url: [
      'captcha',
      'challenge',
      'verify',
      'verification',
      'robot-check',
      'security-check',
      'bot-check',
      'cdn-cgi/challenge',
      'cloudflare',
      'akamai',
      'geetest',
      'recaptcha',
      'hcaptcha',
      'turnstile',
      'datadome',
      'perimeter',
      'px-captcha',
    ],
    text: [
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Please verify',
      'Verify you are human',
      'Complete the security check',
      'Slide to verify',
      'Click to verify',
      'Drag the slider',
      'Prove you are human',
      'I am not a robot',
      'Checking your browser',
      'Just a moment',
      'Checking if the site connection is secure',
      'This process is automatic',
      'Protected by',
      'Powered by',
    ],
  };

  private static readonly EXCLUDE_KEYWORDS = {
    title: ['', '', '', '', '', '', '', 'verification code', 'enter code', 'sms code'],
    url: [
      'verify-email',
      'verify-phone',
      'email-verification',
      'account-verification',
      'verify-account',
    ],
    text: ['', '', '', '', '', 'Enter verification code', 'Get code', 'Send code'],
  };

  async detect(page: Page): Promise<CaptchaDetectionResult> {
    try {
      logger.info(' ...');

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

      logger.info(' ');
      return { detected: false, confidence: 0 };
    } catch (error) {
      logger.error('', error);
      return { detected: false, confidence: 0 };
    }
  }

  private async checkUrl(page: Page): Promise<CaptchaDetectionResult> {
    const url = page.url();
    const lowerUrl = url.toLowerCase();

    for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.url) {
      if (lowerUrl.includes(excludeKeyword)) {
        logger.debug(` URL,: ${excludeKeyword}`);
        return { detected: false, confidence: 0, falsePositiveReason: `: ${excludeKeyword}` };
      }
    }

    for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.url) {
      if (lowerUrl.includes(keyword)) {
        let type: CaptchaDetectionResult['type'] = 'url_redirect';
        let vendor: CaptchaDetectionResult['vendor'] = 'unknown';
        let confidence = 70;

        if (url.includes('cloudflare') || url.includes('cdn-cgi')) {
          type = 'cloudflare';
          vendor = 'cloudflare';
          confidence = 95;
        } else if (url.includes('recaptcha')) {
          type = 'recaptcha';
          vendor = 'recaptcha';
          confidence = 95;
        } else if (url.includes('hcaptcha')) {
          type = 'hcaptcha';
          vendor = 'hcaptcha';
          confidence = 95;
        } else if (url.includes('geetest')) {
          type = 'slider';
          vendor = 'geetest';
          confidence = 90;
        }

        if (confidence < 80) {
          const domCheck = await this.verifyByDOM(page);
          if (!domCheck) {
            logger.debug(`URL keyword match in DOM, skipping: ${keyword}`);
            return { detected: false, confidence: 0, falsePositiveReason: `URLDOM: ${keyword}` };
          }
          confidence = 85;
        }

        logger.warn(`CAPTCHA URL keyword detected: ${keyword} (confidence: ${confidence}%)`);
        return {
          detected: true,
          type,
          url,
          vendor,
          confidence,
        };
      }
    }

    return { detected: false, confidence: 0 };
  }

  private async checkTitle(page: Page): Promise<CaptchaDetectionResult> {
    const title = await page.title();
    const lowerTitle = title.toLowerCase();

    for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.title) {
      if (lowerTitle.includes(excludeKeyword.toLowerCase())) {
        logger.debug(` ,: ${excludeKeyword}`);
        return { detected: false, confidence: 0, falsePositiveReason: `: ${excludeKeyword}` };
      }
    }

    for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.title) {
      if (lowerTitle.includes(keyword)) {
        const domCheck = await this.verifyByDOM(page);
        if (!domCheck) {
          logger.debug(`DOM keyword is common UI element, skipping: ${keyword}`);
          return { detected: false, confidence: 0, falsePositiveReason: `DOM: ${keyword}` };
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

    return { detected: false, confidence: 0 };
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

          logger.warn(`CAPTCHA selector detected: ${selector}`);

          let vendor: CaptchaDetectionResult['vendor'] = 'unknown';
          if (selector.includes('geetest')) vendor = 'geetest';
          else if (selector.includes('nc_') || selector.includes('aliyun')) vendor = 'aliyun';
          else if (selector.includes('tcaptcha') || selector.includes('tencent'))
            vendor = 'tencent';

          return {
            detected: true,
            type: 'slider',
            selector,
            vendor,
            confidence: 95,
          };
        }
      }
    }

    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.recaptcha) {
      const element = await page.$(selector);
      if (element) {
        logger.warn(`reCAPTCHA element detected: ${selector}`);
        return {
          detected: true,
          type: 'recaptcha',
          selector,
          vendor: 'recaptcha',
          confidence: 98,
        };
      }
    }

    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.hcaptcha) {
      const element = await page.$(selector);
      if (element) {
        logger.warn(`hCaptcha element detected: ${selector}`);
        return {
          detected: true,
          type: 'hcaptcha',
          selector,
          vendor: 'hcaptcha',
          confidence: 98,
        };
      }
    }

    for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.cloudflare) {
      const element = await page.$(selector);
      if (element) {
        logger.warn(`Cloudflare challenge detected: ${selector}`);
        return {
          detected: true,
          type: 'cloudflare',
          selector,
          vendor: 'cloudflare',
          confidence: 97,
        };
      }
    }

    return { detected: false, confidence: 0 };
  }

  private async checkPageText(page: Page): Promise<CaptchaDetectionResult> {
    const bodyText = await page.evaluate(() => document.body.innerText);

    for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.text) {
      if (bodyText.includes(excludeKeyword)) {
        logger.debug(` ,: ${excludeKeyword}`);
        return { detected: false, confidence: 0, falsePositiveReason: `: ${excludeKeyword}` };
      }
    }

    for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.text) {
      if (bodyText.includes(keyword)) {
        const domCheck = await this.verifyByDOM(page);
        if (!domCheck) {
          logger.debug(`Keyword is common element, skipping: ${keyword}`);
          return { detected: false, confidence: 0, falsePositiveReason: `DOM: ${keyword}` };
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

    return { detected: false, confidence: 0 };
  }

  private async checkVendorSpecific(page: Page): Promise<CaptchaDetectionResult> {
    const geetestCheck = await page.evaluate(() => {
      return !!(window as any).initGeetest || document.querySelector('.geetest_holder');
    });

    if (geetestCheck) {
      logger.warn('Image CAPTCHA check timed out');
      return {
        detected: true,
        type: 'slider',
        vendor: 'geetest',
        confidence: 95,
      };
    }

    const tencentCheck = await page.evaluate(() => {
      return !!(window as any).TencentCaptcha || document.querySelector('.tcaptcha-transform');
    });

    if (tencentCheck) {
      logger.warn('CAPTCHA detection timed out');
      return {
        detected: true,
        type: 'slider',
        vendor: 'tencent',
        confidence: 95,
      };
    }

    return { detected: false, confidence: 0 };
  }

  async waitForCompletion(page: Page, timeout: number = 300000): Promise<boolean> {
    logger.info('Waiting for CAPTCHA to be solved...');

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.detect(page);

      if (!result.detected) {
        logger.info(' ');
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    logger.error(' ');
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
      logger.error('DOM', error);
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
              console.warn(`[CaptchaDetector] : ${excludeSel}`);
              return false;
            }
            if (element.closest(excludeSel)) {
              console.warn(`[CaptchaDetector] : ${excludeSel}`);
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
              console.warn(`[CaptchaDetector] /ID: ${keyword}`);
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
            console.warn(`[CaptchaDetector] : ${width}x${height}`);
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
              `[CaptchaDetector]  - captcha:${hasCaptchaKeyword}, slider:${hasSliderClass}, parent:${hasParentCaptcha}`
            );
          }

          return isValid;
        },
        selector,
        excludeSelectors
      );

      return result;
    } catch (error) {
      logger.error('', error);
      return false;
    }
  }
}

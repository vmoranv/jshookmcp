import { type Page } from 'rebrowser-puppeteer-core';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '@utils/logger';
import {
  FALLBACK_CAPTCHA_KEYWORDS,
  FALLBACK_EXCLUDE_KEYWORDS,
} from '@modules/captcha/CaptchaDetector.constants';
import {
  CAPTCHA_PROVIDER_HINTS,
  CAPTCHA_TYPES,
  LEGACY_CAPTCHA_PROVIDER_HINT_ALIASES,
  LEGACY_CAPTCHA_TYPE_ALIASES,
} from '@modules/captcha/types';
import type {
  AICaptchaDetectionResult,
  CaptchaProviderHint,
  CaptchaType,
  CaptchaPageInfo,
} from '@modules/captcha/types';

// Re-export for backward compatibility
export type { AICaptchaDetectionResult } from '@modules/captcha/types';

const OVERRIDE_CAPTCHA_KEYWORDS = FALLBACK_CAPTCHA_KEYWORDS;

const OVERRIDE_ELEMENT_SIGNALS = [
  'captcha',
  'challenge',
  'slider',
  'widget',
  'checkbox',
  'sitekey',
  'browser-check',
  'security-check',
] as const;

export class AICaptchaDetector {
  protected screenshotDir: string;

  constructor(screenshotDir: string = './screenshots') {
    this.screenshotDir = screenshotDir;
  }

  protected async saveScreenshot(screenshotBase64: string): Promise<string> {
    try {
      await mkdir(this.screenshotDir, { recursive: true });

      const timestamp = Date.now();
      const filename = `captcha-${timestamp}.png`;
      const filepath = join(this.screenshotDir, filename);

      const buffer = Buffer.from(screenshotBase64, 'base64');
      await writeFile(filepath, buffer);

      logger.info(`Screenshot saved: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error('Failed to persist CAPTCHA screenshot', error);
      throw error;
    }
  }

  async detect(page: Page): Promise<AICaptchaDetectionResult> {
    try {
      logger.info('Running rule-based captcha detection...');

      const pageInfo = await this.getPageInfo(page);
      const result = this.applyLocalGuardrails(
        pageInfo,
        this.evaluateFallbackTextAnalysis(pageInfo),
      );

      logger.info(
        `CAPTCHA detection result: ${result.detected ? 'detected' : 'not_detected'} (confidence: ${result.confidence}%)`,
      );

      return result;
    } catch (error) {
      logger.error('CAPTCHA detection failed', error);
      return {
        detected: false,
        type: 'none',
        confidence: 0,
        reasoning: `Detection error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  protected async getPageInfo(page: Page): Promise<CaptchaPageInfo> {
    const url = page.url();
    const title = await page.title();

    const info = await page.evaluate(() => {
      const bodyText = document.body.innerText.substring(0, 1000);

      const hasIframes = document.querySelectorAll('iframe').length > 0;

      const suspiciousElements: string[] = [];

      const captchaSelectors = [
        '[class*="captcha"]',
        '[id*="captcha"]',
        '[class*="verify"]',
        '[id*="verify"]',
        '[class*="challenge"]',
        'iframe[src*="captcha" i]',
        'iframe[src*="challenge" i]',
        '[data-sitekey]',
        '[class*="browser-check"]',
      ];

      for (const selector of captchaSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          suspiciousElements.push(`${selector} (${elements.length})`);
        }
      }

      return {
        bodyText,
        hasIframes,
        suspiciousElements,
      };
    });

    return {
      url,
      title,
      ...info,
    };
  }

  protected normalizeCaptchaType(type: unknown, detected: boolean): CaptchaType {
    if (!detected) {
      return 'none';
    }

    if (typeof type === 'string') {
      if (CAPTCHA_TYPES.includes(type as (typeof CAPTCHA_TYPES)[number])) {
        return type as CaptchaType;
      }

      const alias = LEGACY_CAPTCHA_TYPE_ALIASES[type.toLowerCase()];
      if (alias) {
        return alias;
      }
    }

    return 'unknown';
  }

  protected normalizeProviderHint(
    providerHint: unknown,
    detected: boolean,
  ): CaptchaProviderHint | undefined {
    if (typeof providerHint === 'string') {
      if (
        CAPTCHA_PROVIDER_HINTS.includes(providerHint as (typeof CAPTCHA_PROVIDER_HINTS)[number])
      ) {
        return providerHint as CaptchaProviderHint;
      }

      const alias = LEGACY_CAPTCHA_PROVIDER_HINT_ALIASES[providerHint.toLowerCase()];
      if (alias) {
        return alias;
      }
    }

    return detected ? 'unknown' : undefined;
  }

  protected normalizeDetected(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }

    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }

    return false;
  }

  protected normalizeConfidence(confidence: unknown): number {
    const normalized = Number(confidence);

    if (!Number.isFinite(normalized)) {
      return 0;
    }

    return Math.max(0, Math.min(100, normalized));
  }

  protected applyLocalGuardrails(
    pageInfo: CaptchaPageInfo,
    aiResult: AICaptchaDetectionResult,
  ): AICaptchaDetectionResult {
    if (aiResult.detected) {
      return aiResult;
    }

    if (!this.hasStrongOverrideSignals(pageInfo)) {
      return aiResult;
    }

    return {
      ...this.evaluateFallbackTextAnalysis(pageInfo),
      reasoning:
        'AI reported no CAPTCHA, but local heuristics found strong CAPTCHA signals in the page context. / AI 判定为无验证码，但本地启发式在页面上下文中发现强信号。',
      screenshotPath: aiResult.screenshotPath,
    };
  }

  protected hasStrongCaptchaElementSignals(elements: string[]): boolean {
    return elements.some((element) => {
      const lowerElement = element.toLowerCase();
      return OVERRIDE_ELEMENT_SIGNALS.some((signal) => lowerElement.includes(signal));
    });
  }

  protected hasStrongOverrideSignals(pageInfo: CaptchaPageInfo): boolean {
    const searchableText = `${pageInfo.title}\n${pageInfo.bodyText}`.toLowerCase();

    const hasStrongElementSignal = this.hasStrongCaptchaElementSignals(pageInfo.suspiciousElements);

    if (!hasStrongElementSignal) {
      return false;
    }

    return OVERRIDE_CAPTCHA_KEYWORDS.some((keyword) => searchableText.includes(keyword));
  }

  protected evaluateFallbackTextAnalysis(pageInfo: CaptchaPageInfo): AICaptchaDetectionResult {
    const searchableText = `${pageInfo.url}\n${pageInfo.title}\n${pageInfo.bodyText}`.toLowerCase();

    const hasCaptchaElements = this.hasStrongCaptchaElementSignals(pageInfo.suspiciousElements);
    const hasCaptchaKeywords = FALLBACK_CAPTCHA_KEYWORDS.some((keyword) =>
      searchableText.includes(keyword),
    );
    const hasStrongCaptchaSignals = hasCaptchaElements && hasCaptchaKeywords;
    const hasExcludedKeywords = FALLBACK_EXCLUDE_KEYWORDS.some((keyword) =>
      searchableText.includes(keyword),
    );

    if (hasExcludedKeywords && !hasStrongCaptchaSignals) {
      return {
        detected: false,
        type: 'none',
        confidence: 95,
        reasoning:
          'Fallback heuristics matched OTP or account verification text, not a CAPTCHA. / 后备启发式匹配到一次性验证码或账户校验文本，不视为 CAPTCHA。',
        suggestions: ['Continue the login or verification flow normally / 继续正常登录或验证流程'],
      };
    }
    const detected = hasStrongCaptchaSignals;

    return {
      detected,
      type: detected ? 'unknown' : 'none',
      confidence: detected ? (hasExcludedKeywords ? 55 : 60) : 90,
      reasoning: detected
        ? hasExcludedKeywords
          ? 'Fallback heuristics found strong CAPTCHA signals despite OTP-like wording on the page. / 后备启发式发现了强 CAPTCHA 信号，优先于页面上的一次性验证码类文案。'
          : 'Fallback heuristics matched both suspicious elements and CAPTCHA keywords. / 后备启发式匹配到可疑元素和验证码关键词。'
        : 'Fallback heuristics did not find strong CAPTCHA signals. / 后备启发式未找到强验证码信号。',
      suggestions: detected
        ? [
            'Switch to headed mode if needed / 如需要切换到有头模式',
            'Wait for manual completion before continuing / 等待手动完成后继续',
          ]
        : ['Solve the CAPTCHA manually if one is visible / 如有可见验证码请手动解决'],
    };
  }

  async waitForCompletion(page: Page, timeout: number = 300000): Promise<boolean> {
    logger.info('Waiting for CAPTCHA to be solved...');

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.detect(page);

      if (!result.detected || result.confidence < 50) {
        logger.info('CAPTCHA is no longer detected; continuing workflow');
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    logger.error('Timed out while waiting for CAPTCHA completion');
    return false;
  }
}

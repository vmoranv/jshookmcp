import { Page } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import {
  CAPTCHA_MATCH_RULES,
  DOM_MATCH_RULES,
  EXCLUDE_MATCH_RULES,
  EXCLUDE_SELECTORS,
} from '@modules/captcha/CaptchaDetector.constants';
import type {
  CaptchaAssessment,
  CaptchaCandidate,
  CaptchaDetectionResult,
  CaptchaDomRule,
  CaptchaHeuristicRule,
  CaptchaSignal,
  CaptchaSignalSource,
} from '@modules/captcha/types';

// Re-export for backward compatibility
export type { CaptchaDetectionResult } from '@modules/captcha/types';

export class CaptchaDetector {
  private static readonly EXCLUDE_SELECTORS = EXCLUDE_SELECTORS;
  private static readonly CAPTCHA_MATCH_RULES = CAPTCHA_MATCH_RULES;
  private static readonly EXCLUDE_MATCH_RULES = EXCLUDE_MATCH_RULES;
  private static readonly DOM_MATCH_RULES = DOM_MATCH_RULES;

  async assess(page: Page): Promise<CaptchaAssessment> {
    const checks: Array<{
      source: CaptchaSignalSource;
      run: () => Promise<CaptchaDetectionResult>;
    }> = [
      { source: 'url', run: () => this.checkUrl(page) },
      { source: 'title', run: () => this.checkTitle(page) },
      { source: 'dom', run: () => this.checkDOMElements(page) },
      { source: 'text', run: () => this.checkPageText(page) },
      { source: 'vendor', run: () => this.checkVendorSpecific(page) },
    ];

    const signals: CaptchaSignal[] = [];
    const candidates: CaptchaCandidate[] = [];
    let primaryDetection: CaptchaDetectionResult = {
      detected: false,
      type: 'none',
      confidence: 0,
    };

    for (const check of checks) {
      try {
        const result = await check.run();
        const signal = this.toAssessmentSignal(check.source, result);
        if (signal) {
          signals.push(signal);
        }

        const candidate = this.toAssessmentCandidate(check.source, result);
        if (candidate) {
          candidates.push(candidate);
        }

        if (result.detected && result.confidence >= primaryDetection.confidence) {
          primaryDetection = result;
        }
      } catch (error) {
        logger.warn(`CAPTCHA assessment check failed for source: ${check.source}`, error);
      }
    }

    const score = signals
      .filter((signal) => signal.kind === 'captcha')
      .reduce((sum, signal) => sum + signal.confidence, 0);
    const excludeScore = signals
      .filter((signal) => signal.kind === 'exclude')
      .reduce((sum, signal) => sum + signal.confidence, 0);

    const confidence = primaryDetection.detected ? primaryDetection.confidence : 0;
    const likelyCaptcha = candidates.length > 0 && (confidence >= 90 || score - excludeScore >= 70);

    const recommendedNextStep = this.getRecommendedNextStep({
      score,
      excludeScore,
      confidence,
      candidateCount: candidates.length,
      likelyCaptcha,
    });

    return {
      signals,
      candidates,
      score,
      excludeScore,
      confidence,
      likelyCaptcha,
      recommendedNextStep,
      primaryDetection: likelyCaptcha
        ? primaryDetection
        : {
            detected: false,
            type: 'none',
            confidence: 0,
            details:
              candidates.length > 0
                ? {
                    candidates,
                    reason: 'Signals were ambiguous and require higher-level policy or AI review.',
                  }
                : undefined,
          },
    };
  }

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

  private toAssessmentSignal(
    source: CaptchaSignalSource,
    result: CaptchaDetectionResult
  ): CaptchaSignal | null {
    if (result.detected) {
      return {
        source,
        kind: 'captcha',
        value: this.getSignalValue(source, result),
        confidence: result.confidence,
        typeHint: result.type,
        providerHint: result.providerHint,
        details: result.details,
      };
    }

    if (result.falsePositiveReason) {
      return {
        source,
        kind: 'exclude',
        value: result.falsePositiveReason,
        confidence: result.confidence,
      };
    }

    return null;
  }

  private toAssessmentCandidate(
    source: CaptchaSignalSource,
    result: CaptchaDetectionResult
  ): CaptchaCandidate | null {
    if (!result.detected || result.type === 'none') {
      return null;
    }

    return {
      source,
      value: this.getSignalValue(source, result),
      confidence: result.confidence,
      type: result.type,
      providerHint: result.providerHint,
    };
  }

  private getSignalValue(source: CaptchaSignalSource, result: CaptchaDetectionResult): string {
    switch (source) {
      case 'url':
        return result.url ?? 'url-match';
      case 'title':
        return result.title ?? 'title-match';
      case 'dom':
        return result.selector ?? result.type;
      case 'text':
        return typeof result.details === 'object' && result.details && 'keyword' in result.details
          ? String((result.details as Record<string, unknown>).keyword)
          : result.type;
      case 'vendor':
      default:
        return result.providerHint ?? result.type;
    }
  }

  private matchRule(
    value: string,
    rules: readonly CaptchaHeuristicRule[]
  ): { rule: CaptchaHeuristicRule; matchText: string } | null {
    for (const rule of rules) {
      const match = value.match(rule.pattern);
      if (match?.[0]) {
        return { rule, matchText: match[0] };
      }
    }
    return null;
  }

  private async confirmRuleWithDOM(page: Page, rule: CaptchaHeuristicRule): Promise<boolean> {
    if (!rule.requiresDomConfirmation) {
      return true;
    }

    return this.verifyByDOM(page);
  }

  private buildExcludeResult(
    sourceLabel: string,
    rule: CaptchaHeuristicRule,
    matchText: string
  ): CaptchaDetectionResult {
    logger.debug(`${sourceLabel} matched exclusion rule: ${rule.id}`);
    return {
      detected: false,
      type: 'none',
      confidence: rule.confidence,
      falsePositiveReason: `${sourceLabel} exclusion: ${matchText}`,
    };
  }

  private buildCaptchaResult(payload: {
    confidence: number;
    type: CaptchaDetectionResult['type'];
    providerHint?: CaptchaDetectionResult['providerHint'];
    url?: string;
    title?: string;
    selector?: string;
    details?: unknown;
  }): CaptchaDetectionResult {
    return {
      detected: true,
      confidence: payload.confidence,
      type: payload.type,
      providerHint: payload.providerHint,
      url: payload.url,
      title: payload.title,
      selector: payload.selector,
      details: payload.details,
    };
  }

  private async evaluateDomRule(
    page: Page,
    rule: CaptchaDomRule
  ): Promise<{ selector: string; rule: CaptchaDomRule } | null> {
    for (const selector of rule.selectors) {
      const element = await page.$(selector);
      if (!element) {
        continue;
      }

      if (rule.requiresVisibility) {
        const isVisible = await element.isIntersectingViewport();
        if (!isVisible) {
          continue;
        }
      }

      if (rule.verifier === 'slider') {
        const isRealSlider = await this.verifySliderElement(page, selector);
        if (!isRealSlider) {
          logger.debug(
            `DOM rule ${rule.id} rejected selector after slider verification: ${selector}`
          );
          continue;
        }
      }

      return { selector, rule };
    }

    return null;
  }

  private getRecommendedNextStep(input: {
    score: number;
    excludeScore: number;
    confidence: number;
    candidateCount: number;
    likelyCaptcha: boolean;
  }): CaptchaAssessment['recommendedNextStep'] {
    if (input.candidateCount === 0) {
      return 'ignore';
    }

    if (!input.likelyCaptcha) {
      return 'ask_ai';
    }

    if (
      input.confidence >= 95 ||
      input.candidateCount >= 2 ||
      input.score - input.excludeScore >= 120
    ) {
      return 'manual';
    }

    if (input.excludeScore > 0) {
      return 'ask_ai';
    }

    return 'observe';
  }

  private async checkUrl(page: Page): Promise<CaptchaDetectionResult> {
    const url = page.url();
    const excludeRule = this.matchRule(url, CaptchaDetector.EXCLUDE_MATCH_RULES.url);
    if (excludeRule) {
      return this.buildExcludeResult('URL', excludeRule.rule, excludeRule.matchText);
    }

    const matchRule = this.matchRule(url, CaptchaDetector.CAPTCHA_MATCH_RULES.url);
    if (matchRule) {
      const domConfirmed = await this.confirmRuleWithDOM(page, matchRule.rule);
      if (!domConfirmed) {
        logger.debug(`URL rule required DOM confirmation but none was found: ${matchRule.rule.id}`);
        return {
          detected: false,
          type: 'none',
          confidence: matchRule.rule.confidence,
          falsePositiveReason: `URLDOM exclusion: ${matchRule.matchText}`,
        };
      }

      logger.warn(`CAPTCHA URL signal detected (confidence: ${matchRule.rule.confidence}%)`);
      return this.buildCaptchaResult({
        confidence: matchRule.rule.confidence,
        type: matchRule.rule.typeHint ?? 'url_redirect',
        providerHint: matchRule.rule.providerHint,
        url,
        details: {
          ruleId: matchRule.rule.id,
          ruleLabel: matchRule.rule.label,
          matchText: matchRule.matchText,
        },
      });
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkTitle(page: Page): Promise<CaptchaDetectionResult> {
    const title = await page.title();
    const excludeRule = this.matchRule(title, CaptchaDetector.EXCLUDE_MATCH_RULES.title);
    if (excludeRule) {
      return this.buildExcludeResult('Title', excludeRule.rule, excludeRule.matchText);
    }

    const matchRule = this.matchRule(title, CaptchaDetector.CAPTCHA_MATCH_RULES.title);
    if (matchRule) {
      const domConfirmed = await this.confirmRuleWithDOM(page, matchRule.rule);
      if (!domConfirmed) {
        logger.debug(
          `Title rule required DOM confirmation but none was found: ${matchRule.rule.id}`
        );
        return {
          detected: false,
          type: 'none',
          confidence: matchRule.rule.confidence,
          falsePositiveReason: `TitleDOM exclusion: ${matchRule.matchText}`,
        };
      }

      logger.warn(`CAPTCHA title rule detected: ${matchRule.rule.label}`);
      return this.buildCaptchaResult({
        confidence: matchRule.rule.confidence,
        type: matchRule.rule.typeHint ?? 'page_redirect',
        providerHint: matchRule.rule.providerHint,
        title,
        details: {
          ruleId: matchRule.rule.id,
          ruleLabel: matchRule.rule.label,
          matchText: matchRule.matchText,
        },
      });
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkDOMElements(page: Page): Promise<CaptchaDetectionResult> {
    for (const rule of CaptchaDetector.DOM_MATCH_RULES) {
      const matched = await this.evaluateDomRule(page, rule);
      if (matched) {
        logger.warn(`CAPTCHA DOM rule detected: ${rule.label} (${matched.selector})`);
        return this.buildCaptchaResult({
          confidence: rule.confidence,
          type: rule.typeHint,
          providerHint: rule.providerHint,
          selector: matched.selector,
          details: {
            ruleId: rule.id,
            ruleLabel: rule.label,
          },
        });
      }
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkPageText(page: Page): Promise<CaptchaDetectionResult> {
    const bodyText = await page.evaluate(() => document.body.innerText);
    const excludeRule = this.matchRule(bodyText, CaptchaDetector.EXCLUDE_MATCH_RULES.text);
    if (excludeRule) {
      return this.buildExcludeResult('Text', excludeRule.rule, excludeRule.matchText);
    }

    const matchRule = this.matchRule(bodyText, CaptchaDetector.CAPTCHA_MATCH_RULES.text);
    if (matchRule) {
      const domConfirmed = await this.confirmRuleWithDOM(page, matchRule.rule);
      if (!domConfirmed) {
        logger.debug(
          `Text rule required DOM confirmation but none was found: ${matchRule.rule.id}`
        );
        return {
          detected: false,
          type: 'none',
          confidence: matchRule.rule.confidence,
          falsePositiveReason: `TextDOM exclusion: ${matchRule.matchText}`,
        };
      }

      logger.warn(`CAPTCHA text rule detected: ${matchRule.rule.label}`);
      return this.buildCaptchaResult({
        confidence: matchRule.rule.confidence,
        type: matchRule.rule.typeHint ?? 'unknown',
        providerHint: matchRule.rule.providerHint,
        details: {
          keyword: matchRule.rule.label,
          ruleId: matchRule.rule.id,
          matchText: matchRule.matchText,
        },
      });
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  private async checkVendorSpecific(_page: Page): Promise<CaptchaDetectionResult> {
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
          '.slide-verify',
          '[class*="captcha"][class*="slider"]',
          '[class*="verify"][class*="slider"]',
        ];
        return sliderSelectors.some((sel) => document.querySelector(sel) !== null);
      });

      const hasWidget = await page.evaluate(() => {
        return (
          !!document.querySelector('iframe[src*="captcha" i]') ||
          !!document.querySelector('iframe[src*="challenge" i]') ||
          !!document.querySelector('[data-sitekey]')
        );
      });

      const hasBrowserCheck = await page.evaluate(() => {
        return (
          !!document.querySelector('#challenge-form') ||
          !!document.querySelector('[class*="browser-check"]') ||
          !!document.querySelector('[class*="security-check"]')
        );
      });

      return hasSlider || hasWidget || hasBrowserCheck;
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

          const isValid = conditionA || conditionB;

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

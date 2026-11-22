import { type Page } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import { getGlobalInstrumentation, SpanNames } from '@utils/instrumentation';
import {
  CAPTCHA_MATCH_RULES,
  DOM_MATCH_RULES,
  EXCLUDE_MATCH_RULES,
  EXCLUDE_SELECTORS,
} from '@modules/captcha/CaptchaDetector.constants';
import { CAPTCHA_SELECTORS } from '@modules/captcha/rules/selectors';
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

/**
 * Assessment thresholds shared by the confidence/score heuristics and the
 * in-page slider verification script.
 */
const CAPTCHA_THRESHOLDS = {
  /** Confidence required to call an assessment likelyCaptcha. */
  likelyCaptchaConfidence: 90,
  /** Score margin (captcha minus exclude signals) for likelyCaptcha. */
  likelyCaptchaScoreMargin: 70,
  /** Confidence required to recommend a manual solve. */
  manualConfidence: 95,
  /** Candidate count required to recommend a manual solve. */
  manualCandidateCount: 2,
  /** Score margin required to recommend a manual solve. */
  manualScoreMargin: 120,
  /** Slider element size bounds (min/max width and height, px). */
  sliderMinWidth: 30,
  sliderMaxWidth: 500,
  sliderMinHeight: 30,
  sliderMaxHeight: 200,
  /** How many ancestors are inspected for a captcha class/id. */
  maxParentDepth: 3,
  /** Default wait budget before declaring the CAPTCHA unsolved (ms). */
  defaultWaitTimeoutMs: 300000,
  /** Poll interval while waiting for the CAPTCHA to clear (ms). */
  waitPollIntervalMs: 2000,
} as const;

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
    const likelyCaptcha =
      candidates.length > 0 &&
      (confidence >= CAPTCHA_THRESHOLDS.likelyCaptchaConfidence ||
        score - excludeScore >= CAPTCHA_THRESHOLDS.likelyCaptchaScoreMargin);

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

  /**
   * `captcha.detect` span wrapper.
   *
   * Owned here rather than inline in the body: detection runs through a chain of
   * early-returning checks (url, title, DOM, text, vendor) plus a catch, and one
   * `finally` is the only way to guarantee exactly one `end` across all of them.
   *
   * The span name is `captcha.detect`, NOT `captcha.solve` — nothing in this
   * repo solves a CAPTCHA; the policy layer recommends a manual solve and the AI
   * path waits for a human. The old name promised a capability that never
   * existed.
   */
  async detect(page: Page): Promise<CaptchaDetectionResult> {
    const instrumentation = getGlobalInstrumentation();
    const span = instrumentation.startSpan(SpanNames.captchaDetect);
    let outcome: CaptchaDetectionResult | undefined;
    try {
      outcome = await this.detectInner(page);
      return outcome;
    } finally {
      span.end({ detected: outcome?.detected ?? false, type: outcome?.type ?? 'none' });
    }
  }

  private async detectInner(page: Page): Promise<CaptchaDetectionResult> {
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

  protected toAssessmentSignal(
    source: CaptchaSignalSource,
    result: CaptchaDetectionResult,
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

  protected toAssessmentCandidate(
    source: CaptchaSignalSource,
    result: CaptchaDetectionResult,
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

  protected getSignalValue(source: CaptchaSignalSource, result: CaptchaDetectionResult): string {
    switch (source) {
      case 'url':
        return result.url ?? 'url-match';
      case 'title':
        return result.title ?? 'title-match';
      case 'dom':
        return result.selector ?? result.type;
      case 'text': {
        // Explicit guard: `in` on a null/primitive details crashes, and the
        // typeof-check alone does not exclude null.
        const details = result.details;
        if (
          details !== null &&
          typeof details === 'object' &&
          'keyword' in details &&
          typeof (details as Record<string, unknown>).keyword === 'string'
        ) {
          return String((details as Record<string, unknown>).keyword);
        }
        return result.type;
      }
      case 'vendor':
      default:
        return result.providerHint ?? result.type;
    }
  }

  protected matchRule(
    value: string,
    rules: readonly CaptchaHeuristicRule[],
  ): { rule: CaptchaHeuristicRule; matchText: string } | null {
    for (const rule of rules) {
      const match = value.match(rule.pattern);
      if (match?.[0]) {
        return { rule, matchText: match[0] };
      }
    }
    return null;
  }

  protected async confirmRuleWithDOM(page: Page, rule: CaptchaHeuristicRule): Promise<boolean> {
    if (!rule.requiresDomConfirmation) {
      return true;
    }

    return this.verifyByDOM(page);
  }

  protected buildExcludeResult(
    sourceLabel: string,
    rule: CaptchaHeuristicRule,
    matchText: string,
  ): CaptchaDetectionResult {
    logger.debug(`${sourceLabel} matched exclusion rule: ${rule.id}`);
    return {
      detected: false,
      type: 'none',
      confidence: rule.confidence,
      falsePositiveReason: `${sourceLabel} exclusion: ${matchText}`,
    };
  }

  protected buildCaptchaResult(payload: {
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

  protected async evaluateDomRule(
    page: Page,
    rule: CaptchaDomRule,
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
            `DOM rule ${rule.id} rejected selector after slider verification: ${selector}`,
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
      input.confidence >= CAPTCHA_THRESHOLDS.manualConfidence ||
      input.candidateCount >= CAPTCHA_THRESHOLDS.manualCandidateCount ||
      input.score - input.excludeScore >= CAPTCHA_THRESHOLDS.manualScoreMargin
    ) {
      return 'manual';
    }

    if (input.excludeScore > 0) {
      return 'ask_ai';
    }

    return 'observe';
  }

  /**
   * Shared template for the exclude → match → DOM-confirm → build pipeline
   * used by the URL/title/text heuristics. The per-source checks only differ
   * in which value and rule sets they feed in, and how the winning rule is
   * rendered into the result.
   */
  protected async checkSignal(
    page: Page,
    options: {
      sourceLabel: string;
      value: string;
      excludeRules: readonly CaptchaHeuristicRule[];
      matchRules: readonly CaptchaHeuristicRule[];
      defaultType: Exclude<CaptchaDetectionResult['type'], 'none'>;
      logMessage: (rule: CaptchaHeuristicRule) => string;
      buildDetails: (rule: CaptchaHeuristicRule, matchText: string) => unknown;
      extra?: (
        rule: CaptchaHeuristicRule,
        matchText: string,
        value: string,
      ) => Record<string, unknown>;
    },
  ): Promise<CaptchaDetectionResult> {
    const excludeRule = this.matchRule(options.value, options.excludeRules);
    if (excludeRule) {
      return this.buildExcludeResult(options.sourceLabel, excludeRule.rule, excludeRule.matchText);
    }

    const matchRule = this.matchRule(options.value, options.matchRules);
    if (matchRule) {
      const domConfirmed = await this.confirmRuleWithDOM(page, matchRule.rule);
      if (!domConfirmed) {
        logger.debug(
          `${options.sourceLabel} rule required DOM confirmation but none was found: ${matchRule.rule.id}`,
        );
        return {
          detected: false,
          type: 'none',
          confidence: matchRule.rule.confidence,
          falsePositiveReason: `${options.sourceLabel}DOM exclusion: ${matchRule.matchText}`,
        };
      }

      logger.warn(options.logMessage(matchRule.rule));
      return this.buildCaptchaResult({
        confidence: matchRule.rule.confidence,
        type: matchRule.rule.typeHint ?? options.defaultType,
        providerHint: matchRule.rule.providerHint,
        ...options.extra?.(matchRule.rule, matchRule.matchText, options.value),
        details: options.buildDetails(matchRule.rule, matchRule.matchText),
      });
    }

    return { detected: false, type: 'none', confidence: 0 };
  }

  protected async checkUrl(page: Page): Promise<CaptchaDetectionResult> {
    return this.checkSignal(page, {
      sourceLabel: 'URL',
      value: page.url(),
      excludeRules: CaptchaDetector.EXCLUDE_MATCH_RULES.url,
      matchRules: CaptchaDetector.CAPTCHA_MATCH_RULES.url,
      defaultType: 'url_redirect',
      logMessage: (rule) => `CAPTCHA URL signal detected (confidence: ${rule.confidence}%)`,
      extra: (_rule, _matchText, value) => ({ url: value }),
      buildDetails: (rule, matchText) => ({
        ruleId: rule.id,
        ruleLabel: rule.label,
        matchText,
      }),
    });
  }

  protected async checkTitle(page: Page): Promise<CaptchaDetectionResult> {
    return this.checkSignal(page, {
      sourceLabel: 'Title',
      value: await page.title(),
      excludeRules: CaptchaDetector.EXCLUDE_MATCH_RULES.title,
      matchRules: CaptchaDetector.CAPTCHA_MATCH_RULES.title,
      defaultType: 'page_redirect',
      logMessage: (rule) => `CAPTCHA title rule detected: ${rule.label}`,
      extra: (_rule, _matchText, value) => ({ title: value }),
      buildDetails: (rule, matchText) => ({
        ruleId: rule.id,
        ruleLabel: rule.label,
        matchText,
      }),
    });
  }

  protected async checkDOMElements(page: Page): Promise<CaptchaDetectionResult> {
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

  protected async checkPageText(page: Page): Promise<CaptchaDetectionResult> {
    // document.body may be absent (early document states) — never let a null
    // body crash the text check.
    const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')) ?? '';
    return this.checkSignal(page, {
      sourceLabel: 'Text',
      value: bodyText,
      excludeRules: CaptchaDetector.EXCLUDE_MATCH_RULES.text,
      matchRules: CaptchaDetector.CAPTCHA_MATCH_RULES.text,
      defaultType: 'unknown',
      logMessage: (rule) => `CAPTCHA text rule detected: ${rule.label}`,
      buildDetails: (rule, matchText) => ({
        keyword: rule.label,
        ruleId: rule.id,
        matchText,
      }),
    });
  }

  protected async checkVendorSpecific(_page: Page): Promise<CaptchaDetectionResult> {
    return { detected: false, type: 'none', confidence: 0 };
  }

  async waitForCompletion(
    page: Page,
    timeout: number = CAPTCHA_THRESHOLDS.defaultWaitTimeoutMs,
  ): Promise<boolean> {
    logger.info('Waiting for CAPTCHA to be solved...');

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.detect(page);

      if (!result.detected) {
        logger.info('CAPTCHA no longer detected; continuing workflow');
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, CAPTCHA_THRESHOLDS.waitPollIntervalMs));
    }

    logger.error('Timed out while waiting for CAPTCHA completion');
    return false;
  }

  protected async verifyByDOM(page: Page): Promise<boolean> {
    try {
      const hasSlider = await page.evaluate((sliderSelectors) => {
        return sliderSelectors.some((sel) => document.querySelector(sel) !== null);
      }, CAPTCHA_SELECTORS.slider);

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

  protected async verifySliderElement(page: Page, selector: string): Promise<boolean> {
    try {
      const excludeSelectors = CaptchaDetector.EXCLUDE_SELECTORS;

      const result = await page.evaluate(
        (sel, excludeSels, thresholds) => {
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
          for (let i = 0; i < thresholds.maxParentDepth && parent; i++) {
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
          const hasReasonableSize =
            width >= thresholds.sliderMinWidth &&
            width <= thresholds.sliderMaxWidth &&
            height >= thresholds.sliderMinHeight &&
            height <= thresholds.sliderMaxHeight;

          if (!hasReasonableSize) {
            console.warn(`[CaptchaDetector] Rejected by size heuristic: ${width}x${height}`);
            return false;
          }

          const conditionA = hasCaptchaKeyword && (hasSliderClass || hasDraggableStyle);

          const conditionB = hasParentCaptcha && hasSliderClass && hasDragAttribute;

          const isValid = conditionA || conditionB;

          if (!isValid) {
            console.warn(
              `[CaptchaDetector] Slider verification rejected - captcha:${hasCaptchaKeyword}, slider:` +
                `${hasSliderClass}, parent:${hasParentCaptcha}`,
            );
          }

          return isValid;
        },
        selector,
        excludeSelectors,
        {
          maxParentDepth: CAPTCHA_THRESHOLDS.maxParentDepth,
          sliderMinWidth: CAPTCHA_THRESHOLDS.sliderMinWidth,
          sliderMaxWidth: CAPTCHA_THRESHOLDS.sliderMaxWidth,
          sliderMinHeight: CAPTCHA_THRESHOLDS.sliderMinHeight,
          sliderMaxHeight: CAPTCHA_THRESHOLDS.sliderMaxHeight,
        },
      );

      return result;
    } catch (error) {
      logger.error('Slider element verification failed', error);
      return false;
    }
  }
}

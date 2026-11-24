import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import { logger } from '@utils/logger';
import { randomUUID } from 'node:crypto';

// ── Types ──

export type FetchInterceptAction = 'continue' | 'abort' | 'fulfill';

export interface FetchInterceptRule {
  /** Auto-generated rule ID */
  id: string;
  /** URL pattern to match against request URL */
  urlPattern: string;
  /** How to interpret urlPattern */
  urlPatternType: 'glob' | 'regex';
  /** Intercept stage: Request (before sending) or Response (after receiving) */
  stage: 'Request' | 'Response';
  /** Action to take when the rule matches */
  interceptAction: FetchInterceptAction;
  /** HTTP status code to return (default: 200) */
  responseCode: number;
  /** Custom response headers */
  responseHeaders: Array<{ name: string; value: string }>;
  /** Custom response body string */
  responseBody: string;
  /** Number of times this rule has been matched */
  hitCount: number;
  /** Timestamp when rule was created */
  createdAt: number;
}

export interface FetchInterceptRuleInput {
  urlPattern: string;
  urlPatternType?: 'glob' | 'regex';
  stage?: 'Request' | 'Response';
  interceptAction?: FetchInterceptAction;
  responseCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

interface FetchRequestPausedEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  responseStatusCode?: number;
  responseHeaders?: Array<{ name: string; value: string }>;
  responseErrorReason?: string;
  networkId?: string;
}

// ── FetchInterceptor ──

export class FetchInterceptor {
  private cdpSession: CDPSessionLike;
  private rules: Map<string, FetchInterceptRule> = new Map();
  private enabled = false;
  private eventHandler: ((params: FetchRequestPausedEvent) => void) | null = null;
  private compiledPatterns: Map<string, RegExp> = new Map();

  constructor(cdpSession: CDPSessionLike) {
    this.cdpSession = cdpSession;
  }

  /**
   * Enable Fetch domain interception with the given rules.
   * If already enabled, merges new rules with existing ones.
   */
  async enable(ruleInputs: FetchInterceptRuleInput[]): Promise<FetchInterceptRule[]> {
    const newRules: FetchInterceptRule[] = [];

    for (const input of ruleInputs) {
      const rule = this.createRule(input);
      this.rules.set(rule.id, rule);
      this.compiledPatterns.set(rule.id, this.compilePattern(rule));
      newRules.push(rule);
    }

    // Register the listener before enabling the domain: requests paused
    // between `Fetch.enable` and listener attachment would otherwise hang.
    const addedHandler = this.eventHandler === null;
    if (!this.eventHandler) {
      this.eventHandler = (params: FetchRequestPausedEvent) => {
        void this.handleRequestPaused(params);
      };
      this.cdpSession.on('Fetch.requestPaused', this.eventHandler);
    }

    try {
      await this.applyRules();
    } catch (error) {
      if (addedHandler && this.eventHandler) {
        try {
          this.cdpSession.off('Fetch.requestPaused', this.eventHandler);
        } catch {
          /* best-effort rollback */
        }
        this.eventHandler = null;
      }
      throw error;
    }

    this.enabled = true;
    logger.info(`FetchInterceptor enabled with ${this.rules.size} rule(s)`);
    return newRules;
  }

  /**
   * Disable all interception, remove all rules, detach event handler.
   */
  async disable(): Promise<{ removedRules: number }> {
    const count = this.rules.size;

    if (this.eventHandler) {
      try {
        this.cdpSession.off('Fetch.requestPaused', this.eventHandler);
      } catch {
        /* best-effort detach */
      }
      this.eventHandler = null;
    }

    try {
      await this.cdpSession.send('Fetch.disable');
    } catch (error) {
      logger.warn('Fetch.disable failed:', error);
    }

    this.rules.clear();
    this.compiledPatterns.clear();
    this.enabled = false;
    logger.info(`FetchInterceptor disabled, removed ${count} rule(s)`);
    return { removedRules: count };
  }

  /**
   * Remove a specific rule by ID. If no rules remain, disables Fetch domain.
   */
  async removeRule(ruleId: string): Promise<boolean> {
    const removed = this.rules.delete(ruleId);
    this.compiledPatterns.delete(ruleId);

    if (removed) {
      if (this.rules.size === 0) {
        await this.disable();
      } else {
        await this.applyRules();
      }
    }

    return removed;
  }

  /**
   * List all active rules with hit statistics.
   */
  listRules(): {
    enabled: boolean;
    rules: FetchInterceptRule[];
    totalHits: number;
  } {
    const rules = Array.from(this.rules.values());
    return {
      enabled: this.enabled,
      rules,
      totalHits: rules.reduce((sum, r) => sum + r.hitCount, 0),
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── Private ──

  private createRule(input: FetchInterceptRuleInput): FetchInterceptRule {
    const headers: Array<{ name: string; value: string }> = [];
    if (input.responseHeaders) {
      for (const [name, value] of Object.entries(input.responseHeaders)) {
        headers.push({ name, value });
      }
    }

    return {
      id: randomUUID().slice(0, 8),
      urlPattern: input.urlPattern,
      urlPatternType: input.urlPatternType ?? 'glob',
      stage: input.stage ?? 'Response',
      interceptAction: input.interceptAction ?? 'fulfill',
      responseCode: input.responseCode ?? 200,
      responseHeaders: headers,
      responseBody: input.responseBody ?? '',
      hitCount: 0,
      createdAt: Date.now(),
    };
  }

  private compilePattern(rule: FetchInterceptRule): RegExp {
    if (rule.urlPatternType === 'regex') {
      try {
        return new RegExp(rule.urlPattern, 'i');
      } catch {
        // Fall back to literal match
        return new RegExp(rule.urlPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    }

    // Glob → regex: * matches anything except /, ** matches anything
    const escaped = rule.urlPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '⟨GLOBSTAR⟩')
      .replace(/\*/g, '[^/]*')
      .replace(/⟨GLOBSTAR⟩/g, '.*');
    return new RegExp(escaped, 'i');
  }

  private async applyRules(): Promise<void> {
    // Build CDP RequestPattern array from rules
    const patterns: Array<{ urlPattern: string; requestStage: 'Request' | 'Response' }> = [];

    for (const rule of this.rules.values()) {
      patterns.push({
        urlPattern: rule.urlPatternType === 'glob' ? rule.urlPattern : '*',
        requestStage: rule.stage,
      });
    }

    // If no patterns, use a wildcard to catch everything (we filter in handler)
    if (patterns.length === 0) {
      return;
    }

    try {
      // Disable first to reset state, then re-enable with new patterns
      try {
        await this.cdpSession.send('Fetch.disable');
      } catch {
        /* ignore if not yet enabled */
      }

      await this.cdpSession.send('Fetch.enable', {
        patterns: patterns.length > 0 ? patterns : [{ urlPattern: '*', requestStage: 'Response' }],
        handleAuthRequests: false,
      });
    } catch (error) {
      logger.error('Failed to apply Fetch interception rules:', error);
      throw error;
    }
  }

  /**
   * CDP signals a Response-stage pause with responseStatusCode (success) or
   * responseErrorReason (failed/blocked). Everything else is a Request-stage
   * pause. When the event carries no response info we also consult the rules:
   * a bare event can only be a request-stage pause if a Request-stage rule
   * caused the domain to pause there.
   */
  private resolvePauseStage(params: FetchRequestPausedEvent): 'Request' | 'Response' {
    if (params.responseStatusCode !== undefined || params.responseErrorReason !== undefined) {
      return 'Response';
    }
    for (const rule of this.rules.values()) {
      if (rule.stage === 'Request') {
        return 'Request';
      }
    }
    return 'Response';
  }

  private async handleRequestPaused(params: FetchRequestPausedEvent): Promise<void> {
    const requestUrl = params.request.url;
    const pauseStage = this.resolvePauseStage(params);

    // Find matching rule for the stage that actually paused the request.
    for (const [ruleId, rule] of this.rules) {
      if (rule.stage !== pauseStage) {
        continue;
      }
      const pattern = this.compiledPatterns.get(ruleId);
      if (!pattern) continue;

      if (pattern.test(requestUrl)) {
        rule.hitCount++;
        logger.info(`[FetchInterceptor] Rule "${rule.urlPattern}" matched: ${requestUrl}`);

        const handled = await this.applyMatchedRule(rule, params, requestUrl);
        if (handled) {
          return;
        }
      }
    }

    // No rule matched — pass through
    await this.continueOriginalRequest(params, requestUrl);
  }

  private async applyMatchedRule(
    rule: FetchInterceptRule,
    params: FetchRequestPausedEvent,
    requestUrl: string,
  ): Promise<boolean> {
    try {
      switch (rule.interceptAction) {
        case 'continue':
          await this.continuePausedRequest(params);
          return true;
        case 'abort':
          await this.cdpSession.send('Fetch.failRequest', {
            requestId: params.requestId,
            errorReason: 'Failed',
          });
          return true;
        case 'fulfill':
          await this.cdpSession.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: rule.responseCode,
            responseHeaders: this.buildFulfillHeaders(rule),
            body: Buffer.from(rule.responseBody, 'utf-8').toString('base64'),
          });
          return true;
      }
    } catch (error) {
      logger.error(`[FetchInterceptor] ${rule.interceptAction} failed for ${requestUrl}:`, error);
      return false;
    }
  }

  private buildFulfillHeaders(rule: FetchInterceptRule): Array<{ name: string; value: string }> {
    const headers = [...rule.responseHeaders];

    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      if (rule.responseBody.startsWith('{') || rule.responseBody.startsWith('[')) {
        headers.push({ name: 'Content-Type', value: 'application/json' });
      } else {
        headers.push({ name: 'Content-Type', value: 'text/plain' });
      }
    }

    if (!headers.some((h) => h.name.toLowerCase() === 'access-control-allow-origin')) {
      headers.push({ name: 'Access-Control-Allow-Origin', value: '*' });
    }

    return headers;
  }

  private async continuePausedRequest(params: FetchRequestPausedEvent): Promise<void> {
    if (params.responseStatusCode !== undefined || params.responseErrorReason !== undefined) {
      await this.cdpSession.send('Fetch.continueResponse', {
        requestId: params.requestId,
      });
      return;
    }

    await this.cdpSession.send('Fetch.continueRequest', {
      requestId: params.requestId,
    });
  }

  private async continueOriginalRequest(
    params: FetchRequestPausedEvent,
    requestUrl: string,
  ): Promise<void> {
    try {
      await this.continuePausedRequest(params);
    } catch (error) {
      logger.warn(`[FetchInterceptor] continue failed for ${requestUrl}:`, error);
    }
  }
}

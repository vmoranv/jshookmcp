import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import { logger } from '@utils/logger';
import { randomUUID } from 'node:crypto';

// ── Types ──

export interface FetchInterceptRule {
  /** Auto-generated rule ID */
  id: string;
  /** URL pattern to match against request URL */
  urlPattern: string;
  /** How to interpret urlPattern */
  urlPatternType: 'glob' | 'regex';
  /** Intercept stage: Request (before sending) or Response (after receiving) */
  stage: 'Request' | 'Response';
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
  private rules: Map<string, FetchInterceptRule> = new Map();
  private enabled = false;
  private eventHandler: ((params: FetchRequestPausedEvent) => void) | null = null;
  private compiledPatterns: Map<string, RegExp> = new Map();

  constructor(private cdpSession: CDPSessionLike) {}

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

    await this.applyRules();

    if (!this.eventHandler) {
      this.eventHandler = (params: FetchRequestPausedEvent) => {
        void this.handleRequestPaused(params);
      };
      this.cdpSession.on('Fetch.requestPaused', this.eventHandler);
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

  private async handleRequestPaused(params: FetchRequestPausedEvent): Promise<void> {
    const requestUrl = params.request.url;

    // Find matching rule
    for (const [ruleId, rule] of this.rules) {
      const pattern = this.compiledPatterns.get(ruleId);
      if (!pattern) continue;

      if (pattern.test(requestUrl)) {
        rule.hitCount++;
        logger.info(`[FetchInterceptor] Rule "${rule.urlPattern}" matched: ${requestUrl}`);

        try {
          // Build response headers
          const headers = [...rule.responseHeaders];

          // Ensure Content-Type is set
          if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
            // Auto-detect content type from body
            const body = rule.responseBody;
            if (body.startsWith('{') || body.startsWith('[')) {
              headers.push({ name: 'Content-Type', value: 'application/json' });
            } else {
              headers.push({ name: 'Content-Type', value: 'text/plain' });
            }
          }

          // Ensure Access-Control-Allow-Origin for CORS
          if (!headers.some((h) => h.name.toLowerCase() === 'access-control-allow-origin')) {
            headers.push({ name: 'Access-Control-Allow-Origin', value: '*' });
          }

          await this.cdpSession.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: rule.responseCode,
            responseHeaders: headers,
            body: Buffer.from(rule.responseBody, 'utf-8').toString('base64'),
          });
          return;
        } catch (error) {
          logger.error(`[FetchInterceptor] fulfillRequest failed for ${requestUrl}:`, error);
          // Fall through to continueRequest
        }
      }
    }

    // No rule matched — pass through
    try {
      if (params.responseStatusCode !== undefined) {
        // Response stage — continue with original response
        await this.cdpSession.send('Fetch.continueResponse', {
          requestId: params.requestId,
        });
      } else {
        // Request stage — continue with original request
        await this.cdpSession.send('Fetch.continueRequest', {
          requestId: params.requestId,
        });
      }
    } catch (error) {
      logger.warn(`[FetchInterceptor] continue failed for ${requestUrl}:`, error);
    }
  }
}

import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { isSsrfTarget } from '../network/replay.js';
import type {
  InterceptRequest,
  PreviewPayload,
  ScriptMatchType,
  ScriptReplaceRule,
} from './handlers.impl.core.runtime.shared.js';

export class GraphQLToolHandlersBase {
  protected readonly collector: CodeCollector;
  protected readonly scriptReplaceRules: ScriptReplaceRule[] = [];
  protected readonly interceptionInstalledPages: WeakSet<Page> = new WeakSet();

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  protected toResponse(payload: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  protected toError(error: unknown, context?: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      success: false,
      error: this.getErrorMessage(error),
    };
    if (context) {
      payload.context = context;
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
      isError: true,
    };
  }

  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  protected getStringArg(args: Record<string, unknown>, key: string): string | null {
    const value = args[key];
    return typeof value === 'string' ? value : null;
  }

  protected getNumberArg(
    args: Record<string, unknown>,
    key: string,
    defaultValue: number,
    min: number,
    max: number
  ): number {
    const value = args[key];
    let parsed = defaultValue;

    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const fromString = Number(value);
      if (Number.isFinite(fromString)) {
        parsed = fromString;
      }
    }

    if (parsed < min) {
      return min;
    }
    if (parsed > max) {
      return max;
    }
    return Math.trunc(parsed);
  }

  protected getObjectArg(args: Record<string, unknown>, key: string): Record<string, unknown> | null {
    const value = args[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  protected normalizeHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
    const headers = Object.create(null) as Record<string, string>;
    for (const [header, rawValue] of Object.entries(value)) {
      if (dangerousKeys.has(header)) continue;
      if (typeof rawValue === 'string') {
        headers[header] = rawValue;
      } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
        headers[header] = String(rawValue);
      }
    }
    return headers;
  }

  protected async validateExternalEndpoint(endpoint: string): Promise<string | null> {
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(endpoint);
    } catch {
      return `Invalid endpoint URL: ${endpoint}`;
    }

    if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
      return `Unsupported endpoint protocol: ${parsedEndpoint.protocol} — only http/https allowed`;
    }

    if (await isSsrfTarget(parsedEndpoint.toString())) {
      return `Blocked: endpoint "${endpoint}" resolves to a private/reserved address`;
    }

    return null;
  }

  protected createPreview(text: string, maxChars: number): PreviewPayload {
    if (text.length <= maxChars) {
      return {
        preview: text,
        truncated: false,
        totalLength: text.length,
      };
    }

    return {
      preview: `${text.slice(0, maxChars)}\n... (truncated)`,
      truncated: true,
      totalLength: text.length,
    };
  }

  protected serializeForPreview(value: unknown, maxChars: number): PreviewPayload {
    let serialized: string;

    if (typeof value === 'string') {
      serialized = value;
    } else {
      try {
        serialized = JSON.stringify(value, null, 2);
      } catch {
        serialized = String(value);
      }
    }

    return this.createPreview(serialized, maxChars);
  }

  protected parseMatchType(value: unknown): ScriptMatchType {
    if (value === 'exact' || value === 'contains' || value === 'regex') {
      return value;
    }
    return 'contains';
  }

  protected generateRuleId(): string {
    return `script_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  protected isRequestInterceptHandled(request: InterceptRequest): boolean {
    if (typeof request.isInterceptResolutionHandled !== 'function') {
      return false;
    }

    try {
      return request.isInterceptResolutionHandled();
    } catch {
      return false;
    }
  }

  protected async continueRequest(request: InterceptRequest): Promise<void> {
    if (this.isRequestInterceptHandled(request)) {
      return;
    }

    try {
      await request.continue();
    } catch {
      // Ignore interception race conditions.
    }
  }

  protected ruleMatchesUrl(rule: ScriptReplaceRule, targetUrl: string): boolean {
    if (rule.matchType === 'exact') {
      return targetUrl === rule.url;
    }

    if (rule.matchType === 'contains') {
      return targetUrl.includes(rule.url);
    }

    try {
      const regex = new RegExp(rule.url);
      return regex.test(targetUrl);
    } catch {
      return false;
    }
  }

  protected findMatchingRule(url: string): ScriptReplaceRule | null {
    for (let index = this.scriptReplaceRules.length - 1; index >= 0; index -= 1) {
      const rule = this.scriptReplaceRules[index];
      if (rule && this.ruleMatchesUrl(rule, url)) {
        return rule;
      }
    }

    return null;
  }

  protected async handleInterceptedRequest(request: InterceptRequest): Promise<void> {
    if (this.isRequestInterceptHandled(request)) {
      return;
    }

    const resourceType = request.resourceType();
    if (resourceType !== 'script') {
      await this.continueRequest(request);
      return;
    }

    const requestUrl = request.url();
    const matchedRule = this.findMatchingRule(requestUrl);

    if (!matchedRule) {
      await this.continueRequest(request);
      return;
    }

    matchedRule.hits += 1;

    try {
      await request.respond({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: {
          'cache-control': 'no-store',
          'x-script-replaced-by': 'script_replace_persist',
        },
        body: matchedRule.replacement,
      });
    } catch {
      await this.continueRequest(request);
    }
  }

  protected async ensureScriptInterception(page: Page): Promise<void> {
    if (this.interceptionInstalledPages.has(page)) {
      return;
    }

    await page.setRequestInterception(true);

    type RequestListener = (request: InterceptRequest) => void;

    const listener: RequestListener = (request) => {
      void this.handleInterceptedRequest(request);
    };

    const eventHost = page as unknown as {
      prependListener?: (event: 'request', listener: RequestListener) => void;
      on: (event: 'request', listener: RequestListener) => void;
    };

    if (typeof eventHost.prependListener === 'function') {
      eventHost.prependListener('request', listener);
    } else {
      eventHost.on('request', listener);
    }

    this.interceptionInstalledPages.add(page);
  }
}
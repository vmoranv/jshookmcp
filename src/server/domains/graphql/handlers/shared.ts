/**
 * Shared utilities for GraphQL handler sub-modules.
 *
 * Extracted from the old GraphQLHandlersBase to support the composition/facade pattern.
 * All sub-handlers receive these helpers via their deps object.
 */

import type { Page } from 'rebrowser-puppeteer-core';
import { isSsrfTarget } from '@server/domains/network/ssrf-policy';
import type {
  InterceptRequest,
  PreviewPayload,
  ScriptMatchType,
  ScriptReplaceRule,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';

// ── Response helpers ──

export function toResponse(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function toError(error: unknown, context?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    success: false,
    error: getErrorMessage(error),
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ── Number parsing with string coercion (legacy compat) ──

/**
 * Parse a number argument from args, supporting string-to-number coercion,
 * min/max clamping, and integer truncation.
 * Preserves behavior from the old GraphQLHandlersBase.getNumberArg().
 */
export function parseClampedNumber(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
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

  if (parsed < min) return min;
  if (parsed > max) return max;
  return Math.trunc(parsed);
}

// ── Header helpers ──

export function normalizeHeaders(value: unknown): Record<string, string> {
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

// ── Endpoint validation ──

export async function validateExternalEndpoint(endpoint: string): Promise<string | null> {
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

// ── Preview helpers ──

export function createPreview(text: string, maxChars: number): PreviewPayload {
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

export function serializeForPreview(value: unknown, maxChars: number): PreviewPayload {
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

  return createPreview(serialized, maxChars);
}

// ── Script interception helpers ──

export function parseMatchType(value: unknown): ScriptMatchType {
  if (value === 'exact' || value === 'contains' || value === 'regex') {
    return value;
  }
  return 'contains';
}

export function generateRuleId(): string {
  return `script_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRequestInterceptHandled(request: InterceptRequest): boolean {
  if (typeof request.isInterceptResolutionHandled !== 'function') {
    return false;
  }

  try {
    return request.isInterceptResolutionHandled();
  } catch {
    return false;
  }
}

async function continueRequest(request: InterceptRequest): Promise<void> {
  if (isRequestInterceptHandled(request)) {
    return;
  }

  try {
    await request.continue();
  } catch {
    // Ignore interception race conditions.
  }
}

function ruleMatchesUrl(rule: ScriptReplaceRule, targetUrl: string): boolean {
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

export function findMatchingRule(
  rules: readonly ScriptReplaceRule[],
  url: string,
): ScriptReplaceRule | null {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (rule && ruleMatchesUrl(rule, url)) {
      return rule;
    }
  }

  return null;
}

async function handleInterceptedRequest(
  rules: readonly ScriptReplaceRule[],
  request: InterceptRequest,
): Promise<void> {
  if (isRequestInterceptHandled(request)) {
    return;
  }

  const resourceType = request.resourceType();
  if (resourceType !== 'script') {
    await continueRequest(request);
    return;
  }

  const requestUrl = request.url();
  const matchedRule = findMatchingRule(rules, requestUrl);

  if (!matchedRule) {
    await continueRequest(request);
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
    await continueRequest(request);
  }
}

export async function ensureScriptInterception(
  rules: readonly ScriptReplaceRule[],
  installedPages: WeakSet<Page>,
  page: Page,
): Promise<void> {
  if (installedPages.has(page)) {
    return;
  }

  await page.setRequestInterception(true);

  type RequestListener = (request: InterceptRequest) => void;

  const listener: RequestListener = (request) => {
    void handleInterceptedRequest(rules, request);
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

  installedPages.add(page);
}

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

const isSsrfTargetMock = vi.fn(async () => false);

import { GraphQLToolHandlersBase } from '@server/domains/graphql/handlers.impl.core.runtime.base';
import type {
  InterceptRequest,
  ScriptReplaceRule,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';

/**
 * Expose protected members for testing via a thin subclass.
 */
class TestableBase extends GraphQLToolHandlersBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public toResponse(payload: any) {
    return super.toResponse(payload);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public toError(error: any, context?: Record<string, unknown>) {
    return super.toError(error, context);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public getErrorMessage(error: any): string {
    return super.getErrorMessage(error);
  }
  public getStringArg(args: Record<string, unknown>, key: string) {
    return super.getStringArg(args, key);
  }
  public getNumberArg(
    args: Record<string, unknown>,
    key: string,
    defaultValue: number,
    min: number,
    max: number,
  ) {
    return super.getNumberArg(args, key, defaultValue, min, max);
  }
  public getObjectArg(args: Record<string, unknown>, key: string) {
    return super.getObjectArg(args, key);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public normalizeHeaders(value: any) {
    return super.normalizeHeaders(value);
  }
  public async validateExternalEndpoint(endpoint: string) {
    return super.validateExternalEndpoint(endpoint);
  }
  public createPreview(text: string, maxChars: number) {
    return super.createPreview(text, maxChars);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public serializeForPreview(value: any, maxChars: number) {
    return super.serializeForPreview(value, maxChars);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public parseMatchType(value: any) {
    return super.parseMatchType(value);
  }
  public generateRuleId() {
    return super.generateRuleId();
  }
  public isRequestInterceptHandled(request: InterceptRequest) {
    return super.isRequestInterceptHandled(request);
  }
  public async continueRequest(request: InterceptRequest) {
    return super.continueRequest(request);
  }
  public ruleMatchesUrl(rule: ScriptReplaceRule, targetUrl: string) {
    return super.ruleMatchesUrl(rule, targetUrl);
  }
  public findMatchingRule(url: string) {
    return super.findMatchingRule(url);
  }
  public async handleInterceptedRequest(request: InterceptRequest) {
    return super.handleInterceptedRequest(request);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public async ensureScriptInterception(page: any) {
    return super.ensureScriptInterception(page);
  }
  public get rules() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    return (this as any).scriptReplaceRules as ScriptReplaceRule[];
  }
}

function getFirstRule(base: TestableBase): ScriptReplaceRule {
  const firstRule = base.rules[0];
  if (!firstRule) {
    throw new Error('Expected at least one script replacement rule');
  }
  return firstRule;
}

describe('GraphQLToolHandlersBase', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const collector = { getActivePage: vi.fn() } as any;
  let base: TestableBase;

  beforeEach(() => {
    vi.clearAllMocks();
    base = new TestableBase(collector);
  });

  // ── toResponse ──────────────────────────────────────────────────────

  describe('toResponse', () => {
    it('wraps payload as JSON text content', () => {
      const result = base.toResponse({ hello: 'world' });
      expect(result.content).toHaveLength(1);
      const firstContent = result.content[0];
      expect(firstContent).toBeDefined();
      if (!firstContent) {
        throw new Error('Expected response.content[0] to be present');
      }
      expect(firstContent.type).toBe('text');
      const parsed = JSON.parse(firstContent.text);
      expect(parsed).toEqual({ hello: 'world' });
    });

    it('handles null payload', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const parsed = parseJson<any>(base.toResponse(null));
      expect(parsed).toBeNull();
    });

    it('handles numeric payload', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const parsed = parseJson<any>(base.toResponse(42));
      expect(parsed).toBe(42);
    });
  });

  // ── toError ─────────────────────────────────────────────────────────

  describe('toError', () => {
    it('wraps error string with isError flag', () => {
      const result = base.toError('something broke');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((result as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const parsed = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.error).toBe('something broke');
    });

    it('extracts message from Error instances', () => {
      const result = base.toError(new Error('test error'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const parsed = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.error).toBe('test error');
    });

    it('includes optional context', () => {
      const result = base.toError('fail', { detail: 'extra' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const parsed = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.context).toEqual({ detail: 'extra' });
    });

    it('omits context when not provided', () => {
      const result = base.toError('fail');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const parsed = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.context).toBeUndefined();
    });
  });

  // ── getErrorMessage ─────────────────────────────────────────────────

  describe('getErrorMessage', () => {
    it('returns message from Error', () => {
      expect(base.getErrorMessage(new Error('msg'))).toBe('msg');
    });

    it('stringifies non-Error values', () => {
      expect(base.getErrorMessage(42)).toBe('42');
      expect(base.getErrorMessage(null)).toBe('null');
      expect(base.getErrorMessage(undefined)).toBe('undefined');
    });
  });

  // ── getStringArg ────────────────────────────────────────────────────

  describe('getStringArg', () => {
    it('returns string values', () => {
      expect(base.getStringArg({ key: 'val' }, 'key')).toBe('val');
    });

    it('returns null for non-string values', () => {
      expect(base.getStringArg({ key: 42 }, 'key')).toBeNull();
      expect(base.getStringArg({ key: true }, 'key')).toBeNull();
      expect(base.getStringArg({ key: null }, 'key')).toBeNull();
    });

    it('returns null for missing keys', () => {
      expect(base.getStringArg({}, 'key')).toBeNull();
    });
  });

  // ── getNumberArg ────────────────────────────────────────────────────

  describe('getNumberArg', () => {
    it('returns the number when valid and in range', () => {
      expect(base.getNumberArg({ n: 5 }, 'n', 10, 1, 20)).toBe(5);
    });

    it('clamps to min', () => {
      expect(base.getNumberArg({ n: -5 }, 'n', 10, 0, 100)).toBe(0);
    });

    it('clamps to max', () => {
      expect(base.getNumberArg({ n: 999 }, 'n', 10, 0, 100)).toBe(100);
    });

    it('uses default for missing key', () => {
      expect(base.getNumberArg({}, 'n', 7, 1, 20)).toBe(7);
    });

    it('parses string numbers', () => {
      expect(base.getNumberArg({ n: '15' }, 'n', 10, 1, 20)).toBe(15);
    });

    it('uses default for non-numeric string', () => {
      expect(base.getNumberArg({ n: 'abc' }, 'n', 10, 1, 20)).toBe(10);
    });

    it('truncates to integer', () => {
      expect(base.getNumberArg({ n: 5.9 }, 'n', 10, 1, 20)).toBe(5);
    });

    it('uses default for NaN', () => {
      expect(base.getNumberArg({ n: NaN }, 'n', 10, 1, 20)).toBe(10);
    });

    it('uses default for Infinity', () => {
      expect(base.getNumberArg({ n: Infinity }, 'n', 10, 1, 20)).toBe(10);
    });
  });

  // ── getObjectArg ────────────────────────────────────────────────────

  describe('getObjectArg', () => {
    it('returns objects', () => {
      const obj = { a: 1 };
      expect(base.getObjectArg({ data: obj }, 'data')).toBe(obj);
    });

    it('returns null for arrays', () => {
      expect(base.getObjectArg({ data: [1, 2] }, 'data')).toBeNull();
    });

    it('returns null for primitives', () => {
      expect(base.getObjectArg({ data: 'str' }, 'data')).toBeNull();
      expect(base.getObjectArg({ data: 42 }, 'data')).toBeNull();
    });

    it('returns null for null values', () => {
      expect(base.getObjectArg({ data: null }, 'data')).toBeNull();
    });

    it('returns null for missing keys', () => {
      expect(base.getObjectArg({}, 'data')).toBeNull();
    });
  });

  // ── normalizeHeaders ────────────────────────────────────────────────

  describe('normalizeHeaders', () => {
    it('passes through string values', () => {
      expect(base.normalizeHeaders({ 'x-foo': 'bar' })).toEqual({ 'x-foo': 'bar' });
    });

    it('stringifies numeric header values', () => {
      expect(base.normalizeHeaders({ 'content-length': 42 })).toEqual({
        'content-length': '42',
      });
    });

    it('stringifies boolean header values', () => {
      expect(base.normalizeHeaders({ 'x-flag': true })).toEqual({
        'x-flag': 'true',
      });
    });

    it('skips non-scalar header values', () => {
      const result = base.normalizeHeaders({ nested: { a: 1 } });
      expect(result).toEqual({});
    });

    it('returns empty object for null/undefined', () => {
      expect(base.normalizeHeaders(null)).toEqual({});
      expect(base.normalizeHeaders(undefined)).toEqual({});
    });

    it('returns empty object for arrays', () => {
      expect(base.normalizeHeaders(['a', 'b'])).toEqual({});
    });

    it('skips dangerous prototype pollution keys', () => {
      const result = base.normalizeHeaders({
        __proto__: 'evil',
        constructor: 'bad',
        prototype: 'nope',
        'x-safe': 'ok',
      });
      expect(result).toEqual({ 'x-safe': 'ok' });
      expect(result.__proto__).toBeUndefined();
      expect(result.constructor).toBeUndefined();
    });
  });

  // ── validateExternalEndpoint ────────────────────────────────────────

  describe('validateExternalEndpoint', () => {
    it('returns null for valid https URL', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      isSsrfTargetMock.mockResolvedValueOnce(false);
      const result = await base.validateExternalEndpoint('https://example.com/graphql');
      expect(result).toBeNull();
    });

    it('returns null for valid http URL', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      isSsrfTargetMock.mockResolvedValueOnce(false);
      const result = await base.validateExternalEndpoint('http://example.com/graphql');
      expect(result).toBeNull();
    });

    it('returns error for invalid URL', async () => {
      const result = await base.validateExternalEndpoint('not-a-url');
      expect(result).toContain('Invalid endpoint URL');
    });

    it('returns error for unsupported protocol', async () => {
      const result = await base.validateExternalEndpoint('ftp://example.com/graphql');
      expect(result).toContain('Unsupported endpoint protocol');
    });

    it('returns error for SSRF targets', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      isSsrfTargetMock.mockResolvedValueOnce(true);
      const result = await base.validateExternalEndpoint('http://127.0.0.1/graphql');
      expect(result).toContain('Blocked');
      expect(result).toContain('private/reserved');
    });
  });

  // ── createPreview ───────────────────────────────────────────────────

  describe('createPreview', () => {
    it('returns full text when under limit', () => {
      const result = base.createPreview('short', 100);
      expect(result.preview).toBe('short');
      expect(result.truncated).toBe(false);
      expect(result.totalLength).toBe(5);
    });

    it('returns full text when exactly at limit', () => {
      const text = 'x'.repeat(10);
      const result = base.createPreview(text, 10);
      expect(result.truncated).toBe(false);
      expect(result.preview).toBe(text);
    });

    it('truncates text exceeding limit', () => {
      const text = 'x'.repeat(20);
      const result = base.createPreview(text, 10);
      expect(result.truncated).toBe(true);
      expect(result.totalLength).toBe(20);
      expect(result.preview).toContain('... (truncated)');
      expect(result.preview.startsWith('x'.repeat(10))).toBe(true);
    });
  });

  // ── serializeForPreview ─────────────────────────────────────────────

  describe('serializeForPreview', () => {
    it('serializes objects to JSON', () => {
      const result = base.serializeForPreview({ a: 1 }, 1000);
      expect(result.truncated).toBe(false);
      expect(JSON.parse(result.preview)).toEqual({ a: 1 });
    });

    it('passes strings through directly', () => {
      const result = base.serializeForPreview('hello', 1000);
      expect(result.preview).toBe('hello');
    });

    it('truncates large serialized objects', () => {
      const large = { data: 'x'.repeat(200) };
      const result = base.serializeForPreview(large, 50);
      expect(result.truncated).toBe(true);
    });

    it('handles circular-reference-like values gracefully', () => {
      const badValue = {
        toJSON() {
          throw new Error('cannot serialize');
        },
      };
      const result = base.serializeForPreview(badValue, 1000);
      expect(result.truncated).toBe(false);
    });
  });

  // ── parseMatchType ──────────────────────────────────────────────────

  describe('parseMatchType', () => {
    it('returns exact for "exact"', () => {
      expect(base.parseMatchType('exact')).toBe('exact');
    });

    it('returns contains for "contains"', () => {
      expect(base.parseMatchType('contains')).toBe('contains');
    });

    it('returns regex for "regex"', () => {
      expect(base.parseMatchType('regex')).toBe('regex');
    });

    it('defaults to contains for unknown values', () => {
      expect(base.parseMatchType('unknown')).toBe('contains');
      expect(base.parseMatchType(null)).toBe('contains');
      expect(base.parseMatchType(123)).toBe('contains');
      expect(base.parseMatchType(undefined)).toBe('contains');
    });
  });

  // ── generateRuleId ──────────────────────────────────────────────────

  describe('generateRuleId', () => {
    it('starts with script_rule_ prefix', () => {
      expect(base.generateRuleId()).toMatch(/^script_rule_/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 20 }, () => base.generateRuleId()));
      expect(ids.size).toBe(20);
    });
  });

  // ── isRequestInterceptHandled ───────────────────────────────────────

  describe('isRequestInterceptHandled', () => {
    it('returns true when handler reports handled', () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        continue: vi.fn(),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => true,
      };
      expect(base.isRequestInterceptHandled(request)).toBe(true);
    });

    it('returns false when handler reports not handled', () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        continue: vi.fn(),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => false,
      };
      expect(base.isRequestInterceptHandled(request)).toBe(false);
    });

    it('returns false when isInterceptResolutionHandled is not a function', () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        continue: vi.fn(),
        respond: vi.fn(),
      };
      expect(base.isRequestInterceptHandled(request)).toBe(false);
    });

    it('returns false when isInterceptResolutionHandled throws', () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        continue: vi.fn(),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => {
          throw new Error('oops');
        },
      };
      expect(base.isRequestInterceptHandled(request)).toBe(false);
    });
  });

  // ── continueRequest ─────────────────────────────────────────────────

  describe('continueRequest', () => {
    it('calls continue when not already handled', async () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        continue: vi.fn().mockResolvedValue(undefined),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => false,
      };
      await base.continueRequest(request);
      expect(request.continue).toHaveBeenCalled();
    });

    it('skips continue when already handled', async () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        continue: vi.fn(),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => true,
      };
      await base.continueRequest(request);
      expect(request.continue).not.toHaveBeenCalled();
    });

    it('swallows errors from continue', async () => {
      const request = {
        url: () => '',
        resourceType: () => 'script',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        continue: vi.fn().mockRejectedValue(new Error('race condition')),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => false,
      };
      await expect(base.continueRequest(request)).resolves.toBeUndefined();
    });
  });

  // ── ruleMatchesUrl ──────────────────────────────────────────────────

  describe('ruleMatchesUrl', () => {
    const makeRule = (
      url: string,
      matchType: 'exact' | 'contains' | 'regex',
    ): ScriptReplaceRule => ({
      id: 'test',
      url,
      replacement: '',
      matchType,
      createdAt: 0,
      hits: 0,
    });

    it('matches exact URLs', () => {
      const rule = makeRule('https://example.com/main.js', 'exact');
      expect(base.ruleMatchesUrl(rule, 'https://example.com/main.js')).toBe(true);
      expect(base.ruleMatchesUrl(rule, 'https://example.com/other.js')).toBe(false);
    });

    it('matches contained substrings', () => {
      const rule = makeRule('main.js', 'contains');
      expect(base.ruleMatchesUrl(rule, 'https://example.com/main.js')).toBe(true);
      expect(base.ruleMatchesUrl(rule, 'https://example.com/other.js')).toBe(false);
    });

    it('matches regex patterns', () => {
      const rule = makeRule('main\\.js$', 'regex');
      expect(base.ruleMatchesUrl(rule, 'https://example.com/main.js')).toBe(true);
      expect(base.ruleMatchesUrl(rule, 'https://example.com/main.jsx')).toBe(false);
    });

    it('returns false for invalid regex', () => {
      const rule = makeRule('[invalid', 'regex');
      expect(base.ruleMatchesUrl(rule, 'https://example.com/main.js')).toBe(false);
    });
  });

  // ── findMatchingRule ────────────────────────────────────────────────

  describe('findMatchingRule', () => {
    it('returns null when no rules exist', () => {
      expect(base.findMatchingRule('https://example.com/main.js')).toBeNull();
    });

    it('returns last matching rule (highest priority)', () => {
      base.rules.push(
        {
          id: 'r1',
          url: 'main.js',
          replacement: 'a',
          matchType: 'contains',
          createdAt: 0,
          hits: 0,
        },
        {
          id: 'r2',
          url: 'main.js',
          replacement: 'b',
          matchType: 'contains',
          createdAt: 0,
          hits: 0,
        },
      );
      const match = base.findMatchingRule('https://example.com/main.js');
      expect(match?.id).toBe('r2');
    });

    it('returns null when no rules match', () => {
      base.rules.push({
        id: 'r1',
        url: 'other.js',
        replacement: 'a',
        matchType: 'exact',
        createdAt: 0,
        hits: 0,
      });
      expect(base.findMatchingRule('https://example.com/main.js')).toBeNull();
    });
  });

  // ── handleInterceptedRequest ────────────────────────────────────────

  describe('handleInterceptedRequest', () => {
    it('continues non-script requests', async () => {
      const request = {
        url: () => 'https://example.com/style.css',
        resourceType: () => 'stylesheet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        continue: vi.fn().mockResolvedValue(undefined),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => false,
      };
      await base.handleInterceptedRequest(request);
      expect(request.continue).toHaveBeenCalled();
      expect(request.respond).not.toHaveBeenCalled();
    });

    it('continues script requests with no matching rules', async () => {
      const request = {
        url: () => 'https://example.com/main.js',
        resourceType: () => 'script',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        continue: vi.fn().mockResolvedValue(undefined),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => false,
      };
      await base.handleInterceptedRequest(request);
      expect(request.continue).toHaveBeenCalled();
    });

    it('responds with replacement for matching script requests', async () => {
      base.rules.push({
        id: 'r1',
        url: 'main.js',
        replacement: 'console.log("replaced")',
        matchType: 'contains',
        createdAt: 0,
        hits: 0,
      });

      const request = {
        url: () => 'https://example.com/main.js',
        resourceType: () => 'script',
        continue: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        respond: vi.fn().mockResolvedValue(undefined),
        isInterceptResolutionHandled: () => false,
      };
      await base.handleInterceptedRequest(request);
      expect(request.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 200,
          body: 'console.log("replaced")',
        }),
      );
      expect(getFirstRule(base).hits).toBe(1);
    });

    it('increments hits counter on each match', async () => {
      base.rules.push({
        id: 'r1',
        url: 'main.js',
        replacement: 'x',
        matchType: 'contains',
        createdAt: 0,
        hits: 0,
      });

      const request = {
        url: () => 'https://example.com/main.js',
        resourceType: () => 'script',
        continue: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        respond: vi.fn().mockResolvedValue(undefined),
        isInterceptResolutionHandled: () => false,
      };

      await base.handleInterceptedRequest(request);
      await base.handleInterceptedRequest(request);
      expect(getFirstRule(base).hits).toBe(2);
    });

    it('falls back to continue if respond throws', async () => {
      base.rules.push({
        id: 'r1',
        url: 'main.js',
        replacement: 'x',
        matchType: 'contains',
        createdAt: 0,
        hits: 0,
      });

      const request = {
        url: () => 'https://example.com/main.js',
        resourceType: () => 'script',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        continue: vi.fn().mockResolvedValue(undefined),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        respond: vi.fn().mockRejectedValue(new Error('respond failed')),
        isInterceptResolutionHandled: () => false,
      };
      await base.handleInterceptedRequest(request);
      expect(request.continue).toHaveBeenCalled();
    });

    it('does nothing when already handled', async () => {
      const request = {
        url: () => 'https://example.com/main.js',
        resourceType: () => 'script',
        continue: vi.fn(),
        respond: vi.fn(),
        isInterceptResolutionHandled: () => true,
      };
      await base.handleInterceptedRequest(request);
      expect(request.continue).not.toHaveBeenCalled();
      expect(request.respond).not.toHaveBeenCalled();
    });
  });

  // ── ensureScriptInterception ────────────────────────────────────────

  describe('ensureScriptInterception', () => {
    it('sets up request interception on first call', async () => {
      const page = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      await base.ensureScriptInterception(page);
      expect(page.setRequestInterception).toHaveBeenCalledWith(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
    });

    it('uses prependListener when available', async () => {
      const page = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        prependListener: vi.fn(),
      };
      await base.ensureScriptInterception(page);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.prependListener).toHaveBeenCalledWith('request', expect.any(Function));
      expect(page.on).not.toHaveBeenCalled();
    });

    it('does not re-install on second call for same page', async () => {
      const page = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      await base.ensureScriptInterception(page);
      await base.ensureScriptInterception(page);
      expect(page.setRequestInterception).toHaveBeenCalledTimes(1);
    });

    it('installs separately for different pages', async () => {
      const page1 = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      const page2 = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      await base.ensureScriptInterception(page1);
      await base.ensureScriptInterception(page2);
      expect(page1.setRequestInterception).toHaveBeenCalledTimes(1);
      expect(page2.setRequestInterception).toHaveBeenCalledTimes(1);
    });
  });
});

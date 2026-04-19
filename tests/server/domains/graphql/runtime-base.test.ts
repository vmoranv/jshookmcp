import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

const isSsrfTargetMock = vi.fn(async () => false);

import {
  toResponse,
  toError,
  getErrorMessage,
  normalizeHeaders,
  validateExternalEndpoint,
  createPreview,
  serializeForPreview,
  parseMatchType,
  generateRuleId,
  findMatchingRule,
} from '@server/domains/graphql/handlers/shared';
import type { ScriptReplaceRule } from '@server/domains/graphql/handlers.impl.core.runtime.shared';

/**
 * Minimal testable wrapper for functions that operate on a rules array.
 */
class TestableShared {
  private readonly scriptReplaceRules: ScriptReplaceRule[] = [];

  get rules() {
    return this.scriptReplaceRules;
  }

  findMatchingRule(url: string) {
    return findMatchingRule(this.scriptReplaceRules, url);
  }
}

describe('GraphQL shared utilities (from handlers/shared.ts)', () => {
  let shared: TestableShared;

  beforeEach(() => {
    vi.clearAllMocks();
    shared = new TestableShared();
  });

  // ── toResponse ──────────────────────────────────────────────────────

  describe('toResponse', () => {
    it('wraps payload as JSON text content', () => {
      const result = toResponse({ hello: 'world' });
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
      const parsed = parseJson<any>(toResponse(null));
      expect(parsed).toBeNull();
    });

    it('handles numeric payload', () => {
      const parsed = parseJson<any>(toResponse(42));
      expect(parsed).toBe(42);
    });
  });

  // ── toError ─────────────────────────────────────────────────────────

  describe('toError', () => {
    it('wraps error string with isError flag', () => {
      const result = toError('something broke');
      expect((result as any).isError).toBe(true);
      const parsed = parseJson<any>(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('something broke');
    });

    it('extracts message from Error instances', () => {
      const result = toError(new Error('test error'));
      const parsed = parseJson<any>(result);
      expect(parsed.error).toBe('test error');
    });

    it('includes optional context', () => {
      const result = toError('fail', { detail: 'extra' });
      const parsed = parseJson<any>(result);
      expect(parsed.context).toEqual({ detail: 'extra' });
    });

    it('omits context when not provided', () => {
      const result = toError('fail');
      const parsed = parseJson<any>(result);
      expect(parsed.context).toBeUndefined();
    });
  });

  // ── getErrorMessage ─────────────────────────────────────────────────

  describe('getErrorMessage', () => {
    it('returns message from Error', () => {
      expect(getErrorMessage(new Error('msg'))).toBe('msg');
    });

    it('stringifies non-Error values', () => {
      expect(getErrorMessage(42)).toBe('42');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });
  });

  // ── normalizeHeaders ────────────────────────────────────────────────

  describe('normalizeHeaders', () => {
    it('passes through string values', () => {
      expect(normalizeHeaders({ 'x-foo': 'bar' })).toEqual({ 'x-foo': 'bar' });
    });

    it('stringifies numeric header values', () => {
      expect(normalizeHeaders({ 'content-length': 42 })).toEqual({
        'content-length': '42',
      });
    });

    it('stringifies boolean header values', () => {
      expect(normalizeHeaders({ 'x-flag': true })).toEqual({
        'x-flag': 'true',
      });
    });

    it('skips non-scalar header values', () => {
      const result = normalizeHeaders({ nested: { a: 1 } });
      expect(result).toEqual({});
    });

    it('returns empty object for null/undefined', () => {
      expect(normalizeHeaders(null)).toEqual({});
      expect(normalizeHeaders(undefined)).toEqual({});
    });

    it('returns empty object for arrays', () => {
      expect(normalizeHeaders(['a', 'b'])).toEqual({});
    });

    it('skips dangerous prototype pollution keys', () => {
      const result = normalizeHeaders({
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
      isSsrfTargetMock.mockResolvedValueOnce(false);
      const result = await validateExternalEndpoint('https://example.com/graphql');
      expect(result).toBeNull();
    });

    it('returns null for valid http URL', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(false);
      const result = await validateExternalEndpoint('http://example.com/graphql');
      expect(result).toBeNull();
    });

    it('returns error for invalid URL', async () => {
      const result = await validateExternalEndpoint('not-a-url');
      expect(result).toContain('Invalid endpoint URL');
    });

    it('returns error for unsupported protocol', async () => {
      const result = await validateExternalEndpoint('ftp://example.com/graphql');
      expect(result).toContain('Unsupported endpoint protocol');
    });

    it('returns error for SSRF targets', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(true);
      const result = await validateExternalEndpoint('http://127.0.0.1/graphql');
      expect(result).toContain('Blocked');
      expect(result).toContain('private/reserved');
    });
  });

  // ── createPreview ───────────────────────────────────────────────────

  describe('createPreview', () => {
    it('returns full text when under limit', () => {
      const result = createPreview('short', 100);
      expect(result.preview).toBe('short');
      expect(result.truncated).toBe(false);
      expect(result.totalLength).toBe(5);
    });

    it('returns full text when exactly at limit', () => {
      const text = 'x'.repeat(10);
      const result = createPreview(text, 10);
      expect(result.truncated).toBe(false);
      expect(result.preview).toBe(text);
    });

    it('truncates text exceeding limit', () => {
      const text = 'x'.repeat(20);
      const result = createPreview(text, 10);
      expect(result.truncated).toBe(true);
      expect(result.totalLength).toBe(20);
      expect(result.preview).toContain('... (truncated)');
      expect(result.preview.startsWith('x'.repeat(10))).toBe(true);
    });
  });

  // ── serializeForPreview ─────────────────────────────────────────────

  describe('serializeForPreview', () => {
    it('serializes objects to JSON', () => {
      const result = serializeForPreview({ a: 1 }, 1000);
      expect(result.truncated).toBe(false);
      expect(JSON.parse(result.preview)).toEqual({ a: 1 });
    });

    it('passes strings through directly', () => {
      const result = serializeForPreview('hello', 1000);
      expect(result.preview).toBe('hello');
    });

    it('truncates large serialized objects', () => {
      const large = { data: 'x'.repeat(200) };
      const result = serializeForPreview(large, 50);
      expect(result.truncated).toBe(true);
    });

    it('handles circular-reference-like values gracefully', () => {
      const badValue = {
        toJSON() {
          throw new Error('cannot serialize');
        },
      };
      const result = serializeForPreview(badValue, 1000);
      expect(result.truncated).toBe(false);
    });
  });

  // ── parseMatchType ──────────────────────────────────────────────────

  describe('parseMatchType', () => {
    it('returns exact for "exact"', () => {
      expect(parseMatchType('exact')).toBe('exact');
    });

    it('returns contains for "contains"', () => {
      expect(parseMatchType('contains')).toBe('contains');
    });

    it('returns regex for "regex"', () => {
      expect(parseMatchType('regex')).toBe('regex');
    });

    it('defaults to contains for unknown values', () => {
      expect(parseMatchType('unknown')).toBe('contains');
      expect(parseMatchType(null)).toBe('contains');
      expect(parseMatchType(123)).toBe('contains');
      expect(parseMatchType(undefined)).toBe('contains');
    });
  });

  // ── generateRuleId ──────────────────────────────────────────────────

  describe('generateRuleId', () => {
    it('starts with script_rule_ prefix', () => {
      expect(generateRuleId()).toMatch(/^script_rule_/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateRuleId()));
      expect(ids.size).toBe(20);
    });
  });

  // ── findMatchingRule ────────────────────────────────────────────────

  describe('findMatchingRule', () => {
    it('returns null when no rules exist', () => {
      expect(shared.findMatchingRule('https://example.com/main.js')).toBeNull();
    });

    it('returns last matching rule (highest priority)', () => {
      shared.rules.push(
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
      const match = shared.findMatchingRule('https://example.com/main.js');
      expect(match?.id).toBe('r2');
    });

    it('returns null when no rules match', () => {
      shared.rules.push({
        id: 'r1',
        url: 'other.js',
        replacement: 'a',
        matchType: 'exact',
        createdAt: 0,
        hits: 0,
      });
      expect(shared.findMatchingRule('https://example.com/main.js')).toBeNull();
    });
  });
});

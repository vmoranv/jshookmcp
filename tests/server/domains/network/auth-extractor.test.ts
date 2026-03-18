import { describe, it, expect } from 'vitest';

import { extractAuthFromRequests } from '@server/domains/network/auth-extractor';
import type { AuthFinding } from '@server/domains/network/auth-extractor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(
  overrides: {
    url?: string;
    headers?: Record<string, string>;
    postData?: string;
  } = {}
) {
  return {
    url: overrides.url ?? 'https://api.example.com/v1/data',
    headers: overrides.headers,
    postData: overrides.postData,
  };
}

function getFinding(findings: AuthFinding[], index = 0): AuthFinding {
  const finding = findings[index];
  expect(finding).toBeDefined();
  if (!finding) {
    throw new Error(`Expected finding at index ${index}`);
  }
  return finding;
}

describe('extractAuthFromRequests', () => {
  // -----------------------------------------------------------------------
  // Empty / no-auth scenarios
  // -----------------------------------------------------------------------
  it('returns empty array when no requests are provided', () => {
    expect(extractAuthFromRequests([])).toEqual([]);
  });

  it('returns empty array when requests have no auth-related headers', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'content-type': 'text/html', accept: '*/*' } }),
    ]);
    expect(findings).toEqual([]);
  });

  it('ignores header values shorter than 4 characters', () => {
    const findings = extractAuthFromRequests([req({ headers: { authorization: 'ab' } })]);
    expect(findings).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Bearer token detection
  // -----------------------------------------------------------------------
  it('detects Bearer token in Authorization header', () => {
    const token = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
    const findings = extractAuthFromRequests([req({ headers: { Authorization: token } })]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).source).toBe('header');
    expect(getFinding(findings).header).toBe('Authorization');
    expect(getFinding(findings).confidence).toBe(0.95);
  });

  it('assigns high confidence (0.95) to Bearer-prefixed values', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { Authorization: 'Bearer some-long-opaque-token-value-here' } }),
    ]);

    expect(getFinding(findings).confidence).toBe(0.95);
  });

  // -----------------------------------------------------------------------
  // JWT detection
  // -----------------------------------------------------------------------
  it('detects standalone JWT tokens with 0.9 confidence', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    const findings = extractAuthFromRequests([req({ headers: { 'x-token': jwt } })]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).confidence).toBe(0.9);
    expect(getFinding(findings).source).toBe('header');
  });

  // -----------------------------------------------------------------------
  // API key / custom token headers
  // -----------------------------------------------------------------------
  it('detects x-api-key header', () => {
    const apiKey = 'sk-abc123def456ghi789jkl012mno345pqr678';
    const findings = extractAuthFromRequests([req({ headers: { 'x-api-key': apiKey } })]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('x-api-key');
    expect(getFinding(findings).source).toBe('header');
  });

  it('detects x-auth-token header', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'x-auth-token': 'a]very-long-auth-token-value-for-testing' } }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('x-auth-token');
  });

  it('detects x-access-token header', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'x-access-token': 'some-access-token-value-12345' } }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('x-access-token');
  });

  it('detects x-signature header', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'x-signature': 'abcdef1234567890abcdef1234567890' } }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('x-signature');
  });

  it('detects x-sign header', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'x-sign': 'abcdef1234567890abcdef1234567890' } }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('x-sign');
  });

  it('detects x-csrf-token header', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'x-csrf-token': 'csrf-token-value-abc123def456' } }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('x-csrf-token');
  });

  // -----------------------------------------------------------------------
  // Cookie extraction
  // -----------------------------------------------------------------------
  it('extracts individual cookies from Cookie header', () => {
    const findings = extractAuthFromRequests([
      req({
        headers: {
          cookie: 'session_id=abcdef1234567890; tracking=short; auth_token=xyz789longvalue0123',
        },
      }),
    ]);

    // "tracking=short" is only 5 chars, below the 8-char minimum
    const names = findings.map((f) => f.header);
    expect(names).toContain('cookie[session_id]');
    expect(names).toContain('cookie[auth_token]');
    expect(names).not.toContain('cookie[tracking]');
  });

  it('reports cookie findings with source "cookie"', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { cookie: 'token=abcdef123456789012345' } }),
    ]);

    expect(getFinding(findings).source).toBe('cookie');
  });

  it('ignores cookie values shorter than 8 characters', () => {
    const findings = extractAuthFromRequests([req({ headers: { cookie: 'tiny=abc' } })]);

    expect(findings).toEqual([]);
  });

  it('skips cookie parts without an equals sign', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { cookie: 'noequalssign; valid=abcdef123456789012345' } }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).header).toBe('cookie[valid]');
  });

  // -----------------------------------------------------------------------
  // Query parameter extraction
  // -----------------------------------------------------------------------
  it('extracts auth tokens from URL query parameters', () => {
    const findings = extractAuthFromRequests([
      req({ url: 'https://api.example.com/data?token=abcdef123456789012345&page=1' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).source).toBe('query');
    expect(getFinding(findings).header).toBe('token');
  });

  it('detects various auth-related query parameter names', () => {
    const longVal = 'abcdef123456789012345';
    const urls = [
      `https://api.example.com?access_token=${longVal}`,
      `https://api.example.com?api_key=${longVal}`,
      `https://api.example.com?apikey=${longVal}`,
      `https://api.example.com?key=${longVal}`,
      `https://api.example.com?secret=${longVal}`,
      `https://api.example.com?jwt=${longVal}`,
      `https://api.example.com?auth=${longVal}`,
      `https://api.example.com?sign=${longVal}`,
      `https://api.example.com?signature=${longVal}`,
      `https://api.example.com?refresh_token=${longVal}`,
    ];

    for (const url of urls) {
      const findings = extractAuthFromRequests([req({ url })]);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(getFinding(findings).source).toBe('query');
    }
  });

  it('applies 0.9 multiplier to query parameter confidence', () => {
    // A long base64-ish string (>20, all alphanumeric) gets base score 0.7
    const longAlphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
    const findings = extractAuthFromRequests([
      req({ url: `https://api.example.com?token=${longAlphanumeric}` }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).confidence).toBeCloseTo(0.7 * 0.9, 5);
  });

  it('ignores query parameters with values shorter than 8 chars', () => {
    const findings = extractAuthFromRequests([req({ url: 'https://api.example.com?token=short' })]);

    expect(findings).toEqual([]);
  });

  it('handles invalid URLs gracefully for query param scanning', () => {
    const findings = extractAuthFromRequests([
      req({
        url: 'not-a-valid-url',
        headers: { authorization: 'Bearer a-valid-long-bearer-token-here' },
      }),
    ]);

    // Should still find the header-based auth, just skip query scanning
    expect(findings).toHaveLength(1);
    expect(getFinding(findings).source).toBe('header');
  });

  // -----------------------------------------------------------------------
  // Request body (JSON) extraction
  // -----------------------------------------------------------------------
  it('extracts auth tokens from JSON request body', () => {
    const findings = extractAuthFromRequests([
      req({
        postData: JSON.stringify({ token: 'abcdef123456789012345', username: 'user' }),
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).source).toBe('body');
    expect(getFinding(findings).header).toBe('token');
  });

  it('detects various auth-related body field names', () => {
    const longVal = 'abcdef123456789012345';
    const keys = [
      'token',
      'access_token',
      'refresh_token',
      'sign',
      'signature',
      'auth',
      'jwt',
      'api_key',
      'apikey',
      'key',
      'secret',
    ];

    for (const key of keys) {
      const findings = extractAuthFromRequests([
        req({ postData: JSON.stringify({ [key]: longVal }) }),
      ]);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(getFinding(findings).source).toBe('body');
    }
  });

  it('applies 0.85 multiplier to body field confidence', () => {
    const longAlphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
    const findings = extractAuthFromRequests([
      req({ postData: JSON.stringify({ token: longAlphanumeric }) }),
    ]);

    expect(findings).toHaveLength(1);
    expect(getFinding(findings).confidence).toBeCloseTo(0.7 * 0.85, 5);
  });

  it('ignores body string values shorter than 8 characters', () => {
    const findings = extractAuthFromRequests([
      req({ postData: JSON.stringify({ token: 'short' }) }),
    ]);

    expect(findings).toEqual([]);
  });

  it('ignores non-string body values', () => {
    const findings = extractAuthFromRequests([
      req({ postData: JSON.stringify({ token: 12345678901234 }) }),
    ]);

    expect(findings).toEqual([]);
  });

  it('skips non-JSON request bodies gracefully', () => {
    const findings = extractAuthFromRequests([req({ postData: 'this is not json {{{' })]);

    expect(findings).toEqual([]);
  });

  it('skips null/non-object JSON bodies', () => {
    const findings = extractAuthFromRequests([req({ postData: '"just a string"' })]);

    expect(findings).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Value masking
  // -----------------------------------------------------------------------
  it('masks long secrets showing first 6 and last 4 characters', () => {
    const token = 'abcdef_middle_part_ghij';
    const findings = extractAuthFromRequests([req({ headers: { authorization: token } })]);

    expect(getFinding(findings).value_masked).toBe('abcdef***ghij');
  });

  it('fully masks short secrets (<=12 chars) as "***"', () => {
    const shortVal = 'shorttoken'; // 10 chars
    const findings = extractAuthFromRequests([req({ headers: { authorization: shortVal } })]);

    expect(getFinding(findings).value_masked).toBe('***');
  });

  // -----------------------------------------------------------------------
  // Confidence scoring
  // -----------------------------------------------------------------------
  it('assigns confidence 0.5 for generic strings between 10 and 20 chars', () => {
    const value = 'medium-value'; // 12 chars, no special pattern
    const findings = extractAuthFromRequests([req({ headers: { 'x-token': value } })]);

    expect(getFinding(findings).confidence).toBe(0.5);
  });

  it('assigns confidence 0.3 for very short strings', () => {
    const value = 'tiny!'; // 5 chars, not alphanumeric-only, length <= 10
    const findings = extractAuthFromRequests([req({ headers: { 'x-token': value } })]);

    expect(getFinding(findings).confidence).toBe(0.3);
  });

  it('assigns confidence 0.7 for long base64-like strings', () => {
    const base64Like = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'; // >20, all alphanumeric
    const findings = extractAuthFromRequests([req({ headers: { 'x-token': base64Like } })]);

    expect(getFinding(findings).confidence).toBe(0.7);
  });

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------
  it('sorts findings by confidence in descending order', () => {
    const findings = extractAuthFromRequests([
      // Bearer → 0.95
      req({ headers: { authorization: 'Bearer some-long-token-value-here-123' } }),
      // Short generic → 0.3
      req({ headers: { 'x-token': 'tiny!' } }),
      // Long base64-like → 0.7
      req({ headers: { 'x-api-key': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' } }),
    ]);

    for (let i = 1; i < findings.length; i++) {
      const previous = getFinding(findings, i - 1);
      const current = getFinding(findings, i);
      expect(previous.confidence).toBeGreaterThanOrEqual(current.confidence);
    }
  });

  // -----------------------------------------------------------------------
  // Deduplication
  // -----------------------------------------------------------------------
  it('deduplicates identical header findings across requests', () => {
    const token = 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    const findings = extractAuthFromRequests([
      req({ url: 'https://api.example.com/a', headers: { authorization: token } }),
      req({ url: 'https://api.example.com/b', headers: { authorization: token } }),
    ]);

    // Same header + same value prefix → deduped
    expect(findings).toHaveLength(1);
  });

  it('deduplicates identical cookie findings across requests', () => {
    const cookieVal = 'session_id=abcdef1234567890abcdef1234567890';
    const findings = extractAuthFromRequests([
      req({ url: 'https://api.example.com/a', headers: { cookie: cookieVal } }),
      req({ url: 'https://api.example.com/b', headers: { cookie: cookieVal } }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('deduplicates identical query param findings across requests', () => {
    const url = 'https://api.example.com/data?token=abcdef123456789012345';
    const findings = extractAuthFromRequests([req({ url }), req({ url })]);

    expect(findings).toHaveLength(1);
  });

  it('deduplicates identical body findings across requests', () => {
    const body = JSON.stringify({ token: 'abcdef123456789012345' });
    const findings = extractAuthFromRequests([req({ postData: body }), req({ postData: body })]);

    expect(findings).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // request_url field
  // -----------------------------------------------------------------------
  it('includes the original request URL in findings', () => {
    const findings = extractAuthFromRequests([
      req({
        url: 'https://specific.api.com/endpoint',
        headers: { authorization: 'Bearer abcdef123456789' },
      }),
    ]);

    expect(getFinding(findings).request_url).toBe('https://specific.api.com/endpoint');
  });

  // -----------------------------------------------------------------------
  // Missing headers
  // -----------------------------------------------------------------------
  it('handles requests with undefined headers', () => {
    const findings = extractAuthFromRequests([req({ headers: undefined })]);
    expect(findings).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Multiple sources in single request
  // -----------------------------------------------------------------------
  it('finds auth in headers, cookies, query, and body of a single request', () => {
    const longVal = 'abcdef123456789012345';
    const findings = extractAuthFromRequests([
      req({
        url: `https://api.example.com/data?token=${longVal}`,
        headers: {
          authorization: `Bearer ${longVal}`,
          cookie: `session=${longVal}`,
        },
        postData: JSON.stringify({ api_key: longVal }),
      }),
    ]);

    const sources = new Set(findings.map((f) => f.source));
    expect(sources).toContain('header');
    expect(sources).toContain('cookie');
    expect(sources).toContain('query');
    expect(sources).toContain('body');
  });

  // -----------------------------------------------------------------------
  // Case-insensitive header matching
  // -----------------------------------------------------------------------
  it('matches auth headers case-insensitively', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { Authorization: 'Bearer some-long-token-value-here-123' } }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('matches X-Api-Key in mixed case', () => {
    const findings = extractAuthFromRequests([
      req({ headers: { 'X-Api-Key': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' } }),
    ]);

    expect(findings).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Non-auth headers should be ignored
  // -----------------------------------------------------------------------
  it('ignores standard non-auth headers even with long values', () => {
    const findings = extractAuthFromRequests([
      req({
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) very long agent string here',
          'accept-language': 'en-US,en;q=0.9,fr;q=0.8,de;q=0.7',
          'content-type': 'application/json; charset=utf-8',
        },
      }),
    ]);

    expect(findings).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Non-auth query params
  // -----------------------------------------------------------------------
  it('ignores non-auth query parameters', () => {
    const findings = extractAuthFromRequests([
      req({ url: 'https://api.example.com?page=1&limit=50&sort=name&filter=active' }),
    ]);

    expect(findings).toEqual([]);
  });
});

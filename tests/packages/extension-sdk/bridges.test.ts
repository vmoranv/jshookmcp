import { describe, expect, it } from 'vitest';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  toDisplayPath,
  assertLoopbackUrl,
  normalizeBaseUrl,
  buildUrl,
} from '@extension-sdk/bridges/shared';

/* ================================================================== */
/*  Response helpers                                                    */
/* ================================================================== */

describe('toTextResponse', () => {
  it('wraps payload as JSON text content', () => {
    const res = toTextResponse({ success: true, data: 42 });
    expect(res.content).toHaveLength(1);
    expect(res.content[0]!.type).toBe('text');
    const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe(42);
  });

  it('handles nested objects', () => {
    const res = toTextResponse({ a: { b: [1, 2, 3] } });
    const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.a.b).toEqual([1, 2, 3]);
  });
});

describe('toErrorResponse', () => {
  it('wraps Error instance', () => {
    const res = toErrorResponse('my_tool', new Error('boom'));
    const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.success).toBe(false);
    expect(parsed.tool).toBe('my_tool');
    expect(parsed.error).toBe('boom');
  });

  it('wraps string error', () => {
    const res = toErrorResponse('my_tool', 'string error');
    const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.error).toBe('string error');
  });

  it('merges extra fields', () => {
    const res = toErrorResponse('my_tool', new Error('fail'), { code: 'TIMEOUT' });
    const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.code).toBe('TIMEOUT');
    expect(parsed.success).toBe(false);
  });
});

/* ================================================================== */
/*  parseStringArg                                                      */
/* ================================================================== */

describe('parseStringArg', () => {
  it('extracts string value', () => {
    expect(parseStringArg({ url: 'https://example.com' }, 'url')).toBe('https://example.com');
  });

  it('returns undefined for missing optional arg', () => {
    expect(parseStringArg({}, 'url')).toBeUndefined();
  });

  it('throws for missing required arg', () => {
    expect(() => parseStringArg({}, 'url', true)).toThrow();
  });

  it('returns undefined for non-string value when not required', () => {
    expect(parseStringArg({ url: 123 }, 'url')).toBeUndefined();
  });
});

/* ================================================================== */
/*  URL helpers                                                         */
/* ================================================================== */

describe('assertLoopbackUrl', () => {
  it('accepts 127.0.0.1', () => {
    const result = assertLoopbackUrl('http://127.0.0.1:9222');
    expect(result).toContain('127.0.0.1:9222');
  });

  it('accepts localhost', () => {
    const result = assertLoopbackUrl('http://localhost:3000');
    expect(result).toContain('localhost:3000');
  });

  it('rejects non-loopback URL', () => {
    expect(() => assertLoopbackUrl('http://evil.com')).toThrow();
  });
});

describe('normalizeBaseUrl', () => {
  it('strips trailing slash', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:9222/')).toBe('http://127.0.0.1:9222');
  });

  it('preserves URL without trailing slash', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222');
  });
});

describe('buildUrl', () => {
  it('joins base and path', () => {
    expect(buildUrl('http://127.0.0.1:9222', '/json/list')).toBe('http://127.0.0.1:9222/json/list');
  });

  it('appends query parameters', () => {
    const url = buildUrl('http://127.0.0.1:9222', '/json', { t: '123' });
    expect(url).toContain('t=123');
  });
});

describe('toDisplayPath', () => {
  it('converts absolute path to display path', () => {
    const result = toDisplayPath('/home/user/project/file.txt');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

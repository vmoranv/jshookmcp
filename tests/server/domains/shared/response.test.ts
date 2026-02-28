import { describe, expect, it } from 'vitest';
import { asErrorResponse, asJsonResponse, asTextResponse, serializeError } from '../../../../src/server/domains/shared/response.js';

describe('shared response helpers', () => {
  it('asTextResponse returns MCP text payload', () => {
    const res = asTextResponse('ok');
    expect(res).toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
  });

  it('asTextResponse marks error responses when requested', () => {
    const res = asTextResponse('bad', true);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe('bad');
  });

  it('asJsonResponse formats JSON content', () => {
    const res = asJsonResponse({ a: 1, b: 'x' });
    expect(res.content[0]?.text).toBe('{\n  "a": 1,\n  "b": "x"\n}');
  });

  it('asErrorResponse uses message from Error instances', () => {
    const res = asErrorResponse(new Error('boom'));
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe('Error: boom');
  });

  it('asErrorResponse stringifies non-Error values', () => {
    const res = asErrorResponse({ code: 500 });
    expect(res.content[0]?.text).toContain('Error: [object Object]');
  });

  it('serializeError returns normalized error object', () => {
    expect(serializeError(new Error('fail'))).toEqual({
      success: false,
      error: 'fail',
    });
    expect(serializeError(404)).toEqual({
      success: false,
      error: '404',
    });
  });
});


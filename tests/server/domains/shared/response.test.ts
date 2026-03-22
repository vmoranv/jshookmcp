import { describe, expect, it } from 'vitest';
import {
  asErrorResponse,
  asJsonResponse,
  asTextResponse,
  serializeError,
  toolErrorToResponse,
} from '@server/domains/shared/response';
import { ToolError } from '@errors/ToolError';

describe('shared response helpers', () => {
  it('asTextResponse returns MCP text payload', () => {
    const res = asTextResponse('ok');
    expect(res).toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
  });

  it('asTextResponse marks error responses when requested', () => {
    const res = asTextResponse('bad', true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((res as any).isError).toBe(true);
    expect((res.content[0] as unknown)?.text).toBe('bad');
  });

  it('asJsonResponse formats JSON content', () => {
    const res = asJsonResponse({ a: 1, b: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((res.content[0] as any)?.text).toBe('{\n  "a": 1,\n  "b": "x"\n}');
  });

  it('asErrorResponse uses message from Error instances', () => {
    const res = asErrorResponse(new Error('boom'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((res as any).isError).toBe(true);
    expect((res.content[0] as unknown)?.text).toBe('Error: boom');
  });

  it('asErrorResponse stringifies non-Error values', () => {
    const res = asErrorResponse({ code: 500 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((res.content[0] as any)?.text).toContain('Error: [object Object]');
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

  describe('toolErrorToResponse', () => {
    it('formats user-correctable ToolError (VALIDATION) without isError', () => {
      const err = new ToolError('VALIDATION', 'bad input', { toolName: 'test_tool' });
      const res = toolErrorToResponse(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = JSON.parse((res.content[0] as any).text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.code).toBe('VALIDATION');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toBe('bad input');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('test_tool');
      expect(res).not.toHaveProperty('isError');
    });

    it('formats PREREQUISITE as user-correctable', () => {
      const err = new ToolError('PREREQUISITE', 'not ready');
      const res = toolErrorToResponse(err);
      expect(res).not.toHaveProperty('isError');
    });

    it('formats NOT_FOUND as user-correctable', () => {
      const err = new ToolError('NOT_FOUND', 'missing');
      const res = toolErrorToResponse(err);
      expect(res).not.toHaveProperty('isError');
    });

    it('formats RUNTIME error with isError=true', () => {
      const err = new ToolError('RUNTIME', 'crash', {
        details: { stack: 'trace' },
      });
      const res = toolErrorToResponse(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = JSON.parse((res.content[0] as any).text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.code).toBe('RUNTIME');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.details).toEqual({ stack: 'trace' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((res as any).isError).toBe(true);
    });

    it('formats TIMEOUT error with isError=true', () => {
      const res = toolErrorToResponse(new ToolError('TIMEOUT', 'slow'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((res as any).isError).toBe(true);
    });

    it('formats CONNECTION error with isError=true', () => {
      const res = toolErrorToResponse(new ToolError('CONNECTION', 'lost'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((res as any).isError).toBe(true);
    });

    it('formats PERMISSION error with isError=true', () => {
      const res = toolErrorToResponse(new ToolError('PERMISSION', 'denied'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((res as any).isError).toBe(true);
    });

    it('falls back to asErrorResponse for non-ToolError', () => {
      const res = toolErrorToResponse(new Error('generic'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((res.content[0] as any).text).toBe('Error: generic');
      expect((res as unknown).isError).toBe(true);
    });

    it('falls back for string errors', () => {
      const res = toolErrorToResponse('plain');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((res.content[0] as any).text).toBe('Error: plain');
    });

    it('omits tool and details when not provided', () => {
      const err = new ToolError('RUNTIME', 'err');
      const res = toolErrorToResponse(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = JSON.parse((res.content[0] as any).text);
      expect(body).not.toHaveProperty('tool');
      expect(body).not.toHaveProperty('details');
    });
  });
});

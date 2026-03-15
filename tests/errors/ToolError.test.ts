import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToolError, USER_CORRECTABLE_CODES } from '@errors/ToolError';

describe('ToolError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures code, message, tool metadata, and cause', () => {
    const cause = new Error('root-cause');
    const error = new ToolError('RUNTIME', 'tool failed', {
      toolName: 'page_evaluate',
      details: { url: 'https://example.com' },
      cause,
    });

    expect(error).toBeInstanceOf(ToolError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ToolError');
    expect(error.message).toBe('tool failed');
    expect(error.code).toBe('RUNTIME');
    expect(error.toolName).toBe('page_evaluate');
    expect(error.details).toEqual({ url: 'https://example.com' });
    expect(error.cause).toBe(cause);
  });

  it('tracks user-correctable error codes separately from fatal ones', () => {
    expect(USER_CORRECTABLE_CODES.has('PREREQUISITE')).toBe(true);
    expect(USER_CORRECTABLE_CODES.has('VALIDATION')).toBe(true);
    expect(USER_CORRECTABLE_CODES.has('NOT_FOUND')).toBe(true);
    expect(USER_CORRECTABLE_CODES.has('TIMEOUT')).toBe(false);
    expect(USER_CORRECTABLE_CODES.has('RUNTIME')).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { normalizeToolName, validateToolNameArray } from '@server/MCPServer.search.validation';

describe('MCPServer.search.validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes namespaced tool names while preserving plain names', () => {
    expect(normalizeToolName(' page_navigate ')).toBe('page_navigate');
    expect(normalizeToolName('mcp__jshook__page_navigate')).toBe('page_navigate');
    expect(normalizeToolName('mcp__invalid')).toBe('mcp__invalid');
    expect(normalizeToolName('mcp__jshook__tool__with__parts')).toBe('tool__with__parts');
  });

  it('validates tool name arrays and normalizes each entry', () => {
    expect(
      validateToolNameArray({
        names: ['page_navigate', 'mcp__jshook__network_get_requests'],
      })
    ).toEqual({
      names: ['page_navigate', 'network_get_requests'],
    });
  });

  it('rejects non-array or blank tool names', () => {
    expect(validateToolNameArray({ names: 'page_navigate' })).toEqual({
      names: [],
      error: 'names must be an array',
    });
    expect(validateToolNameArray({ names: ['page_navigate', ' '] })).toEqual({
      names: [],
      error: 'invalid tool name: expected non-empty string',
    });
    expect(validateToolNameArray({ names: ['page_navigate', 1] } as any)).toEqual({
      names: [],
      error: 'invalid tool name: expected non-empty string',
    });
  });
});

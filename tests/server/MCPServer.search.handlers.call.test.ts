import { beforeEach, describe, expect, it, vi } from 'vitest';

function tool(name: string, description = `desc_${name}`) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const state = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  normalizeToolName: vi.fn((name: string) => {
    const trimmed = name.trim();
    if (!trimmed.startsWith('mcp__')) return trimmed;
    const parts = trimmed.split('__');
    return parts.length < 3 ? trimmed : parts.slice(2).join('__');
  }),
  getToolByName: vi.fn(),
  getSearchEngine: vi.fn(),
  activateToolNames: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({
    content: [{ type: 'text', text }],
  }),
}));

vi.mock('@server/MCPServer.search.validation', () => ({
  normalizeToolName: state.normalizeToolName,
}));

vi.mock('@server/MCPServer.search.helpers', () => ({
  getToolByName: state.getToolByName,
  getSearchEngine: state.getSearchEngine,
}));

vi.mock('@server/MCPServer.search.handlers.activate', () => ({
  activateToolNames: state.activateToolNames,
}));

import { handleCallTool } from '@server/MCPServer.search.handlers.call';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    router: {
      has: vi.fn(() => true),
    },
    executeToolWithTracking: vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ result: 'ok' }) }],
    })),
    ...overrides,
  } as any;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('MCPServer.search.handlers.call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSearchEngine.mockReturnValue({
      recordToolCallFeedback: vi.fn(),
    });
    state.getToolByName.mockReturnValue(new Map([['test_tool', tool('test_tool')]]));
    state.activateToolNames.mockResolvedValue({
      activated: ['test_tool'],
      alreadyActive: [],
      notFound: [],
      totalActive: 1,
    });
  });

  it('returns error when name is not provided', async () => {
    const ctx = createCtx();
    const response = await handleCallTool(ctx, {});
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('name must be a non-empty string');
    expect(result.wasAutoActivated).toBe(false);
    expect(result.activatedTools).toEqual([]);
  });

  it('returns error when name is empty string', async () => {
    const ctx = createCtx();
    const response = await handleCallTool(ctx, { name: '' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('name must be a non-empty string');
  });

  it('returns error when name is not a string', async () => {
    const ctx = createCtx();
    const response = await handleCallTool(ctx, { name: 123 });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('name must be a non-empty string');
  });

  it('executes tool directly when already in router', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, { name: 'test_tool', args: { key: 'value' } });
    const result = parseResponse(response);

    expect(result.result).toBe('ok');
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', { key: 'value' });
    expect(result.wasAutoActivated).toBe(false);
  });

  it('normalizes tool names via normalizeToolName', async () => {
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'mcp__jshook__test_tool' });

    expect(state.normalizeToolName).toHaveBeenCalledWith('mcp__jshook__test_tool');
    expect(ctx.router.has).toHaveBeenCalledWith('test_tool');
  });

  it('uses empty object when args is not an object', async () => {
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'test_tool', args: 'not-an-object' });

    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {});
  });

  it('uses empty object when args is an array', async () => {
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'test_tool', args: [1, 2] });

    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {});
  });

  it('uses empty object when args is not provided', async () => {
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'test_tool' });

    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {});
  });

  it('auto-activates tool when not in router', async () => {
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ executed: true }) }],
      })),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(state.activateToolNames).toHaveBeenCalledWith(ctx, ['test_tool']);
    expect(result.executed).toBe(true);
    expect(result.wasAutoActivated).toBe(true);
    expect(result.activatedTools).toEqual(['test_tool']);
  });

  it('returns error when tool not found in catalogue', async () => {
    state.getToolByName.mockReturnValue(new Map());
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'unknown_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found in the catalogue');
    expect(result.error).toContain('unknown_tool');
  });

  it('returns error when activation fails (nothing activated)', async () => {
    state.activateToolNames.mockResolvedValue({
      activated: [],
      alreadyActive: [],
      notFound: ['test_tool'],
      totalActive: 0,
    });
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be activated');
  });

  it('proceeds when tool is alreadyActive (not newly activated)', async () => {
    state.activateToolNames.mockResolvedValue({
      activated: [],
      alreadyActive: ['test_tool'],
      notFound: [],
      totalActive: 1,
    });
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      })),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.ok).toBe(true);
  });

  it('records search engine feedback after successful execution', async () => {
    const recordToolCallFeedback = vi.fn();
    state.getSearchEngine.mockReturnValue({ recordToolCallFeedback });
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'test_tool' });

    expect(recordToolCallFeedback).toHaveBeenCalledWith('test_tool', '');
  });

  it('ignores feedback errors gracefully', async () => {
    state.getSearchEngine.mockReturnValue({
      recordToolCallFeedback: vi.fn(() => {
        throw new Error('feedback error');
      }),
    });
    const ctx = createCtx();

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.result).toBe('ok');
  });

  it('returns error response when tool execution throws', async () => {
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw new Error('execution failed');
      }),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('execution failed');
    expect(state.logger.error).toHaveBeenCalled();
  });

  it('handles non-Error throws from tool execution', async () => {
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw 'string error';
      }),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('string error');
  });

  it('attaches metadata to non-JSON text content without breaking it', async () => {
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: 'plain text response' }],
      })),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });

    // Non-JSON text should be left unchanged
    expect(response.content[0].text).toBe('plain text response');
  });

  it('attaches metadata to array JSON responses without breaking it', async () => {
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [{ type: 'text', text: '[1, 2, 3]' }],
      })),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });

    // Array JSON should be left unchanged
    expect(response.content[0].text).toBe('[1, 2, 3]');
  });

  it('preserves non-text content items in response', async () => {
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => ({
        content: [
          { type: 'image', data: 'base64data' },
          { type: 'text', text: JSON.stringify({ data: 'test' }) },
        ],
      })),
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });

    expect(response.content[0]).toEqual({ type: 'image', data: 'base64data' });
    const textResult = JSON.parse(response.content[1].text);
    expect(textResult.data).toBe('test');
    expect(textResult.wasAutoActivated).toBe(false);
  });
});

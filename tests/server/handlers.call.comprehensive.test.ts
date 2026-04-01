/**
 * Comprehensive tests for MCPServer.search.handlers.call.ts
 *
 * Covers additional edge cases beyond MCPServer.search.handlers.call.test.ts:
 * - attachCallToolMetadata with edge cases (null JSON parse, non-object items)
 * - buildCallToolMetadata factory
 * - getSearchEngine throwing during feedback
 * - Content items with `text` property but wrong type
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('MCPServer.search.handlers.call — comprehensive edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSearchEngine.mockReturnValue({
      recordToolCallFeedback: vi.fn(),
    });
    state.getToolByName.mockReturnValue(
      new Map([
        [
          'test_tool',
          {
            name: 'test_tool',
            description: 'desc',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      ]),
    );
    state.activateToolNames.mockResolvedValue({
      activated: ['test_tool'],
      alreadyActive: [],
      notFound: [],
      totalActive: 1,
    });
  });

  describe('attachCallToolMetadata edge cases', () => {
    it('handles JSON content that parses to null', async () => {
      const ctx = createCtx({
        executeToolWithTracking: vi.fn(async () => ({
          content: [{ type: 'text', text: 'null' }],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });

      // null parses as object but fails !parsed check — should be left unchanged
      expect(response.content[0].text).toBe('null');
    });

    it('handles JSON content that parses to a number', async () => {
      const ctx = createCtx({
        executeToolWithTracking: vi.fn(async () => ({
          content: [{ type: 'text', text: '42' }],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      // number is not an object — should be left unchanged
      expect(response.content[0].text).toBe('42');
    });

    it('handles content item with type text but text is not a string', async () => {
      const ctx = createCtx({
        executeToolWithTracking: vi.fn(async () => ({
          content: [{ type: 'text', text: 123 }],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      // Non-string text property — item should be returned unchanged
      expect(response.content[0].text).toBe(123);
    });

    it('handles content item without text property', async () => {
      const ctx = createCtx({
        executeToolWithTracking: vi.fn(async () => ({
          content: [{ type: 'text', data: 'something' }],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      // No text property — item should be returned unchanged
      expect(response.content[0]).toEqual({ type: 'text', data: 'something' });
    });

    it('handles empty content array', async () => {
      const ctx = createCtx({
        executeToolWithTracking: vi.fn(async () => ({
          content: [],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      expect(response.content).toEqual([]);
    });

    it('attaches metadata to valid JSON object content', async () => {
      const ctx = createCtx({
        executeToolWithTracking: vi.fn(async () => ({
          content: [{ type: 'text', text: '{"foo":"bar"}' }],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.foo).toBe('bar');
      expect(parsed.wasAutoActivated).toBe(false);
      expect(parsed.activatedTools).toEqual([]);
    });

    it('preserves metadata from auto-activated tool', async () => {
      const ctx = createCtx({
        router: { has: vi.fn(() => false) },
        executeToolWithTracking: vi.fn(async () => ({
          content: [{ type: 'text', text: '{"status":"done"}' }],
        })),
      });

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.status).toBe('done');
      expect(parsed.wasAutoActivated).toBe(true);
      expect(parsed.activatedTools).toEqual(['test_tool']);
    });
  });

  describe('getSearchEngine error paths', () => {
    it('handles getSearchEngine throwing during feedback recording', async () => {
      state.getSearchEngine.mockImplementation(() => {
        throw new Error('search engine construction failed');
      });
      const ctx = createCtx();

      const response = await handleCallTool(ctx, { name: 'test_tool' });
      // Should still succeed despite feedback error
      const parsed = parseResponse(response);
      expect(parsed.result).toBe('ok');
    });
  });

  describe('args normalization', () => {
    it('passes valid args object to executeToolWithTracking', async () => {
      const ctx = createCtx();

      await handleCallTool(ctx, { name: 'test_tool', args: { param: 'value', count: 5 } });

      expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {
        param: 'value',
        count: 5,
      });
    });

    it('treats null args as empty object', async () => {
      const ctx = createCtx();

      await handleCallTool(ctx, { name: 'test_tool', args: null });

      expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {});
    });

    it('treats number args as empty object', async () => {
      const ctx = createCtx();

      await handleCallTool(ctx, { name: 'test_tool', args: 42 });

      expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {});
    });
  });
});

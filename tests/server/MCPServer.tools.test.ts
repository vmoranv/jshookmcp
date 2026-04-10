import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockToolError extends Error {}

  return {
    buildZodShape: vi.fn(),
    toolErrorToResponse: vi.fn((error: Error) => ({
      content: [{ type: 'text', text: `tool:${error.message}` }],
    })),
    asErrorResponse: vi.fn((error: Error) => ({
      isError: true,
      content: [{ type: 'text', text: `generic:${error.message}` }],
    })),
    logger: {
      error: vi.fn(),
    },
    MockToolError,
  };
});

vi.mock('@server/MCPServer.schema', () => ({
  buildZodShape: mocks.buildZodShape,
}));

vi.mock('@server/domains/shared/response', () => ({
  toolErrorToResponse: mocks.toolErrorToResponse,
  asErrorResponse: mocks.asErrorResponse,
}));

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@errors/ToolError', () => ({
  ToolError: mocks.MockToolError,
}));

import { registerSingleTool } from '@server/MCPServer.tools';

function createCtx(overrides: Record<string, unknown> = {}) {
  const registrations: Array<{
    name: string;
    config: Record<string, unknown>;
    handler: (args?: Record<string, unknown>) => Promise<any>;
  }> = [];

  const ctx = {
    server: {
      registerTool: vi.fn(
        (
          name: string,
          config: Record<string, unknown>,
          handler: (args?: Record<string, unknown>) => Promise<any>,
        ) => {
          const registered = { name, config, handler, remove: vi.fn() };
          registrations.push(registered);
          return registered;
        },
      ),
    },
    executeToolWithTracking: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify(args) }],
    })),
    toolAutocompleteHandlers: new Map(),
    __registrations: registrations,
    ...overrides,
  } as any;

  return ctx;
}

describe('MCPServer.tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers tools with generated zod input schemas and forwards tool args', async () => {
    mocks.buildZodShape.mockReturnValue({
      url: { safeParse: vi.fn() },
    });
    const ctx = createCtx();
    const toolDef = {
      name: 'page_navigate',
      description: 'Navigate a page',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    };

    const registered = registerSingleTool(ctx, toolDef as any);
    const handler = ctx.__registrations[0].handler;
    const result = await handler({ url: 'https://example.com' });

    expect(registered).toBe(ctx.__registrations[0]);
    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'page_navigate',
      {
        description: 'Navigate a page',
        inputSchema: { url: { safeParse: expect.any(Function) } },
      },
      expect.any(Function),
    );
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('page_navigate', {
      url: 'https://example.com',
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: '{"url":"https://example.com"}' }],
    });
  });

  it('registers tools without schemas using the tool name as fallback description', async () => {
    mocks.buildZodShape.mockReturnValue({});
    const ctx = createCtx();
    const toolDef = {
      name: 'extensions_list',
      inputSchema: { type: 'object', properties: {} },
    };

    registerSingleTool(ctx, toolDef as any);
    const handler = ctx.__registrations[0].handler;
    await handler({ ignored: true });

    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'extensions_list',
      { description: 'extensions_list' },
      expect.any(Function),
    );
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('extensions_list', {});
  });

  it('registers tools when inputSchema is missing and forwards empty args', async () => {
    const ctx = createCtx();

    registerSingleTool(ctx, {
      name: 'extensions_reload',
    } as any);
    const handler = ctx.__registrations[0].handler;
    await handler({ ignored: true });

    expect(mocks.buildZodShape).not.toHaveBeenCalled();
    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'extensions_reload',
      { description: 'extensions_reload' },
      expect.any(Function),
    );
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('extensions_reload', {});
  });

  it('throws McpError on ToolError failures', async () => {
    mocks.buildZodShape.mockReturnValue({});
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw new mocks.MockToolError('missing prerequisite');
      }),
    });

    registerSingleTool(ctx, {
      name: 'page_navigate',
      description: 'Navigate a page',
      inputSchema: { type: 'object', properties: {} },
    } as any);
    await expect(ctx.__registrations[0].handler()).rejects.toThrow(/missing prerequisite/);
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it('throws McpError for unknown failures and logs them', async () => {
    mocks.buildZodShape.mockReturnValue({});
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const mockTool = { name: 'page_navigate', inputSchema: {} } as any;
    registerSingleTool(ctx, mockTool);
    const handler = (ctx.server.registerTool as Mock).mock.calls[0]![2];

    await expect(handler({})).rejects.toThrowError(/Execution Failed in page_navigate: boom/);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Tool execution failed: page_navigate',
      expect.any(Error),
    );
  });
});

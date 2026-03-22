import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    handler: (args?: Record<string, unknown>) => Promise<unknown>;
  }> = [];

  const ctx = {
    server: {
      registerTool: vi.fn(
        (
          name: string,
          config: Record<string, unknown>,
          handler: (args?: Record<string, unknown>) => Promise<unknown>
        ) => {
          const registered = { name, config, handler, remove: vi.fn() };
          registrations.push(registered);
          return registered;
        }
      ),
    },
    executeToolWithTracking: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify(args) }],
    })),
    __registrations: registrations,
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const registered = registerSingleTool(ctx, toolDef as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handler = ctx.__registrations[0].handler;
    const result = await handler({ url: 'https://example.com' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(registered).toBe(ctx.__registrations[0]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'page_navigate',
      {
        description: 'Navigate a page',
        inputSchema: { url: { safeParse: expect.any(Function) } },
      },
      expect.any(Function)
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    registerSingleTool(ctx, toolDef as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handler = ctx.__registrations[0].handler;
    await handler({ ignored: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'extensions_list',
      { description: 'extensions_list' },
      expect.any(Function)
    );
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('extensions_list', {});
  });

  it('converts ToolError failures into structured tool responses', async () => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const response = await ctx.__registrations[0].handler();

    expect(response).toEqual({
      content: [{ type: 'text', text: 'tool:missing prerequisite' }],
    });
    expect(mocks.toolErrorToResponse).toHaveBeenCalledWith(expect.any(mocks.MockToolError));
    expect(mocks.asErrorResponse).not.toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it('converts unknown failures into generic error responses and logs them', async () => {
    mocks.buildZodShape.mockReturnValue({});
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    registerSingleTool(ctx, {
      name: 'page_navigate',
      description: 'Navigate a page',
      inputSchema: { type: 'object', properties: {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const response = await ctx.__registrations[0].handler();

    expect(response).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'generic:boom' }],
    });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Tool execution failed: page_navigate',
      expect.any(Error)
    );
    expect(mocks.asErrorResponse).toHaveBeenCalledWith(expect.any(Error));
  });
});

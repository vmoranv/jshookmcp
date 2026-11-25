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
  asToolResponse: (payload: unknown) => {
    const record = payload as { content?: unknown } | null;
    if (record && Array.isArray(record.content)) return record;
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  },
}));

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@errors/ToolError', () => ({
  ToolError: mocks.MockToolError,
}));

import { registerSingleTool, installCachedToolListHandler } from '@server/MCPServer.tools';
import { TEST_URLS } from '@tests/shared/test-urls';
import { McpServer } from '@modelcontextprotocol/server';

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
    registrationsForTest: registrations,
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
    const handler = ctx.registrationsForTest[0].handler;
    const result = await handler({ url: TEST_URLS.root });

    expect(registered).toBe(ctx.registrationsForTest[0]);
    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'page_navigate',
      {
        description: 'Navigate a page',
        inputSchema: { url: { safeParse: expect.any(Function) } },
      },
      expect.any(Function),
    );
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('page_navigate', {
      url: TEST_URLS.root,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ url: TEST_URLS.root }) }],
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
    const handler = ctx.registrationsForTest[0].handler;
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
    const handler = ctx.registrationsForTest[0].handler;
    await handler({ ignored: true });

    expect(mocks.buildZodShape).not.toHaveBeenCalled();
    expect(ctx.server.registerTool).toHaveBeenCalledWith(
      'extensions_reload',
      { description: 'extensions_reload' },
      expect.any(Function),
    );
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('extensions_reload', {});
  });

  it('forwards MCP annotations and output schema metadata to the SDK', () => {
    mocks.buildZodShape.mockReturnValue({});
    const ctx = createCtx();

    registerSingleTool(ctx, {
      name: 'structured_query',
      description: 'Structured query',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
      },
      inputSchema: { type: 'object', properties: {} },
    } as any);

    const config = ctx.registrationsForTest[0].config;
    expect(config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(config.outputSchema).toBeDefined();
  });

  it('returns ToolError failures as isError tool results', async () => {
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

    // SEP-1303: a failed call is a Tool Execution Error. The model must be able
    // to see the failure in-band, so this is a result, not a JSON-RPC fault.
    const result = (await ctx.registrationsForTest[0].handler()) as {
      isError?: boolean;
      success?: boolean;
      content: { type: string; text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.success).toBe(false);
    expect(result.content[0]!.text).toContain('missing prerequisite');
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it('returns unknown failures as RUNTIME isError results and logs them', async () => {
    mocks.buildZodShape.mockReturnValue({});
    const ctx = createCtx({
      executeToolWithTracking: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const mockTool = { name: 'page_navigate', inputSchema: {} } as any;
    registerSingleTool(ctx, mockTool);
    const handler = (ctx.server.registerTool as Mock).mock.calls[0]![2];

    const result = (await handler({})) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Execution Failed in page_navigate: boom');
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Tool execution failed: page_navigate',
      expect.any(Error),
    );
  });
});

describe('installCachedToolListHandler', () => {
  /** A fake McpServer exposing just the SDK surface the installer touches. */
  function createFakeMcpServer() {
    const originalHandler = vi.fn(async () => ({
      tools: [{ name: 'page_navigate', inputSchema: { type: 'object' } }],
    }));

    let installedHandler: ((request: unknown, extra?: unknown) => unknown) | null = null;
    const innerServer = {
      _requestHandlers: new Map([['tools/list', originalHandler]]),
      setRequestHandler: vi.fn(
        (_schema: unknown, handler: (request: unknown, extra?: unknown) => unknown) => {
          installedHandler = handler;
        },
      ),
    };

    const server = {
      server: innerServer,
      sendToolListChanged: vi.fn(),
    } as any;

    return { server, innerServer, originalHandler, getInstalledHandler: () => installedHandler };
  }

  it('reuses the serialized tool list until the tool set mutates', async () => {
    const { server, innerServer, originalHandler, getInstalledHandler } = createFakeMcpServer();

    installCachedToolListHandler(server);

    expect(innerServer.setRequestHandler).toHaveBeenCalledWith('tools/list', expect.any(Function));

    const handler = getInstalledHandler()!;
    const first = await handler({ method: 'tools/list', params: {} });
    const second = await handler({ method: 'tools/list', params: {} });

    expect(first).toEqual(second);
    expect(originalHandler).toHaveBeenCalledTimes(1); // second call hit the cache

    // A tool-set mutation (register/update/remove) invalidates the cache.
    server.sendToolListChanged();
    await handler({ method: 'tools/list', params: {} });
    expect(originalHandler).toHaveBeenCalledTimes(2);
  });

  it('installs at most once per server', () => {
    const { server, innerServer } = createFakeMcpServer();

    installCachedToolListHandler(server);
    installCachedToolListHandler(server);

    expect(innerServer.setRequestHandler).toHaveBeenCalledTimes(1);
  });

  it('keeps the default handler when the SDK handler is not yet registered', () => {
    const innerServer = { _requestHandlers: new Map(), setRequestHandler: vi.fn() };
    const server = { server: innerServer, sendToolListChanged: vi.fn() } as any;

    installCachedToolListHandler(server);

    expect(innerServer.setRequestHandler).not.toHaveBeenCalled();
    expect(server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('invalidates the cache on SDK-internal mutations that skip the explicit client notification', async () => {
    // Regression guard for the cache-invalidation coupling: the server gates the
    // explicit `sendToolListChanged()` notification on `clientSupportsListChanged`,
    // but the SDK itself calls the (wrapped) notifier on every register/update/
    // remove. Removing through the RegisteredTool handle must therefore still
    // bump the cache version even when no notification is sent to the client.
    const server = new McpServer({ name: 'cache-test', version: '0.0.0' });
    const registered = server.registerTool('cache_tool', { description: 'x' }, async () => ({
      content: [],
    }));
    installCachedToolListHandler(server);

    const inner = (server as unknown as { server: Record<string, unknown> }).server;
    const handlers = inner['_requestHandlers'] as Map<
      string,
      (request: unknown, ctx?: unknown) => unknown
    >;
    const handler = handlers.get('tools/list')!;
    const request = { method: 'tools/list', params: {} };

    const first = (await handler(request, {})) as { tools: Array<{ name: string }> };
    expect(first.tools.map((tool) => tool.name)).toEqual(['cache_tool']);

    registered.remove();

    const second = (await handler(request, {})) as { tools: Array<{ name: string }> };
    expect(second.tools).toEqual([]);
  });

  it('reports append-only tools/list growth as a stable prefix', async () => {
    const { server, originalHandler, getInstalledHandler } = createFakeMcpServer();
    const emit = vi.fn();
    installCachedToolListHandler(server, { emit } as any);
    const handler = getInstalledHandler()!;
    const request = { method: 'tools/list', params: {} };

    await handler(request, {}); // session baseline — no event
    expect(emit).not.toHaveBeenCalled();

    originalHandler.mockResolvedValue({
      tools: [
        { name: 'page_navigate', inputSchema: { type: 'object' } },
        { name: 'network_enable', inputSchema: { type: 'object' } },
      ],
    } as any);
    server.sendToolListChanged();
    await handler(request, {});

    expect(emit).toHaveBeenCalledWith(
      'tool.list_prefix_changed',
      expect.objectContaining({
        prefixStable: true,
        commonPrefixTools: 1,
        added: ['network_enable'],
        removed: [],
        reordered: false,
        toolCountBefore: 1,
        toolCountAfter: 2,
        truncated: false,
        timestamp: expect.any(String),
      }),
    );
  });

  it('flags a mid-list removal as a broken prefix', async () => {
    const { server, originalHandler, getInstalledHandler } = createFakeMcpServer();
    const emit = vi.fn();
    installCachedToolListHandler(server, { emit } as any);
    const handler = getInstalledHandler()!;
    const request = { method: 'tools/list', params: {} };

    originalHandler.mockResolvedValue({
      tools: [
        { name: 'a', inputSchema: { type: 'object' } },
        { name: 'b', inputSchema: { type: 'object' } },
      ],
    } as any);
    await handler(request, {});

    originalHandler.mockResolvedValue({
      tools: [{ name: 'a', inputSchema: { type: 'object' } }],
    } as any);
    server.sendToolListChanged();
    await handler(request, {});

    expect(emit).toHaveBeenCalledWith(
      'tool.list_prefix_changed',
      expect.objectContaining({
        prefixStable: false,
        commonPrefixTools: 1,
        removed: ['b'],
        added: [],
      }),
    );
  });

  it('flags a same-name schema mutation as a broken prefix', async () => {
    const { server, originalHandler, getInstalledHandler } = createFakeMcpServer();
    const emit = vi.fn();
    installCachedToolListHandler(server, { emit } as any);
    const handler = getInstalledHandler()!;
    const request = { method: 'tools/list', params: {} };

    await handler(request, {});
    originalHandler.mockResolvedValue({
      tools: [
        {
          name: 'page_navigate',
          description: 'mutated',
          inputSchema: { type: 'object' },
        },
      ],
    } as any);
    server.sendToolListChanged();
    await handler(request, {});

    expect(emit).toHaveBeenCalledWith(
      'tool.list_prefix_changed',
      expect.objectContaining({
        prefixStable: false,
        commonPrefixTools: 0,
        added: [],
        removed: [],
        reordered: false,
      }),
    );
  });

  it('flags a reorder as a broken prefix', async () => {
    const { server, originalHandler, getInstalledHandler } = createFakeMcpServer();
    const emit = vi.fn();
    installCachedToolListHandler(server, { emit } as any);
    const handler = getInstalledHandler()!;
    const request = { method: 'tools/list', params: {} };

    originalHandler.mockResolvedValue({
      tools: [
        { name: 'a', inputSchema: { type: 'object' } },
        { name: 'b', inputSchema: { type: 'object' } },
      ],
    } as any);
    await handler(request, {});

    originalHandler.mockResolvedValue({
      tools: [
        { name: 'b', inputSchema: { type: 'object' } },
        { name: 'a', inputSchema: { type: 'object' } },
      ],
    } as any);
    server.sendToolListChanged();
    await handler(request, {});

    expect(emit).toHaveBeenCalledWith(
      'tool.list_prefix_changed',
      expect.objectContaining({
        prefixStable: false,
        commonPrefixTools: 0,
        reordered: true,
      }),
    );
  });

  it('preserves non-tool fields (nextCursor) when recomputing the list', async () => {
    const { server, originalHandler, getInstalledHandler } = createFakeMcpServer();
    installCachedToolListHandler(server, { emit: vi.fn() } as any);
    const handler = getInstalledHandler()!;
    const request = { method: 'tools/list', params: {} };

    originalHandler.mockResolvedValue({ tools: [], nextCursor: 'page-2' } as any);
    server.sendToolListChanged();

    await expect(handler(request, {})).resolves.toEqual({ tools: [], nextCursor: 'page-2' });
  });

  it('does not emit when a mutation notification leaves the payload unchanged', async () => {
    const { server, getInstalledHandler } = createFakeMcpServer();
    const emit = vi.fn();
    installCachedToolListHandler(server, { emit } as any);
    const handler = getInstalledHandler()!;
    const request = { method: 'tools/list', params: {} };

    await handler(request, {});
    server.sendToolListChanged();
    await handler(request, {});

    expect(emit).not.toHaveBeenCalled();
  });
});

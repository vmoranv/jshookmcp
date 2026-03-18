import { beforeEach, describe, expect, it, vi } from 'vitest';

function tool(name: string, description = `desc_${name}`) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const state = vi.hoisted(() => ({
  createToolHandlerMap: vi.fn((_: unknown, names?: Set<string>) =>
    Object.fromEntries(
      [...(names ?? new Set<string>())].map((name) => [name, vi.fn(async () => ({ name }))])
    )
  ),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({
    content: [{ type: 'text', text }],
  }),
}));

vi.mock('@server/ToolCatalog', () => ({
  allTools: [
    tool('browser_launch', 'Launch browser'),
    tool('page_navigate', 'Navigate page'),
    tool('network_get_requests', 'Get requests'),
  ],
  getToolDomain: (name: string) => {
    if (name === 'page_navigate' || name === 'browser_launch') return 'browser';
    if (name === 'network_get_requests') return 'network';
    return undefined;
  },
}));

vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: state.createToolHandlerMap,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

import {
  activateToolNames,
  handleActivateTools,
  handleDeactivateTools,
} from '@server/MCPServer.search.handlers.activate';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [tool('browser_launch', 'Launch browser')],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map<string, any>(),
    enabledDomains: new Set<string>(),
    activatedRegisteredTools: new Map<string, { remove: ReturnType<typeof vi.fn> }>(),
    router: {
      addHandlers: vi.fn(),
      removeHandler: vi.fn(),
    },
    handlerDeps: {},
    server: {
      sendToolListChanged: vi.fn(async () => undefined),
    },
    registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    ...overrides,
  } as any;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('MCPServer.search.handlers.activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activates built-in tools, registers handlers, and tracks enabled domains', async () => {
    const ctx = createCtx();

    const result = await activateToolNames(ctx, ['page_navigate']);

    expect(result).toEqual({
      activated: ['page_navigate'],
      alreadyActive: [],
      notFound: [],
      totalActive: 2,
    });
    expect(ctx.registerSingleTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'page_navigate' })
    );
    expect(ctx.activatedToolNames.has('page_navigate')).toBe(true);
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(state.createToolHandlerMap).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['page_navigate'])
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ page_navigate: expect.any(Function) })
    );
    expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it('normalizes namespaced extension tools and uses the stored extension handler', async () => {
    const extensionHandler = vi.fn(async () => ({ ok: true }));
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow'),
            handler: extensionHandler,
          },
        ],
      ]),
    });

    const result = await activateToolNames(ctx, ['mcp__jshook__custom_tool']);

    expect(result.activated).toEqual(['custom_tool']);
    expect(result.totalActive).toBe(2);
    expect(state.createToolHandlerMap).not.toHaveBeenCalled();
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
    expect(ctx.extensionToolsByName.get('custom_tool')?.registeredTool).toBeDefined();
    expect(ctx.enabledDomains.has('workflow')).toBe(true);
  });

  it('tracks already-active and missing tool names without notifying the server when nothing changes', async () => {
    const ctx = createCtx({
      activatedToolNames: new Set(['page_navigate']),
    });

    const result = await activateToolNames(ctx, ['page_navigate', 'missing_tool']);

    expect(result).toEqual({
      activated: [],
      alreadyActive: ['page_navigate'],
      notFound: ['missing_tool'],
      totalActive: 2,
    });
    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('downgrades sendToolListChanged failures to warnings during activation', async () => {
    const ctx = createCtx({
      server: {
        sendToolListChanged: vi.fn(async () => {
          throw new Error('notify failed');
        }),
      },
    });

    const result = await activateToolNames(ctx, ['network_get_requests']);

    expect(result.activated).toEqual(['network_get_requests']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      'sendToolListChanged failed:',
      expect.any(Error)
    );
  });

  it('returns validation errors from handleActivateTools', async () => {
    const ctx = createCtx();

    expect(parseResponse(await handleActivateTools(ctx, { names: 'oops' }))).toEqual({
      success: false,
      error: 'names must be an array',
    });
  });

  it('wraps activation results in a success response from handleActivateTools', async () => {
    const ctx = createCtx();

    expect(parseResponse(await handleActivateTools(ctx, { names: ['page_navigate'] }))).toEqual({
      success: true,
      activated: ['page_navigate'],
      alreadyActive: [],
      notFound: [],
      totalActive: 2,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
  });

  it('deactivates tools, removes handlers, and clears extension registration state', async () => {
    const remove = vi.fn();
    const ctx = createCtx({
      activatedToolNames: new Set(['custom_tool']),
      activatedRegisteredTools: new Map([['custom_tool', { remove }]]),
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'workflow',
            tool: tool('custom_tool', 'Custom workflow'),
            registeredTool: { remove },
          },
        ],
      ]),
    });

    expect(
      parseResponse(
        await handleDeactivateTools(ctx, {
          names: ['mcp__jshook__custom_tool', 'missing_tool'],
        })
      )
    ).toEqual({
      success: true,
      deactivated: ['custom_tool'],
      notActivated: ['missing_tool'],
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(ctx.router.removeHandler).toHaveBeenCalledWith('custom_tool');
    expect(ctx.activatedToolNames.has('custom_tool')).toBe(false);
    expect(ctx.extensionToolsByName.get('custom_tool')?.registeredTool).toBeUndefined();
    expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it('warns when tool removal throws but still completes deactivation', async () => {
    const remove = vi.fn(() => {
      throw new Error('remove failed');
    });
    const ctx = createCtx({
      activatedToolNames: new Set(['page_navigate']),
      activatedRegisteredTools: new Map([['page_navigate', { remove }]]),
    });

    const response = parseResponse(await handleDeactivateTools(ctx, { names: ['page_navigate'] }));

    expect(response.deactivated).toEqual(['page_navigate']);
    expect(ctx.router.removeHandler).toHaveBeenCalledWith('page_navigate');
    expect(state.logger.warn).toHaveBeenCalledWith(
      'Failed to remove activated tool "page_navigate":',
      expect.any(Error)
    );
  });

  it('does not notify the server when deactivation finds no active tools', async () => {
    const ctx = createCtx();

    const response = parseResponse(await handleDeactivateTools(ctx, { names: ['missing_tool'] }));

    expect(response).toEqual({
      success: true,
      deactivated: [],
      notActivated: ['missing_tool'],
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    });
    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
  });
});

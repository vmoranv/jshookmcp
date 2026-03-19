import { beforeEach, describe, expect, it, vi } from 'vitest';

function tool(name: string, description = `desc_${name}`) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  };
}

const state = vi.hoisted(() => ({
  getToolsByDomains: vi.fn((domains: string[]) => {
    const builtin = [
      { tool: tool('page_navigate', 'Navigate page'), domain: 'browser' },
      { tool: tool('network_get_requests', 'Get requests'), domain: 'network' },
    ];
    return builtin.filter((entry) => domains.includes(entry.domain)).map((entry) => entry.tool);
  }),
  createToolHandlerMap: vi.fn((_: unknown, names?: Set<string>) =>
    Object.fromEntries(
      [...(names ?? new Set<string>())].map((name) => [name, vi.fn(async () => ({ name }))])
    )
  ),
  startDomainTtl: vi.fn(),
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
  getToolsByDomains: state.getToolsByDomains,
}));

vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: state.createToolHandlerMap,
}));

vi.mock('@server/registry/index', () => ({
  getAllDomains: () => new Set(['browser', 'network']),
}));

vi.mock('@server/MCPServer.activation.ttl', () => ({
  startDomainTtl: state.startDomainTtl,
}));

vi.mock('@src/constants', () => ({
  ACTIVATION_TTL_MINUTES: 45,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    selectedTools: [],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map<string, any>(),
    enabledDomains: new Set<string>(),
    activatedRegisteredTools: new Map<string, unknown>(),
    router: {
      addHandlers: vi.fn(),
    },
    handlerDeps: {},
    registerSingleTool: vi.fn((toolDef: { name: string }) => ({
      remove: vi.fn(),
      name: toolDef.name,
    })),
    server: {
      sendToolListChanged: vi.fn(async () => undefined),
    },
    ...overrides,
  } as any;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('MCPServer.search.handlers.domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates missing and unknown domains', async () => {
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'custom',
            tool: tool('custom_tool', 'Custom workflow'),
          },
        ],
      ]),
    });

    expect(parseResponse(await handleActivateDomain(ctx, {}))).toEqual({
      success: false,
      error: 'domain must be a non-empty string',
    });
    expect(parseResponse(await handleActivateDomain(ctx, { domain: 'missing' }))).toEqual({
      success: false,
      error: 'Unknown domain "missing". Valid: browser, network, custom',
    });
  });

  it('activates built-in and extension tools for a domain and starts TTL tracking', async () => {
    const extensionHandler = vi.fn(async () => ({ ok: true }));
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'browser_custom',
          {
            name: 'browser_custom',
            domain: 'browser',
            tool: tool('browser_custom', 'Browser custom'),
            handler: extensionHandler,
          },
        ],
      ]),
    });

    const response = parseResponse(await handleActivateDomain(ctx, { domain: 'browser' }));

    expect(response).toEqual({
      success: true,
      domain: 'browser',
      activated: 2,
      activatedTools: ['page_navigate', 'browser_custom'],
      totalDomainTools: 2,
      ttlMinutes: 45,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
    expect(ctx.registerSingleTool).toHaveBeenCalledTimes(2);
    expect(state.createToolHandlerMap).toHaveBeenCalledWith(
      ctx.handlerDeps,
      new Set(['page_navigate'])
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ page_navigate: expect.any(Function) })
    );
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ browser_custom: extensionHandler });
    expect(state.startDomainTtl).toHaveBeenCalledWith(ctx, 'browser', 45, [
      'page_navigate',
      'browser_custom',
    ]);
    expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it('accepts extension-only domains that are not part of the built-in domain list', async () => {
    const extensionHandler = vi.fn(async () => ({ ok: true }));
    const ctx = createCtx({
      extensionToolsByName: new Map([
        [
          'custom_tool',
          {
            name: 'custom_tool',
            domain: 'custom',
            tool: tool('custom_tool', 'Custom workflow'),
            handler: extensionHandler,
          },
        ],
      ]),
    });

    const response = parseResponse(await handleActivateDomain(ctx, { domain: 'custom' }));

    expect(response).toEqual({
      success: true,
      domain: 'custom',
      activated: 1,
      activatedTools: ['custom_tool'],
      totalDomainTools: 1,
      ttlMinutes: 45,
      hint: 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke them.',
    });
    expect(ctx.router.addHandlers).toHaveBeenCalledWith({ custom_tool: extensionHandler });
  });

  it('skips already-active tools and avoids TTL or notification when nothing new is activated', async () => {
    const ctx = createCtx({
      selectedTools: [tool('page_navigate', 'Navigate page')],
      activatedToolNames: new Set(['browser_custom']),
      extensionToolsByName: new Map([
        [
          'browser_custom',
          {
            name: 'browser_custom',
            domain: 'browser',
            tool: tool('browser_custom', 'Browser custom'),
            handler: vi.fn(),
          },
        ],
      ]),
    });

    const response = parseResponse(await handleActivateDomain(ctx, { domain: 'browser' }));

    expect(response).toEqual({
      success: true,
      domain: 'browser',
      activated: 0,
      activatedTools: [],
      totalDomainTools: 2,
      ttlMinutes: 45,
    });
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(ctx.registerSingleTool).not.toHaveBeenCalled();
    expect(state.createToolHandlerMap).not.toHaveBeenCalled();
    expect(state.startDomainTtl).not.toHaveBeenCalled();
    expect(ctx.server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('passes ttlMinutes=0 through to TTL tracking and downgrades notify failures to warnings', async () => {
    const ctx = createCtx({
      server: {
        sendToolListChanged: vi.fn(async () => {
          throw new Error('notify failed');
        }),
      },
    });

    const response = parseResponse(
      await handleActivateDomain(ctx, { domain: 'browser', ttlMinutes: 0 })
    );

    expect(response.ttlMinutes).toBe('no expiry');
    expect(state.startDomainTtl).toHaveBeenCalledWith(ctx, 'browser', 0, ['page_navigate']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      'sendToolListChanged failed:',
      expect.any(Error)
    );
  });
});

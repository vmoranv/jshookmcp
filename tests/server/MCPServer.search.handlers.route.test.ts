import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  routeToolRequest: vi.fn(),
  describeTool: vi.fn(),
  buildCallToolCommand: vi.fn(
    (name: string, _schema: unknown) => `call_tool({ name: "${name}", args: {} })`
  ),
  activateToolNames: vi.fn(),
  handleActivateDomain: vi.fn(),
  getSearchEngine: vi.fn(() => ({ kind: 'engine' })),
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({
    content: [{ type: 'text', text }],
  }),
}));

vi.mock('@server/ToolRouter', () => ({
  routeToolRequest: state.routeToolRequest,
  describeTool: state.describeTool,
  buildCallToolCommand: state.buildCallToolCommand,
}));

vi.mock('@server/MCPServer.search.handlers.activate', () => ({
  activateToolNames: state.activateToolNames,
}));

vi.mock('@server/MCPServer.search.handlers.domain', () => ({
  handleActivateDomain: state.handleActivateDomain,
}));

vi.mock('@server/MCPServer.search.helpers', () => ({
  getSearchEngine: state.getSearchEngine,
}));

vi.mock('@src/constants', () => ({
  ACTIVATION_TTL_MINUTES: 30,
}));

import { handleDescribeTool, handleRouteTool } from '@server/MCPServer.search.handlers.route';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    enabledDomains: new Set<string>(),
    activatedToolNames: new Set<string>(),
    ...overrides,
  } as any;
}

function parseResponse(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('MCPServer.search.handlers.route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSearchEngine.mockReturnValue({ kind: 'engine' });
    state.activateToolNames.mockResolvedValue({
      activated: [],
      alreadyActive: [],
      notFound: [],
      totalActive: 0,
    });
    state.handleActivateDomain.mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });
  });

  it('rejects invalid route_tool requests', async () => {
    const ctx = createCtx();

    expect(parseResponse(await handleRouteTool(ctx, {}))).toEqual({
      success: false,
      error: 'task must be a non-empty string',
    });
  });

  it('passes through route results when autoActivate is disabled', async () => {
    const ctx = createCtx();
    state.routeToolRequest.mockResolvedValueOnce({
      recommendations: [],
      nextActions: [{ step: 1, action: 'call', command: 'page_navigate', description: 'Call it' }],
    });

    const response = parseResponse(
      await handleRouteTool(ctx, {
        task: 'navigate to a page',
        context: { autoActivate: false },
      })
    );

    expect(response).toEqual({
      recommendations: [],
      nextActions: [{ step: 1, action: 'call', command: 'page_navigate', description: 'Call it' }],
    });
    expect(state.routeToolRequest).toHaveBeenCalledOnce();
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).not.toHaveBeenCalled();
  });

  it('auto-activates inactive recommendation domains and reroutes with autoActivate disabled', async () => {
    const ctx = createCtx();
    state.routeToolRequest
      .mockResolvedValueOnce({
        recommendations: [
          { name: 'page_navigate', domain: 'browser', isActive: false },
          { name: 'network_get_requests', domain: 'network', isActive: false },
        ],
        nextActions: [],
      })
      .mockResolvedValueOnce({
        recommendations: [
          { name: 'page_navigate', domain: 'browser', isActive: true },
          { name: 'network_get_requests', domain: 'network', isActive: true },
        ],
        nextActions: [
          { step: 1, action: 'call', command: 'page_navigate', description: 'Call it' },
        ],
      });
    state.handleActivateDomain.mockImplementation(async (innerCtx: any, args: any) => {
      if (args.domain === 'browser') {
        innerCtx.enabledDomains.add('browser');
        innerCtx.activatedToolNames.add('page_navigate');
      }
      if (args.domain === 'network') {
        innerCtx.enabledDomains.add('network');
        innerCtx.activatedToolNames.add('network_get_requests');
      }
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    });

    const response = parseResponse(await handleRouteTool(ctx, { task: 'inspect requests' }));

    expect(state.handleActivateDomain).toHaveBeenNthCalledWith(1, ctx, {
      domain: 'browser',
      ttlMinutes: 30,
    });
    expect(state.handleActivateDomain).toHaveBeenNthCalledWith(2, ctx, {
      domain: 'network',
      ttlMinutes: 30,
    });
    expect(state.activateToolNames).not.toHaveBeenCalled();
    expect(state.routeToolRequest).toHaveBeenNthCalledWith(
      2,
      { task: 'inspect requests', context: { autoActivate: false } },
      ctx,
      { kind: 'engine' }
    );
    expect(response.autoActivated).toBe(true);
    expect(response.activatedNames).toEqual(['page_navigate', 'network_get_requests']);
  });

  it('activates tools individually for recommendations without a domain or already-enabled domains', async () => {
    const ctx = createCtx({
      enabledDomains: new Set(['browser']),
    });
    state.routeToolRequest
      .mockResolvedValueOnce({
        recommendations: [
          { name: 'page_navigate', domain: 'browser', isActive: false },
          { name: 'page_navigate', domain: 'browser', isActive: false },
          { name: 'custom_tool', domain: null, isActive: false },
        ],
        nextActions: [],
      })
      .mockResolvedValueOnce({
        recommendations: [
          { name: 'page_navigate', domain: 'browser', isActive: true },
          { name: 'custom_tool', domain: null, isActive: true },
        ],
        nextActions: [{ step: 1, action: 'call', command: 'custom_tool', description: 'Call it' }],
      });
    state.activateToolNames.mockImplementation(async (innerCtx: any, names: string[]) => {
      for (const name of names) innerCtx.activatedToolNames.add(name);
      return {
        activated: names,
        alreadyActive: [],
        notFound: [],
        totalActive: innerCtx.activatedToolNames.size,
      };
    });

    const response = parseResponse(await handleRouteTool(ctx, { task: 'use custom helper' }));

    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).toHaveBeenCalledWith(ctx, ['page_navigate', 'custom_tool']);
    expect(response.autoActivated).toBe(true);
    expect(response.activatedNames).toEqual(['page_navigate', 'page_navigate', 'custom_tool']);
  });

  it('returns the original route response when activation fails and nothing becomes active', async () => {
    const ctx = createCtx();
    state.routeToolRequest.mockResolvedValueOnce({
      recommendations: [{ name: 'page_navigate', domain: 'browser', isActive: false }],
      nextActions: [],
    });
    state.handleActivateDomain.mockRejectedValueOnce(new Error('activate failed'));

    const response = parseResponse(await handleRouteTool(ctx, { task: 'navigate' }));

    expect(state.routeToolRequest).toHaveBeenCalledOnce();
    expect(state.activateToolNames).not.toHaveBeenCalled();
    expect(response).toEqual({
      recommendations: [
        {
          name: 'page_navigate',
          domain: 'browser',
          isActive: false,
          callCommand: 'call_tool({ name: "page_navigate", args: {} })',
        },
      ],
      nextActions: [],
    });
  });

  it('rejects invalid describe_tool requests', async () => {
    const ctx = createCtx();

    expect(parseResponse(await handleDescribeTool(ctx, {}))).toEqual({
      success: false,
      error: 'name must be a non-empty string',
    });
  });

  it('returns not found when describe_tool cannot resolve a tool', async () => {
    const ctx = createCtx();
    state.describeTool.mockReturnValueOnce(undefined);

    expect(parseResponse(await handleDescribeTool(ctx, { name: 'missing_tool' }))).toEqual({
      success: false,
      error: 'Tool not found: missing_tool',
    });
  });

  it('returns tool details from describe_tool', async () => {
    const ctx = createCtx();
    state.describeTool.mockReturnValueOnce({
      name: 'page_navigate',
      description: 'Navigate page',
      inputSchema: { type: 'object', properties: {} },
    });

    expect(parseResponse(await handleDescribeTool(ctx, { name: 'page_navigate' }))).toEqual({
      success: true,
      tool: {
        name: 'page_navigate',
        description: 'Navigate page',
        inputSchema: { type: 'object', properties: {} },
      },
    });
  });
});

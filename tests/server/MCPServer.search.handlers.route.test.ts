import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  routeToolRequest: vi.fn(),
  describeTool: vi.fn(),
  buildCallToolCommand: vi.fn(
    (name: string, _schema: any) => `call_tool({ name: "${name}", args: {} })`,
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

vi.mock('@src/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/constants')>()),
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
      }),
    );

    expect(response).toEqual({
      recommendations: [],
      nextActions: [{ step: 1, action: 'call', command: 'page_navigate', description: 'Call it' }],
    });
    expect(state.routeToolRequest).toHaveBeenCalledOnce();
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).not.toHaveBeenCalled();
  });

  it('does not auto-activate when autoActivate is not explicitly true', async () => {
    const ctx = createCtx();
    state.routeToolRequest.mockResolvedValueOnce({
      recommendations: [
        { name: 'page_navigate', domain: 'browser', isActive: false },
        { name: 'network_get_requests', domain: 'network', isActive: false },
      ],
      nextActions: [],
    });

    const response = parseResponse(await handleRouteTool(ctx, { task: 'inspect requests' }));

    // autoActivate defaults to false — no domain/tool activation should occur
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).not.toHaveBeenCalled();
    expect(state.routeToolRequest).toHaveBeenCalledOnce();
    expect(response.autoActivated).toBeUndefined();
  });

  it('does not auto-activate tools when autoActivate is not explicit', async () => {
    const ctx = createCtx({
      enabledDomains: new Set(['browser']),
    });
    state.routeToolRequest.mockResolvedValueOnce({
      recommendations: [
        { name: 'page_navigate', domain: 'browser', isActive: false },
        { name: 'custom_tool', domain: null, isActive: false },
      ],
      nextActions: [],
    });

    const response = parseResponse(await handleRouteTool(ctx, { task: 'use custom helper' }));

    // autoActivate defaults to false — no activation should occur
    expect(state.handleActivateDomain).not.toHaveBeenCalled();
    expect(state.activateToolNames).not.toHaveBeenCalled();
    expect(state.routeToolRequest).toHaveBeenCalledOnce();
    expect(response.autoActivated).toBeUndefined();
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

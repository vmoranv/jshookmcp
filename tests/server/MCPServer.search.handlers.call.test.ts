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
  handleActivateTools: vi.fn(),
  handleDeactivateTools: vi.fn(),
  ensureAllDomainsLoaded: vi.fn(),
  getToolInputSchema: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({
    content: [{ type: 'text', text }],
  }),
  asErrorResponse: (error: unknown) => ({
    content: [
      { type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` },
    ],
    isError: true,
  }),
}));

vi.mock('@server/MCPServer.search.validation', () => ({
  normalizeToolName: state.normalizeToolName,
}));

vi.mock('@server/MCPServer.search.helpers', () => ({
  getToolByName: state.getToolByName,
  getSearchEngine: state.getSearchEngine,
  // coverage_report dispatch calls the real handler, which resolves the budget
  // snapshot through this module.
  getActivationBudgetSnapshot: vi.fn(async () => ({
    activeTools: 0,
    estimatedTokens: 0,
    budget: 30_000,
    maxTools: 50,
    headroom: 30_000,
  })),
}));

vi.mock('@server/MCPServer.search.handlers.activate', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  activateToolNames: state.activateToolNames,
  handleActivateTools: state.handleActivateTools,
  handleDeactivateTools: state.handleDeactivateTools,
}));

vi.mock('@server/registry/SearchCatalog', () => ({
  // The real catalog depends on registry state that this suite mocks away;
  // the call handler only needs entryByName lookups for auto-activation.
  // `crypto_test_harness` is deliberately here to keep the near-miss
  // suggestions honest: it shares the generic token "test" with `test_tool`
  // but is not a typo of it, so it must never be suggested.
  loadSearchCatalog: vi.fn(async () => ({
    entryByName: new Map([
      ['binary_decode', { name: 'binary_decode', domain: 'encoding' }],
      ['crypto_test_harness', { name: 'crypto_test_harness', domain: 'core' }],
    ]),
    toolByName: new Map(),
    domainByToolName: new Map([
      ['binary_decode', 'encoding'],
      ['crypto_test_harness', 'core'],
    ]),
    tools: [],
    sceneKeywordsByToolName: new Map(),
  })),
}));

vi.mock('@server/registry/index', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureAllDomainsLoaded: state.ensureAllDomainsLoaded.mockResolvedValue(undefined),
  getAllDomains: vi.fn(() => new Set(['browser'])),
}));

vi.mock('@server/ToolRouter.probe', () => ({
  getToolInputSchema: state.getToolInputSchema,
}));

import { handleCallTool } from '@server/MCPServer.search.handlers.call';
import { ToolCallContextGuard } from '@server/ToolCallContextGuard';

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
    state.getToolInputSchema.mockReturnValue({ type: 'object', properties: {} });
    state.getToolByName.mockReturnValue(new Map([['test_tool', tool('test_tool')]]));
    state.activateToolNames.mockResolvedValue({
      activated: ['test_tool'],
      alreadyActive: [],
      notFound: [],
      budgetExceeded: [],
      totalActive: 1,
      budget: { usedTokens: 0, maxTokens: 30_000, activeTools: 1, maxTools: 50 },
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

  it('validates args against tool schema before execution', async () => {
    state.getToolInputSchema.mockReturnValue({
      type: 'object',
      properties: {
        url: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['url', 'count'],
    });
    const ctx = createCtx();

    const response = await handleCallTool(ctx, {
      name: 'test_tool',
      args: { url: 'https://example.com', count: '5' },
    });
    const result = parseResponse(response);

    expect(result.result).toBe('ok');
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', {
      url: 'https://example.com',
      count: 5,
    });
  });

  it('returns a clear validation error when required args are missing', async () => {
    state.getToolInputSchema.mockReturnValue({
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    });
    const ctx = createCtx();

    const response = await handleCallTool(ctx, {
      name: 'test_tool',
      args: {},
    });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments for "test_tool"');
    expect(result.error).toContain('url');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
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

  it('parses JSON arguments wrapper', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, {
      name: 'test_tool',
      arguments: '{"key": "value"}',
    });
    const result = parseResponse(response);

    expect(result.result).toBe('ok');
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', { key: 'value' });
  });

  it('accepts an object-valued arguments wrapper', async () => {
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'test_tool', arguments: { key: 'value' } });

    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('test_tool', { key: 'value' });
  });

  it('reports an empty arguments string instead of silently dropping it', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, { name: 'test_tool', arguments: '' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('non-empty JSON string');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('reports malformed arguments JSON instead of silently dropping it', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, { name: 'test_tool', arguments: '{broken' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid JSON');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('reports arguments JSON that is not an object', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, { name: 'test_tool', arguments: '123' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('JSON object');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('reports a name absent from the catalog as non-existent, not as inactive', async () => {
    // Regression: an unknown name used to report "is not currently active",
    // which sends the caller to activate_tools for a tool that can never
    // activate. "does not exist" and "exists but inactive" must read
    // differently, because the recovery is different.
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
    expect(result.error).toContain('search_tools');
    expect(result.error).not.toContain('not currently active');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('suggests near-miss catalog names for an unknown tool', async () => {
    // 'binary_decod' is one character away from the only catalog entry,
    // 'binary_decode' — the error should name it instead of dead-ending.
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'binary_decod' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Did you mean');
    expect(result.suggestions).toContain('binary_decode');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('does not suggest a candidate that only shares a generic token', async () => {
    // Regression: token-overlap scoring suggested `crypto_test_harness` for
    // `test_tool` because both contain "test". A wrong "Did you mean" is its
    // own misleading error, so similarity is gated on edit distance instead.
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('Did you mean');
    expect(result.suggestions).toBeUndefined();
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('reports an activation failure distinctly from an unknown tool', async () => {
    // A throwing activation is an infrastructure failure, not a bad name: the
    // caller should retry rather than go hunting for a different tool.
    state.activateToolNames.mockRejectedValue(new Error('registry offline'));
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
      enabledDomains: new Set(['encoding']),
    });

    const response = await handleCallTool(ctx, { name: 'binary_decode' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be activated');
    expect(result.error).toContain('registry offline');
    expect(result.error).not.toContain('does not exist');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('reports budget-blocked activation accurately instead of a misleading Unknown tool', async () => {
    // Regression: activateToolNames silently SKIPS tools over the activation
    // budget; the old code discarded the summary and unconditionally claimed
    // activatedTools=[name], then failed the dispatch with "Unknown tool".
    // 'binary_decode' exists in the real search catalog, so auto-activation
    // reaches the budget check.
    state.activateToolNames.mockResolvedValue({
      activated: [],
      alreadyActive: [],
      notFound: [],
      budgetExceeded: ['binary_decode'],
      totalActive: 50,
      budget: { usedTokens: 9_787, maxTokens: 30_000, activeTools: 50, maxTools: 50 },
    });
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
      enabledDomains: new Set<string>(),
    });

    const response = await handleCallTool(ctx, { name: 'binary_decode', args: {} });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be auto-activated');
    expect(result.error).toContain('activation budget');
    expect(result.error).toContain('MCP_TOOL_ACTIVATION_BUDGET_TOKENS');
    expect(result.error).toContain('binary_decode');
    // No false claims about activation, and nothing was dispatched.
    expect(result.wasAutoActivated).toBe(false);
    expect(result.activatedTools).toEqual([]);
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('returns error with tool name in message when not active', async () => {
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'some_fancy_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('some_fancy_tool');
  });

  it('suggests activate_tools or activate_domain when a known tool is not active', async () => {
    // 'binary_decode' is the only name in the mocked catalog, so it reaches
    // the activation branch instead of the unknown-name early return. Its
    // domain is pre-enabled to skip domain activation and hit individual
    // activation directly.
    state.activateToolNames.mockResolvedValue({
      activated: [],
      alreadyActive: [],
      notFound: [],
      budgetExceeded: [],
      totalActive: 0,
      budget: { usedTokens: 0, maxTokens: 30_000, activeTools: 0, maxTools: 50 },
    });
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
      enabledDomains: new Set(['encoding']),
    });

    const response = await handleCallTool(ctx, { name: 'binary_decode' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('binary_decode');
    expect(result.error).toContain('exists but is not active');
    expect(result.error).toContain('activate_tools');
    expect(result.error).toContain('activate_domain');
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('returns error for inactive tool even if activation is configured', async () => {
    // Even with activate success configured, the handler should not call it
    const ctx = createCtx({
      router: { has: vi.fn(() => false) },
    });

    const response = await handleCallTool(ctx, { name: 'test_tool' });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(state.activateToolNames).not.toHaveBeenCalled();
  });

  it('dispatches deactivate_tools to its meta handler with parsed args', async () => {
    state.handleDeactivateTools.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, deactivated: ['page_navigate'], notActivated: [] }),
        },
      ],
    });
    const ctx = createCtx();

    const response = await handleCallTool(ctx, {
      name: 'deactivate_tools',
      args: { names: ['page_navigate'] },
    });
    const result = parseResponse(response);

    expect(state.handleDeactivateTools).toHaveBeenCalledTimes(1);
    expect(state.handleDeactivateTools).toHaveBeenCalledWith(ctx, { names: ['page_navigate'] });
    expect(result.success).toBe(true);
    expect(result.deactivated).toEqual(['page_navigate']);
    expect(result.wasAutoActivated).toBe(false);
    expect(ctx.router.has).not.toHaveBeenCalled();
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('dispatches coverage_report to its meta handler and returns the summary', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, { name: 'coverage_report' });
    const result = parseResponse(response);

    expect(state.ensureAllDomainsLoaded).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.calledCount).toBe(0);
    expect(result.wasAutoActivated).toBe(false);
    expect(ctx.router.has).not.toHaveBeenCalled();
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('returns an error instead of recursing when call_tool targets itself', async () => {
    const ctx = createCtx();

    const response = await handleCallTool(ctx, {
      name: 'call_tool',
      args: { name: 'deactivate_tools' },
    });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('directly as a top-level tool');
    expect(state.handleDeactivateTools).not.toHaveBeenCalled();
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
  });

  it('matches the direct-call failure shape when a dispatched meta tool throws', async () => {
    state.handleDeactivateTools.mockRejectedValue(new Error('deactivate boom'));
    const ctx = createCtx();

    const response = await handleCallTool(ctx, {
      name: 'deactivate_tools',
      args: { names: ['page_navigate'] },
    });

    expect(response.isError).toBe(true);
    // Direct meta-tool failures return `Error: <message>` via asErrorResponse.
    expect(response.content[0]).toMatchObject({ type: 'text', text: 'Error: deactivate boom' });
    expect(state.logger.error).toHaveBeenCalled();
  });

  it('does not record engine feedback manually (moved to execution pipeline)', async () => {
    const recordToolCallFeedback = vi.fn();
    state.getSearchEngine.mockReturnValue({ recordToolCallFeedback });
    const ctx = createCtx();

    await handleCallTool(ctx, { name: 'test_tool' });

    // The call_tool proxy dispatches via executeToolWithTracking, which now
    // records search-engine feedback (vector weight + recency) for BOTH the
    // direct-call and proxy paths. A manual record here would double-count
    // the learning signal.
    expect(recordToolCallFeedback).not.toHaveBeenCalled();
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
    // @ts-expect-error
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
    // @ts-expect-error
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
    // @ts-expect-error
    const textResult = JSON.parse(response.content[1].text);
    expect(textResult.data).toBe('test');
    expect(textResult.wasAutoActivated).toBe(false);
  });

  it('gates dispatched meta tools through the toolExecution rules before dispatch', async () => {
    const emit = vi.fn(async () => undefined);
    const ctx = createCtx({
      config: {
        toolExecution: { allowTools: [], rules: [{ tool: 'deactivate_tools', action: 'deny' }] },
      },
      eventBus: { emit },
    });
    state.handleDeactivateTools.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, deactivated: [] }) }],
    });

    const response = await handleCallTool(ctx, {
      name: 'deactivate_tools',
      args: { names: ['page_navigate'] },
    });

    expect(response.isError).toBe(true);
    const result = parseResponse(response);
    expect(result.success).toBe(false);
    expect(result.deniedBy).toEqual({ tool: 'deactivate_tools', action: 'deny' });
    // call_tool carries its dispatch metadata on the gate denial too.
    expect(result.wasAutoActivated).toBe(false);
    expect(state.handleDeactivateTools).not.toHaveBeenCalled();
    expect(ctx.executeToolWithTracking).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'tool.gate.denied',
      expect.objectContaining({ toolName: 'deactivate_tools', source: 'rules' }),
    );
  });

  it('applies the doom-loop breaker to repeated identical dispatched meta calls', async () => {
    state.handleDeactivateTools.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, deactivated: [] }) }],
    });
    const ctx = createCtx({ contextGuard: new ToolCallContextGuard(() => null) });

    for (let i = 0; i < 4; i++) {
      const response = await handleCallTool(ctx, {
        name: 'deactivate_tools',
        args: { names: ['page_navigate'] },
      });
      expect(response.isError).not.toBe(true);
    }
    const blocked = await handleCallTool(ctx, {
      name: 'deactivate_tools',
      args: { names: ['page_navigate'] },
    });

    expect(blocked.isError).toBe(true);
    const result = parseResponse(blocked);
    expect(result.doomLoop).toEqual({
      toolName: 'deactivate_tools',
      consecutiveCount: 5,
      threshold: 5,
    });
    expect(state.handleDeactivateTools).toHaveBeenCalledTimes(4);
  });

  it('keeps the call_tool self-reference rejection ahead of the gate', async () => {
    const ctx = createCtx({
      config: {
        toolExecution: { allowTools: [], rules: [{ tool: 'deactivate_tools', action: 'deny' }] },
      },
    });

    const response = await handleCallTool(ctx, {
      name: 'call_tool',
      args: { name: 'deactivate_tools' },
    });
    const result = parseResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toContain('directly as a top-level tool');
    expect(state.handleDeactivateTools).not.toHaveBeenCalled();
  });
});

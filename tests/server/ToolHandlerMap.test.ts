import { describe, expect, it, vi } from 'vitest';
import {
  HANDLED_TOOL_NAMES,
  createToolHandlerMap,
  type ToolHandlerMapDependencies,
} from '../../src/server/ToolHandlerMap.js';

function createDeps(): { deps: ToolHandlerMapDependencies; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    handleGetTokenBudgetStats: vi.fn(async () => ({ ok: 'budget' })),
    handlePageNavigate: vi.fn(async (args: unknown) => ({ ok: 'navigate', args })),
    handleNetworkGetRequests: vi.fn(async (args: unknown) => ({ ok: 'network', args })),
  };

  const deps: ToolHandlerMapDependencies = {
    browserHandlers: {
      handlePageNavigate: spies.handlePageNavigate,
    } as any,
    debuggerHandlers: {} as any,
    advancedHandlers: {
      handleNetworkGetRequests: spies.handleNetworkGetRequests,
    } as any,
    aiHookHandlers: {} as any,
    hookPresetHandlers: {} as any,
    coreAnalysisHandlers: {} as any,
    coreMaintenanceHandlers: {
      handleGetTokenBudgetStats: spies.handleGetTokenBudgetStats,
    } as any,
    processHandlers: {} as any,
    workflowHandlers: {} as any,
    wasmHandlers: {} as any,
    streamingHandlers: {} as any,
    encodingHandlers: {} as any,
    antidebugHandlers: {} as any,
    graphqlHandlers: {} as any,
    platformHandlers: {} as any,
    sourcemapHandlers: {} as any,
    transformHandlers: {} as any,
  };

  return { deps, spies };
}

describe('ToolHandlerMap', () => {
  it('exposes known handled tool names', () => {
    expect(HANDLED_TOOL_NAMES.has('get_token_budget_stats')).toBe(true);
    expect(HANDLED_TOOL_NAMES.has('page_navigate')).toBe(true);
    expect(HANDLED_TOOL_NAMES.has('network_get_requests')).toBe(true);
  });

  it('creates filtered map when selectedToolNames is provided', () => {
    const { deps } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['page_navigate', 'get_token_budget_stats']));

    expect(Object.keys(map).sort()).toEqual(['get_token_budget_stats', 'page_navigate']);
  });

  it('mapped browser handler delegates with original args', async () => {
    const { deps, spies } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['page_navigate']));

    const payload = { url: 'https://example.com' };
    await expect(map.page_navigate?.(payload)).resolves.toEqual({
      ok: 'navigate',
      args: payload,
    });
    expect(spies.handlePageNavigate).toHaveBeenCalledWith(payload);
  });

  it('mapped maintenance handler works without args contract', async () => {
    const { deps, spies } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['get_token_budget_stats']));

    await expect(map.get_token_budget_stats?.({ ignored: true } as any)).resolves.toEqual({
      ok: 'budget',
    });
    expect(spies.handleGetTokenBudgetStats).toHaveBeenCalledOnce();
  });

  it('returns empty map for unknown selected names', () => {
    const { deps } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['totally_unknown']));
    expect(map).toEqual({});
  });

  it('returns full binding map when no filter is provided', () => {
    const { deps } = createDeps();
    const map = createToolHandlerMap(deps);
    expect(Object.keys(map).length).toBe(HANDLED_TOOL_NAMES.size);
  });
});


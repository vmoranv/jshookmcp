import { describe, expect, it, vi } from 'vitest';
import {
  getHandledToolNames,
  createToolHandlerMap,
  type ToolHandlerMapDependencies,
} from '@server/ToolHandlerMap';

function createDeps(): {
  deps: ToolHandlerMapDependencies;
  spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    handleGetTokenBudgetStats: vi.fn(async () => ({ ok: 'budget' })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageNavigate: vi.fn(async (args: any) => ({ ok: 'navigate', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleNetworkGetRequests: vi.fn(async (args: any) => ({ ok: 'network', args })),
  };

  const deps: ToolHandlerMapDependencies = {
    browserHandlers: {
      handlePageNavigate: spies.handlePageNavigate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    debuggerHandlers: {} as any,
    advancedHandlers: {
      handleNetworkGetRequests: spies.handleNetworkGetRequests,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    aiHookHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    hookPresetHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    coreAnalysisHandlers: {} as any,
    coreMaintenanceHandlers: {
      handleGetTokenBudgetStats: spies.handleGetTokenBudgetStats,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    processHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    workflowHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    wasmHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    streamingHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    encodingHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    antidebugHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    graphqlHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    platformHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    sourcemapHandlers: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    transformHandlers: {} as any,
  };

  return { deps, spies };
}

describe('ToolHandlerMap', () => {
  it('exposes known handled tool names', () => {
    const names = getHandledToolNames();
    expect(names.has('get_token_budget_stats')).toBe(true);
    expect(names.has('page_navigate')).toBe(true);
    expect(names.has('network_get_requests')).toBe(true);
  });

  it('creates filtered map when selectedToolNames is provided', () => {
    const { deps } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['page_navigate', 'get_token_budget_stats']));

    expect(Object.keys(map).toSorted()).toEqual(['get_token_budget_stats', 'page_navigate']);
  });

  it('mapped browser handler delegates with original args', async () => {
    const { deps, spies } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['page_navigate']));

    const payload = { url: 'https://vmoranv.github.io/jshookmcp' };
    await expect(map.page_navigate?.(payload)).resolves.toEqual({
      ok: 'navigate',
      args: payload,
    });
    expect(spies.handlePageNavigate).toHaveBeenCalledWith(payload);
  });

  it('mapped maintenance handler works without args contract', async () => {
    const { deps, spies } = createDeps();
    const map = createToolHandlerMap(deps, new Set(['get_token_budget_stats']));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    expect(Object.keys(map).length).toBe(getHandledToolNames().size);
  });
});

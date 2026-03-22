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
    handlePageNavigate: vi.fn(async (args: unknown) => ({ ok: 'navigate', args })),
    handleNetworkGetRequests: vi.fn(async (args: unknown) => ({ ok: 'network', args })),
  };

  const deps: ToolHandlerMapDependencies = {
    browserHandlers: {
      handlePageNavigate: spies.handlePageNavigate,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any,
    debuggerHandlers: {} as unknown,
    advancedHandlers: {
      handleNetworkGetRequests: spies.handleNetworkGetRequests,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any,
    aiHookHandlers: {} as unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    hookPresetHandlers: {} as any,
    coreAnalysisHandlers: {} as unknown,
    coreMaintenanceHandlers: {
      handleGetTokenBudgetStats: spies.handleGetTokenBudgetStats,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any,
    processHandlers: {} as unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    workflowHandlers: {} as any,
    wasmHandlers: {} as unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    streamingHandlers: {} as any,
    encodingHandlers: {} as unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    antidebugHandlers: {} as any,
    graphqlHandlers: {} as unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    platformHandlers: {} as any,
    sourcemapHandlers: {} as unknown,
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

    expect(Object.keys(map).sort()).toEqual(['get_token_budget_stats', 'page_navigate']);
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

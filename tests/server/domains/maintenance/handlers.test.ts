import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoreMaintenanceHandlers } from '../../../../src/server/domains/maintenance/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('CoreMaintenanceHandlers', () => {
  const tokenBudget = {
    getStats: vi.fn(),
    manualCleanup: vi.fn(),
    reset: vi.fn(),
  } as any;

  const unifiedCache = {
    getGlobalStats: vi.fn(),
    smartCleanup: vi.fn(),
    clearAll: vi.fn(),
  } as any;

  let handlers: CoreMaintenanceHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new CoreMaintenanceHandlers({ tokenBudget, unifiedCache });
  });

  it('returns token budget stats with sessionDuration', async () => {
    tokenBudget.getStats.mockReturnValue({
      currentUsage: 10,
      maxTokens: 100,
      usagePercentage: 10,
      sessionStartTime: Date.now() - 1200,
    });

    const body = parseJson(await handlers.handleGetTokenBudgetStats());
    expect(body.success).toBe(true);
    expect(body.sessionDuration).toMatch(/s$/);
  });

  it('returns serialized error when reading stats fails', async () => {
    tokenBudget.getStats.mockImplementation(() => {
      throw new Error('boom');
    });

    const body = parseJson(await handlers.handleGetTokenBudgetStats());
    expect(body.success).toBe(false);
    expect(body.error).toBe('boom');
  });

  it('manual cleanup computes freed tokens', async () => {
    tokenBudget.getStats
      .mockReturnValueOnce({ currentUsage: 80, usagePercentage: 40, maxTokens: 200, sessionStartTime: 1 })
      .mockReturnValueOnce({ currentUsage: 30, usagePercentage: 15, maxTokens: 200, sessionStartTime: 1 });

    const body = parseJson(await handlers.handleManualTokenCleanup());
    expect(tokenBudget.manualCleanup).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.freed.tokens).toBe(50);
    expect(body.freed.percentage).toBe(25);
  });

  it('returns cache stats', async () => {
    unifiedCache.getGlobalStats.mockResolvedValue({ totalEntries: 3 });
    const body = parseJson(await handlers.handleGetCacheStats());
    expect(body.success).toBe(true);
    expect(body.totalEntries).toBe(3);
  });

  it('returns clear-all-caches error on failure', async () => {
    unifiedCache.clearAll.mockRejectedValue(new Error('cache-fail'));
    const body = parseJson(await handlers.handleClearAllCaches());
    expect(body.success).toBe(false);
    expect(body.error).toBe('cache-fail');
  });
});


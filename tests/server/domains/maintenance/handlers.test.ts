import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoreMaintenanceHandlers } from '@server/domains/maintenance/handlers';

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

  const artifactCleanup = vi.fn();
  const environmentDoctor = vi.fn();

  let handlers: CoreMaintenanceHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new CoreMaintenanceHandlers({
      tokenBudget,
      unifiedCache,
      artifactCleanup,
      environmentDoctor,
    });
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
      .mockReturnValueOnce({
        currentUsage: 80,
        usagePercentage: 40,
        maxTokens: 200,
        sessionStartTime: 1,
      })
      .mockReturnValueOnce({
        currentUsage: 30,
        usagePercentage: 15,
        maxTokens: 200,
        sessionStartTime: 1,
      });

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

  it('runs artifact cleanup with overrides', async () => {
    artifactCleanup.mockResolvedValue({ success: true, removedFiles: 3, dryRun: true });

    const body = parseJson(
      await handlers.handleCleanupArtifacts({ retentionDays: 7, dryRun: true })
    );
    expect(artifactCleanup).toHaveBeenCalledWith({
      retentionDays: 7,
      maxTotalBytes: undefined,
      dryRun: true,
    });
    expect(body.success).toBe(true);
    expect(body.removedFiles).toBe(3);
  });

  it('returns environment doctor payload', async () => {
    environmentDoctor.mockResolvedValue({ success: true, recommendations: ['ok'] });

    const body = parseJson(await handlers.handleEnvironmentDoctor({ includeBridgeHealth: false }));
    expect(environmentDoctor).toHaveBeenCalledWith({ includeBridgeHealth: false });
    expect(body.success).toBe(true);
    expect(body.recommendations).toEqual(['ok']);
  });

  // --- additional error-path coverage ---

  it('returns error when manual cleanup fails', async () => {
    tokenBudget.getStats.mockImplementation(() => {
      throw new Error('cleanup-crash');
    });
    const body = parseJson(await handlers.handleManualTokenCleanup());
    expect(body.success).toBe(false);
    expect(body.error).toBe('cleanup-crash');
  });

  it('returns error when reset fails', async () => {
    tokenBudget.reset.mockImplementation(() => {
      throw new Error('reset-fail');
    });
    const body = parseJson(await handlers.handleResetTokenBudget());
    expect(body.success).toBe(false);
    expect(body.error).toBe('reset-fail');
  });

  it('resetTokenBudget returns zeroed state on success', async () => {
    const body = parseJson(await handlers.handleResetTokenBudget());
    expect(body.success).toBe(true);
    expect(body.currentUsage).toBe(0);
    expect(body.maxTokens).toBe(200000);
    expect(body.usagePercentage).toBe(0);
    expect(tokenBudget.reset).toHaveBeenCalledOnce();
  });

  it('returns error when cache stats fail', async () => {
    unifiedCache.getGlobalStats.mockRejectedValue(new Error('stats-err'));
    const body = parseJson(await handlers.handleGetCacheStats());
    expect(body.success).toBe(false);
    expect(body.error).toBe('stats-err');
  });

  it('smart cache cleanup forwards targetSize', async () => {
    unifiedCache.smartCleanup.mockResolvedValue({ freed: 1024 });
    const body = parseJson(await handlers.handleSmartCacheCleanup(5000));
    expect(unifiedCache.smartCleanup).toHaveBeenCalledWith(5000);
    expect(body.success).toBe(true);
    expect(body.freed).toBe(1024);
  });

  it('returns error when smart cache cleanup fails', async () => {
    unifiedCache.smartCleanup.mockRejectedValue(new Error('smart-fail'));
    const body = parseJson(await handlers.handleSmartCacheCleanup());
    expect(body.success).toBe(false);
    expect(body.error).toBe('smart-fail');
  });

  it('clearAllCaches returns success', async () => {
    unifiedCache.clearAll.mockResolvedValue(undefined);
    const body = parseJson(await handlers.handleClearAllCaches());
    expect(body.success).toBe(true);
    expect(body.message).toBe('All caches cleared');
  });

  it('returns error when artifact cleanup fails', async () => {
    artifactCleanup.mockRejectedValue(new Error('artifact-err'));
    const body = parseJson(await handlers.handleCleanupArtifacts({}));
    expect(body.success).toBe(false);
    expect(body.error).toBe('artifact-err');
  });

  it('returns error when environment doctor fails', async () => {
    environmentDoctor.mockRejectedValue(new Error('doctor-err'));
    const body = parseJson(await handlers.handleEnvironmentDoctor({}));
    expect(body.success).toBe(false);
    expect(body.error).toBe('doctor-err');
  });

  it('artifact cleanup passes all args', async () => {
    artifactCleanup.mockResolvedValue({ success: true });
    await handlers.handleCleanupArtifacts({ retentionDays: 3, maxTotalBytes: 1000, dryRun: false });
    expect(artifactCleanup).toHaveBeenCalledWith({
      retentionDays: 3,
      maxTotalBytes: 1000,
      dryRun: false,
    });
  });

  it('environment doctor with bridge health enabled', async () => {
    environmentDoctor.mockResolvedValue({ success: true });
    await handlers.handleEnvironmentDoctor({ includeBridgeHealth: true });
    expect(environmentDoctor).toHaveBeenCalledWith({ includeBridgeHealth: true });
  });
});

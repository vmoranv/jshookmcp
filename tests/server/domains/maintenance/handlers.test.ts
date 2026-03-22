import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoreMaintenanceHandlers } from '@server/domains/maintenance/handlers';



describe('CoreMaintenanceHandlers', () => {
  const tokenBudget = {
    getStats: vi.fn(),
    manualCleanup: vi.fn(),
    reset: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  const unifiedCache = {
    getGlobalStats: vi.fn(),
    smartCleanup: vi.fn(),
    clearAll: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    tokenBudget.getStats.mockReturnValue({
      currentUsage: 10,
      maxTokens: 100,
      usagePercentage: 10,
      sessionStartTime: Date.now() - 1200,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleGetTokenBudgetStats());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.sessionDuration).toMatch(/s$/);
  });

  it('returns serialized error when reading stats fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    tokenBudget.getStats.mockImplementation(() => {
      throw new Error('boom');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleGetTokenBudgetStats());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('boom');
  });

  it('manual cleanup computes freed tokens', async () => {
    tokenBudget.getStats
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockReturnValueOnce({
        currentUsage: 80,
        usagePercentage: 40,
        maxTokens: 200,
        sessionStartTime: 1,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockReturnValueOnce({
        currentUsage: 30,
        usagePercentage: 15,
        maxTokens: 200,
        sessionStartTime: 1,
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleManualTokenCleanup());
    expect(tokenBudget.manualCleanup).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.freed.tokens).toBe(50);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.freed.percentage).toBe(25);
  });

  it('returns cache stats', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unifiedCache.getGlobalStats.mockResolvedValue({ totalEntries: 3 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleGetCacheStats());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.totalEntries).toBe(3);
  });

  it('returns clear-all-caches error on failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unifiedCache.clearAll.mockRejectedValue(new Error('cache-fail'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleClearAllCaches());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('cache-fail');
  });

  it('runs artifact cleanup with overrides', async () => {
    artifactCleanup.mockResolvedValue({ success: true, removedFiles: 3, dryRun: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleCleanupArtifacts({ retentionDays: 7, dryRun: true })
    );
    expect(artifactCleanup).toHaveBeenCalledWith({
      retentionDays: 7,
      maxTotalBytes: undefined,
      dryRun: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.removedFiles).toBe(3);
  });

  it('returns environment doctor payload', async () => {
    environmentDoctor.mockResolvedValue({ success: true, recommendations: ['ok'] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleEnvironmentDoctor({ includeBridgeHealth: false }));
    expect(environmentDoctor).toHaveBeenCalledWith({ includeBridgeHealth: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.recommendations).toEqual(['ok']);
  });

  // --- additional error-path coverage ---

  it('returns error when manual cleanup fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    tokenBudget.getStats.mockImplementation(() => {
      throw new Error('cleanup-crash');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleManualTokenCleanup());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('cleanup-crash');
  });

  it('returns error when reset fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    tokenBudget.reset.mockImplementation(() => {
      throw new Error('reset-fail');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleResetTokenBudget());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('reset-fail');
  });

  it('resetTokenBudget returns zeroed state on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleResetTokenBudget());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.currentUsage).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.maxTokens).toBe(200000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.usagePercentage).toBe(0);
    expect(tokenBudget.reset).toHaveBeenCalledOnce();
  });

  it('returns error when cache stats fail', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unifiedCache.getGlobalStats.mockRejectedValue(new Error('stats-err'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleGetCacheStats());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('stats-err');
  });

  it('smart cache cleanup forwards targetSize', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unifiedCache.smartCleanup.mockResolvedValue({ freed: 1024 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleSmartCacheCleanup(5000));
    expect(unifiedCache.smartCleanup).toHaveBeenCalledWith(5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.freed).toBe(1024);
  });

  it('returns error when smart cache cleanup fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unifiedCache.smartCleanup.mockRejectedValue(new Error('smart-fail'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleSmartCacheCleanup());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('smart-fail');
  });

  it('clearAllCaches returns success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unifiedCache.clearAll.mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleClearAllCaches());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toBe('All caches cleared');
  });

  it('returns error when artifact cleanup fails', async () => {
    artifactCleanup.mockRejectedValue(new Error('artifact-err'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleCleanupArtifacts({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('artifact-err');
  });

  it('returns error when environment doctor fails', async () => {
    environmentDoctor.mockRejectedValue(new Error('doctor-err'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleEnvironmentDoctor({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

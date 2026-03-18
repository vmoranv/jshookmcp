import { logger } from '@utils/logger';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import type { ToolResponse } from '@server/types';
import { asJsonResponse, serializeError } from '@server/domains/shared/response';
import { cleanupArtifacts } from '@utils/artifactRetention';
import { runEnvironmentDoctor } from '@utils/environmentDoctor';

interface CoreMaintenanceHandlerDeps {
  tokenBudget: TokenBudgetManager;
  unifiedCache: UnifiedCacheManager;
  artifactCleanup?: typeof cleanupArtifacts;
  environmentDoctor?: typeof runEnvironmentDoctor;
}

export class CoreMaintenanceHandlers {
  private readonly tokenBudget: TokenBudgetManager;
  private readonly unifiedCache: UnifiedCacheManager;
  private readonly artifactCleanup: typeof cleanupArtifacts;
  private readonly environmentDoctor: typeof runEnvironmentDoctor;

  constructor(deps: CoreMaintenanceHandlerDeps) {
    this.tokenBudget = deps.tokenBudget;
    this.unifiedCache = deps.unifiedCache;
    this.artifactCleanup = deps.artifactCleanup ?? cleanupArtifacts;
    this.environmentDoctor = deps.environmentDoctor ?? runEnvironmentDoctor;
  }

  async handleGetTokenBudgetStats(): Promise<ToolResponse> {
    try {
      const stats = this.tokenBudget.getStats();
      return asJsonResponse({
        success: true,
        ...stats,
        sessionDuration: `${Math.round((Date.now() - stats.sessionStartTime) / 1000)}s`,
      });
    } catch (error) {
      logger.error('Failed to read token budget stats:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleManualTokenCleanup(): Promise<ToolResponse> {
    try {
      const beforeStats = this.tokenBudget.getStats();
      this.tokenBudget.manualCleanup();
      const afterStats = this.tokenBudget.getStats();
      const freed = beforeStats.currentUsage - afterStats.currentUsage;

      return asJsonResponse({
        success: true,
        message: 'Manual cleanup completed',
        before: {
          usage: beforeStats.currentUsage,
          percentage: beforeStats.usagePercentage,
        },
        after: {
          usage: afterStats.currentUsage,
          percentage: afterStats.usagePercentage,
        },
        freed: {
          tokens: freed,
          percentage: Math.round((freed / beforeStats.maxTokens) * 100),
        },
      });
    } catch (error) {
      logger.error('Failed to perform manual cleanup:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleResetTokenBudget(): Promise<ToolResponse> {
    try {
      this.tokenBudget.reset();
      return asJsonResponse({
        success: true,
        message: 'Token budget reset successfully',
        currentUsage: 0,
        maxTokens: 200000,
        usagePercentage: 0,
      });
    } catch (error) {
      logger.error('Failed to reset token budget:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleGetCacheStats(): Promise<ToolResponse> {
    try {
      const stats = await this.unifiedCache.getGlobalStats();
      return asJsonResponse({
        success: true,
        ...stats,
      });
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleSmartCacheCleanup(targetSize?: number): Promise<ToolResponse> {
    try {
      const result = await this.unifiedCache.smartCleanup(targetSize);
      return asJsonResponse({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error('Failed to perform cache cleanup:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleClearAllCaches(): Promise<ToolResponse> {
    try {
      await this.unifiedCache.clearAll();
      return asJsonResponse({
        success: true,
        message: 'All caches cleared',
      });
    } catch (error) {
      logger.error('Failed to clear caches:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleCleanupArtifacts(args: {
    retentionDays?: number;
    maxTotalBytes?: number;
    dryRun?: boolean;
  }): Promise<ToolResponse> {
    try {
      const result = await this.artifactCleanup({
        retentionDays: args.retentionDays,
        maxTotalBytes: args.maxTotalBytes,
        dryRun: args.dryRun,
      });
      return asJsonResponse(result);
    } catch (error) {
      logger.error('Failed to cleanup artifacts:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleEnvironmentDoctor(args: { includeBridgeHealth?: boolean }): Promise<ToolResponse> {
    try {
      const report = await this.environmentDoctor({
        includeBridgeHealth: args.includeBridgeHealth,
      });
      return asJsonResponse(report);
    } catch (error) {
      logger.error('Failed to run environment doctor:', error);
      return asJsonResponse(serializeError(error));
    }
  }
}

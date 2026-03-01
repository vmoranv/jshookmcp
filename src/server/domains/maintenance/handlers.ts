import { logger } from '../../../utils/logger.js';
import { TokenBudgetManager } from '../../../utils/TokenBudgetManager.js';
import { UnifiedCacheManager } from '../../../utils/UnifiedCacheManager.js';
import type { ToolResponse } from '../../types.js';
import { asJsonResponse, serializeError } from '../shared/response.js';

interface CoreMaintenanceHandlerDeps {
  tokenBudget: TokenBudgetManager;
  unifiedCache: UnifiedCacheManager;
}

export class CoreMaintenanceHandlers {
  private readonly tokenBudget: TokenBudgetManager;
  private readonly unifiedCache: UnifiedCacheManager;

  constructor(deps: CoreMaintenanceHandlerDeps) {
    this.tokenBudget = deps.tokenBudget;
    this.unifiedCache = deps.unifiedCache;
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
}

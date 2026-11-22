/**
 * Data management handlers: clear_collected_data, get_collection_stats
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ScriptManager } from '@modules/debugger/ScriptManager';
import type { ToolResponse } from '@server/types';

interface DataManagementDeps {
  collector: CodeCollector;
  scriptManager: ScriptManager;
}

export class DataManagementHandlers {
  private readonly collector: CodeCollector;
  private readonly scriptManager: ScriptManager;

  constructor(deps: DataManagementDeps) {
    this.collector = deps.collector;
    this.scriptManager = deps.scriptManager;
  }

  async handleClearCollectedData(): Promise<ToolResponse> {
    return handleSafe(async () => {
      if (typeof this.collector.clearSessionData === 'function') {
        this.collector.clearSessionData();
      } else {
        await this.collector.clearAllData();
      }
      this.scriptManager.clear();
      return {
        message: 'Current MCP session collected view cleared.',
        cleared: {
          fileCache: false,
          compressionCache: false,
          collectedUrls: true,
          scriptManager: true,
        },
      };
    });
  }

  async handleGetCollectionStats(): Promise<ToolResponse> {
    return handleSafe(async () => {
      const stats = await this.collector.getAllStats();
      return {
        stats,
        summary: {
          totalCachedFiles: stats.cache.memoryEntries + stats.cache.diskEntries,
          totalCacheSize: `${(stats.cache.totalSize / 1024).toFixed(2)} KB`,
          compressionRatio: `${stats.compression.averageRatio.toFixed(1)}%`,
          cacheHitRate:
            stats.compression.cacheHits > 0
              ? `${(
                  (stats.compression.cacheHits /
                    (stats.compression.cacheHits + stats.compression.cacheMisses)) *
                  100
                ).toFixed(1)}%`
              : '0%',
          collectedUrls: stats.collector.collectedUrls,
        },
      };
    });
  }
}

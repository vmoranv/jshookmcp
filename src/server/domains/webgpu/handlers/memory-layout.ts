import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getGPUMemoryStats } from '@modules/webgpu/CDPIntegration';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

/**
 * Handler for webgpu_memory_layout tool
 * Analyzes GPU memory allocations and buffer usage patterns
 */
export class MemoryLayoutHandler {
  private pageLockManager = getPageLockManager();

  constructor(
    _ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
  ) {}

  async handle(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock to prevent concurrent GPU context access
      return await this.pageLockManager.withLock(pageId, async () => {
        // Use real CDP integration to get GPU memory stats
        const memoryStats = await getGPUMemoryStats(page);

        return {
          heapSize: memoryStats.heapSize,
          usedHeapSize: memoryStats.usedHeapSize,
          allocations: memoryStats.allocations,
          // Provenance of usedHeapSize so consumers can gauge data quality:
          // 'cdp' = Performance.getMetrics GPUMemoryUsedKB (most accurate),
          // 'tracked' = sum of live WeakRef-tracked allocations (lower bound),
          // 'estimated' = no signal available (conservative fallback).
          memorySource: memoryStats.memorySource,
          trackedBytes: memoryStats.trackedBytes,
        };
      });
    });
  }

  private async getActivePage(): Promise<any> {
    if (!this.deps.pageController) {
      return null;
    }

    try {
      return await this.deps.pageController.getActivePage();
    } catch {
      return null;
    }
  }
}

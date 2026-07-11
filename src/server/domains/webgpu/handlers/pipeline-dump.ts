import { setTimeout as delay } from 'node:timers/promises';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getCapturedPipelines, installPipelineDumpHook } from '@modules/webgpu/PipelineDumpHook';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

const PIPELINE_DUMP_TIMEOUT_MS = 5000;
const PIPELINE_DUMP_POLL_INTERVAL_MS = 50;
const DEFAULT_MAX_PIPELINES = 10;

/**
 * Handler for webgpu_pipeline_dump.
 *
 * Hooks GPUDevice createRenderPipeline / createComputePipeline /
 * createBindGroupLayout (plus async variants) to accumulate the full
 * descriptor of every pipeline/layout the app creates. Resolves a captured
 * `bindGroups: [0,1]` to actual resources, so analysts can tell what data a
 * draw/dispatch operated on.
 */
export class PipelineDumpHandler {
  private ddm: DetailedDataManager;
  private pageLockManager = getPageLockManager();

  constructor(
    _ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
  ) {
    this.ddm = DetailedDataManager.getInstance();
  }

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const captureCount = argNumber(args, 'captureCount', DEFAULT_MAX_PIPELINES);
      if (!captureCount || captureCount <= 0) {
        throw new Error('Missing or invalid argument: captureCount (must be > 0)');
      }
      const timeoutMs = argNumber(args, 'timeoutMs', PIPELINE_DUMP_TIMEOUT_MS);

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock — pipeline hook shares the WebGPU context.
      return await this.pageLockManager.withLock(pageId, async () => {
        const cleanup = await installPipelineDumpHook(page, captureCount);
        try {
          const captured = await this.waitForPipelines(page, captureCount, timeoutMs);
          const result = {
            pipelines: captured.pipelines,
            totalCreated: captured.totalCreated,
            capturedCount: captured.pipelines.length,
            captureTimedOut: captured.pipelines.length < captureCount,
          };
          return this.ddm.smartHandle(result, 25000);
        } finally {
          await cleanup();
        }
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

  private async waitForPipelines(
    page: any,
    captureCount: number,
    timeoutMs: number,
  ): ReturnType<typeof getCapturedPipelines> {
    const deadline = Date.now() + timeoutMs;
    let state = await getCapturedPipelines(page);

    while (state.pipelines.length < captureCount && Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      await delay(Math.min(PIPELINE_DUMP_POLL_INTERVAL_MS, Math.max(remainingMs, 0)));
      state = await getCapturedPipelines(page);
    }

    return state;
  }
}

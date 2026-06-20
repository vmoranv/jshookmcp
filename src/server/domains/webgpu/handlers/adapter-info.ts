import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { ensureDevice } from '@modules/webgpu/CDPIntegration';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

/**
 * Handler for webgpu_adapter_info tool
 * Gets GPU adapter information (vendor, architecture, device)
 *
 * Uses the cached adapter/device from `ensureDevice` so that repeated calls
 * (and concurrent calls from other WebGPU tools) do not trigger redundant
 * `requestAdapter`/`requestDevice` cycles. On multi-GPU systems this keeps
 * adapter selection stable across the session.
 */
export class AdapterInfoHandler {
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
        const handle = await ensureDevice(page);

        return {
          adapter: handle.adapterInfo,
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

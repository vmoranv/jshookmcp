import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import {
  installGPUCommandHook,
  getGPUCommandTrace,
  analyzeCommandTrace,
} from '@modules/webgpu/CDPIntegration';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

/**
 * Handler for webgpu_capture_commands tool
 * Captures GPU command queue submissions (render passes, compute dispatches)
 */
export class CommandCaptureHandler {
  private ddm: DetailedDataManager;
  private pageLockManager = getPageLockManager();

  constructor(
    private ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
  ) {
    this.ddm = DetailedDataManager.getInstance();
  }

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const captureCount = argNumber(args, 'captureCount');
      if (!captureCount || captureCount <= 0) {
        throw new Error('Missing or invalid required argument: captureCount (must be > 0)');
      }

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock to prevent concurrent GPU context access
      return await this.pageLockManager.withLock(pageId, async () => {
        // Install GPUQueue.submit hook (recoverable)
        const cleanup = await installGPUCommandHook(page, captureCount);

        try {
          // Wait for commands to be captured (or timeout after 5 seconds)
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // Retrieve captured commands
          const trace = await getGPUCommandTrace(page);

          // Analyze command patterns
          const analyzed = analyzeCommandTrace(trace);

          const result = {
            commands: analyzed.commands,
            totalSubmissions: analyzed.totalSubmissions,
            captureWindow: {
              start: analyzed.captureStartTime,
              end: analyzed.captureEndTime,
              duration: analyzed.captureEndTime - analyzed.captureStartTime,
            },
            inferredTypes: analyzed.inferredTypes,
          };

          // Handle large command arrays
          return this.ddm.smartHandle(result, 25000);
        } finally {
          // Restore original GPUQueue.prototype.submit and createCommandEncoder
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
}

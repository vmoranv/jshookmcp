import { setTimeout as delay } from 'node:timers/promises';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getCapturedShaders, installShaderSourceHook } from '@modules/webgpu/ShaderSourceHook';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

const SHADER_CAPTURE_TIMEOUT_MS = 5000;
const SHADER_CAPTURE_POLL_INTERVAL_MS = 50;
const DEFAULT_MAX_SHADERS = 10;

/**
 * Handler for webgpu_shader_source_capture.
 *
 * Hooks GPUDevice.prototype.createShaderModule and accumulates every shader
 * source the running application compiles. Returns as soon as `captureCount`
 * shaders are captured or the timeout elapses (whichever first).
 */
export class ShaderSourceCaptureHandler {
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
      const captureCount = argNumber(args, 'captureCount', DEFAULT_MAX_SHADERS);
      if (!captureCount || captureCount <= 0) {
        throw new Error('Missing or invalid argument: captureCount (must be > 0)');
      }
      const timeoutMs = argNumber(args, 'timeoutMs', SHADER_CAPTURE_TIMEOUT_MS);

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock — shader hook and command hook share the WebGPU context.
      return await this.pageLockManager.withLock(pageId, async () => {
        const cleanup = await installShaderSourceHook(page, captureCount);
        try {
          const captured = await this.waitForShaders(page, captureCount, timeoutMs);
          const result = {
            shaders: captured.shaders,
            totalCreated: captured.totalCreated,
            capturedCount: captured.shaders.length,
            captureTimedOut: captured.shaders.length < captureCount,
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

  private async waitForShaders(
    page: any,
    captureCount: number,
    timeoutMs: number,
  ): ReturnType<typeof getCapturedShaders> {
    const deadline = Date.now() + timeoutMs;
    let state = await getCapturedShaders(page);

    while (state.shaders.length < captureCount && Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      await delay(Math.min(SHADER_CAPTURE_POLL_INTERVAL_MS, Math.max(remainingMs, 0)));
      state = await getCapturedShaders(page);
    }

    return state;
  }
}

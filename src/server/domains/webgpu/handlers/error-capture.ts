import { setTimeout as delay } from 'node:timers/promises';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argBool, argNumber } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getCapturedErrors, installErrorCaptureHook } from '@modules/webgpu/ErrorCaptureHook';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

const ERROR_CAPTURE_TIMEOUT_MS = 5000;
const ERROR_CAPTURE_POLL_INTERVAL_MS = 50;
const DEFAULT_MAX_ERRORS = 10;

/**
 * Handler for webgpu_error_capture.
 *
 * Hooks device uncapturederror (and optionally wraps createBuffer/createTexture
 * in error scopes) to surface WebGPU validation/out-of-memory/internal errors
 * the target app otherwise swallows. Returns as soon as `captureCount` errors
 * are captured or the timeout elapses, plus the current device.lost state.
 */
export class ErrorCaptureHandler {
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
      const captureCount = argNumber(args, 'captureCount', DEFAULT_MAX_ERRORS);
      if (!captureCount || captureCount <= 0) {
        throw new Error('Missing or invalid argument: captureCount (must be > 0)');
      }
      const timeoutMs = argNumber(args, 'timeoutMs', ERROR_CAPTURE_TIMEOUT_MS);
      const wrapAllocations = argBool(args, 'wrapAllocations', false);

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock — error hook shares the WebGPU context.
      return await this.pageLockManager.withLock(pageId, async () => {
        const cleanup = await installErrorCaptureHook(page, { captureCount, wrapAllocations });
        try {
          const captured = await this.waitForErrors(page, captureCount, timeoutMs);
          const result = {
            errors: captured.errors,
            deviceLost: captured.deviceLost,
            totalErrors: captured.totalErrors,
            capturedCount: captured.errors.length,
            captureTimedOut: captured.errors.length < captureCount,
            wrapAllocations,
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

  private async waitForErrors(
    page: any,
    captureCount: number,
    timeoutMs: number,
  ): ReturnType<typeof getCapturedErrors> {
    const deadline = Date.now() + timeoutMs;
    let state = await getCapturedErrors(page);

    while (state.errors.length < captureCount && Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      await delay(Math.min(ERROR_CAPTURE_POLL_INTERVAL_MS, Math.max(remainingMs, 0)));
      state = await getCapturedErrors(page);
    }

    return state;
  }
}

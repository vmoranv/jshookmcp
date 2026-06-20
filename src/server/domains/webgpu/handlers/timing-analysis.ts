import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argBool, argString } from '@server/domains/shared/parse-args';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { ensureDevice } from '@modules/webgpu/CDPIntegration';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

/**
 * Handler for webgpu_timing_analysis tool
 * GPU timing analysis for side-channel detection (measures variance)
 *
 * Uses the cached device from `ensureDevice` (shared with other WebGPU tools)
 * so that timing analysis does not compete for a fresh adapter/device on
 * multi-GPU systems. The device is obtained from the page-context cache and
 * the timing loop runs entirely within a single evaluate closure.
 */
export class TimingAnalysisHandler {
  private pageLockManager = getPageLockManager();

  constructor(
    _ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
  ) {}

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const iterations = argNumber(args, 'iterations');
      if (!iterations || iterations <= 0) {
        throw new Error('Missing or invalid required argument: iterations (must be > 0)');
      }

      const detectAnomalies = argBool(args, 'detectAnomalies', false);
      const meta = args['_meta'] as Record<string, unknown> | undefined;
      if (meta) argString(meta, 'progressToken'); // read if present, unused

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock to prevent concurrent GPU context access
      return await this.pageLockManager.withLock(pageId, async () => {
        // Ensure a cached adapter/device exists (shared with other WebGPU tools).
        // The device object lives in the page context and is reused below.
        await ensureDevice(page);

        const stats = await page.evaluate(
          async ({
            _iterations,
            _detectAnomalies,
          }: {
            _iterations: number;
            _detectAnomalies: boolean;
          }) => {
            // Reuse the cached device established by ensureDevice.
            const cache = (window as any).__webgpuDeviceCache;
            if (!cache || !cache.device) {
              throw new Error('WebGPU device cache unavailable. Call ensureDevice first.');
            }
            const device = cache.device;
            const timings: number[] = [];

            for (let i = 0; i < _iterations; i++) {
              const start = performance.now();

              // Simple GPU timing test: create buffer and wait for completion
              const buffer = device.createBuffer({
                size: 1024,
                usage:
                  (globalThis as any).GPUBufferUsage?.COPY_DST |
                    (globalThis as any).GPUBufferUsage?.MAP_READ || 0,
              });

              await device.queue.onSubmittedWorkDone();

              const end = performance.now();
              timings.push(end - start);

              buffer.destroy();

              // Report progress every 20%
              const wpg = (window as any).webgpuProgressCallback;
              if (wpg && i % Math.ceil(_iterations / 5) === 0) {
                wpg(i / _iterations);
              }
            }

            const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
            const variance =
              timings.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / timings.length;
            const stddev = Math.sqrt(variance);
            const min = Math.min(...timings);
            const max = Math.max(...timings);

            const result: any = {
              timings,
              mean,
              stddev,
              min,
              max,
            };

            if (_detectAnomalies) {
              const threshold = 2.0; // 2 standard deviations
              result.anomalies = timings
                .map((val, idx) => ({
                  index: idx,
                  value: val,
                  deviation: Math.abs(val - mean) / stddev,
                }))
                .filter((a) => a.deviation > threshold);
            }

            return result;
          },
          { _iterations: iterations, _detectAnomalies: detectAnomalies },
        );

        return stats;
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

/**
 * GPU Memory Tracking — CDP-based metrics + WeakRef allocation pool.
 *
 * Resolves `usedHeapSize` from the most accurate available source:
 * 1. `Performance.getMetrics` → `GPUMemoryUsedKB` (memorySource='cdp')
 * 2. Sum of live WeakRef-tracked allocations          (memorySource='tracked')
 * 3. Conservative zero fallback                       (memorySource='estimated')
 */

import type { Page } from 'rebrowser-puppeteer-core';
import type { GPUMemoryAllocation, GPUMemoryStats } from '@server/domains/webgpu/types';
import type { PageHookState } from './CDPTypes';

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get GPU memory statistics via CDP and page-script tracking.
 *
 * @param page - Puppeteer page
 * @returns Memory stats with provenance in `memorySource`
 */
export async function getGPUMemoryStats(page: Page): Promise<GPUMemoryStats> {
  const cdp = await page.createCDPSession();

  try {
    // Enable Memory domain (ensures counters are collected)
    await cdp.send('Memory.getDOMCounters');

    // Get performance metrics (includes GPU metrics on some platforms)
    const metrics = await cdp.send('Performance.getMetrics');

    // Extract GPU-related metrics
    const gpuMemoryMetric = metrics.metrics.find((m: any) => m.name === 'GPUMemoryUsedKB');
    const cdpUsedBytes = gpuMemoryMetric ? gpuMemoryMetric.value * 1024 : 0;
    const hasCdpMetric = Boolean(gpuMemoryMetric);

    // Ensure page-script allocation tracker is installed
    await ensureAllocationTracker(page);

    // Query live allocations from page context
    const allocations = await page.evaluate(() => {
      const state = (window as any).webgpuHookState as PageHookState | undefined;
      if (!state) {
        return [] as GPUMemoryAllocation[];
      }

      const usageNames: Record<number, string> = {
        0x01: 'MAP_READ',
        0x02: 'MAP_WRITE',
        0x04: 'COPY_SRC',
        0x08: 'COPY_DST',
        0x10: 'INDEX',
        0x20: 'VERTEX',
        0x40: 'UNIFORM',
        0x80: 'STORAGE',
        0x100: 'INDIRECT',
        0x200: 'QUERY_RESOLVE',
      };

      function decodeBufferUsage(usage: number): string {
        const parts: string[] = [];
        for (const [bit, name] of Object.entries(usageNames)) {
          if (usage & Number(bit)) {
            parts.push(name);
          }
        }
        return parts.length > 0 ? parts.join(' | ') : String(usage);
      }

      // Filter dead refs and build allocation list
      const alive: GPUMemoryAllocation[] = [];
      for (const record of state.allocations) {
        const obj = record.ref.deref();
        if (obj) {
          alive.push({
            size: record.size,
            usage:
              record.type === 'buffer'
                ? decodeBufferUsage(record.usage)
                : `textureUsage:${record.usage}`,
            label: record.label,
            type: record.type,
            alive: true,
          });
        }
      }

      return alive;
    });

    // trackedBytes is always the sum of live tracked allocation sizes.
    const trackedBytes = allocations.reduce((sum, a) => sum + a.size, 0);

    // Resolve usedHeapSize + memorySource using the precedence ladder.
    let usedHeapSize: number;
    let memorySource: GPUMemoryStats['memorySource'];
    if (hasCdpMetric) {
      usedHeapSize = cdpUsedBytes;
      memorySource = 'cdp';
    } else if (trackedBytes > 0) {
      usedHeapSize = trackedBytes;
      memorySource = 'tracked';
    } else {
      usedHeapSize = 0;
      memorySource = 'estimated';
    }

    // Estimate total heap size (conservative: max of 2x used or 256MB).
    const heapBase = memorySource === 'tracked' ? trackedBytes : usedHeapSize;
    const heapSize = Math.max(heapBase * 2, 256 * 1024 * 1024);

    return {
      heapSize,
      usedHeapSize,
      allocations,
      memorySource,
      trackedBytes,
    };
  } finally {
    await cdp.detach();
  }
}

/**
 * Install the page-script allocation tracker if not already present.
 *
 * Wraps `GPUDevice.createBuffer` and `GPUDevice.createTexture` to keep a
 * `WeakRef` pool of live GPU resources. The pool is pruned on every read.
 *
 * @param page - Puppeteer page
 */
async function ensureAllocationTracker(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    if (typeof (window as any).webgpuHookState !== 'undefined') {
      return;
    }

    const state: PageHookState = {
      originalSubmit: GPUQueue.prototype.submit,
      originalCreateCommandEncoder: GPUDevice.prototype.createCommandEncoder,
      hooksInstalled: false,
      commandTrace: null,
      allocations: [],
    };

    (window as any).webgpuHookState = state;

    if (typeof GPUDevice === 'undefined') {
      return;
    }

    const originalCreateBuffer = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor: any) {
      const buffer = originalCreateBuffer.call(this, descriptor);
      state.allocations.push({
        size: descriptor.size ?? 0,
        usage: descriptor.usage ?? 0,
        label: descriptor.label,
        type: 'buffer',
        ref: new WeakRef(buffer),
      });
      return buffer;
    };

    const originalCreateTexture = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (descriptor: any) {
      const texture = originalCreateTexture.call(this, descriptor);
      const size = Array.isArray(descriptor.size)
        ? descriptor.size.reduce((a: number, b: number) => a * b, 1)
        : typeof descriptor.size === 'number'
          ? descriptor.size
          : 0;
      state.allocations.push({
        size,
        usage: descriptor.usage ?? 0,
        label: descriptor.label,
        type: 'texture',
        ref: new WeakRef(texture),
      });
      return texture;
    };
  });
}

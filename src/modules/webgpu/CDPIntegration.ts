/**
 * CDP Integration for WebGPU — backward-compatible re-export hub.
 *
 * **Module layout** (Phase 3 refactor, 2026-06-27):
 * - `CDPTypes.ts`     — Internal types (PageHookState, PageAllocationRecord)
 * - `MemoryTracking.ts` — `getGPUMemoryStats` + allocation tracker
 * - `CommandHook.ts`  — `installGPUCommandHook`, `uninstallGPUCommandHook`,
 *                        `getGPUCommandTrace`, `analyzeCommandTrace`,
 *                        `resetGPUCommandTrace`
 * - `CDPIntegration.ts` (this file) — `ensureDevice` / `releaseDevice` +
 *                                      re-exports for backward compatibility
 *
 * **Capabilities**:
 * 1. GPU Memory Tracking — via `WeakRef` pool of `GPUBuffer`/`GPUTexture` objects
 * 2. Command Queue Capture — via recoverable page-script hooks on `GPUQueue.submit`,
 *    `GPUDevice.createCommandEncoder`, and pass encoders
 * 3. Multi-adapter/device cache — `ensureDevice`/`releaseDevice` with `device.lost` recovery
 */

import type { Page } from 'rebrowser-puppeteer-core';
import type { GPUAdapterInfo } from '@server/domains/webgpu/types';

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports (backward-compatible — consumers only import from CDPIntegration)
// ─────────────────────────────────────────────────────────────────────────────

// Types
export type { GPUMemoryStats } from '@server/domains/webgpu/types';
export type { GPUCommandTrace } from './CommandHook';
export type { PageHookState, PageAllocationRecord } from './CDPTypes';

// Memory tracking
export { getGPUMemoryStats } from './MemoryTracking';

// Command hooks
export {
  installGPUCommandHook,
  uninstallGPUCommandHook,
  getGPUCommandTrace,
  analyzeCommandTrace,
  resetGPUCommandTrace,
} from './CommandHook';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-adapter / device cache (defect #5)
// ─────────────────────────────────────────────────────────────────────────────

/** Handle returned by `ensureDevice` — adapter/device are page-context objects. */
export interface DeviceHandle {
  adapter: any;
  device: any;
  fresh: boolean;
  adapterInfo: GPUAdapterInfo;
}

/** In-page cache shape stored on `window.__webgpuDeviceCache`. */
interface PageDeviceCache {
  adapter: any;
  device: any;
  adapterInfo: GPUAdapterInfo;
  lost: boolean;
}

/**
 * Get or create a cached `GPUAdapter` + `GPUDevice` in the page context.
 *
 * On a dual-GPU system, repeated `requestAdapter()` calls can return different
 * adapters depending on power state. This cache pins a single adapter+device
 * pair for the page lifetime and transparently rebuilds it after `device.lost`.
 */
export async function ensureDevice(
  page: Page,
  opts?: { powerPreference?: 'low-power' | 'high-performance' | 'none' },
): Promise<DeviceHandle> {
  const pp = opts?.powerPreference ?? 'none';

  const result = await page.evaluate(async (powerPreference: string) => {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      throw new Error('WebGPU not available: navigator.gpu is undefined.');
    }

    const w = window as any;
    const existing: PageDeviceCache | undefined = w.__webgpuDeviceCache;
    if (existing && !existing.lost && existing.adapter && existing.device) {
      return {
        adapter: existing.adapter,
        device: existing.device,
        fresh: false,
        adapterInfo: existing.adapterInfo,
      };
    }

    // Stale cache (lost/device lost) — discard before re-requesting.
    w.__webgpuDeviceCache = undefined;

    const requestAdapterOpts = powerPreference === 'none' ? {} : { powerPreference };
    const adapter = await gpu.requestAdapter(requestAdapterOpts);
    if (!adapter) {
      throw new Error('No suitable GPUAdapter available.');
    }

    const device = await adapter.requestDevice();

    const info =
      (adapter.info as GPUAdapterInfo | undefined) ??
      (typeof adapter.requestAdapterInfo === 'function' ? await adapter.requestAdapterInfo() : {});
    const adapterInfo: GPUAdapterInfo = {
      vendor: String(info?.vendor ?? ''),
      architecture: String(info?.architecture ?? ''),
      device: String(info?.device ?? ''),
      description: String(info?.description ?? ''),
    };

    const cache: PageDeviceCache = {
      adapter,
      device,
      adapterInfo,
      lost: false,
    };

    // Attach device.lost recovery: clear cache so next ensureDevice rebuilds.
    if (device && typeof device.lost === 'object' && device.lost !== null) {
      (device.lost as Promise<any>).then(() => {
        cache.lost = true;
        cache.adapter = null;
        cache.device = null;
      });
    }

    w.__webgpuDeviceCache = cache;

    return { adapter, device, fresh: true, adapterInfo };
  }, pp);

  return result as DeviceHandle;
}

/**
 * Release the cached adapter/device pair in the page context.
 */
export async function releaseDevice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__webgpuDeviceCache) {
      w.__webgpuDeviceCache = undefined;
    }
  });
}

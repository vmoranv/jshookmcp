/**
 * CDP Integration for WebGPU — Real memory tracking and command capture.
 *
 * **Phase 2 Implementation**: Uses Chrome DevTools Protocol plus page-script
 * instrumentation for real data.
 *
 * **Capabilities**:
 * 1. GPU Memory Tracking — via `WeakRef` pool of `GPUBuffer`/`GPUTexture` objects
 * 2. Command Queue Capture — via page script injection hooking `GPUQueue.submit`,
 *    `GPUDevice.createCommandEncoder`, and pass encoders
 * 3. Resource Tracking — via Page.getResourceTree + target info
 * 4. Multi-adapter/device cache — `ensureDevice`/`releaseDevice` with `device.lost` recovery
 *
 * **Known Limitations**:
 * - Chrome DevTools Protocol does not expose all WebGPU internals
 * - Some metrics require Chrome flags (--enable-gpu-benchmarking)
 * - Command buffer contents are opaque (only metadata available)
 */

import type { Page } from 'rebrowser-puppeteer-core';
import type { GPUMemoryAllocation, GPUCommand, GPUAdapterInfo } from '@server/domains/webgpu/types';

// Re-export GPUMemoryStats from the canonical types module so consumers that
// import the type from CDPIntegration see the extended (Phase 2) shape with
// `memorySource` and `trackedBytes`. This avoids a duplicate definition that
// would drift from the source of truth.
export type { GPUMemoryStats } from '@server/domains/webgpu/types';
import type { GPUMemoryStats } from '@server/domains/webgpu/types';

export interface GPUCommandTrace {
  commands: GPUCommand[];
  totalSubmissions: number;
  captureStartTime: number;
  captureEndTime: number;
}

/** WeakRef-based allocation record kept in the page context. */
interface PageAllocationRecord {
  size: number;
  usage: number;
  label?: string;
  type: 'buffer' | 'texture';
  ref: WeakRef<any>;
}

/** Hook state stored in the page context for recoverable hooks. */
interface PageHookState {
  originalSubmit: typeof GPUQueue.prototype.submit;
  originalCreateCommandEncoder: typeof GPUDevice.prototype.createCommandEncoder;
  hooksInstalled: boolean;
  commandTrace: {
    commands: any[];
    totalSubmissions: number;
    startTime: number;
  } | null;
  allocations: PageAllocationRecord[];
}

/** Handle returned by `ensureDevice` — adapter/device are page-context objects. */
export interface DeviceHandle {
  adapter: any;
  device: any;
  fresh: boolean;
  adapterInfo: GPUAdapterInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPU Memory Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get GPU memory statistics via CDP and page-script tracking.
 *
 * Resolves `usedHeapSize` from the most accurate available source:
 * 1. `Performance.getMetrics` → `GPUMemoryUsedKB` (memorySource='cdp')
 * 2. Sum of live WeakRef-tracked allocations          (memorySource='tracked')
 * 3. Conservative zero fallback                       (memorySource='estimated')
 *
 * `trackedBytes` is always computed as the sum of tracked allocation sizes,
 * regardless of whether the CDP metric is available.
 *
 * @param page - Puppeteer page
 * @returns Memory stats
 */
export async function getGPUMemoryStats(page: Page): Promise<GPUMemoryStats> {
  const cdp = await page.createCDPSession();

  try {
    // Enable Memory domain (ensures counters are collected)
    await cdp.send('Memory.getDOMCounters');

    // Get performance metrics (includes GPU metrics on some platforms)
    const metrics = await cdp.send('Performance.getMetrics');

    // Extract GPU-related metrics
    const gpuMemoryMetric = metrics.metrics.find((m) => m.name === 'GPUMemoryUsedKB');
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
    // In tracked mode the trackedBytes value participates in the estimate so
    // the heap floor scales with real allocations even when CDP is silent.
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

// ─────────────────────────────────────────────────────────────────────────────
// Multi-adapter / device cache (defect #5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-page cache shape stored on `window.__webgpuDeviceCache`.
 *
 * Kept as a separate type from `DeviceHandle` because the cache also tracks
 * the `lost` flag and holds the live adapter/device references between calls.
 */
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
 *
 * **Recovery**: the `device.lost` promise is attached a cleanup callback that
 * marks the cache `lost=true` and clears the references. The next `ensureDevice`
 * call sees the stale cache, discards it, and creates a fresh pair.
 *
 * @param page - Puppeteer page
 * @param opts.powerPreference - 'low-power' | 'high-performance' | 'none' (default: don't pass)
 * @returns DeviceHandle (adapter/device are page-context objects, valid only
 *          within the evaluate closure that produced them)
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

    // adapter.info is the modern accessor (adapter.requestAdapterInfo() is
    // deprecated in current WebGPU specs). Fall back gracefully.
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

    return {
      adapter,
      device,
      fresh: true,
      adapterInfo,
    };
  }, pp);

  return result as DeviceHandle;
}

/**
 * Release the cached adapter/device pair in the page context.
 *
 * Does not destroy the device (the page may still hold references); it only
 * clears the cache so the next `ensureDevice` call creates a fresh pair.
 *
 * @param page - Puppeteer page
 */
export async function releaseDevice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__webgpuDeviceCache) {
      w.__webgpuDeviceCache = undefined;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Queue Capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize recoverable hook state in the page context.
 *
 * Must run before any other hook installation so the original methods can be
 * restored later.
 *
 * @param page - Puppeteer page
 */
async function ensureHookState(page: Page): Promise<void> {
  const hookScript = () => {
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
  };

  // evaluateOnNewDocument for future navigations
  await page.evaluateOnNewDocument(hookScript);

  // Also evaluate immediately on the current page
  await page.evaluate(hookScript);
}

/**
 * Install GPUQueue.submit and GPUDevice.createCommandEncoder hooks.
 *
 * **Recoverable**: stores original methods in `window.webgpuHookState` so
 * `uninstallGPUCommandHook` can restore them.
 *
 * **Structured**: intercepts render/compute/copy pass encoders to record
 * drawCalls, dispatch dimensions, pipeline labels, and pass labels.
 *
 * **Enhanced (defect #3)**: render/compute pass encoders also capture
 * pipeline-state metadata:
 *  - `setPipeline(pipeline)` → `pipelineLabel`, `pipelineSet=true`
 *  - `setVertexBuffer(slot, buffer)` → `vertexBuffers.push(slot)`
 *  - `setBindGroup(index, ...)` → `bindGroups.push(index)`
 *  - `setIndexBuffer(...)` (render only) → `indexBufferSet=true`
 *
 * These fields ride along on the command object pushed at pass `end()`. Copy
 * encoders have no pipeline state and are unaffected.
 *
 * @param page - Puppeteer page
 * @param captureCount - Maximum commands to capture
 * @returns Cleanup function that restores original methods
 */
export async function installGPUCommandHook(
  page: Page,
  captureCount: number,
): Promise<() => Promise<void>> {
  await ensureHookState(page);

  await page.evaluate((maxCommands: number) => {
    const state = (window as any).webgpuHookState as PageHookState;

    // If already installed, reset trace but keep hooks
    state.commandTrace = {
      commands: [],
      totalSubmissions: 0,
      startTime: performance.now(),
    };

    if (state.hooksInstalled) {
      return;
    }

    // Save original methods if not already saved
    if (!state.originalCreateCommandEncoder) {
      state.originalCreateCommandEncoder = GPUDevice.prototype.createCommandEncoder;
    }
    if (!state.originalSubmit) {
      state.originalSubmit = GPUQueue.prototype.submit;
    }

    function wrapRenderPassEncoder(encoder: any, passLabel: string | undefined): any {
      let drawCalls = 0;
      let pipelineLabel: string | undefined;
      let pipelineSet = false;
      let indexBufferSet = false;
      const vertexBuffers: number[] = [];
      const bindGroups: number[] = [];

      const drawMethods = ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect'];
      for (const method of drawMethods) {
        const original = (encoder as any)[method];
        if (typeof original !== 'function') continue;
        (encoder as any)[method] = function (...args: any[]) {
          drawCalls++;
          return original.apply(this, args);
        };
      }

      // Pipeline state hooks (defect #3)
      const originalSetPipeline = encoder.setPipeline;
      if (typeof originalSetPipeline === 'function') {
        encoder.setPipeline = function (pipeline: any) {
          pipelineLabel = pipeline?.label;
          pipelineSet = true;
          return originalSetPipeline.call(this, pipeline);
        };
      }

      const originalSetVertexBuffer = encoder.setVertexBuffer;
      if (typeof originalSetVertexBuffer === 'function') {
        encoder.setVertexBuffer = function (slot: number, ...rest: any[]) {
          vertexBuffers.push(slot);
          return originalSetVertexBuffer.apply(this, [slot, ...rest] as any);
        };
      }

      const originalSetBindGroup = encoder.setBindGroup;
      if (typeof originalSetBindGroup === 'function') {
        encoder.setBindGroup = function (index: number, ...rest: any[]) {
          bindGroups.push(index);
          return originalSetBindGroup.apply(this, [index, ...rest] as any);
        };
      }

      const originalSetIndexBuffer = encoder.setIndexBuffer;
      if (typeof originalSetIndexBuffer === 'function') {
        encoder.setIndexBuffer = function (...args: any[]) {
          indexBufferSet = true;
          return originalSetIndexBuffer.apply(this, args);
        };
      }

      const originalEnd = encoder.end;
      encoder.end = function () {
        const trace = state.commandTrace;
        if (trace && trace.commands.length < maxCommands && drawCalls > 0) {
          trace.commands.push({
            type: 'render',
            drawCalls,
            pipelineLabel,
            passLabel,
            timestamp: performance.now(),
            pipelineSet,
            vertexBuffers: vertexBuffers.slice(),
            bindGroups: bindGroups.slice(),
            indexBufferSet,
          });
        }
        return originalEnd.call(this);
      };

      return encoder;
    }

    function wrapComputePassEncoder(encoder: any, passLabel: string | undefined): any {
      let dispatchX = 0;
      let dispatchY = 0;
      let dispatchZ = 0;
      let pipelineLabel: string | undefined;
      let pipelineSet = false;
      const bindGroups: number[] = [];

      const originalDispatch = encoder.dispatchWorkgroups;
      encoder.dispatchWorkgroups = function (x: number, y?: number, z?: number) {
        dispatchX = x;
        dispatchY = y ?? 1;
        dispatchZ = z ?? 1;
        return originalDispatch.call(this, x, y, z);
      };

      const originalDispatchIndirect = encoder.dispatchWorkgroupsIndirect;
      if (typeof originalDispatchIndirect === 'function') {
        encoder.dispatchWorkgroupsIndirect = function (...args: any[]) {
          dispatchX = -1; // indirect: dimension unknown
          dispatchY = -1;
          dispatchZ = -1;
          return originalDispatchIndirect.apply(this, args);
        };
      }

      // Pipeline state hooks (defect #3) — compute passes have setPipeline/setBindGroup
      const originalSetPipeline = encoder.setPipeline;
      if (typeof originalSetPipeline === 'function') {
        encoder.setPipeline = function (pipeline: any) {
          pipelineLabel = pipeline?.label;
          pipelineSet = true;
          return originalSetPipeline.call(this, pipeline);
        };
      }

      const originalSetBindGroup = encoder.setBindGroup;
      if (typeof originalSetBindGroup === 'function') {
        encoder.setBindGroup = function (index: number, ...rest: any[]) {
          bindGroups.push(index);
          return originalSetBindGroup.apply(this, [index, ...rest] as any);
        };
      }

      const originalEnd = encoder.end;
      encoder.end = function () {
        const trace = state.commandTrace;
        if (trace && trace.commands.length < maxCommands && dispatchX > 0) {
          trace.commands.push({
            type: 'compute',
            dispatches: { x: dispatchX, y: dispatchY, z: dispatchZ },
            pipelineLabel,
            passLabel,
            timestamp: performance.now(),
            pipelineSet,
            bindGroups: bindGroups.slice(),
          });
        }
        return originalEnd.call(this);
      };

      return encoder;
    }

    function wrapCopyEncoder(encoder: any, passLabel: string | undefined): any {
      let copyOps = 0;
      const copyMethods = [
        'copyBufferToBuffer',
        'copyBufferToTexture',
        'copyTextureToBuffer',
        'copyTextureToTexture',
      ];
      for (const method of copyMethods) {
        const original = (encoder as any)[method];
        if (typeof original !== 'function') continue;
        (encoder as any)[method] = function (...args: any[]) {
          copyOps++;
          return original.apply(this, args);
        };
      }

      const originalFinish = encoder.finish;
      encoder.finish = function () {
        const trace = state.commandTrace;
        if (trace && trace.commands.length < maxCommands && copyOps > 0) {
          trace.commands.push({
            type: 'copy',
            drawCalls: copyOps,
            pipelineLabel: undefined,
            passLabel,
            timestamp: performance.now(),
          });
        }
        return originalFinish.call(this);
      };

      return encoder;
    }

    // Hook GPUDevice.createCommandEncoder
    GPUDevice.prototype.createCommandEncoder = function (descriptor: any) {
      const encoder = state.originalCreateCommandEncoder.call(this, descriptor);
      const passLabel = descriptor?.label;

      const originalBeginRenderPass = encoder.beginRenderPass;
      encoder.beginRenderPass = function (desc: any) {
        const passEncoder = originalBeginRenderPass.call(this, desc);
        return wrapRenderPassEncoder(passEncoder, desc?.label ?? passLabel);
      };

      const originalBeginComputePass = encoder.beginComputePass;
      encoder.beginComputePass = function (desc: any) {
        const passEncoder = originalBeginComputePass.call(this, desc);
        return wrapComputePassEncoder(passEncoder, desc?.label ?? passLabel);
      };

      return wrapCopyEncoder(encoder, passLabel);
    };

    // Hook GPUQueue.submit
    GPUQueue.prototype.submit = function (commandBuffers: GPUCommandBuffer[]) {
      const trace = state.commandTrace;
      if (trace) {
        trace.totalSubmissions += 1;
      }
      return state.originalSubmit.call(this, commandBuffers);
    };

    state.hooksInstalled = true;
  }, captureCount);

  // Return cleanup function that restores original methods
  return async () => {
    await uninstallGPUCommandHook(page);
  };
}

/**
 * Uninstall GPU command hooks and restore original prototype methods.
 *
 * @param page - Puppeteer page
 */
export async function uninstallGPUCommandHook(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as any).webgpuHookState as PageHookState | undefined;
    if (!state || !state.hooksInstalled) {
      return;
    }

    GPUQueue.prototype.submit = state.originalSubmit;
    GPUDevice.prototype.createCommandEncoder = state.originalCreateCommandEncoder;
    state.commandTrace = null;
    state.hooksInstalled = false;
  });
}

/**
 * Retrieve captured GPU command trace from page.
 *
 * @param page - Puppeteer page
 * @returns Command trace
 */
export async function getGPUCommandTrace(page: Page): Promise<GPUCommandTrace> {
  const trace = await page.evaluate(() => {
    const t = (window as any).webgpuHookState?.commandTrace;
    if (!t) {
      return null;
    }

    return {
      commands: t.commands,
      totalSubmissions: t.totalSubmissions,
      captureStartTime: t.startTime,
      captureEndTime: performance.now(),
    };
  });

  if (!trace) {
    return {
      commands: [],
      totalSubmissions: 0,
      captureStartTime: 0,
      captureEndTime: 0,
    };
  }

  return trace;
}

/**
 * Enhanced command analysis — infer command types from heuristics.
 *
 * **Heuristics**:
 * - High submission rate → likely render commands
 * - Low submission rate + long gaps → likely compute
 * - Periodic pattern → likely animation loop
 *
 * Kept for backward compatibility; with structured capture the `type` field is
 * already populated.
 *
 * @param trace - Command trace
 * @returns Enhanced trace with inferred types
 */
export function analyzeCommandTrace(trace: GPUCommandTrace): GPUCommandTrace & {
  inferredTypes: Array<{ command: GPUCommand; inferredType: 'render' | 'compute' | 'copy' }>;
} {
  const inferredTypes: Array<{
    command: GPUCommand;
    inferredType: 'render' | 'compute' | 'copy';
  }> = [];

  for (let i = 0; i < trace.commands.length; i++) {
    const cmd = trace.commands[i]!;
    const nextCmd = trace.commands[i + 1];

    // Heuristic: short gaps → render, long gaps → compute
    const gap = nextCmd ? nextCmd.timestamp - cmd.timestamp : 0;

    let inferredType: 'render' | 'compute' | 'copy' = 'render';
    if (gap > 50) {
      inferredType = 'compute';
    } else if (gap < 5) {
      inferredType = 'copy';
    }

    inferredTypes.push({ command: cmd, inferredType });
  }

  return {
    ...trace,
    inferredTypes,
  };
}

/**
 * Reset command trace without uninstalling hooks.
 *
 * Useful when starting a new capture window on a page that already has hooks.
 *
 * @param page - Puppeteer page
 */
export async function resetGPUCommandTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as any).webgpuHookState as PageHookState | undefined;
    if (!state) {
      return;
    }
    state.commandTrace = {
      commands: [],
      totalSubmissions: 0,
      startTime: performance.now(),
    };
  });
}

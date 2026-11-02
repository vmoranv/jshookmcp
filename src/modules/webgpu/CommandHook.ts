/**
 * GPU Command Queue Capture — recoverable hooks on GPUQueue.submit and
 * GPUDevice.createCommandEncoder with structured render/compute/copy interception.
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
 */

import type { Page } from 'rebrowser-puppeteer-core';
import type { GPUCommand } from '@server/domains/webgpu/types';
import type { PageHookState } from './CDPTypes';

export interface GPUCommandTrace {
  commands: GPUCommand[];
  totalSubmissions: number;
  captureStartTime: number;
  captureEndTime: number;
  /** Timestamp-query capability + resolution status (Fix 2). */
  timestampQuery?: {
    supported: boolean;
    timestampPeriod?: number;
    resolvedPasses?: number;
    pendingPasses?: number;
    overflow?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Page-script payload that initialises the WebGPU hook state bag. */
function hookScript(): void {
  if (typeof (window as any).webgpuHookState !== 'undefined') {
    return;
  }

  const state: PageHookState = {
    originalSubmit: GPUQueue.prototype.submit,
    originalCreateCommandEncoder: GPUDevice.prototype.createCommandEncoder,
    hooksInstalled: false,
    commandTrace: null,
    allocations: [],
    timestampQuery: {
      supported: false,
      querySet: null,
      count: 0,
      next: 0,
      timestampPeriod: 1,
      pending: [],
      results: {},
      overflow: false,
      resolving: false,
      resolveStartedAt: 0,
      device: null,
    },
  };

  (window as any).webgpuHookState = state;
}

/**
 * Initialize recoverable hook state in the page context.
 */
async function ensureHookState(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(hookScript);
  await page.evaluate(hookScript);
}

/**
 * Install GPUQueue.submit and GPUDevice.createCommandEncoder hooks.
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

  await page.evaluate(async (maxCommands: number) => {
    const state = (window as any).webgpuHookState as PageHookState;

    // If already installed, reset trace but keep hooks
    state.commandTrace = {
      commands: [],
      totalSubmissions: 0,
      startTime: performance.now(),
    };

    // ── Timestamp-query init (Fix 2) ──────────────────────────────────────
    // On re-install, the previous query set may be fully written — rebuild it
    // so a fresh capture window starts with a clean slot pool.
    const ts = state.timestampQuery;
    if (!ts) {
      state.timestampQuery = {
        supported: false,
        querySet: null,
        count: 0,
        next: 0,
        timestampPeriod: 1,
        pending: [],
        results: {},
        overflow: false,
        resolving: false,
        resolveStartedAt: 0,
        device: null,
      };
    } else {
      // Destroy the previous querySet before overwriting the reference so the
      // GPU resource is freed. The old reference is abandoned after this block.
      if (ts.querySet && typeof ts.querySet.destroy === 'function') {
        ts.querySet.destroy();
      }
      state.timestampQuery = {
        ...ts,
        querySet: null,
        count: 0,
        next: 0,
        pending: [],
        results: {},
        overflow: false,
        resolving: false,
        resolveStartedAt: 0,
        device: null,
      };
    }

    // Resolve the page device (prefer the shared cache; fall back to a fresh
    // adapter/device request — only when navigator.gpu is present, so the hook
    // still installs on non-WebGPU pages with timestampQuery.supported=false).
    let timingDevice: any = null;
    const cached = (window as any).__webgpuDeviceCache;
    if (cached && cached.device && !cached.lost) {
      timingDevice = cached.device;
    } else if ((navigator as any).gpu) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          timingDevice = await adapter.requestDevice();
        }
      } catch {
        // Environment without a usable adapter — stay unsupported.
        timingDevice = null;
      }
    }

    const timestampQuery = state.timestampQuery!;
    if (timingDevice) {
      const features = timingDevice.features;
      const supported = features ? features.has('timestamp-query') : false;
      const period =
        timingDevice.limits && typeof timingDevice.limits.timestampPeriod === 'number'
          ? timingDevice.limits.timestampPeriod
          : 1;
      timestampQuery.device = timingDevice;
      timestampQuery.timestampPeriod = period;
      if (supported) {
        // 2 slots per pass (begin + end). 512 passes is ample for a capture
        // window; when exhausted, further passes are captured untimed and
        // `overflow` is reported.
        const SLOT_COUNT = 1024;
        timestampQuery.querySet = timingDevice.createQuerySet({
          type: 'timestamp',
          count: SLOT_COUNT,
        });
        timestampQuery.count = SLOT_COUNT;
        timestampQuery.next = 0;
        timestampQuery.supported = true;
      } else {
        timestampQuery.supported = false;
      }
    }

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
      // Draw statistics (Fix 5): last-draw params + aggregated vertex count.
      // Indirect draws cannot report a static count; the indirect buffer size
      // is surfaced best-effort instead.
      let lastVertexCount: number | undefined;
      let lastInstanceCount: number | undefined;
      let lastIndirect = false;
      let lastIndirectBufferSize: number | undefined;
      let totalVertexCount = 0;

      const drawMethods = ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect'];
      for (const method of drawMethods) {
        const original = (encoder as any)[method];
        if (typeof original !== 'function') continue;
        (encoder as any)[method] = function (...args: any[]) {
          drawCalls++;
          if (method === 'draw' || method === 'drawIndexed') {
            const count = args[0];
            if (typeof count === 'number') {
              lastVertexCount = count;
              totalVertexCount += count;
            }
            const instanceCount = args[1];
            lastInstanceCount = typeof instanceCount === 'number' ? instanceCount : 1;
            lastIndirect = false;
          } else {
            // drawIndirect / drawIndexedIndirect: vertex count lives in the
            // indirect buffer — read the buffer size (best effort) and flag it.
            lastIndirect = true;
            const indirectBuffer = args[0];
            lastIndirectBufferSize =
              indirectBuffer && typeof indirectBuffer.size === 'number'
                ? indirectBuffer.size
                : undefined;
            lastVertexCount = undefined;
            lastInstanceCount = undefined;
          }
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
            vertexCount: lastVertexCount,
            instanceCount: lastInstanceCount,
            indirect: lastIndirect,
            indirectBufferSize: lastIndirectBufferSize,
            totalVertexCount,
          });
          // Associate this pass with its allocated timestamp slots so the
          // post-submit resolution can attach gpuStartNs/gpuEndNs.
          const slotMark = (encoder as any).__jshookTimestamp;
          const tsq = state.timestampQuery;
          if (slotMark && tsq && tsq.supported) {
            const pend = tsq.pending.find((p) => p.commandIndex === null);
            if (pend) {
              pend.commandIndex = trace.commands.length - 1;
            }
          }
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
          const slotMark = (encoder as any).__jshookTimestamp;
          const tsq = state.timestampQuery;
          if (slotMark && tsq && tsq.supported) {
            const pend = tsq.pending.find((p) => p.commandIndex === null);
            if (pend) {
              pend.commandIndex = trace.commands.length - 1;
            }
          }
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

      // Allocate 2 timestamp slots per pass and inject `timestampWrites` into
      // the pass descriptor (Fix 2). The descriptor is shallow-copied so the
      // caller's object is not mutated. When the slot pool is exhausted the
      // pass is captured untimed and `overflow` is flagged.
      function injectTimestampWrites(desc: any): any {
        const tsq = state.timestampQuery;
        if (!tsq || !tsq.supported) {
          return desc;
        }
        if (tsq.next + 2 > tsq.count) {
          tsq.overflow = true;
          return desc;
        }
        const begin = tsq.next;
        const end = tsq.next + 1;
        tsq.next += 2;
        tsq.pending.push({ commandIndex: null, begin, end });
        const newDesc = desc && typeof desc === 'object' ? { ...desc } : {};
        newDesc.timestampWrites = {
          querySet: tsq.querySet,
          beginningOfPassWriteIndex: begin,
          endOfPassWriteIndex: end,
        };
        return newDesc;
      }

      const originalBeginRenderPass = encoder.beginRenderPass;
      encoder.beginRenderPass = function (desc: any) {
        const timedDesc = injectTimestampWrites(desc);
        const passEncoder = originalBeginRenderPass.call(this, timedDesc);
        const wrapped = wrapRenderPassEncoder(passEncoder, timedDesc?.label ?? passLabel);
        const tsq = state.timestampQuery;
        if (tsq && tsq.supported && tsq.pending.length > 0) {
          const pend = tsq.pending[tsq.pending.length - 1];
          if (pend && pend.commandIndex === null) {
            wrapped.__jshookTimestamp = { begin: pend.begin, end: pend.end };
          }
        }
        return wrapped;
      };

      const originalBeginComputePass = encoder.beginComputePass;
      encoder.beginComputePass = function (desc: any) {
        const timedDesc = injectTimestampWrites(desc);
        const passEncoder = originalBeginComputePass.call(this, timedDesc);
        const wrapped = wrapComputePassEncoder(passEncoder, timedDesc?.label ?? passLabel);
        const tsq = state.timestampQuery;
        if (tsq && tsq.supported && tsq.pending.length > 0) {
          const pend = tsq.pending[tsq.pending.length - 1];
          if (pend && pend.commandIndex === null) {
            wrapped.__jshookTimestamp = { begin: pend.begin, end: pend.end };
          }
        }
        return wrapped;
      };

      return wrapCopyEncoder(encoder, passLabel);
    };

    // Hook GPUQueue.submit — after submitting, asynchronously resolve any
    // timestamp queries whose passes have been captured (Fix 2). The resolve
    // chain runs detached; getGPUCommandTrace waits for it up to a deadline.
    GPUQueue.prototype.submit = function (commandBuffers: GPUCommandBuffer[]) {
      const trace = state.commandTrace;
      if (trace) {
        trace.totalSubmissions += 1;
      }
      const result = state.originalSubmit.call(this, commandBuffers);

      const tsq = state.timestampQuery;
      if (
        tsq &&
        tsq.supported &&
        !tsq.resolving &&
        tsq.pending.some((p) => p.commandIndex !== null)
      ) {
        tsq.resolving = true;
        tsq.resolveStartedAt = performance.now();
        const resolveCount = tsq.next;
        const deviceForTiming = tsq.device;
        if (deviceForTiming && deviceForTiming.queue) {
          deviceForTiming.queue
            .onSubmittedWorkDone()
            .then(() => {
              const dst = deviceForTiming.createBuffer({
                size: resolveCount * 8,
                usage:
                  ((globalThis as any).GPUBufferUsage?.COPY_DST || 0) |
                  ((globalThis as any).GPUBufferUsage?.MAP_READ || 0),
              });
              deviceForTiming.queue.resolveQuerySet(tsq.querySet, 0, resolveCount, dst, 0);
              return deviceForTiming.queue
                .onSubmittedWorkDone()
                .then(() => dst.mapAsync((globalThis as any).GPUMapMode?.READ || 0))
                .then(() => {
                  const arr = new BigUint64Array(dst.getMappedRange());
                  const period = tsq.timestampPeriod;
                  for (const p of tsq.pending) {
                    if (p.commandIndex === null) {
                      continue;
                    }
                    const startTicks = Number(arr[p.begin] ?? 0n);
                    const endTicks = Number(arr[p.end] ?? 0n);
                    const startNs = startTicks * period;
                    const endNs = endTicks * period;
                    tsq.results[p.commandIndex] = {
                      startNs,
                      endNs,
                      elapsedNs: Math.max(0, endNs - startNs),
                    };
                  }
                  tsq.pending = [];
                  dst.destroy();
                  tsq.resolving = false;
                })
                .catch(() => {
                  // Resolution failed (e.g. mapAsync rejected or device lost).
                  // Destroy the dst buffer that was already allocated, then
                  // leave pending for the next submit; never throw.
                  try {
                    dst.destroy();
                  } catch {
                    // device may already be lost — best-effort
                  }
                  tsq.resolving = false;
                });
            })
            .catch(() => {
              tsq.resolving = false;
            });
        } else {
          tsq.resolving = false;
        }
      }

      return result;
    };

    state.hooksInstalled = true;
  }, captureCount);

  return async () => {
    await uninstallGPUCommandHook(page);
  };
}

/**
 * Uninstall GPU command hooks and restore original prototype methods.
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
    // Timestamp resolution chains reference the (now-restored) prototypes only
    // via the stored device; mark resolving false so a later install is clean.
    if (state.timestampQuery) {
      state.timestampQuery.resolving = false;
      // Destroy the querySet so GPU resources are released. The device may
      // already be lost, so best-effort via optional chaining.
      if (
        state.timestampQuery.querySet &&
        typeof state.timestampQuery.querySet.destroy === 'function'
      ) {
        state.timestampQuery.querySet.destroy();
      }
    }
  });
}

/**
 * Retrieve captured GPU command trace from page.
 *
 * When a timestamp-query resolution is still in flight, waits up to
 * `TIMESTAMP_RESOLVE_WAIT_MS` for it to land so per-pass GPU timings are
 * attached before the trace is returned.
 */
export async function getGPUCommandTrace(page: Page): Promise<GPUCommandTrace> {
  const trace = await page.evaluate(async () => {
    const t = (window as any).webgpuHookState?.commandTrace;
    const tsq = (window as any).webgpuHookState?.timestampQuery;
    if (!t) {
      return null;
    }

    if (tsq && tsq.resolving) {
      const deadline = tsq.resolveStartedAt + TIMESTAMP_RESOLVE_WAIT_MS;
      while (tsq.resolving && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    const commands = t.commands.map((cmd: any, index: number) => {
      const r = tsq && tsq.results[index];
      if (!r) {
        return cmd;
      }
      return {
        ...cmd,
        gpuStartNs: r.startNs,
        gpuEndNs: r.endNs,
        gpuElapsedNs: r.elapsedNs,
      };
    });

    return {
      commands,
      totalSubmissions: t.totalSubmissions,
      captureStartTime: t.startTime,
      captureEndTime: performance.now(),
      timestampQuery: tsq
        ? {
            supported: tsq.supported,
            timestampPeriod: tsq.timestampPeriod,
            resolvedPasses: Object.keys(tsq.results).length,
            pendingPasses: tsq.pending.length,
            overflow: tsq.overflow,
          }
        : { supported: false },
    };
  });

  if (!trace) {
    return {
      commands: [],
      totalSubmissions: 0,
      captureStartTime: 0,
      captureEndTime: 0,
      timestampQuery: { supported: false },
    };
  }

  return trace;
}

/** Max wait for in-flight timestamp resolution inside getGPUCommandTrace (ms). */
const TIMESTAMP_RESOLVE_WAIT_MS = 1500;

/**
 * Convert GPU timestamp ticks to nanoseconds using the device's
 * `timestampPeriod` (ns per tick). Pure helper, exported for testability.
 */
export function toNanoseconds(ticks: number, timestampPeriod: number): number {
  return ticks * timestampPeriod;
}

/**
 * Enhanced command analysis — infer command types from heuristics.
 *
 * Kept for backward compatibility; with structured capture the `type` field is
 * already populated.
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

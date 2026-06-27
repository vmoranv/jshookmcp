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
  });
}

/**
 * Retrieve captured GPU command trace from page.
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

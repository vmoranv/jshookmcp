/**
 * Pipeline Dump — recoverable hook on GPUDevice pipeline/layout factory
 * methods.
 *
 * Captures the full descriptor of every pipeline and bind-group layout an app
 * creates, so an analyst can resolve a captured `bindGroups: [0,1]` to the
 * actual resources a draw/dispatch operated on. Pipeline descriptors are
 * JS-side and fully accessible (unlike command-buffer binary, which CDP cannot
 * expose).
 *
 * Hooks createRenderPipeline / createComputePipeline / createBindGroupLayout
 * (plus their async variants). GPU object references inside a descriptor
 * (GPUShaderModule, GPUBufferLayout-backed objects) are sanitized to a
 * `{ __gpu, label }` placeholder so the captured descriptor is serializable.
 *
 * Uses an independent page state bag (`window.webgpuPipelineHookState`).
 *
 * **Recoverable**: stores originals so uninstall restores prototype methods.
 */
import type { Page } from 'rebrowser-puppeteer-core';

export interface CapturedPipeline {
  kind: 'render' | 'compute' | 'bind-group-layout';
  method: string;
  /** Sanitized descriptor (GPU object references reduced to { __gpu, label }). */
  descriptor: unknown;
  label?: string;
  timestamp: number;
}

export interface PipelineDumpState {
  pipelines: CapturedPipeline[];
  totalCreated: number;
}

/** Page-script payload that initialises the pipeline hook state bag. */
function pipelineHookScript(): void {
  const w = window as any;
  if (w.webgpuPipelineHookState !== undefined) {
    return;
  }
  w.webgpuPipelineHookState = {
    installed: false,
    pipelines: [],
    totalCreated: 0,
    wrapped: [],
  };
}

async function ensurePipelineHookState(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(pipelineHookScript);
  await page.evaluate(pipelineHookScript);
}

/**
 * Install a recoverable hook on GPUDevice pipeline/layout factory methods.
 *
 * @returns Cleanup function that restores the original prototype methods.
 */
export async function installPipelineDumpHook(
  page: Page,
  maxPipelines: number,
): Promise<() => Promise<void>> {
  await ensurePipelineHookState(page);

  await page.evaluate((max: number) => {
    const w = window as any;
    const state = w.webgpuPipelineHookState;

    // Reset capture buffer but keep the hook if already installed.
    state.pipelines = [];
    state.totalCreated = 0;

    if (state.installed) {
      return;
    }

    if (typeof GPUDevice === 'undefined' || !GPUDevice.prototype) {
      throw new Error('WebGPU (GPUDevice.prototype) is not available in this page');
    }

    // Reduce GPU object references to a serializable placeholder so the
    // captured descriptor is JSON-safe. Plain objects/arrays/primitives pass
    // through; anything with a non-trivial constructor (GPUShaderModule, etc.)
    // becomes { __gpu, label }.
    const MAX_DEPTH = 8;
    const sanitize = (value: any, depth = 0): any => {
      if (value === null || typeof value !== 'object') {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((v) => sanitize(v, depth + 1));
      }
      if (depth > MAX_DEPTH) {
        return '<deep>';
      }
      const ctor = typeof value.constructor === 'function' ? value.constructor.name : '';
      if (ctor !== '' && ctor !== 'Object' && ctor !== 'Array') {
        return {
          __gpu: ctor,
          label: typeof value.label === 'string' ? value.label : undefined,
        };
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        out[key] = sanitize(value[key], depth + 1);
      }
      return out;
    };

    const proto: any = GPUDevice.prototype;
    const wrap = (name: string, kind: CapturedPipeline['kind']) => {
      const orig = proto[name];
      if (typeof orig !== 'function') {
        return;
      }
      proto[name] = function (descriptor: any) {
        try {
          state.totalCreated += 1;
          if (state.pipelines.length < max) {
            const entry: CapturedPipeline = {
              kind,
              method: name,
              descriptor: sanitize(descriptor),
              timestamp: performance.now(),
            };
            if (typeof descriptor?.label === 'string') {
              entry.label = descriptor.label;
            }
            state.pipelines.push(entry);
          }
        } catch {
          /* instrumentation must never break the app */
        }
        return orig.apply(this, arguments as any);
      };
      state.wrapped.push({ name, orig });
    };

    wrap('createRenderPipeline', 'render');
    wrap('createRenderPipelineAsync', 'render');
    wrap('createComputePipeline', 'compute');
    wrap('createComputePipelineAsync', 'compute');
    wrap('createBindGroupLayout', 'bind-group-layout');

    state.installed = true;
  }, maxPipelines);

  return async () => {
    await uninstallPipelineDumpHook(page);
  };
}

/** Restore the original pipeline/layout factory prototype methods. */
export async function uninstallPipelineDumpHook(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const state = w.webgpuPipelineHookState;
    if (!state || !state.installed) {
      return;
    }
    const proto: any = GPUDevice.prototype;
    if (Array.isArray(state.wrapped)) {
      for (const entry of state.wrapped) {
        try {
          proto[entry.name] = entry.orig;
        } catch {
          /* ignore */
        }
      }
    }
    state.installed = false;
  });
}

/** Retrieve captured pipelines + total create-call count. */
export async function getCapturedPipelines(page: Page): Promise<PipelineDumpState> {
  const result = await page.evaluate(() => {
    const state = (window as any).webgpuPipelineHookState;
    if (!state) {
      return null;
    }
    return {
      pipelines: state.pipelines,
      totalCreated: state.totalCreated,
    };
  });
  if (!result) {
    return { pipelines: [], totalCreated: 0 };
  }
  return result as PipelineDumpState;
}

/**
 * Shader Source Capture — recoverable hook on
 * GPUDevice.prototype.createShaderModule.
 *
 * Captures every WGSL/SPIR-V source an application compiles at runtime. Shader
 * source is the only artifact that reveals what a WebGPU compute/render
 * pipeline actually computes (e.g. legitimate physics vs. a cryptominer), and
 * without this hook analysts must reverse the JS bundle to find the shader
 * string — defeating the point of having a WebGPU domain.
 *
 * Uses an independent page state bag (`window.webgpuShaderHookState`) so it does
 * not interfere with the command-queue hook (`window.webgpuHookState`).
 *
 * **Recoverable**: stores the original `createShaderModule` so uninstall
 * restores the prototype exactly.
 */
import type { Page } from 'rebrowser-puppeteer-core';

export interface CapturedShader {
  code: string;
  label?: string;
  /** Best-effort `getCompilationInfo()` result (async, attached when resolved). */
  compilationInfo?: unknown;
  timestamp: number;
}

export interface ShaderCaptureState {
  shaders: CapturedShader[];
  totalCreated: number;
}

/** Page-script payload that initialises the shader hook state bag. */
function shaderHookScript(): void {
  const w = window as any;
  if (w.webgpuShaderHookState !== undefined) {
    return;
  }
  w.webgpuShaderHookState = {
    originalCreateShaderModule: null as unknown,
    installed: false,
    shaders: [] as CapturedShader[],
    totalCreated: 0,
  };
}

async function ensureShaderHookState(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(shaderHookScript);
  await page.evaluate(shaderHookScript);
}

/**
 * Install a recoverable hook on GPUDevice.prototype.createShaderModule that
 * accumulates every compiled shader's source.
 *
 * @returns Cleanup function that restores the original prototype method.
 */
export async function installShaderSourceHook(
  page: Page,
  maxShaders: number,
): Promise<() => Promise<void>> {
  await ensureShaderHookState(page);

  await page.evaluate((max: number) => {
    const w = window as any;
    const state = w.webgpuShaderHookState;

    // Reset capture buffer but keep the hook if already installed.
    state.shaders = [];
    state.totalCreated = 0;

    if (state.installed) {
      return;
    }

    if (typeof GPUDevice === 'undefined' || !GPUDevice.prototype.createShaderModule) {
      throw new Error('WebGPU (GPUDevice.createShaderModule) is not available in this page');
    }

    state.originalCreateShaderModule = GPUDevice.prototype.createShaderModule;

    GPUDevice.prototype.createShaderModule = function (descriptor: any) {
      const module = state.originalCreateShaderModule.call(this, descriptor);
      try {
        state.totalCreated += 1;
        if (state.shaders.length < max) {
          const entry: CapturedShader = {
            code: typeof descriptor?.code === 'string' ? descriptor.code : '',
            timestamp: performance.now(),
          };
          if (typeof descriptor?.label === 'string') {
            entry.label = descriptor.label;
          }
          // compilationInfo is async; attach best-effort without blocking the app.
          if (module && typeof module.getCompilationInfo === 'function') {
            module.getCompilationInfo().then(
              (info: unknown) => {
                entry.compilationInfo = info;
              },
              () => {
                /* ignore — instrumentation must never break the app */
              },
            );
          }
          state.shaders.push(entry);
        }
      } catch {
        // Never let instrumentation break the application's createShaderModule.
      }
      return module;
    };

    state.installed = true;
  }, maxShaders);

  return async () => {
    await uninstallShaderSourceHook(page);
  };
}

/** Restore the original createShaderModule prototype method. */
export async function uninstallShaderSourceHook(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const state = w.webgpuShaderHookState;
    if (!state || !state.installed) {
      return;
    }
    if (state.originalCreateShaderModule) {
      GPUDevice.prototype.createShaderModule = state.originalCreateShaderModule;
    }
    state.installed = false;
  });
}

/** Retrieve captured shader sources + total createShaderModule call count. */
export async function getCapturedShaders(page: Page): Promise<ShaderCaptureState> {
  const result = await page.evaluate(() => {
    const state = (window as any).webgpuShaderHookState;
    if (!state) {
      return null;
    }
    return {
      shaders: state.shaders as CapturedShader[],
      totalCreated: state.totalCreated as number,
    };
  });
  if (!result) {
    return { shaders: [], totalCreated: 0 };
  }
  return result;
}

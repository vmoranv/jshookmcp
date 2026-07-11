/**
 * Error Capture — recoverable hook for WebGPU validation errors + device.lost.
 *
 * Surfaces the diagnostics that a target app silently swallows. When a WebGPU
 * pipeline fails (fingerprinting probes, obfuscated WASM-driven WebGPU), the
 * only visible symptom today is "the buffer is empty" / "zero draw calls"; the
 * actual validation errors are never reported. This hook accumulates them via
 * `device.onuncapturederror` and optionally wraps `createBuffer`/`createTexture`
 * in push/pop error scopes to attribute failures to specific calls.
 *
 * Uses an independent page state bag (`window.webgpuErrorHookState`) so it does
 * not interfere with the shader hook (`webgpuShaderHookState`) or the
 * command-queue hook (`webgpuHookState`).
 *
 * **Recoverable**: stores originals so uninstall restores prototype methods
 * exactly.
 */
import type { Page } from 'rebrowser-puppeteer-core';

export interface CapturedError {
  /** GPUError type: 'validation' | 'out-of-memory' | 'internal' | string. */
  type: string;
  message: string;
  /** When captured via allocation wrapping: 'createBuffer' | 'createTexture'. */
  source?: string;
  /** The descriptor label, when captured via allocation wrapping. */
  label?: string;
  timestamp: number;
}

export interface DeviceLostInfo {
  reason: string;
  message: string;
}

export interface ErrorCaptureState {
  errors: CapturedError[];
  deviceLost: DeviceLostInfo | null;
  totalErrors: number;
}

export interface ErrorCaptureOptions {
  captureCount: number;
  /** Wrap createBuffer/createTexture in error scopes to attribute failures. */
  wrapAllocations?: boolean;
}

/** Page-script payload that initialises the error hook state bag. */
function errorHookScript(): void {
  const w = window as any;
  if (w.webgpuErrorHookState !== undefined) {
    return;
  }
  w.webgpuErrorHookState = {
    installed: false,
    errors: [],
    totalErrors: 0,
    deviceLost: null,
    errorHandler: null,
    device: null,
    wrapped: [],
    lostRegistered: false,
  };
}

async function ensureErrorHookState(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(errorHookScript);
  await page.evaluate(errorHookScript);
}

/**
 * Install a recoverable WebGPU error-capture hook. Requires a cached
 * `GPUDevice` on `window.__webgpuDeviceCache` (populated by ensureDevice via
 * webgpu_adapter_info / webgpu_capture_commands); if absent it tries to create
 * one from `navigator.gpu`.
 *
 * @returns Cleanup function that removes the listener and restores prototypes.
 */
export async function installErrorCaptureHook(
  page: Page,
  options: ErrorCaptureOptions,
): Promise<() => Promise<void>> {
  await ensureErrorHookState(page);

  await page.evaluate(async (opts: ErrorCaptureOptions) => {
    const w = window as any;
    const state = w.webgpuErrorHookState;

    // Reset capture buffer but keep the hook if already installed.
    state.errors = [];
    state.totalErrors = 0;
    state.deviceLost = null;

    if (state.installed) {
      return;
    }

    let device = w.__webgpuDeviceCache?.device ?? null;
    if (!device) {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('WebGPU (navigator.gpu) is not available in this page');
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('No GPU adapter available');
      }
      device = await adapter.requestDevice();
      w.__webgpuDeviceCache = w.__webgpuDeviceCache || {};
      w.__webgpuDeviceCache.device = device;
    }
    state.device = device;

    const handler = (event: any) => {
      try {
        state.totalErrors += 1;
        if (state.errors.length < opts.captureCount) {
          const err = event?.error ?? {};
          state.errors.push({
            type: typeof err.type === 'string' ? err.type : 'unknown',
            message: typeof err.message === 'string' ? err.message : '',
            timestamp: performance.now(),
          });
        }
      } catch {
        /* instrumentation must never break the app */
      }
    };
    state.errorHandler = handler;
    device.addEventListener('uncapturederror', handler);

    // device.lost resolves if/when the device is lost.
    if (!state.lostRegistered) {
      device.lost.then(
        (info: any) => {
          state.deviceLost = {
            reason: typeof info?.reason === 'string' ? info.reason : 'unknown',
            message: typeof info?.message === 'string' ? info.message : '',
          };
        },
        () => {
          /* ignore */
        },
      );
      state.lostRegistered = true;
    }

    if (opts.wrapAllocations) {
      const proto: any = GPUDevice.prototype;
      const wrap = (name: string) => {
        const orig = proto[name];
        proto[name] = function (this: any, descriptor: any) {
          try {
            this.pushErrorScope('validation');
            const result = orig.call(this, descriptor);
            this.popErrorScope().then(
              (err: any) => {
                if (err && state.errors.length < opts.captureCount) {
                  state.errors.push({
                    type: typeof err.type === 'string' ? err.type : 'validation',
                    message: typeof err.message === 'string' ? err.message : '',
                    source: name,
                    label: typeof descriptor?.label === 'string' ? descriptor.label : undefined,
                    timestamp: performance.now(),
                  });
                }
              },
              () => {
                /* ignore */
              },
            );
            return result;
          } catch {
            return orig.call(this, descriptor);
          }
        };
        state.wrapped.push({ name, orig });
      };
      wrap('createBuffer');
      wrap('createTexture');
    }

    state.installed = true;
  }, options);

  return async () => {
    await uninstallErrorCaptureHook(page);
  };
}

/** Remove the uncapturederror listener and restore wrapped prototype methods. */
export async function uninstallErrorCaptureHook(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const state = w.webgpuErrorHookState;
    if (!state || !state.installed) {
      return;
    }
    if (state.device && state.errorHandler) {
      try {
        state.device.removeEventListener('uncapturederror', state.errorHandler);
      } catch {
        /* ignore */
      }
    }
    if (Array.isArray(state.wrapped)) {
      const proto: any = GPUDevice.prototype;
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

/** Retrieve captured errors, device-lost state, and total error count. */
export async function getCapturedErrors(page: Page): Promise<ErrorCaptureState> {
  const result = await page.evaluate(() => {
    const state = (window as any).webgpuErrorHookState;
    if (!state) {
      return null;
    }
    return {
      errors: state.errors,
      deviceLost: state.deviceLost,
      totalErrors: state.totalErrors,
    };
  });
  if (!result) {
    return { errors: [], deviceLost: null, totalErrors: 0 };
  }
  return result as ErrorCaptureState;
}

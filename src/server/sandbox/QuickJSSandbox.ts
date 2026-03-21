/**
 * QuickJSSandbox — WASM-isolated JavaScript execution engine.
 *
 * Uses quickjs-emscripten to run untrusted code inside a QuickJS WASM
 * runtime.  Each `execute()` call spins up a fresh runtime (no state
 * leakage across calls) with configurable timeout and memory limits.
 *
 * Provides stronger isolation than the existing Node.js vm-based
 * ExecutionSandbox because the guest code runs inside WebAssembly —
 * it cannot reach Node.js APIs, the filesystem, or the network even
 * if it escapes the QuickJS VM.
 */

import { getQuickJS, type QuickJSHandle, type QuickJSContext } from 'quickjs-emscripten';
import type { SandboxOptions, SandboxResult } from '@server/sandbox/types';

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Marshal a host value into a QuickJS handle.
 *
 * Supports primitives, arrays, and plain objects.  Anything else
 * is converted to its JSON representation (string).
 */
function marshalToQuickJS(ctx: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) return ctx.undefined;
  switch (typeof value) {
    case 'string':
      return ctx.newString(value);
    case 'number':
      return ctx.newNumber(value);
    case 'boolean':
      return value ? ctx.true : ctx.false;
    case 'object': {
      if (Array.isArray(value)) {
        const arr = ctx.newArray();
        for (let i = 0; i < value.length; i++) {
          const elem = marshalToQuickJS(ctx, value[i]);
          ctx.setProp(arr, i, elem);
          elem.dispose();
        }
        return arr;
      }
      // Plain object
      const obj = ctx.newObject();
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const prop = marshalToQuickJS(ctx, v);
        ctx.setProp(obj, k, prop);
        prop.dispose();
      }
      return obj;
    }
    default:
      return ctx.newString(String(value));
  }
}

/**
 * Unmarshal a QuickJS handle back to a host value.
 */
function unmarshalFromQuickJS(ctx: QuickJSContext, handle: QuickJSHandle): unknown {
  const ty = ctx.typeof(handle);
  switch (ty) {
    case 'undefined':
      return undefined;
    case 'number':
      return ctx.getNumber(handle);
    case 'string':
      return ctx.getString(handle);
    case 'boolean': {
      return ctx.dump(handle);
    }
    case 'object': {
      // Use dump for convenience — it handles arrays / objects recursively
      return ctx.dump(handle);
    }
    default:
      return ctx.dump(handle);
  }
}

export class QuickJSSandbox {
  /**
   * Execute JavaScript code inside a fresh WASM-isolated QuickJS runtime.
   *
   * Every call creates a new runtime + context, evaluates code, and tears
   * it down.  There is zero state leakage between calls.
   */
  async execute(code: string, options: SandboxOptions = {}): Promise<SandboxResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES;

    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();

    // Resource limits
    runtime.setMemoryLimit(memoryLimitBytes);

    // Timeout enforcement via interrupt handler
    const startTime = Date.now();
    let timedOut = false;
    runtime.setInterruptHandler(() => {
      if (Date.now() - startTime > timeoutMs) {
        timedOut = true;
        return true; // interrupt execution
      }
      return false;
    });

    const context = runtime.newContext();
    const logs: string[] = [];

    try {
      // Inject console.log stub to capture output
      this._injectConsole(context, logs);

      // Inject user-supplied globals
      if (options.globals) {
        this._injectGlobals(context, options.globals);
      }

      // Evaluate the user code
      const result = context.evalCode(code, 'sandbox-eval.js');

      if (result.error) {
        const errorMsg = context.dump(result.error);
        result.error.dispose();

        if (timedOut) {
          return {
            ok: false,
            error: 'Execution timed out',
            timedOut: true,
            durationMs: Date.now() - startTime,
            logs,
          };
        }

        return {
          ok: false,
          error: typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : String(errorMsg),
          timedOut: false,
          durationMs: Date.now() - startTime,
          logs,
        };
      }

      const output = unmarshalFromQuickJS(context, result.value);
      result.value.dispose();

      return {
        ok: true,
        output,
        timedOut: false,
        durationMs: Date.now() - startTime,
        logs,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        timedOut,
        durationMs: Date.now() - startTime,
        logs,
      };
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }

  /**
   * Inject a `console` object into the sandbox whose `log` method
   * pushes stringified arguments into the captured `logs` array.
   */
  private _injectConsole(ctx: QuickJSContext, logs: string[]): void {
    const consoleObj = ctx.newObject();
    const logFn = ctx.newFunction('log', (...args: QuickJSHandle[]) => {
      const parts = args.map((a) => {
        const val = unmarshalFromQuickJS(ctx, a);
        return typeof val === 'string' ? val : JSON.stringify(val);
      });
      logs.push(parts.join(' '));
    });

    ctx.setProp(consoleObj, 'log', logFn);
    ctx.setProp(consoleObj, 'warn', logFn);
    ctx.setProp(consoleObj, 'error', logFn);
    ctx.setProp(ctx.global, 'console', consoleObj);

    logFn.dispose();
    consoleObj.dispose();
  }

  /**
   * Inject user-supplied global variables into the QuickJS context.
   */
  private _injectGlobals(ctx: QuickJSContext, globals: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(globals)) {
      const handle = marshalToQuickJS(ctx, value);
      ctx.setProp(ctx.global, key, handle);
      handle.dispose();
    }
  }
}

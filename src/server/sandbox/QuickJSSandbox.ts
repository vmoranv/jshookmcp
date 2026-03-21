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
import type { MCPBridge } from '@server/sandbox/MCPBridge';
import { SANDBOX_HELPER_SOURCE } from '@server/sandbox/SandboxHelpers';

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
  private bridge: MCPBridge | null = null;

  /**
   * Set an optional MCP bridge for host tool invocation from sandbox.
   */
  setBridge(bridge: MCPBridge): void {
    this.bridge = bridge;
  }

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

      // Inject pre-built helper libraries
      this._injectHelpers(context);

      // Inject MCP bridge if available
      if (this.bridge) {
        this._injectBridge(context, this.bridge, logs);
      }

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

  /**
   * Inject pre-built helper libraries (base64, hex, hash, etc.) into the
   * sandbox global scope by evaluating the helper source code.
   */
  private _injectHelpers(ctx: QuickJSContext): void {
    const result = ctx.evalCode(SANDBOX_HELPER_SOURCE, 'sandbox-helpers.js');
    if (result.error) {
      // Helpers failed to load — log but don't block execution
      ctx.dump(result.error);
      result.error.dispose();
    } else {
      result.value.dispose();
    }
  }

  /**
   * Inject the `mcp` bridge object into the sandbox.
   *
   * Because QuickJS doesn't natively support async host functions in sync
   * mode, `mcp.call()` and `mcp.listTools()` are exposed as synchronous
   * functions.  Bridge calls capture the request; the caller should use
   * `MCPBridge.call()` from the host side for actual async dispatch.
   *
   * For sandbox scripts that need bridge results inline, the host orchestrator
   * (AutoCorrectionLoop or handler) resolves bridge calls between executions.
   */
  private _injectBridge(ctx: QuickJSContext, bridge: MCPBridge, logs: string[]): void {
    const mcpObj = ctx.newObject();

    // mcp.call(name, args) — synchronous stub that logs the call intent
    const callFn = ctx.newFunction('call', (nameHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
      const name = ctx.getString(nameHandle);
      const args = ctx.dump(argsHandle) as Record<string, unknown> ?? {};
      logs.push(`[mcp.call] ${name}(${JSON.stringify(args)})`);
      // Return a placeholder — full async bridge requires host orchestration
      return marshalToQuickJS(ctx, { pending: true, tool: name });
    });

    // mcp.listTools() — returns available tool names
    const listFn = ctx.newFunction('listTools', () => {
      const tools = bridge.listAvailableTools();
      return marshalToQuickJS(ctx, tools);
    });

    ctx.setProp(mcpObj, 'call', callFn);
    ctx.setProp(mcpObj, 'listTools', listFn);
    ctx.setProp(ctx.global, 'mcp', mcpObj);

    callFn.dispose();
    listFn.dispose();
    mcpObj.dispose();
  }
}

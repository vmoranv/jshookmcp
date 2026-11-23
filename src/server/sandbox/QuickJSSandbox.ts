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

import type { QuickJSHandle, QuickJSContext } from 'quickjs-emscripten';

import type {
  SandboxOptions,
  SandboxResult,
  OrchestrationOptions,
  OrchestrationResult,
  BridgeCallRecord,
} from '@server/sandbox/types';
import type { MCPBridge } from '@server/sandbox/MCPBridge';
import { SANDBOX_HELPER_SOURCE } from '@server/sandbox/SandboxHelpers';
import {
  SANDBOX_EXEC_TIMEOUT_MS,
  SANDBOX_MEMORY_LIMIT_MB,
  SANDBOX_MAX_BRIDGE_CALLS,
} from '@src/constants';

const DEFAULT_TIMEOUT_MS = SANDBOX_EXEC_TIMEOUT_MS;
const DEFAULT_MEMORY_LIMIT_BYTES = SANDBOX_MEMORY_LIMIT_MB * 1024 * 1024;

type QuickJSModule = Awaited<ReturnType<typeof import('quickjs-emscripten').getQuickJS>>;

let quickjsPromise: Promise<QuickJSModule> | null = null;

/**
 * Dispose every handle an evalCode result may carry.
 *
 * quickjs-emscripten's evalCode result is a union type that only exposes the
 * `value` or the `error` side depending on the outcome, so the non-narrowed
 * side needs an explicit cast to reach it. Disposing a missing handle is a
 * no-op; disposing both when both exist prevents handle leaks.
 */
function disposeEvalResult(result: unknown): void {
  const handles = result as { value?: QuickJSHandle; error?: QuickJSHandle };
  handles.value?.dispose();
  handles.error?.dispose();
}

function getQuickJS(): Promise<QuickJSModule> {
  if (!quickjsPromise) {
    quickjsPromise = import('quickjs-emscripten').then((m) => m.getQuickJS());
  }
  return quickjsPromise;
}

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
    return this.executeInFreshRuntime(code, options, (ctx, logs) => {
      // Legacy sync bridge stub — injected only when a bridge is set.
      if (this.bridge) {
        this.injectBridge(ctx, this.bridge, logs);
      }
    });
  }

  /**
   * Execute JavaScript code with multi-round MCP bridge orchestration.
   *
   * The sandbox script can call `mcp.call(name, args)` which enqueues
   * the request.  After each evaluation round, pending calls are resolved
   * asynchronously on the host side, and results are injected back as
   * `__bridgeResults` for the next round.
   *
   * The script should check `typeof __bridgeResults !== 'undefined'`
   * to determine if it's in a continuation round and read prior results.
   *
   * @param code - JavaScript source to evaluate
   * @param bridge - MCPBridge instance for tool dispatch
   * @param options - Orchestration options (maxBridgeCalls, bridgeAllowlist, etc.)
   */
  async executeWithOrchestration(
    code: string,
    bridge: MCPBridge,
    options: OrchestrationOptions = {},
  ): Promise<OrchestrationResult> {
    const requestedBudget = options.maxBridgeCalls ?? SANDBOX_MAX_BRIDGE_CALLS;
    const maxBridgeCalls = Number.isFinite(requestedBudget)
      ? Math.max(0, Math.floor(requestedBudget))
      : SANDBOX_MAX_BRIDGE_CALLS;
    const startTime = Date.now();
    const allLogs: string[] = [];
    const allBridgeCalls: BridgeCallRecord[] = [];

    // The bridge is caller-owned and may be reused, so never leave our
    // allowlist installed after this run. (Concurrent runs on the same bridge
    // still share its pending queue and must not overlap.)
    const previousAllowlist = options.bridgeAllowlist ? bridge.getAllowlist() : null;
    if (options.bridgeAllowlist) {
      bridge.setAllowlist(options.bridgeAllowlist);
    }

    // Accumulated results from all rounds — keyed by callId
    let bridgeResults: Record<string, unknown> = {};
    let lastOutput: unknown;
    let round = 0;

    try {
      for (;;) {
        // Build globals for this round
        const roundGlobals: Record<string, unknown> = {
          ...options.globals,
          __bridgeRound: round,
        };

        // Inject prior bridge results (round > 0)
        if (round > 0) {
          roundGlobals.__bridgeResults = bridgeResults;
        }

        // Execute one round
        const roundResult = await this.executeOneRound(code, bridge, {
          ...options,
          globals: roundGlobals,
        });

        // Collect logs
        allLogs.push(...roundResult.logs);

        // Check for errors / timeout
        if (!roundResult.ok || roundResult.timedOut) {
          return {
            ...roundResult,
            logs: allLogs,
            durationMs: Date.now() - startTime,
            bridgeCallCount: allBridgeCalls.length,
            bridgeCalls: allBridgeCalls,
          };
        }

        lastOutput = roundResult.output;

        // No pending calls — script completed without requesting tools
        if (!bridge.hasPending()) {
          break;
        }

        // Drain and resolve pending calls. The budget caps host tool
        // executions (not just rounds), so a single round cannot smuggle an
        // unbounded batch of calls past the limit.
        const pending = bridge.drainPending();
        // Defensive: a bridge that reports pending but drains nothing would
        // otherwise spin this loop forever.
        if (pending.length === 0) {
          break;
        }

        if (allBridgeCalls.length + pending.length > maxBridgeCalls) {
          // Do not execute calls whose results can never be delivered back:
          // the guest would silently lose them and the run would look
          // successful. Fail loudly instead.
          return {
            ok: false,
            error: `Bridge call budget exhausted (max ${maxBridgeCalls})`,
            output: lastOutput,
            timedOut: false,
            durationMs: Date.now() - startTime,
            logs: allLogs,
            bridgeCallCount: allBridgeCalls.length,
            bridgeCalls: allBridgeCalls,
          };
        }

        const roundResults: Record<string, unknown> = {};

        for (const req of pending) {
          try {
            const result = await bridge.call(req.toolName, req.args);
            roundResults[req.id] = result;
            allBridgeCalls.push({ toolName: req.toolName, args: req.args, result });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            roundResults[req.id] = { __error: true, message: errorMsg };
            allBridgeCalls.push({
              toolName: req.toolName,
              args: req.args,
              result: { __error: true, message: errorMsg },
            });
          }
        }

        // Merge results for next round
        bridgeResults = { ...bridgeResults, ...roundResults };
        round++;
      }

      return {
        ok: true,
        output: lastOutput,
        timedOut: false,
        durationMs: Date.now() - startTime,
        logs: allLogs,
        bridgeCallCount: allBridgeCalls.length,
        bridgeCalls: allBridgeCalls,
      };
    } finally {
      if (options.bridgeAllowlist) {
        bridge.setAllowlist(previousAllowlist);
      }
    }
  }

  // ── Private helpers ──

  /**
   * Run a single evaluation round inside a fresh QuickJS runtime.
   * Used internally by executeWithOrchestration.
   */
  private async executeOneRound(
    code: string,
    bridge: MCPBridge,
    options: SandboxOptions = {},
  ): Promise<SandboxResult> {
    return this.executeInFreshRuntime(code, options, (ctx, logs) => {
      this.injectBridgeForOrchestration(ctx, bridge, logs);
    });
  }

  /**
   * Shared single-round execution: spins up a fresh QuickJS runtime, injects
   * the console/helpers/globals plus the caller-supplied bridge injection,
   * evaluates the code, and tears everything down. Used by both execute()
   * (legacy sync bridge stub) and executeOneRound() (orchestration bridge).
   */
  private async executeInFreshRuntime(
    code: string,
    options: SandboxOptions = {},
    injectBridge: (ctx: QuickJSContext, logs: string[]) => void,
  ): Promise<SandboxResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES;

    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(memoryLimitBytes);

    const startTime = Date.now();
    let timedOut = false;
    runtime.setInterruptHandler(() => {
      if (Date.now() - startTime > timeoutMs) {
        timedOut = true;
        return true;
      }
      return false;
    });

    const context = runtime.newContext();
    const logs: string[] = [];

    try {
      this.injectConsole(context, logs);
      this.injectHelpers(context);
      injectBridge(context, logs);

      if (options.globals) {
        this.injectGlobals(context, options.globals);
      }

      const result = context.evalCode(code, 'sandbox-eval.js');

      if (result.error) {
        const errorMsg = context.dump(result.error);
        // Disposes the error handle and any value handle the engine produced
        // alongside it — otherwise the value leaks for the runtime's lifetime.
        disposeEvalResult(result);

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
      disposeEvalResult(result);

      return { ok: true, output, timedOut: false, durationMs: Date.now() - startTime, logs };
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
  private injectConsole(ctx: QuickJSContext, logs: string[]): void {
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
  private injectGlobals(ctx: QuickJSContext, globals: Record<string, unknown>): void {
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
  private injectHelpers(ctx: QuickJSContext): void {
    const result = ctx.evalCode(SANDBOX_HELPER_SOURCE, 'sandbox-helpers.js');
    if (result.error) {
      // Helpers failed to load — log but don't block execution.
      ctx.dump(result.error);
      disposeEvalResult(result);
    } else {
      disposeEvalResult(result);
    }
  }

  /**
   * Inject the `mcp` bridge object into the sandbox (legacy sync stub).
   *
   * Because QuickJS doesn't natively support async host functions in sync
   * mode, `mcp.call()` and `mcp.listTools()` are exposed as synchronous
   * functions.  Bridge calls capture the request; the caller should use
   * `MCPBridge.call()` from the host side for actual async dispatch.
   *
   * For sandbox scripts that need bridge results inline, the host orchestrator
   * (AutoCorrectionLoop or handler) resolves bridge calls between executions.
   */
  private injectBridge(ctx: QuickJSContext, bridge: MCPBridge, logs: string[]): void {
    const mcpObj = ctx.newObject();

    // mcp.call(name, args) — synchronous stub that logs the call intent
    const callFn = ctx.newFunction(
      'call',
      (nameHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
        const name = ctx.getString(nameHandle);
        const args = (ctx.dump(argsHandle) as Record<string, unknown>) ?? {};
        try {
          bridge.assertCallable(name);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logs.push(`[mcp.call] rejected ${name}: ${errorMsg}`);
          return marshalToQuickJS(ctx, { pending: false, tool: name, error: errorMsg });
        }
        logs.push(`[mcp.call] ${name}(${JSON.stringify(args)})`);
        // Return a placeholder — full async bridge requires host orchestration
        return marshalToQuickJS(ctx, { pending: true, tool: name });
      },
    );

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

  /**
   * Inject the `mcp` bridge object for orchestration mode.
   *
   * `mcp.call()` enqueues the request via `bridge.enqueue()` and returns
   * a `{ __bridgeCall: true, callId }` marker.  The orchestration loop
   * resolves these calls between rounds and injects results into
   * `__bridgeResults[callId]`.
   */
  private injectBridgeForOrchestration(
    ctx: QuickJSContext,
    bridge: MCPBridge,
    logs: string[],
  ): void {
    const mcpObj = ctx.newObject();

    const callFn = ctx.newFunction(
      'call',
      (nameHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
        const name = ctx.getString(nameHandle);
        const args = (ctx.dump(argsHandle) as Record<string, unknown>) ?? {};
        try {
          const callId = bridge.enqueue(name, args);
          logs.push(`[mcp.call] enqueued ${name}(${JSON.stringify(args)}) → ${callId}`);
          return marshalToQuickJS(ctx, { __bridgeCall: true, callId });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logs.push(`[mcp.call] rejected ${name}: ${errorMsg}`);
          return marshalToQuickJS(ctx, { __bridgeCall: false, error: errorMsg });
        }
      },
    );

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

/**
 * Types for the WASM-isolated QuickJS sandbox.
 *
 * These types define the contract for executing untrusted JavaScript
 * in a WASM-based QuickJS runtime with strict resource limits.
 */

/** Options for a sandbox execution call. */
export interface SandboxOptions {
  /** Execution timeout in ms (default 1000). */
  timeoutMs?: number;
  /** Memory limit in bytes (default 8 MB). */
  memoryLimitBytes?: number;
  /** Variables to inject into the sandbox global scope. */
  globals?: Record<string, unknown>;
  /** Session ID for scratchpad persistence. */
  sessionId?: string;
}

/** Result returned from a sandbox execution. */
export interface SandboxResult {
  /** Whether execution completed without errors. */
  ok: boolean;
  /** The value returned by the evaluated code. */
  output?: unknown;
  /** Error message if execution failed. */
  error?: string;
  /** Whether execution was terminated due to timeout. */
  timedOut: boolean;
  /** Wall-clock duration of execution in ms. */
  durationMs: number;
  /** Captured console.log output from inside the sandbox. */
  logs: string[];
}

/**
 * Shared types for E2E tool tests.
 */

/** Function signature for calling an MCP tool */
export type CallFn = (name: string, args: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;

/** A single test phase with optional setup and tool list */
export interface Phase {
  name: string;
  setup: string[] | ((call: CallFn) => Promise<void>);
  tools: string[];
}

/** Runtime context that accumulates dynamic IDs across phases */
export interface E2EContext {
  scriptId: string | null;
  breakpointId: string | null;
  requestId: string | null;
  hookId: string | null;
  objectId: string | null;
}

/** Per-tool test result */
export interface ToolResult {
  name: string;
  ok: boolean;
  isError: boolean;
  detail: string;
}

/** CLI configuration parsed from command-line args */
export interface E2EConfig {
  targetUrl: string;
  targetDomain: string;
  electronPath: string;
  miniappPath: string;
  asarPath: string;
  browserPath: string;
  perToolTimeout: number;
  skipSet: Set<string>;
  artifactDir: string;
}

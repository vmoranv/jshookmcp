/**
 * Shared types for E2E tool tests.
 */

/** Function signature for calling an MCP tool */
export type CallFn = (
  name: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

/** A single test phase with optional setup and tool list */
export interface Phase {
  name: string;
  setup: string[] | ((call: CallFn) => Promise<void>);
  tools: string[];
  /** When true, tools in this phase run in parallel (no ordering dependency) */
  concurrent?: boolean;
  /**
   * Phase group ID. Phases in the same group run sequentially (in order).
   * Different groups can run concurrently with each other.
   * Default: 'browser' (sequential with all other browser-dependent phases).
   */
  group?: 'browser' | 'compute-core' | 'compute-system' | 'compute-browser' | 'cleanup';
}

/** Runtime context that accumulates dynamic IDs across phases */
export interface E2EContext {
  scriptId: string | null;
  detailId: string | null;
  breakpointId: string | null;
  requestId: string | null;
  hookId: string | null;
  objectId: string | null;
  workflowId: string | null;
  snapshotId: string | null;
  pluginId: string | null;
  v8SnapshotId: string | null;
  v8ComparisonSnapshotId: string | null;
  browserPid: number | null;
  sessionPath: string | null;
  dllPath: string | null;
  sourceMapUrl: string | null;
  xhrBreakpointId: string | null;
  eventBreakpointId: string | null;
  watchId: string | null;
  taskId: string | null;
}

/** Tool test status (unified result model) */
export type ToolStatus = 'PASS' | 'SKIP' | 'EXPECTED_LIMITATION' | 'FAIL';

/** Per-tool test result */
export interface ToolResult {
  name: string;
  status: ToolStatus;
  code?: string;
  detail: string;
  isError: boolean;
  /** @deprecated Use status instead */
  ok?: boolean;
}

/** CLI configuration parsed from command-line args */
export interface E2EConfig {
  targetUrl: string;
  targetDomain: string;
  electronPath: string;
  electronEnabled: boolean;
  electronCdpPort: number | null;
  electronUserdataDir: string;
  miniappPath: string;
  asarPath: string;
  browserPath: string;
  perToolTimeout: number;
  artifactDir: string;
}

/** Status of a tool in the coverage analysis */
export type ToolCoverageStatus = 'exercised' | 'skipped' | 'untested';

/** Per-tool coverage entry */
export interface ToolCoverageEntry {
  name: string;
  domain: string;
  status: ToolCoverageStatus;
}

/** Per-domain coverage summary */
export interface DomainCoverage {
  domain: string;
  total: number;
  exercised: number;
  skipped: number;
  untested: number;
  coveragePercent: number;
  tools: ToolCoverageEntry[];
}

/** Full coverage report */
export interface CoverageReport {
  timestamp: string;
  totalTools: number;
  exercised: number;
  skipped: number;
  untested: number;
  overallCoveragePercent: number;
  domains: DomainCoverage[];
  untestedTools: string[];
}

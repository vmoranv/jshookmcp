/**
 * External Tool Runner types
 * Unified interface for safely invoking external CLI tools (wabt, binaryen, wasmtime, miniapp unpacker, etc.)
 */

export type ExternalToolName =
  | 'wabt.wasm2wat'
  | 'wabt.wasm-objdump'
  | 'wabt.wasm-decompile'
  | 'wabt.wasm2c'
  | 'wabt.wat2wasm'
  | 'binaryen.wasm-opt'
  | 'runtime.wasmtime'
  | 'runtime.wasmer'
  | 'miniapp.unpacker'
  | 'platform.jadx'
  | 'analysis.ast-grep'
  | 'analysis.wakaru'
  | 'analysis.restringer'
  | 'analysis.z3'
  | 'syscall.strace'
  | 'syscall.bpftrace';

export interface ExternalToolSpec {
  /** Unique tool identifier */
  name: ExternalToolName;
  /** Executable command name (resolved via PATH or absolute) */
  command: string;
  /** Default arguments prepended to every invocation */
  defaultArgs?: string[];
  /** Arguments to check version (e.g. ['--version']) */
  versionArgs?: string[];
  /** If true, probe failure is a hard error; if false, tool is optional */
  required: boolean;
  /** Environment variables allowed to pass through to child process */
  envAllowlist?: string[];
}

export interface ToolRunRequest {
  /** Which tool to invoke */
  tool: ExternalToolName;
  /** Arguments (array form only — no shell string concatenation) */
  args: string[];
  /** Working directory for the child process */
  cwd?: string;
  /** Timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Max stdout bytes before truncation (default: 10MB) */
  maxStdoutBytes?: number;
  /** Max stderr bytes before truncation (default: 1MB) */
  maxStderrBytes?: number;
  /** Optional stdin data to pipe */
  stdin?: Buffer | string;
  /** Require the process to produce some output signal when it exits successfully. */
  requireNonEmptyOutput?: boolean;
  /** Expected artifact files that must exist and be non-empty on success. */
  expectedOutputPaths?: string[];
  /** When true, allow expected output directories and only require them to exist. */
  allowDirectoryOutputs?: boolean;
  /** Human-readable output label used in diagnostics. */
  outputLabel?: string;
  /** Progress callback for long-running operations */
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: 'spawn' | 'stdout' | 'stderr' | 'heartbeat' | 'exit' | 'timeout';
  message?: string;
  bytesRead?: number;
  ts: number;
}

export interface ToolRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  diagnosticCode?: 'EMPTY_OUTPUT' | 'EMPTY_OUTPUT_ARTIFACT';
  diagnostics?: string[];
}

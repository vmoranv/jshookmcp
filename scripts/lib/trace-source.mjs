/**
 * Phase 1: script-side MIRROR of the production trace-flush directory logic.
 *
 * `src/` must not import `scripts/` (would invert the dependency layering and
 * pull scripts into the tsdown bundle), so the production flush path in
 * MCPServer.transport.ts implements the same contract inline using
 * `readEnvString`/`readEnvBoolean`. This module is the testable mirror used by
 * scripts. Both obey `tests/server/benchmarks/trace-source.test.ts`.
 *
 * Contract:
 *   - default           -> <cwd>/.ccg/traces (byte-identical to pre-change)
 *   - MCP_TRACE_DIR     -> resolved against cwd (relative) or as-is (absolute)
 *   - MCP_TRACE_DISABLE -> 1/true => null (no flush; used by unit tests)
 *   - empty/blank dir   -> default
 * Paths are normalized to forward slashes for deterministic cross-platform
 * display (the value is evidence metadata, not a syscall path).
 */
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_TRACE_DIR = '.ccg/traces';

function truthy(raw) {
  return ['1', 'true'].includes(
    String(raw ?? '')
      .trim()
      .toLowerCase(),
  );
}

/** Whether trace flushing is disabled for this process. */
export function isTraceDisabled(env = process.env) {
  return truthy(env.MCP_TRACE_DISABLE);
}

/**
 * Resolve the trace directory, or return null when flushing is disabled.
 * Pure: env + cwd are injectable for unit tests on Windows/POSIX.
 */
export function resolveTraceDir(env = process.env, cwd = process.cwd()) {
  if (isTraceDisabled(env)) return null;
  const raw = String(env.MCP_TRACE_DIR ?? '').trim();
  const rel = raw.length > 0 ? raw : DEFAULT_TRACE_DIR;
  const absolute = isAbsolute(rel) ? rel : resolve(cwd, rel);
  return absolute.replace(/\\/g, '/');
}

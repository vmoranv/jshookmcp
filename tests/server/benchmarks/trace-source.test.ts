/**
 * Phase 1.1: resolveTraceDir is the script-side MIRROR of the production flush
 * path (src/server/MCPServer.transport.ts). Both obey the same contract; src
 * must NOT import scripts (dependency direction), so the mirror is intentional
 * and locked by this test. Pure function with injectable env + cwd.
 *
 * Expectations are computed with node:path.resolve so they hold on POSIX and
 * Windows (a hardcoded 'D:/proj' string is NOT absolute on Linux).
 */
import { describe, expect, it } from 'vitest';
import { resolve as resolvePath } from 'node:path';
import { resolveTraceDir, isTraceDisabled } from '../../../scripts/lib/trace-source.mjs';

const CWD = resolvePath(process.cwd(), 'proj-fixture');

/** Platform-appropriate absolute path for the cwd-relative cases. */
function dirUnderCwd(rel: string): string {
  return resolvePath(CWD, rel).replace(/\\/g, '/');
}

describe('resolveTraceDir (directory isolation)', () => {
  it('defaults to <cwd>/.ccg/traces (byte-identical to pre-change behavior)', () => {
    expect(resolveTraceDir({}, CWD)).toBe(dirUnderCwd('.ccg/traces'));
  });

  it('MCP_TRACE_DIR relative path is resolved against cwd', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: 'custom/traces' }, CWD)).toBe(
      dirUnderCwd('custom/traces'),
    );
  });

  it('MCP_TRACE_DIR absolute path is honored (resolved as-is, not prefixed)', () => {
    const abs = resolvePath(process.cwd(), 'absolute-traces');
    expect(resolveTraceDir({ MCP_TRACE_DIR: abs }, CWD)).toBe(abs.replace(/\\/g, '/'));
  });

  it('empty / whitespace MCP_TRACE_DIR falls back to default', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: '' }, CWD)).toBe(dirUnderCwd('.ccg/traces'));
    expect(resolveTraceDir({ MCP_TRACE_DIR: '   ' }, CWD)).toBe(dirUnderCwd('.ccg/traces'));
  });

  it('MCP_TRACE_DIR is trimmed', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: '  rel/traces  ' }, CWD)).toBe(
      dirUnderCwd('rel/traces'),
    );
  });
});

describe('isTraceDisabled', () => {
  it('is false by default', () => {
    expect(isTraceDisabled({})).toBe(false);
  });

  it('is true for 1 / true (case-insensitive)', () => {
    expect(isTraceDisabled({ MCP_TRACE_DISABLE: '1' })).toBe(true);
    expect(isTraceDisabled({ MCP_TRACE_DISABLE: 'true' })).toBe(true);
    expect(isTraceDisabled({ MCP_TRACE_DISABLE: 'TRUE' })).toBe(true);
  });

  it('is false for 0 / false / nonsense', () => {
    expect(isTraceDisabled({ MCP_TRACE_DISABLE: '0' })).toBe(false);
    expect(isTraceDisabled({ MCP_TRACE_DISABLE: 'false' })).toBe(false);
    expect(isTraceDisabled({ MCP_TRACE_DISABLE: 'maybe' })).toBe(false);
  });

  it('disable wins over a custom dir', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: 'x', MCP_TRACE_DISABLE: '1' }, CWD)).toBeNull();
  });
});

/**
 * Phase 1.2: the PRODUCTION flush path (src/server/MCPServer.transport.ts)
 * obeys the same directory-isolation contract as the script-side mirror.
 * We export a tiny pure helper from the production file so it is directly
 * testable WITHOUT inverting dependencies (src must not import scripts).
 *
 * Expectations are computed with node:path.resolve so they hold on POSIX and
 * Windows (a hardcoded 'D:/proj' string is NOT absolute on Linux).
 */
import { describe, expect, it } from 'vitest';
import { resolve as resolvePath } from 'node:path';
import { resolveTraceFlushDir } from '@server/MCPServer.transport';

const CWD = resolvePath(process.cwd(), 'proj-fixture');

/** Platform-appropriate absolute path for the cwd-relative cases. */
function dirUnderCwd(rel: string): string {
  return resolvePath(CWD, rel).replace(/\\/g, '/');
}

describe('resolveTraceFlushDir (production, src-only)', () => {
  it('defaults to <cwd>/.ccg/traces (byte-identical to pre-change)', () => {
    expect(resolveTraceFlushDir({}, CWD)).toBe(dirUnderCwd('.ccg/traces'));
  });

  it('MCP_TRACE_DIR relative resolves against cwd', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: 'custom/traces' }, CWD)).toBe(
      dirUnderCwd('custom/traces'),
    );
  });

  it('MCP_TRACE_DIR absolute is honored (resolved as-is, not prefixed)', () => {
    const abs = resolvePath(process.cwd(), 'abs-traces');
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: abs }, CWD)).toBe(abs.replace(/\\/g, '/'));
  });

  it('empty/blank falls back to default', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: '  ' }, CWD)).toBe(dirUnderCwd('.ccg/traces'));
  });

  it('MCP_TRACE_DISABLE=1|true => null (no flush)', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: '1' }, CWD)).toBeNull();
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: 'true' }, CWD)).toBeNull();
  });

  it('0/false/nonsense disable => still flushes', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: '0' }, CWD)).toBe(dirUnderCwd('.ccg/traces'));
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: 'maybe' }, CWD)).toBe(
      dirUnderCwd('.ccg/traces'),
    );
  });

  it('disable wins over custom dir', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: 'x', MCP_TRACE_DISABLE: '1' }, CWD)).toBeNull();
  });
});

/**
 * Phase 1.2: the PRODUCTION flush path (src/server/MCPServer.transport.ts)
 * obeys the same directory-isolation contract as the script-side mirror.
 * We export a tiny pure helper from the production file so it is directly
 * testable WITHOUT inverting dependencies (src must not import scripts).
 */
import { describe, expect, it } from 'vitest';
import { resolveTraceFlushDir } from '@server/MCPServer.transport';

const CWD = 'D:/proj';

describe('resolveTraceFlushDir (production, src-only)', () => {
  it('defaults to <cwd>/.ccg/traces (byte-identical to pre-change)', () => {
    expect(resolveTraceFlushDir({}, CWD)).toBe('D:/proj/.ccg/traces');
  });

  it('MCP_TRACE_DIR relative resolves against cwd', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: 'custom/traces' }, CWD)).toBe(
      'D:/proj/custom/traces',
    );
  });

  it('MCP_TRACE_DIR absolute is honored', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: 'D:/abs/traces' }, CWD)).toBe('D:/abs/traces');
  });

  it('empty/blank falls back to default', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: '  ' }, CWD)).toBe('D:/proj/.ccg/traces');
  });

  it('MCP_TRACE_DISABLE=1|true => null (no flush)', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: '1' }, CWD)).toBeNull();
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: 'true' }, CWD)).toBeNull();
  });

  it('0/false/nonsense disable => still flushes', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: '0' }, CWD)).toBe('D:/proj/.ccg/traces');
    expect(resolveTraceFlushDir({ MCP_TRACE_DISABLE: 'maybe' }, CWD)).toBe('D:/proj/.ccg/traces');
  });

  it('disable wins over custom dir', () => {
    expect(resolveTraceFlushDir({ MCP_TRACE_DIR: 'x', MCP_TRACE_DISABLE: '1' }, CWD)).toBeNull();
  });
});

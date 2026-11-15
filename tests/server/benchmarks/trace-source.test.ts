/**
 * Phase 1.1: resolveTraceDir is the script-side MIRROR of the production flush
 * path (src/server/MCPServer.transport.ts). Both obey the same contract; src
 * must NOT import scripts (dependency direction), so the mirror is intentional
 * and locked by this test. Pure function with injectable env + cwd.
 */
import { describe, expect, it } from 'vitest';
import { resolveTraceDir, isTraceDisabled } from '../../../scripts/lib/trace-source.mjs';

const CWD = 'D:/proj';

describe('resolveTraceDir (directory isolation)', () => {
  it('defaults to <cwd>/.ccg/traces (byte-identical to pre-change behavior)', () => {
    expect(resolveTraceDir({}, CWD)).toBe('D:/proj/.ccg/traces');
  });

  it('MCP_TRACE_DIR relative path is resolved against cwd', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: 'custom/traces' }, CWD)).toBe('D:/proj/custom/traces');
  });

  it('MCP_TRACE_DIR absolute path is honored', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: 'D:/absolute/traces' }, CWD)).toBe(
      'D:/absolute/traces',
    );
  });

  it('empty / whitespace MCP_TRACE_DIR falls back to default', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: '' }, CWD)).toBe('D:/proj/.ccg/traces');
    expect(resolveTraceDir({ MCP_TRACE_DIR: '   ' }, CWD)).toBe('D:/proj/.ccg/traces');
  });

  it('MCP_TRACE_DIR is trimmed', () => {
    expect(resolveTraceDir({ MCP_TRACE_DIR: '  rel/traces  ' }, CWD)).toBe('D:/proj/rel/traces');
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

import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/trace/index';
import { TRACE_TOOLS } from '@server/domains/trace/definitions.tools';
import { TraceToolHandlers } from '@server/domains/trace/handlers';

describe('trace domain exports', () => {
  it('should export TRACE_TOOLS', async () => {
    expect(exports.TRACE_TOOLS).toBe(TRACE_TOOLS);
  });
  it('should export TraceToolHandlers', async () => {
    expect(exports.TraceToolHandlers).toBe(TraceToolHandlers);
  });
});

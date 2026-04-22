import { describe, expect, it } from 'vitest';
import { traceTools } from '@server/domains/trace/definitions';

describe('trace domain definitions', () => {
  it('should define tools array', async () => {
    expect(Array.isArray(traceTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    for (const tool of traceTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

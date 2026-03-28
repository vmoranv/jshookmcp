import { describe, expect, it } from 'vitest';
import { instrumentationTools } from '@server/domains/instrumentation/definitions';

describe('instrumentation domain definitions', () => {
  it('should define tools array', () => {
    expect(Array.isArray(instrumentationTools)).toBe(true);
  });
  it('should have valid tool shapes', () => {
    for (const tool of instrumentationTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

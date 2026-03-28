import { describe, expect, it } from 'vitest';
import { coordinationTools } from '@server/domains/coordination/definitions';

describe('coordination domain definitions', () => {
  it('should define tools array', () => {
    expect(Array.isArray(coordinationTools)).toBe(true);
  });
  it('should have valid tool shapes', () => {
    for (const tool of coordinationTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

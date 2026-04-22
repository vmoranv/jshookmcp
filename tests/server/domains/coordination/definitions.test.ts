import { describe, expect, it } from 'vitest';
import { coordinationTools } from '@server/domains/coordination/definitions';

describe('coordination domain definitions', () => {
  it('should define tools array', async () => {
    expect(Array.isArray(coordinationTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    for (const tool of coordinationTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

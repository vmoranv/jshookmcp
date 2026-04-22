import { describe, expect, it } from 'vitest';
import { evidenceTools } from '@server/domains/evidence/definitions';

describe('evidence domain definitions', () => {
  it('should define tools array', async () => {
    expect(Array.isArray(evidenceTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    for (const tool of evidenceTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

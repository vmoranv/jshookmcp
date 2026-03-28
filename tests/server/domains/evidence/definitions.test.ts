import { describe, expect, it } from 'vitest';
import { evidenceTools } from '@server/domains/evidence/definitions';

describe('evidence domain definitions', () => {
  it('should define tools array', () => {
    expect(Array.isArray(evidenceTools)).toBe(true);
  });
  it('should have valid tool shapes', () => {
    for (const tool of evidenceTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

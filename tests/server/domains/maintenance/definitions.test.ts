import { describe, expect, it } from 'vitest';
import {
  tokenBudgetTools,
  cacheTools,
  extensionTools,
  artifactTools,
} from '@server/domains/maintenance/definitions';

describe('maintenance domain definitions', () => {
  it('should define tools arrays', () => {
    expect(Array.isArray(tokenBudgetTools)).toBe(true);
    expect(Array.isArray(cacheTools)).toBe(true);
    expect(Array.isArray(extensionTools)).toBe(true);
    expect(Array.isArray(artifactTools)).toBe(true);
  });
  it('should have valid tool shapes', () => {
    const allTools = [...tokenBudgetTools, ...cacheTools, ...extensionTools, ...artifactTools];
    expect(allTools.length).toBeGreaterThan(0);
    for (const tool of allTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

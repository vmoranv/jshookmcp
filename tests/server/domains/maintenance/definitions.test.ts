import { describe, expect, it } from 'vitest';
import {
  tokenBudgetTools,
  cacheTools,
  extensionTools,
  artifactTools,
  sandboxTools,
} from '@server/domains/maintenance/definitions';

describe('maintenance domain definitions', () => {
  it('should define tools arrays', async () => {
    expect(Array.isArray(tokenBudgetTools)).toBe(true);
    expect(Array.isArray(cacheTools)).toBe(true);
    expect(Array.isArray(extensionTools)).toBe(true);
    expect(Array.isArray(artifactTools)).toBe(true);
    expect(Array.isArray(sandboxTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    const allTools = [
      ...tokenBudgetTools,
      ...cacheTools,
      ...extensionTools,
      ...artifactTools,
      ...sandboxTools,
    ];
    expect(allTools.length).toBeGreaterThan(0);
    for (const tool of allTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('execute_sandbox_script exposes security hardening options', () => {
    const sandboxTool = sandboxTools.find((tool) => tool.name === 'execute_sandbox_script');
    const properties = sandboxTool?.inputSchema.properties as Record<string, unknown> | undefined;

    expect(properties).toBeDefined();
    expect(properties).toHaveProperty('memoryLimitBytes');
    expect(properties).toHaveProperty('allowedTools');
    expect(properties).toHaveProperty('redactOutput');
  });
});

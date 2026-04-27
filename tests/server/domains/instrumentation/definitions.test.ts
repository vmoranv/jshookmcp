import { describe, expect, it } from 'vitest';
import { instrumentationTools } from '@server/domains/instrumentation/definitions';

describe('instrumentation domain definitions', () => {
  it('should define tools array', async () => {
    expect(Array.isArray(instrumentationTools)).toBe(true);
  });

  it('should have valid tool shapes', async () => {
    for (const tool of instrumentationTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('declares session-aware parameters for session-scoped tools', async () => {
    const operationTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_operation',
    );
    const artifactTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_artifact',
    );
    const hookPresetTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_hook_preset',
    );

    expect(operationTool?.inputSchema.properties).toHaveProperty('sessionId');
    expect(artifactTool?.inputSchema.properties).toHaveProperty('sessionId');
    expect(hookPresetTool?.inputSchema.properties).toHaveProperty('sessionId');
  });

  it('exposes replay authorization inputs for instrumentation network replay', async () => {
    const networkReplayTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_network_replay',
    );

    expect(networkReplayTool?.inputSchema.properties).toHaveProperty('authorization');
    expect(networkReplayTool?.inputSchema.properties).toHaveProperty('authorizationCapability');
  });
});

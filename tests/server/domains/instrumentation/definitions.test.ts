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
    const exportTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_session_export',
    );
    const hookPresetTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_hook_preset',
    );

    expect(operationTool?.inputSchema.properties).toHaveProperty('sessionId');
    expect(operationTool?.inputSchema.properties).toHaveProperty('operationId');
    expect(artifactTool?.inputSchema.properties).toHaveProperty('sessionId');
    expect(exportTool?.inputSchema.properties).toHaveProperty('sessionId');
    expect(hookPresetTool?.inputSchema.properties).toHaveProperty('sessionId');
  });

  it('declares operation lifecycle actions', async () => {
    const operationTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_operation',
    );

    expect(operationTool?.inputSchema.properties?.action).toMatchObject({
      enum: ['register', 'list', 'status', 'stop'],
    });
    expect(operationTool?.inputSchema.properties?.type).toMatchObject({
      enum: ['before-load-inject', 'runtime-hook', 'network-intercept', 'function-trace'],
    });
  });

  it('bounds artifact query limits and type filters', async () => {
    const artifactTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_artifact',
    );

    expect(artifactTool?.inputSchema.properties?.type).toMatchObject({
      enum: ['before-load-inject', 'runtime-hook', 'network-intercept', 'function-trace'],
    });
    expect(artifactTool?.inputSchema.properties?.limit).toMatchObject({
      minimum: 1,
      maximum: 500,
    });
  });

  it('declares session export output directory support', async () => {
    const exportTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_session_export',
    );

    expect(exportTool?.inputSchema.required).toEqual(['sessionId']);
    expect(exportTool?.inputSchema.properties).toHaveProperty('outputDir');
  });

  it('exposes replay authorization inputs for instrumentation network replay', async () => {
    const networkReplayTool = instrumentationTools.find(
      (tool) => tool.name === 'instrumentation_network_replay',
    );

    expect(networkReplayTool?.inputSchema.properties).toHaveProperty('authorization');
    expect(networkReplayTool?.inputSchema.properties).toHaveProperty('authorizationCapability');
  });
});

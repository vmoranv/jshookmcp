import { describe, expect, it } from 'vitest';
import { protocolAnalysisTools } from '@server/domains/protocol-analysis/definitions';

describe('protocol-analysis definitions', () => {
  const getTool = (name: string) => protocolAnalysisTools.find((tool) => tool.name === name);

  it('should expose fields for payload_template_build', async () => {
    const tool = getTool('payload_template_build');
    expect(tool?.inputSchema.properties).toHaveProperty('fields');
    expect(tool?.inputSchema.properties).toHaveProperty('endian');
  });

  it('should expose real packet inputs for raw_ip_packet_build', async () => {
    const tool = getTool('raw_ip_packet_build');
    expect(tool?.inputSchema.properties).toHaveProperty('version');
    expect(tool?.inputSchema.properties).toHaveProperty('sourceIp');
    expect(tool?.inputSchema.properties).toHaveProperty('destinationIp');
  });

  it('should expose strategy-based mutations for payload_mutate', async () => {
    const tool = getTool('payload_mutate');
    const mutationsProperty = tool?.inputSchema.properties?.['mutations'] as
      | { items?: { properties?: Record<string, unknown> } }
      | undefined;
    const mutationItems = mutationsProperty?.items;
    expect(mutationItems?.properties).toHaveProperty('strategy');
    expect(mutationItems?.properties).toHaveProperty('data');
  });
});

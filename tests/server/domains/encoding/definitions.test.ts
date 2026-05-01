import { describe, expect, it } from 'vitest';
import { encodingTools } from '@server/domains/encoding/definitions';

describe('encoding definitions', () => {
  const getTool = (name: string) => encodingTools.find((tool) => tool.name === name);

  it('should expose data for binary_detect_format', async () => {
    const tool = getTool('binary_detect_format');
    expect(tool?.inputSchema.properties).toHaveProperty('data');
    expect(tool?.inputSchema.properties).toHaveProperty('requestId');
  });

  it('should expose data for binary_entropy_analysis', async () => {
    const tool = getTool('binary_entropy_analysis');
    expect(tool?.inputSchema.properties).toHaveProperty('data');
    expect(tool?.inputSchema.properties).toHaveProperty('blockSize');
  });

  it('marks binary_decode as a read-only deterministic helper', async () => {
    const tool = getTool('binary_decode');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    });
  });
});

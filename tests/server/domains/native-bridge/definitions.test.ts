import { describe, expect, it } from 'vitest';
import { nativeBridgeTools } from '@server/domains/native-bridge/definitions';

describe('native-bridge domain definitions', () => {
  it('should define tools array', async () => {
    expect(Array.isArray(nativeBridgeTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    for (const tool of nativeBridgeTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('exposes parity actions for IDA and Ghidra bridge tools', async () => {
    const ghidra = nativeBridgeTools.find((tool) => tool.name === 'ghidra_bridge');
    const ida = nativeBridgeTools.find((tool) => tool.name === 'ida_bridge');

    expect(ghidra).toBeDefined();
    expect(ida).toBeDefined();

    const ghidraProperties = ghidra!.inputSchema.properties as Record<string, unknown>;
    const idaProperties = ida!.inputSchema.properties as Record<string, unknown>;
    const ghidraActions = (ghidraProperties['action'] as { enum?: string[] }).enum;
    const idaActions = (idaProperties['action'] as { enum?: string[] }).enum;

    expect(ghidraActions).toEqual(expect.arrayContaining(['search_strings', 'get_segments']));
    expect(idaActions).toEqual(expect.arrayContaining(['search_strings', 'get_segments']));
    expect(idaProperties).toHaveProperty('searchPattern');
  });
});

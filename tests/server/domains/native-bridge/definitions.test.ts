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
});

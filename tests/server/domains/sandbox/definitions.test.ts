import { describe, expect, it } from 'vitest';
import { sandboxTools } from '@server/domains/sandbox/definitions';

describe('sandboxTools', () => {
  it('should define execute_sandbox_script tool', () => {
    const tool = sandboxTools.find((t) => t.name === 'execute_sandbox_script');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('Execute JavaScript in a WASM-isolated QuickJS sandbox');
    expect(tool?.inputSchema.required).toContain('code');
    expect(tool?.inputSchema.properties).toHaveProperty('sessionId');
    expect(tool?.inputSchema.properties).toHaveProperty('timeoutMs');
    expect(tool?.inputSchema.properties).toHaveProperty('autoCorrect');
  });
});

import { describe, expect, it } from 'vitest';
import { v8InspectorTools } from '../../../../src/server/domains/v8-inspector/definitions';

describe('v8-inspector definitions', () => {
  it('uses scriptId schema for bytecode extraction and JIT inspection', () => {
    const bytecodeTool = v8InspectorTools.find((tool) => tool.name === 'v8_bytecode_extract');
    const jitTool = v8InspectorTools.find((tool) => tool.name === 'v8_jit_inspect');

    expect(bytecodeTool).toBeDefined();
    expect(jitTool).toBeDefined();

    expect(bytecodeTool?.inputSchema.properties).toHaveProperty('scriptId');
    expect(bytecodeTool?.inputSchema.required).toContain('scriptId');
    expect(bytecodeTool?.inputSchema.properties).toHaveProperty('functionOffset');
    expect(bytecodeTool?.inputSchema.properties).not.toHaveProperty('functionId');

    expect(jitTool?.inputSchema.properties).toHaveProperty('scriptId');
    expect(jitTool?.inputSchema.required).toContain('scriptId');
    expect(jitTool?.inputSchema.properties).not.toHaveProperty('functionId');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { MCPBridge } from '@server/sandbox/MCPBridge';
import type { MCPServerContext } from '@server/MCPServer.context';

function createMockContext(tools: string[] = ['tool_a', 'tool_b']): MCPServerContext {
  return {
    selectedTools: tools.map((name) => ({ name, description: '', inputSchema: { type: 'object' } })),
    executeToolWithTracking: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"result":"ok"}' }],
    }),
  } as unknown as MCPServerContext;
}

describe('MCPBridge', () => {
  it('calls executeToolWithTracking for registered tools', async () => {
    const ctx = createMockContext();
    const bridge = new MCPBridge(ctx);

    const result = await bridge.call('tool_a', { key: 'value' });
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('tool_a', { key: 'value' });
    expect(result).toEqual({ result: 'ok' });
  });

  it('rejects calls to non-existent tools', async () => {
    const ctx = createMockContext();
    const bridge = new MCPBridge(ctx);

    await expect(bridge.call('nonexistent_tool')).rejects.toThrow(
      'Tool "nonexistent_tool" is not a registered MCP tool'
    );
  });

  it('listAvailableTools returns registered tool names', () => {
    const ctx = createMockContext(['alpha', 'beta', 'gamma']);
    const bridge = new MCPBridge(ctx);

    expect(bridge.listAvailableTools()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('respects allowlist — blocks unlisted tools', async () => {
    const ctx = createMockContext(['tool_a', 'tool_b']);
    const bridge = new MCPBridge(ctx);
    bridge.setAllowlist(['tool_a']);

    await expect(bridge.call('tool_b')).rejects.toThrow(
      'Tool "tool_b" is not in the sandbox allowlist'
    );
  });

  it('allowlist filters listAvailableTools', () => {
    const ctx = createMockContext(['tool_a', 'tool_b', 'tool_c']);
    const bridge = new MCPBridge(ctx);
    bridge.setAllowlist(['tool_b']);

    expect(bridge.listAvailableTools()).toEqual(['tool_b']);
  });

  it('null allowlist allows all tools', async () => {
    const ctx = createMockContext(['tool_a', 'tool_b']);
    const bridge = new MCPBridge(ctx);
    bridge.setAllowlist(['tool_a']);
    bridge.setAllowlist(null); // reset

    const result = await bridge.call('tool_b');
    expect(ctx.executeToolWithTracking).toHaveBeenCalledWith('tool_b', {});
    expect(result).toBeDefined();
  });

  it('returns plain text when JSON parsing fails', async () => {
    const ctx = createMockContext();
    (ctx.executeToolWithTracking as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: 'text', text: 'plain text result' }],
    });
    const bridge = new MCPBridge(ctx);

    const result = await bridge.call('tool_a');
    expect(result).toBe('plain text result');
  });
});

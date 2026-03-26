import { describe, it, expect, vi } from 'vitest';
import { MCPBridge } from '@server/sandbox/MCPBridge';
import type { MCPServerContext } from '@server/MCPServer.context';

function createMockContext(tools: string[] = ['tool_a', 'tool_b']): MCPServerContext {
  return {
    selectedTools: tools.map((name) => ({
      name,
      description: '',
      inputSchema: { type: 'object' },
    })),
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
      'Tool "nonexistent_tool" is not a registered MCP tool',
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
      'Tool "tool_b" is not in the sandbox allowlist',
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

  // ── enqueue / drain / hasPending (orchestration queue) ──

  describe('enqueue/drain/hasPending', () => {
    it('enqueue returns a unique call ID', () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const id1 = bridge.enqueue('tool_a', { x: 1 });
      const id2 = bridge.enqueue('tool_b', { y: 2 });

      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);
    });

    it('hasPending returns true after enqueue, false after drain', () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      expect(bridge.hasPending()).toBe(false);

      bridge.enqueue('tool_a', {});
      expect(bridge.hasPending()).toBe(true);

      bridge.drainPending();
      expect(bridge.hasPending()).toBe(false);
    });

    it('drainPending returns all enqueued requests and clears the queue', () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const id1 = bridge.enqueue('tool_a', { key: 'val1' });
      const id2 = bridge.enqueue('tool_b', { key: 'val2' });

      const pending = bridge.drainPending();
      expect(pending).toHaveLength(2);
      expect(pending[0]).toEqual({ id: id1, toolName: 'tool_a', args: { key: 'val1' } });
      expect(pending[1]).toEqual({ id: id2, toolName: 'tool_b', args: { key: 'val2' } });

      // Queue is now empty
      expect(bridge.drainPending()).toHaveLength(0);
    });

    it('enqueue rejects tools not in allowlist', () => {
      const ctx = createMockContext(['tool_a', 'tool_b']);
      const bridge = new MCPBridge(ctx);
      bridge.setAllowlist(['tool_a']);

      expect(() => bridge.enqueue('tool_b', {})).toThrow('not in the sandbox allowlist');
    });

    it('enqueue rejects unregistered tools', () => {
      const ctx = createMockContext(['tool_a']);
      const bridge = new MCPBridge(ctx);

      expect(() => bridge.enqueue('nonexistent', {})).toThrow('not a registered MCP tool');
    });
  });
});

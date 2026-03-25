import { describe, it, expect, vi } from 'vitest';
import { DynamicToolRegistry } from '@server/sandbox/DynamicToolRegistry';
import type { MCPServerContext } from '@server/MCPServer.context';

function createMockContext(): MCPServerContext {
  return {
    registerSingleTool: vi.fn(),
    selectedTools: [],
  } as unknown as MCPServerContext;
}

describe('DynamicToolRegistry', () => {
  it('registers tool with sandbox_ prefix', () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    const prefixed = registry.registerDynamicTool('my_tool', 'A test tool', async () => ({
      ok: true,
    }));

    expect(prefixed).toBe('sandbox_my_tool');
    expect(ctx.registerSingleTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sandbox_my_tool',
        description: '[Sandbox] A test tool',
      }),
    );
  });

  it('unregisters dynamic tool', () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    registry.registerDynamicTool('temp', 'Temp tool', async () => null);
    expect(registry.listDynamicTools()).toHaveLength(1);

    const removed = registry.unregisterDynamicTool('sandbox_temp');
    expect(removed).toBe(true);
    expect(registry.listDynamicTools()).toHaveLength(0);
  });

  it('unregister returns false for non-existent tool', () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    expect(registry.unregisterDynamicTool('sandbox_nonexistent')).toBe(false);
  });

  it('listDynamicTools returns all registered tools', () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    registry.registerDynamicTool('a', 'Tool A', async () => 'a');
    registry.registerDynamicTool('b', 'Tool B', async () => 'b');

    const tools = registry.listDynamicTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.prefixedName).toSorted()).toEqual(['sandbox_a', 'sandbox_b']);
  });

  it('getHandler returns the correct handler', () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    const handler = async () => 'result';
    registry.registerDynamicTool('test', 'Test', handler);

    const entry = registry.getHandler('sandbox_test');
    expect(entry).toBeDefined();
    expect(entry!.handler).toBe(handler);
  });

  it('clearAll removes all dynamic tools', () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    registry.registerDynamicTool('a', 'A', async () => null);
    registry.registerDynamicTool('b', 'B', async () => null);
    registry.clearAll();

    expect(registry.listDynamicTools()).toHaveLength(0);
  });
});

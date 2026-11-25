import { describe, it, expect, vi } from 'vitest';
import { DynamicToolRegistry } from '@server/sandbox/DynamicToolRegistry';
import type { MCPServerContext } from '@server/MCPServer.context';

function createMockContext(): MCPServerContext {
  return {
    registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    router: { addHandlers: vi.fn(), removeHandler: vi.fn() },
    activatedToolNames: new Set<string>(),
    activatedRegisteredTools: new Map<string, { remove: () => void }>(),
    selectedTools: [],
  } as unknown as MCPServerContext;
}

const resultHandler = async () => 'result';

describe('DynamicToolRegistry', () => {
  it('registers tool with sandbox_ prefix', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    const prefixed = await registry.registerDynamicTool('my_tool', 'A test tool', async () => ({
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

  it('wires the handler into the execution router so the tool is callable', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);
    const handler = vi.fn(async (args: Record<string, unknown>) => ({ echoed: args }));

    await registry.registerDynamicTool('wired', 'Wired tool', handler);

    // executeToolWithTracking dispatches through ctx.router, so the handler must
    // be registered there — the local map alone is never consulted.
    const addHandlers = ctx.router.addHandlers as ReturnType<typeof vi.fn>;
    expect(addHandlers).toHaveBeenCalledOnce();
    const routed = (
      addHandlers.mock.calls[0]![0] as Record<
        string,
        (a: Record<string, unknown>) => Promise<unknown>
      >
    )['sandbox_wired'];
    expect(typeof routed).toBe('function');

    const response = (await routed!({ args: { x: 1 } })) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(handler).toHaveBeenCalledWith({ args: { x: 1 } });
    expect(response.content[0]!.text).toContain('"echoed"');
  });

  it('rejects a duplicate registration instead of leaking the previous handle', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    await registry.registerDynamicTool('dup', 'Duplicate', async () => null);

    await expect(
      registry.registerDynamicTool('dup', 'Duplicate again', async () => null),
    ).rejects.toThrow(/already registered/);
    expect(ctx.registerSingleTool).toHaveBeenCalledOnce();
  });

  it('unregisters dynamic tool from both the local map and the MCP server', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    await registry.registerDynamicTool('temp', 'Temp tool', async () => null);
    expect(registry.listDynamicTools()).toHaveLength(1);

    const removeFn = (ctx.registerSingleTool as ReturnType<typeof vi.fn>).mock.results[0]!.value
      .remove as ReturnType<typeof vi.fn>;

    const removed = await registry.unregisterDynamicTool('sandbox_temp');
    expect(removed).toBe(true);
    expect(registry.listDynamicTools()).toHaveLength(0);
    // The MCP server registration must be removed too — not just the local map.
    expect(removeFn).toHaveBeenCalledOnce();
    // And the router handler, otherwise the tool stays callable.
    expect(ctx.router.removeHandler).toHaveBeenCalledWith('sandbox_temp');
  });

  it('unregister returns false for non-existent tool', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    expect(await registry.unregisterDynamicTool('sandbox_nonexistent')).toBe(false);
  });

  it('listDynamicTools returns all registered tools', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    await registry.registerDynamicTool('a', 'Tool A', async () => 'a');
    await registry.registerDynamicTool('b', 'Tool B', async () => 'b');

    const tools = registry.listDynamicTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.prefixedName).toSorted()).toEqual(['sandbox_a', 'sandbox_b']);
  });

  it('getHandler returns the correct handler', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    await registry.registerDynamicTool('test', 'Test', resultHandler);

    const entry = registry.getHandler('sandbox_test');
    expect(entry).toBeDefined();
    expect(entry!.handler).toBe(resultHandler);
  });

  it('clearAll unregisters every tool from the MCP server', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    await registry.registerDynamicTool('a', 'A', async () => null);
    await registry.registerDynamicTool('b', 'B', async () => null);
    const removeFns = (ctx.registerSingleTool as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value.remove,
    );

    await registry.clearAll();

    expect(registry.listDynamicTools()).toHaveLength(0);
    for (const removeFn of removeFns) {
      expect(removeFn).toHaveBeenCalledOnce();
    }
  });

  it('serializes concurrent register/unregister/clearAll mutations', async () => {
    const ctx = createMockContext();
    const registry = new DynamicToolRegistry(ctx);

    await Promise.all([
      registry.registerDynamicTool('a', 'A', async () => null),
      registry.registerDynamicTool('b', 'B', async () => null),
      registry.registerDynamicTool('c', 'C', async () => null),
    ]);

    await registry.clearAll();

    expect(registry.listDynamicTools()).toHaveLength(0);
    const removeFns = (ctx.registerSingleTool as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value.remove,
    );
    for (const removeFn of removeFns) {
      expect(removeFn).toHaveBeenCalledOnce();
    }
  });
});

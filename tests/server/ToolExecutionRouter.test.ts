import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import type { ToolArgs, ToolHandler } from '@server/types';

describe('ToolExecutionRouter', () => {
  it('reports whether a tool exists', () => {
    const router = new ToolExecutionRouter({
      ping: (async () => ({ content: [{ type: 'text', text: 'pong' }] })) as ToolHandler,
    });

    expect(router.has('ping')).toBe(true);
    expect(router.has('missing')).toBe(false);
  });

  it('lists registered tool names', () => {
    const router = new ToolExecutionRouter({
      a: (async () => ({ content: [] })) as ToolHandler,
      b: (async () => ({ content: [] })) as ToolHandler,
    });

    expect(router.listToolNames().toSorted()).toEqual(['a', 'b']);
  });

  it('executes mapped handlers with args', async () => {
    const handler = vi.fn(async (args: ToolArgs) => ({
      content: [{ type: 'text', text: String(args['msg']) }],
    }));
    const router = new ToolExecutionRouter({ echo: handler as ToolHandler });

    const out = await router.execute('echo', { msg: 'hello' });
    expect((out.content[0] as { text: string }).text).toBe('hello');
    expect(handler).toHaveBeenCalledWith({ msg: 'hello' });
  });

  it('supports adding handlers after construction', async () => {
    const router = new ToolExecutionRouter({});
    router.addHandlers({
      later: (async () => ({ content: [{ type: 'text', text: 'added' }] })) as ToolHandler,
    });

    const out = await router.execute('later', {});
    expect((out.content[0] as { text: string }).text).toBe('added');
  });

  it('removeHandler unregisters tool and execute throws unknown tool error', async () => {
    const router = new ToolExecutionRouter({
      tmp: (async () => ({ content: [] })) as ToolHandler,
    });

    router.removeHandler('tmp');
    await expect(router.execute('tmp', {})).rejects.toThrow('Unknown tool: tmp');
  });

  it('throws unknown tool error for missing handlers', async () => {
    const router = new ToolExecutionRouter({});
    await expect(router.execute('nope', {})).rejects.toThrow('Unknown tool: nope');
  });
});

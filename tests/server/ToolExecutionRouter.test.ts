import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionRouter } from '../../src/server/ToolExecutionRouter.js';

describe('ToolExecutionRouter', () => {
  it('reports whether a tool exists', () => {
    const router = new ToolExecutionRouter({
      ping: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
    } as any);

    expect(router.has('ping')).toBe(true);
    expect(router.has('missing')).toBe(false);
  });

  it('lists registered tool names', () => {
    const router = new ToolExecutionRouter({
      a: async () => ({ content: [] }),
      b: async () => ({ content: [] }),
    } as any);

    expect(router.listToolNames().sort()).toEqual(['a', 'b']);
  });

  it('executes mapped handlers with args', async () => {
    const handler = vi.fn(async (args: any) => ({ content: [{ type: 'text', text: args.msg }] }));
    const router = new ToolExecutionRouter({ echo: handler } as any);

    const out = await router.execute('echo', { msg: 'hello' } as any);
    expect(out.content[0]?.text).toBe('hello');
    expect(handler).toHaveBeenCalledWith({ msg: 'hello' });
  });

  it('supports adding handlers after construction', async () => {
    const router = new ToolExecutionRouter({} as any);
    router.addHandlers({
      later: async () => ({ content: [{ type: 'text', text: 'added' }] }),
    } as any);

    const out = await router.execute('later', {} as any);
    expect(out.content[0]?.text).toBe('added');
  });

  it('removeHandler unregisters tool and execute throws unknown tool error', async () => {
    const router = new ToolExecutionRouter({
      tmp: async () => ({ content: [] }),
    } as any);

    router.removeHandler('tmp');
    await expect(router.execute('tmp', {} as any)).rejects.toThrow('Unknown tool: tmp');
  });

  it('throws unknown tool error for missing handlers', async () => {
    const router = new ToolExecutionRouter({} as any);
    await expect(router.execute('nope', {} as any)).rejects.toThrow('Unknown tool: nope');
  });
});


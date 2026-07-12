import { describe, expect, it, vi } from 'vitest';
import { handleDrawHook } from '@server/domains/canvas/handlers/draw-hook';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock controller
function makePageController(withPersistent = true): any {
  const pc: any = { evaluate: vi.fn() };
  if (withPersistent) {
    pc.evaluateOnNewDocument = vi.fn();
  }
  return pc;
}

describe('handleDrawHook', () => {
  it('installs the hook on the current page (non-persistent)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install' }));

    expect(json.action).toBe('install');
    expect(json.installed).toBe(true);
    expect(json.persistent).toBe(false);
    expect(pc.evaluate).toHaveBeenCalledTimes(1);
    expect(pc.evaluateOnNewDocument).not.toHaveBeenCalled();
    // install script wraps the Canvas 2D + WebGL draw methods
    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('drawImage');
    expect(script).toContain('drawArrays');
    expect(script).toContain('__jshookDrawLog');
  });

  it('installs persistently via evaluateOnNewDocument', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install', persistent: true }));

    expect(json.persistent).toBe(true);
    expect(pc.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    expect(pc.evaluate).toHaveBeenCalledTimes(1);
  });

  it('honors maxEntries in the generated install script', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    await handleDrawHook(pc, { action: 'install', maxEntries: 5000 });

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('MAX=5000');
  });

  it('reads captured entries from the ring buffer', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      entries: [{ kind: 'drawImage', args: ['bg.png'], t: 1 }],
      count: 1,
      installed: true,
    });

    const json = parseJson(await handleDrawHook(pc, { action: 'read' }));

    expect(json.action).toBe('read');
    expect(json.count).toBe(1);
    expect(json.entries).toHaveLength(1);
    expect(json.installed).toBe(true);
  });

  it('forwards the clear flag on read', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ entries: [], count: 0, installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'read', clear: true }));

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('if(true){log.length=0;}');
    expect(json.clear).toBe(true);
  });

  it('uninstalls the hook', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ uninstalled: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'uninstall' }));

    expect(json.action).toBe('uninstall');
    expect(json.uninstalled).toBe(true);
    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('__jshookDrawHookInstalled=false');
  });

  it('degrades honestly when the controller lacks evaluateOnNewDocument', async () => {
    const pc = makePageController(false); // no evaluateOnNewDocument
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install', persistent: true }));

    expect(json.persistent).toBe(false);
    expect(json.persistentNote).toContain('unavailable');
  });

  it('wraps unexpected errors', async () => {
    const pc = makePageController();
    pc.evaluate.mockRejectedValueOnce(new Error('page gone'));

    const json = parseJson(await handleDrawHook(pc, { action: 'read' }));

    expect(json.success).toBe(false);
    expect(json.error).toBe('page gone');
  });
});

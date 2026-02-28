import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { XHRBreakpointManager } from '../../../src/modules/debugger/XHRBreakpointManager.js';

describe('XHRBreakpointManager', () => {
  let session: any;
  let manager: XHRBreakpointManager;

  beforeEach(() => {
    session = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(),
    };
    manager = new XHRBreakpointManager(session);
  });

  it('creates xhr breakpoint and stores metadata', async () => {
    const id = await manager.setXHRBreakpoint('/api/');

    expect(id).toBe('xhr_1');
    expect(manager.getXHRBreakpoint(id)?.urlPattern).toBe('/api/');
    expect(session.send).toHaveBeenCalledWith('DOMDebugger.setXHRBreakpoint', { url: '/api/' });
  });

  it('returns false when trying to remove unknown breakpoint', async () => {
    await expect(manager.removeXHRBreakpoint('missing')).resolves.toBe(false);
  });

  it('removes existing breakpoint and updates state', async () => {
    const id = await manager.setXHRBreakpoint('/v1/');
    const removed = await manager.removeXHRBreakpoint(id);

    expect(removed).toBe(true);
    expect(manager.getXHRBreakpoint(id)).toBeUndefined();
    expect(session.send).toHaveBeenCalledWith('DOMDebugger.removeXHRBreakpoint', { url: '/v1/' });
  });

  it('clearAll removes all known breakpoints even when a removal fails', async () => {
    await manager.setXHRBreakpoint('/a/');
    await manager.setXHRBreakpoint('/b/');
    session.send.mockRejectedValueOnce(new Error('remove failed'));

    await manager.clearAllXHRBreakpoints();
    expect(manager.getAllXHRBreakpoints()).toEqual([]);
  });

  it('close delegates to clearAllXHRBreakpoints', async () => {
    const spy = vi.spyOn(manager, 'clearAllXHRBreakpoints').mockResolvedValue(undefined);
    await manager.close();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});


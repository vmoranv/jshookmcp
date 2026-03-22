import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { EventBreakpointManager } from '@modules/debugger/EventBreakpointManager';

describe('EventBreakpointManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  let session: any;
  let manager: EventBreakpointManager;

  beforeEach(() => {
    session = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(),
    };
    manager = new EventBreakpointManager(session);
  });

  it('sets event listener breakpoints and tracks them', async () => {
    const id = await manager.setEventListenerBreakpoint('click');

    expect(id).toBe('event_1');
    expect(manager.getEventBreakpoint(id)?.eventName).toBe('click');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(session.send).toHaveBeenCalledWith('DOMDebugger.setEventListenerBreakpoint', {
      eventName: 'click',
      targetName: undefined,
    });
  });

  it('returns false when removing missing breakpoint', async () => {
    await expect(manager.removeEventListenerBreakpoint('nope')).resolves.toBe(false);
  });

  it('sets all mouse event breakpoints', async () => {
    const ids = await manager.setMouseEventBreakpoints();

    expect(ids.length).toBe(EventBreakpointManager.MOUSE_EVENTS.length);
    expect(manager.getAllEventBreakpoints()).toHaveLength(
      EventBreakpointManager.MOUSE_EVENTS.length
    );
  });

  it('clears all breakpoints even if one CDP removal fails', async () => {
    await manager.setEventListenerBreakpoint('click');
    await manager.setEventListenerBreakpoint('keydown');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    session.send.mockRejectedValueOnce(new Error('remove failed'));

    await manager.clearAllEventBreakpoints();
    expect(manager.getAllEventBreakpoints()).toEqual([]);
  });

  it('close delegates to clearAllEventBreakpoints', async () => {
    const spy = vi.spyOn(manager, 'clearAllEventBreakpoints').mockResolvedValue(undefined);
    await manager.close();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

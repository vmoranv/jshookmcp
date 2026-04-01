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
      EventBreakpointManager.MOUSE_EVENTS.length,
    );
  });

  it('sets keyboard, timer, and WebSocket event breakpoint groups', async () => {
    const keyboard = await manager.setKeyboardEventBreakpoints();
    const timer = await manager.setTimerEventBreakpoints();
    const websocket = await manager.setWebSocketEventBreakpoints();

    expect(keyboard).toHaveLength(EventBreakpointManager.KEYBOARD_EVENTS.length);
    expect(timer).toHaveLength(EventBreakpointManager.TIMER_EVENTS.length);
    expect(websocket).toHaveLength(EventBreakpointManager.WEBSOCKET_EVENTS.length);
    expect(session.send).toHaveBeenCalledWith('DOMDebugger.setEventListenerBreakpoint', {
      eventName: 'message',
      targetName: 'WebSocket',
    });
  });

  it('removes an existing breakpoint and clears it from the registry', async () => {
    const id = await manager.setEventListenerBreakpoint('click');
    expect(manager.getAllEventBreakpoints()[0]?.id).toBe(id);

    await expect(manager.removeEventListenerBreakpoint(id)).resolves.toBe(true);
    expect(manager.getEventBreakpoint(id)).toBeUndefined();
  });

  it('clears all breakpoints even if one CDP removal fails', async () => {
    await manager.setEventListenerBreakpoint('click');
    await manager.setEventListenerBreakpoint('keydown');
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

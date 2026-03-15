// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBreakpointHandlers } from '@server/domains/debugger/handlers/event-breakpoint';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('EventBreakpointHandlers', () => {
  const eventManager = {
    setEventListenerBreakpoint: vi.fn(),
    setMouseEventBreakpoints: vi.fn(),
    setKeyboardEventBreakpoints: vi.fn(),
    setTimerEventBreakpoints: vi.fn(),
    setWebSocketEventBreakpoints: vi.fn(),
    removeEventListenerBreakpoint: vi.fn(),
    getAllEventBreakpoints: vi.fn(),
  };

  function createDebuggerManager(withAdvancedFeatures = true) {
    return {
      getEventManager: vi.fn(() => eventManager),
      ...(withAdvancedFeatures
        ? {
            ensureAdvancedFeatures: vi.fn().mockResolvedValue(undefined),
          }
        : {}),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets an event breakpoint and initializes advanced features when supported', async () => {
    const debuggerManager = createDebuggerManager(true);
    eventManager.setEventListenerBreakpoint.mockResolvedValueOnce('event-1');
    const handlers = new EventBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleEventBreakpointSet({
        eventName: 'click',
        targetName: 'button',
      })
    );

    expect(debuggerManager.ensureAdvancedFeatures).toHaveBeenCalledOnce();
    expect(eventManager.setEventListenerBreakpoint).toHaveBeenCalledWith(
      'click',
      'button'
    );
    expect(body).toEqual({
      success: true,
      message: 'Event breakpoint set',
      breakpointId: 'event-1',
      eventName: 'click',
      targetName: 'button',
    });
  });

  it('sets breakpoint categories through the matching event manager method', async () => {
    const debuggerManager = createDebuggerManager(true);
    eventManager.setWebSocketEventBreakpoints.mockResolvedValueOnce([
      'ws-1',
      'ws-2',
    ]);
    const handlers = new EventBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleEventBreakpointSetCategory({ category: 'websocket' })
    );

    expect(eventManager.setWebSocketEventBreakpoints).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Set 2 websocket event breakpoint(s)',
      category: 'websocket',
      breakpointIds: ['ws-1', 'ws-2'],
    });
  });

  it('returns a structured failure for unknown categories', async () => {
    const debuggerManager = createDebuggerManager(true);
    const handlers = new EventBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleEventBreakpointSetCategory({
        category: 'unknown',
      })
    );

    expect(body).toEqual({
      success: false,
      message: 'Failed to set event breakpoints',
      error: 'Unknown category: unknown',
    });
  });

  it('reports when a breakpoint id cannot be removed', async () => {
    const debuggerManager = createDebuggerManager(true);
    eventManager.removeEventListenerBreakpoint.mockResolvedValueOnce(false);
    const handlers = new EventBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleEventBreakpointRemove({ breakpointId: 'missing' })
    );

    expect(body).toEqual({
      success: false,
      message: 'Event breakpoint not found',
      breakpointId: 'missing',
    });
  });

  it('lists event breakpoints without requiring optional advanced support', async () => {
    const debuggerManager = createDebuggerManager(false);
    eventManager.getAllEventBreakpoints.mockReturnValueOnce([
      { breakpointId: 'event-1', eventName: 'click' },
    ]);
    const handlers = new EventBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleEventBreakpointList({}));

    expect(body).toEqual({
      success: true,
      message: 'Found 1 event breakpoint(s)',
      breakpoints: [{ breakpointId: 'event-1', eventName: 'click' }],
    });
  });
});

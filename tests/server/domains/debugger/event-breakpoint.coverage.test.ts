/**
 * Coverage tests for EventBreakpointHandlers — target all uncovered branches
 * in src/server/domains/debugger/handlers/event-breakpoint.ts.
 *
 * Uncovered branches identified:
 *  - getErrorMessage: String(error) fallback when error.message is absent/empty/non-string
 *  - handleEventBreakpointSet: error when manager throws
 *  - handleEventBreakpointSetCategory: mouse/keyboard/timer categories; error when manager throws
 *  - handleEventBreakpointRemove: removed=true path; error when manager throws
 *  - handleEventBreakpointList: path when ensureAdvancedFeatures is present (advanced=true)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerManager } from '@server/domains/shared/modules';
import { EventBreakpointHandlers } from '@server/domains/debugger/handlers/event-breakpoint';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

type EventManager = ReturnType<DebuggerManager['getEventManager']>;
type EventDebuggerManager = Pick<DebuggerManager, 'getEventManager'> &
  Partial<Pick<DebuggerManager, 'ensureAdvancedFeatures'>>;

// ─── mock refs (hoisted before vi.mock) ──────────────────────────────────────

const ensureAdvancedFeaturesMock = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));

const setEventListenerBreakpointMock = vi.hoisted(() =>
  vi.fn(async (_eventName: string, _targetName?: string): Promise<string> => 'event-1'),
);
const setMouseEventBreakpointsMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string[]> => ['mouse-1', 'mouse-2']),
);
const setKeyboardEventBreakpointsMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string[]> => ['key-1']),
);
const setTimerEventBreakpointsMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string[]> => ['timer-1', 'timer-2', 'timer-3']),
);
const setWebSocketEventBreakpointsMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string[]> => ['ws-1']),
);
const removeEventListenerBreakpointMock = vi.hoisted(() =>
  vi.fn(async (_breakpointId: string): Promise<boolean> => false),
);
const getAllEventBreakpointsMock = vi.hoisted(() =>
  vi.fn((): ReturnType<EventManager['getAllEventBreakpoints']> => []),
);
const getEventManagerMock = vi.hoisted(() =>
  vi.fn(
    (): EventManager =>
      ({
        setEventListenerBreakpoint: setEventListenerBreakpointMock,
        setMouseEventBreakpoints: setMouseEventBreakpointsMock,
        setKeyboardEventBreakpoints: setKeyboardEventBreakpointsMock,
        setTimerEventBreakpoints: setTimerEventBreakpointsMock,
        setWebSocketEventBreakpoints: setWebSocketEventBreakpointsMock,
        removeEventListenerBreakpoint: removeEventListenerBreakpointMock,
        getAllEventBreakpoints: getAllEventBreakpointsMock,
      }) as unknown as EventManager,
  ),
);

// ─── helpers ─────────────────────────────────────────────────────────────────

function createDebuggerManager(withAdvancedFeatures: boolean): EventDebuggerManager {
  const manager: EventDebuggerManager = {
    getEventManager: getEventManagerMock,
  };
  if (withAdvancedFeatures) {
    manager.ensureAdvancedFeatures = ensureAdvancedFeaturesMock;
  }
  return manager;
}

function parseBody<T>(response: unknown): T {
  return parseJson<T>(response);
}

// ─── TestableXXX wrapper ──────────────────────────────────────────────────────

export class TestableEventBreakpointHandlers extends EventBreakpointHandlers {
  public testEnsureAdvancedFeaturesIfSupported() {
    return this.ensureAdvancedFeaturesIfSupported();
  }
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('EventBreakpointHandlers — coverage gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── getErrorMessage fallback branches ──────────────────────────────────

  describe('getErrorMessage — uncovered fallback paths', () => {
    it('returns String(error) when error.message is absent', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(
        new Error('original') as unknown as Error,
      );
      // Patch so the object has no 'message' property
      const errorWithoutMessage = Object.create(null, {
        code: { value: 'ENOENT', enumerable: true },
      });
      setEventListenerBreakpointMock.mockRejectedValueOnce(errorWithoutMessage);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoint');
      // getErrorMessage falls back to String(error)
      expect(typeof body.error).toBe('string');
    });

    it('returns String(error) when error.message is an empty string', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(
        Object.assign(new Error(''), { extra: 'data' }),
      );
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoint');
      expect(typeof body.error).toBe('string');
    });

    it('returns String(error) when error.message is not a string (number)', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(
        Object.assign(new Error(123 as any), { extra: 'data' }),
      );
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
    });

    it('returns String(error) for a non-object error (primitive string)', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(
        'plain string error' as unknown as Error,
      );
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('plain string error');
    });

    it('returns String(error) for a non-object error (primitive number)', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(42 as unknown as Error);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.error).toBe('42');
    });

    it('returns String(error) for null', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(null);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('null');
    });
  });

  // ─── handleEventBreakpointSet — error path ───────────────────────────────

  describe('handleEventBreakpointSet — error path', () => {
    it('returns failure when setEventListenerBreakpoint throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      setEventListenerBreakpointMock.mockRejectedValueOnce(new Error('CDP connection lost'));
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSet({
          eventName: 'click',
          targetName: 'button',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoint');
      expect(body.error).toBe('CDP connection lost');
      expect(ensureAdvancedFeaturesMock).toHaveBeenCalledOnce();
    });

    it('returns failure when getEventManager throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      getEventManagerMock.mockImplementationOnce(() => {
        throw new Error('manager not ready');
      });
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointSet({ eventName: 'click' }));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoint');
      expect(body.error).toBe('manager not ready');
    });
  });

  // ─── handleEventBreakpointSetCategory — uncovered category branches ──────

  describe('handleEventBreakpointSetCategory — mouse/keyboard/timer + error', () => {
    it('sets mouse category breakpoints', async () => {
      const debuggerManager = createDebuggerManager(true);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSetCategory({ category: 'mouse' }),
      );

      expect(setMouseEventBreakpointsMock).toHaveBeenCalledOnce();
      expect(body.success).toBe(true);
      expect(body.category).toBe('mouse');
      expect(body.breakpointIds).toEqual(['mouse-1', 'mouse-2']);
      expect(body.message).toBe('Set 2 mouse event breakpoint(s)');
    });

    it('sets keyboard category breakpoints', async () => {
      const debuggerManager = createDebuggerManager(true);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSetCategory({ category: 'keyboard' }),
      );

      expect(setKeyboardEventBreakpointsMock).toHaveBeenCalledOnce();
      expect(body.success).toBe(true);
      expect(body.category).toBe('keyboard');
      expect(body.breakpointIds).toEqual(['key-1']);
      expect(body.message).toBe('Set 1 keyboard event breakpoint(s)');
    });

    it('sets timer category breakpoints', async () => {
      const debuggerManager = createDebuggerManager(true);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSetCategory({ category: 'timer' }),
      );

      expect(setTimerEventBreakpointsMock).toHaveBeenCalledOnce();
      expect(body.success).toBe(true);
      expect(body.category).toBe('timer');
      expect(body.breakpointIds).toEqual(['timer-1', 'timer-2', 'timer-3']);
      expect(body.message).toBe('Set 3 timer event breakpoint(s)');
    });

    it('returns failure when setMouseEventBreakpoints throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      setMouseEventBreakpointsMock.mockRejectedValueOnce(new Error('mouse events unavailable'));
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSetCategory({ category: 'mouse' }),
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoints');
      expect(body.error).toBe('mouse events unavailable');
    });

    it('returns failure when setKeyboardEventBreakpoints throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      setKeyboardEventBreakpointsMock.mockRejectedValueOnce(
        new Error('keyboard events unavailable'),
      );
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSetCategory({ category: 'keyboard' }),
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoints');
      expect(body.error).toBe('keyboard events unavailable');
    });

    it('returns failure when setTimerEventBreakpoints throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      setTimerEventBreakpointsMock.mockRejectedValueOnce(new Error('timer events unavailable'));
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointSetCategory({ category: 'timer' }),
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to set event breakpoints');
      expect(body.error).toBe('timer events unavailable');
    });
  });

  // ─── handleEventBreakpointRemove — removed=true + error ─────────────────

  describe('handleEventBreakpointRemove — removed=true + error path', () => {
    it('returns success when removeEventListenerBreakpoint returns true', async () => {
      const debuggerManager = createDebuggerManager(true);
      removeEventListenerBreakpointMock.mockResolvedValueOnce(true);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointRemove({ breakpointId: 'event-1' }),
      );

      expect(removeEventListenerBreakpointMock).toHaveBeenCalledWith('event-1');
      expect(body.success).toBe(true);
      expect(body.message).toBe('Event breakpoint removed');
      expect(body.breakpointId).toBe('event-1');
    });

    it('returns failure when removeEventListenerBreakpoint throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      removeEventListenerBreakpointMock.mockRejectedValueOnce(new Error('breakpoint already gone'));
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointRemove({ breakpointId: 'event-1' }),
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to remove event breakpoint');
      expect(body.error).toBe('breakpoint already gone');
    });

    it('returns failure when getEventManager throws on remove', async () => {
      const debuggerManager = createDebuggerManager(true);
      getEventManagerMock.mockImplementationOnce(() => {
        throw new Error('session ended');
      });
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(
        await handlers.handleEventBreakpointRemove({ breakpointId: 'event-1' }),
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to remove event breakpoint');
      expect(body.error).toBe('session ended');
    });
  });

  // ─── handleEventBreakpointList — advanced features enabled ──────────────

  describe('handleEventBreakpointList — advanced features enabled path', () => {
    it('lists breakpoints and calls ensureAdvancedFeatures when supported', async () => {
      const debuggerManager = createDebuggerManager(true);
      getAllEventBreakpointsMock.mockReturnValueOnce([
        { id: 'e1', eventName: 'click', enabled: true, hitCount: 5, createdAt: 100 },
        { id: 'e2', eventName: 'keydown', enabled: false, hitCount: 0, createdAt: 200 },
      ]);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointList({}));

      expect(ensureAdvancedFeaturesMock).toHaveBeenCalledOnce();
      expect(getAllEventBreakpointsMock).toHaveBeenCalledOnce();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Found 2 event breakpoint(s)');
      expect(body.breakpoints).toHaveLength(2);
    });

    it('returns failure when getAllEventBreakpoints throws', async () => {
      const debuggerManager = createDebuggerManager(true);
      getAllEventBreakpointsMock.mockImplementationOnce(() => {
        throw new Error('breakpoint store corrupted');
      });
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointList({}));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to list event breakpoints');
      expect(body.error).toBe('breakpoint store corrupted');
    });

    it('returns failure when getEventManager throws on list', async () => {
      const debuggerManager = createDebuggerManager(true);
      getEventManagerMock.mockImplementationOnce(() => {
        throw new Error('manager unavailable');
      });
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointList({}));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to list event breakpoints');
      expect(body.error).toBe('manager unavailable');
    });

    it('returns empty breakpoints list gracefully', async () => {
      const debuggerManager = createDebuggerManager(true);
      getAllEventBreakpointsMock.mockReturnValueOnce([]);
      const handlers = new EventBreakpointHandlers({
        debuggerManager,
      } as any);

      const body = parseBody<any>(await handlers.handleEventBreakpointList({}));

      expect(body.success).toBe(true);
      expect(body.message).toBe('Found 0 event breakpoint(s)');
      expect(body.breakpoints).toHaveLength(0);
    });
  });

  // ─── ensureAdvancedFeaturesIfSupported via TestableXXX ─────────────────

  describe('ensureAdvancedFeaturesIfSupported — advanced features call', () => {
    it('calls ensureAdvancedFeatures when manager supports it', async () => {
      const debuggerManager = createDebuggerManager(true);
      const handlers = new TestableEventBreakpointHandlers({
        debuggerManager,
      } as any);

      await handlers.testEnsureAdvancedFeaturesIfSupported();

      expect(ensureAdvancedFeaturesMock).toHaveBeenCalledOnce();
    });

    it('does not throw when manager does not support advanced features', async () => {
      const debuggerManager = createDebuggerManager(false);
      const handlers = new TestableEventBreakpointHandlers({
        debuggerManager,
      } as any);

      await expect(handlers.testEnsureAdvancedFeaturesIfSupported()).resolves.toBeUndefined();
    });
  });
});

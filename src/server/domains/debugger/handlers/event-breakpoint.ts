import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';

interface EventBreakpointHandlersDeps {
  debuggerManager: DebuggerManager;
}

interface AdvancedFeatureCapable {
  ensureAdvancedFeatures: () => Promise<void>;
}

function hasEnsureAdvancedFeatures(
  manager: DebuggerManager
): manager is DebuggerManager & AdvancedFeatureCapable {
  return typeof (manager as { ensureAdvancedFeatures?: unknown }).ensureAdvancedFeatures === 'function';
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

export class EventBreakpointHandlers {
  constructor(private deps: EventBreakpointHandlersDeps) {}

  private async ensureAdvancedFeaturesIfSupported(): Promise<void> {
    if (hasEnsureAdvancedFeatures(this.deps.debuggerManager)) {
      await this.deps.debuggerManager.ensureAdvancedFeatures();
    }
  }

  async handleEventBreakpointSet(args: Record<string, unknown>) {
    try {
      const eventName = args.eventName as string;
      const targetName = args.targetName as string | undefined;
      await this.ensureAdvancedFeaturesIfSupported();
      const eventManager = this.deps.debuggerManager.getEventManager();
      const breakpointId = await eventManager.setEventListenerBreakpoint(eventName, targetName);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Event breakpoint set',
                breakpointId,
                eventName,
                targetName,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to set event breakpoint',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleEventBreakpointSetCategory(args: Record<string, unknown>) {
    try {
      const category = args.category as 'mouse' | 'keyboard' | 'timer' | 'websocket';
      await this.ensureAdvancedFeaturesIfSupported();
      const eventManager = this.deps.debuggerManager.getEventManager();

      let breakpointIds: string[];
      switch (category) {
        case 'mouse':
          breakpointIds = await eventManager.setMouseEventBreakpoints();
          break;
        case 'keyboard':
          breakpointIds = await eventManager.setKeyboardEventBreakpoints();
          break;
        case 'timer':
          breakpointIds = await eventManager.setTimerEventBreakpoints();
          break;
        case 'websocket':
          breakpointIds = await eventManager.setWebSocketEventBreakpoints();
          break;
        default:
          throw new Error(`Unknown category: ${category}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Set ${breakpointIds.length} ${category} event breakpoint(s)`,
                category,
                breakpointIds,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to set event breakpoints',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleEventBreakpointRemove(args: Record<string, unknown>) {
    try {
      const breakpointId = args.breakpointId as string;
      await this.ensureAdvancedFeaturesIfSupported();
      const eventManager = this.deps.debuggerManager.getEventManager();
      const removed = await eventManager.removeEventListenerBreakpoint(breakpointId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: removed,
                message: removed ? 'Event breakpoint removed' : 'Event breakpoint not found',
                breakpointId,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to remove event breakpoint',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleEventBreakpointList(_args: Record<string, unknown>) {
    try {
      await this.ensureAdvancedFeaturesIfSupported();
      const eventManager = this.deps.debuggerManager.getEventManager();
      const breakpoints = eventManager.getAllEventBreakpoints();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Found ${breakpoints.length} event breakpoint(s)`,
                breakpoints,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to list event breakpoints',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}

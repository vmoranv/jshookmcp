import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import { argString } from '@server/domains/shared/parse-args';

interface XHRBreakpointHandlersDeps {
  debuggerManager: DebuggerManager;
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

export class XHRBreakpointHandlers {
  private deps: XHRBreakpointHandlersDeps;
  constructor(deps: XHRBreakpointHandlersDeps) {
    this.deps = deps;
  }

  async handleXHRBreakpointSet(args: Record<string, unknown>) {
    try {
      const urlPattern = argString(args, 'urlPattern', '');
      await (this.deps.debuggerManager as any).ensureAdvancedFeatures?.();
      const xhrManager = this.deps.debuggerManager.getXHRManager();
      const breakpointId = await xhrManager.setXHRBreakpoint(urlPattern);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'XHR breakpoint set',
                breakpointId,
                urlPattern,
              },
              null,
              2,
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
                message: 'Failed to set XHR breakpoint',
                error: getErrorMessage(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleXHRBreakpointRemove(args: Record<string, unknown>) {
    try {
      const breakpointId = argString(args, 'breakpointId', '');
      await (this.deps.debuggerManager as any).ensureAdvancedFeatures?.();
      const xhrManager = this.deps.debuggerManager.getXHRManager();
      const removed = await xhrManager.removeXHRBreakpoint(breakpointId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: removed,
                message: removed ? 'XHR breakpoint removed' : 'XHR breakpoint not found',
                breakpointId,
              },
              null,
              2,
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
                message: 'Failed to remove XHR breakpoint',
                error: getErrorMessage(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleXHRBreakpointList(_args: Record<string, unknown>) {
    try {
      await (this.deps.debuggerManager as any).ensureAdvancedFeatures?.();
      const xhrManager = this.deps.debuggerManager.getXHRManager();
      const breakpoints = xhrManager.getAllXHRBreakpoints();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Found ${breakpoints.length} XHR breakpoint(s)`,
                breakpoints,
              },
              null,
              2,
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
                message: 'Failed to list XHR breakpoints',
                error: getErrorMessage(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }
}

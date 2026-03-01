import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';

interface XHRBreakpointHandlersDeps {
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

export class XHRBreakpointHandlers {
  constructor(private deps: XHRBreakpointHandlersDeps) {}

  private async ensureAdvancedFeaturesIfSupported(): Promise<void> {
    if (hasEnsureAdvancedFeatures(this.deps.debuggerManager)) {
      await this.deps.debuggerManager.ensureAdvancedFeatures();
    }
  }

  async handleXHRBreakpointSet(args: Record<string, unknown>) {
    try {
      const urlPattern = args.urlPattern as string;
      await this.ensureAdvancedFeaturesIfSupported();
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
                message: 'Failed to set XHR breakpoint',
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

  async handleXHRBreakpointRemove(args: Record<string, unknown>) {
    try {
      const breakpointId = args.breakpointId as string;
      await this.ensureAdvancedFeaturesIfSupported();
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
                message: 'Failed to remove XHR breakpoint',
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

  async handleXHRBreakpointList(_args: Record<string, unknown>) {
    try {
      await this.ensureAdvancedFeaturesIfSupported();
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
                message: 'Failed to list XHR breakpoints',
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

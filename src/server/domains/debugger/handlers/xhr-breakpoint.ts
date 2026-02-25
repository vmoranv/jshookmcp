import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';

interface XHRBreakpointHandlersDeps {
  debuggerManager: DebuggerManager;
}

export class XHRBreakpointHandlers {
  constructor(private deps: XHRBreakpointHandlersDeps) {}

  private async ensureAdvancedFeaturesIfSupported(): Promise<void> {
    const debuggerManager = this.deps.debuggerManager as DebuggerManager & {
      ensureAdvancedFeatures?: () => Promise<void>;
    };
    if (typeof debuggerManager.ensureAdvancedFeatures === 'function') {
      await debuggerManager.ensureAdvancedFeatures();
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
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to set XHR breakpoint',
                error: error.message || String(error),
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
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to remove XHR breakpoint',
                error: error.message || String(error),
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
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to list XHR breakpoints',
                error: error.message || String(error),
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

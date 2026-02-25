import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';

interface BreakpointBasicHandlersDeps {
  debuggerManager: DebuggerManager;
}

export class BreakpointBasicHandlers {
  constructor(private deps: BreakpointBasicHandlersDeps) {}

  async handleBreakpointSet(args: Record<string, unknown>) {
    const url = args.url as string | undefined;
    const scriptId = args.scriptId as string | undefined;
    const lineNumber = args.lineNumber as number;
    const columnNumber = args.columnNumber as number | undefined;
    const condition = args.condition as string | undefined;

    let breakpoint;

    if (url) {
      breakpoint = await this.deps.debuggerManager.setBreakpointByUrl({
        url,
        lineNumber,
        columnNumber,
        condition,
      });
    } else if (scriptId) {
      breakpoint = await this.deps.debuggerManager.setBreakpoint({
        scriptId,
        lineNumber,
        columnNumber,
        condition,
      });
    } else {
      throw new Error('Either url or scriptId must be provided');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              breakpoint: {
                breakpointId: breakpoint.breakpointId,
                location: breakpoint.location,
                condition: breakpoint.condition,
                enabled: breakpoint.enabled,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleBreakpointRemove(args: Record<string, unknown>) {
    const breakpointId = args.breakpointId as string;

    await this.deps.debuggerManager.removeBreakpoint(breakpointId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Breakpoint ${breakpointId} removed`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleBreakpointList(_args: Record<string, unknown>) {
    const breakpoints = this.deps.debuggerManager.listBreakpoints();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: breakpoints.length,
              breakpoints: breakpoints.map((bp) => ({
                breakpointId: bp.breakpointId,
                location: bp.location,
                condition: bp.condition,
                enabled: bp.enabled,
                hitCount: bp.hitCount,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
}

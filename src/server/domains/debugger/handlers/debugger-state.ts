import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import type { RuntimeInspector } from '../../../../modules/debugger/RuntimeInspector.js';
import { ToolError } from '../../../../errors/ToolError.js';

interface DebuggerStateHandlersDeps {
  debuggerManager: DebuggerManager;
  runtimeInspector: RuntimeInspector;
}

export class DebuggerStateHandlers {
  constructor(private deps: DebuggerStateHandlersDeps) {}

  async handleDebuggerWaitForPaused(args: Record<string, unknown>) {
    const timeout = (args.timeout as number) || 30000;

    try {
      const pausedState = await this.deps.debuggerManager.waitForPaused(timeout);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                paused: true,
                reason: pausedState.reason,
                location: pausedState.callFrames[0]?.location,
                hitBreakpoints: pausedState.hitBreakpoints,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      // Let classified ToolErrors (including PrerequisiteError) propagate
      // to MCPServer's unified error handler
      if (error instanceof ToolError) {
        throw error;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                paused: false,
                message: error instanceof Error ? error.message : 'Timeout waiting for paused event',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleDebuggerGetPausedState(_args: Record<string, unknown>) {
    const pausedState = this.deps.debuggerManager.getPausedState();

    if (!pausedState) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                paused: false,
                message: 'Debugger is not paused',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              paused: true,
              reason: pausedState.reason,
              frameCount: pausedState.callFrames.length,
              topFrame: {
                functionName: pausedState.callFrames[0]?.functionName,
                location: pausedState.callFrames[0]?.location,
              },
              hitBreakpoints: pausedState.hitBreakpoints,
              timestamp: pausedState.timestamp,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleGetCallStack(_args: Record<string, unknown>) {
    const callStack = await this.deps.runtimeInspector.getCallStack();

    if (!callStack) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Not in paused state. Set a breakpoint and trigger it first.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              callStack: {
                frameCount: callStack.callFrames.length,
                reason: callStack.reason,
                frames: callStack.callFrames.map((frame, index) => ({
                  index,
                  callFrameId: frame.callFrameId,
                  functionName: frame.functionName,
                  location: `${frame.location.url}:${frame.location.lineNumber}:${frame.location.columnNumber}`,
                  scopeCount: frame.scopeChain.length,
                })),
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
}

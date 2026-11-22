import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import { ToolError } from '@errors/ToolError';
import { DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS } from '@src/constants';
import { argBool, argNumber } from '@server/domains/shared/parse-args';

interface DebuggerStateHandlersDeps {
  debuggerManager: DebuggerManager;
  runtimeInspector: RuntimeInspector;
}

export class DebuggerStateHandlers {
  private deps: DebuggerStateHandlersDeps;
  constructor(deps: DebuggerStateHandlersDeps) {
    this.deps = deps;
  }

  async handleDebuggerWaitForPaused(args: Record<string, unknown>) {
    const timeout = argNumber(args, 'timeout', DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS);

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
              2,
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
                message:
                  error instanceof Error ? error.message : 'Timeout waiting for paused event',
              },
              null,
              2,
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
              2,
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
            2,
          ),
        },
      ],
    };
  }

  async handleDebuggerCaptureHit(args: Record<string, unknown>) {
    const timeout = argNumber(args, 'timeout', DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS);
    const includeScope = argBool(args, 'includeScope', true);
    const includeObjectProperties = argBool(args, 'includeObjectProperties', false);
    const maxDepth = argNumber(args, 'maxDepth', 1);
    const skipErrors = argBool(args, 'skipErrors', true);

    try {
      const pausedState = await this.deps.debuggerManager.waitForPaused(timeout);
      const errors: string[] = [];
      const callStack = await this.deps.runtimeInspector.getCallStack().catch((error: unknown) => {
        errors.push(`callStack: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      const frames = callStack?.callFrames ?? pausedState.callFrames;
      const topFrame = frames[0];
      const topFrameId =
        typeof topFrame?.callFrameId === 'string' && topFrame.callFrameId.length > 0
          ? topFrame.callFrameId
          : undefined;
      const scope =
        includeScope && topFrameId
          ? await this.deps.debuggerManager
              .getScopeVariables({
                callFrameId: topFrameId,
                includeObjectProperties,
                maxDepth,
                skipErrors,
              })
              .catch((error: unknown) => {
                errors.push(`scope: ${error instanceof Error ? error.message : String(error)}`);
                return undefined;
              })
          : undefined;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                paused: true,
                reason: pausedState.reason,
                hitBreakpoints: pausedState.hitBreakpoints,
                timestamp: pausedState.timestamp,
                topFrame: this.summarizeFrame(topFrame as Record<string, unknown> | undefined),
                callStack: {
                  frameCount: frames.length,
                  reason: callStack?.reason ?? pausedState.reason,
                  frames: frames.map((frame, index) => ({
                    index,
                    ...this.summarizeFrame(frame as Record<string, unknown>),
                  })),
                },
                scope,
                errors,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
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
                message:
                  error instanceof Error ? error.message : 'Timeout waiting for paused event',
              },
              null,
              2,
            ),
          },
        ],
      };
    }
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
              2,
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
            2,
          ),
        },
      ],
    };
  }

  private summarizeFrame(frame: Record<string, unknown> | undefined) {
    const location =
      typeof frame?.['location'] === 'object' && frame['location'] !== null
        ? (frame['location'] as Record<string, unknown>)
        : undefined;
    const locationUrl = typeof location?.['url'] === 'string' ? location['url'] : undefined;
    const frameUrl = typeof frame?.['url'] === 'string' ? frame['url'] : undefined;
    return {
      callFrameId: typeof frame?.['callFrameId'] === 'string' ? frame['callFrameId'] : undefined,
      functionName: typeof frame?.['functionName'] === 'string' ? frame['functionName'] : undefined,
      url: frameUrl ?? locationUrl,
      location,
      scopeCount: Array.isArray(frame?.['scopeChain']) ? frame['scopeChain'].length : undefined,
    };
  }
}
